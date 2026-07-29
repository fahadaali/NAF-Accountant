// ============================================================================
// أعضاء المنصة تحت الدخول الموحّد — /api/members/*
//
// المصادقة مركزية والصلاحيات موزّعة: المركز يقرّر الدخول، وهذه المسارات
// تقرّر ما بعد الباب من جدول هذه المنصة وحده.
//
// وإيقاف عضو هنا يُبلَّغ للمركز عبر المسار الداخلي في الحزمة.
// ============================================================================

import { Hono } from 'hono';
import { reportAccessChange } from 'naf-auth';
import { authConfig } from '../auth/config.js';
import { authenticate } from '../lib/auth.js';

const members = new Hono();

const ROLES = ['admin', 'editor', 'viewer'];

// ---- العضو الحالي ----
// يُسجَّل قبل وسيط «مسؤول فقط» أدناه فلا يخضع له: كل عضو يقرأ نفسه.
// اللوحة تعرفه من كوكي الجلسة لا من رمز في الترويسة.
members.get('/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ ok: false, error: 'unauthorized' }, 401);
  return c.json({ ok: true, user });
});

// ---- الحماية: مسؤول فقط ----
members.use('/members/*', async (c, next) => {
  const who = await authenticate(c);
  if (!who) return c.json({ ok: false, error: 'unauthorized' }, 401);
  /* ولا هنا: ترقيةُ عضوٍ وإيقافُه قرارُ بشرٍ يمرّ بالمركز ويُسجَّل باسمه.
     انظر شرحه في `routes/admin.js` وفي `auth/middleware.js`. */
  if (who.apiKey || who.role !== 'admin') {
    return c.json({ ok: false, error: 'هذه العملية تتطلب صلاحية مسؤول' }, 403);
  }
  await next();
});

// ---- عرض الأعضاء ----
members.get('/members', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT user_id, display_name, email, role, is_active, last_seen_at, created_at
     FROM members ORDER BY created_at ASC`,
  ).all();
  return c.json({ ok: true, members: results || [] });
});

// ---- تغيير الدور أو إيقاف العضو ----
members.post('/members/update', async (c) => {
  const { user_id: userId, role, is_active: isActive, reason } =
    await c.req.json().catch(() => ({}));

  if (!userId) return c.json({ ok: false, error: 'هذا الحقل مطلوب' }, 400);

  /* ═══ حارسان على النفس ═══

     لا يوقف مسؤولُ المنصة حسابَه ولا ينزع عن نفسه صفته. وكلاهما يقفل
     الشاشة على صاحبها بلا طريق عودة: `‎/members/*` لا يُفتح إلا لمسؤول،
     فآخرُ مسؤولٍ يخفض نفسه يترك المنصة بلا من يرقّي أحداً — ولا يُصلَح إلا
     بكتابةٍ يدوية في القاعدة.

     والمركز يحرس هذا في `functions/api/admin/users.js` منذ البداية، وهذه
     الشاشة كانت لا تحرسه — والخطأ فيها أيسر وقوعاً: قائمةُ أعضاءٍ يظهر فيها
     المسؤول بين البقية بلا ما يميّزه.

     ويُستثنى المفتاح الآلي: لا نفس له تُحرَس. */
  const actor = await authenticate(c);
  if (actor && !actor.apiKey && actor.id === userId) {
    if (isActive === false || isActive === 0) {
      return c.json({ ok: false, error: 'لا يمكنك إيقاف حسابك' }, 400);
    }
    if (role && role !== 'admin') {
      return c.json({ ok: false, error: 'لا يمكنك خفض صلاحيتك' }, 400);
    }
  }

  // البريد يُقرأ هنا لأن المركز يطابق صفّ الوصول به لا بالمعرّف المركزي.
  const member = await c.env.DB.prepare(
    `SELECT user_id, email, is_active, role FROM members WHERE user_id = ?`,
  )
    .bind(userId)
    .first();
  if (!member) return c.json({ ok: false, error: 'لا عضو بهذا المعرّف' }, 404);

  if (role) {
    if (!ROLES.includes(role)) return c.json({ ok: false, error: 'هذا الحقل مطلوب' }, 400);
    await c.env.DB.prepare(`UPDATE members SET role = ? WHERE user_id = ?`)
      .bind(role, userId)
      .run();
  }

  // الدور المعروض في المركز بعد هذا الطلب — لا الذي كان قبله.
  const currentRole = role || member.role;

  /* تغيير دورٍ وحده يُبلَّغ به المركز ليعرضه في صفّ الوصول.

     مسؤول النظام يمنح وصولاً إلى هذه المنصة ولا تقول له أي شاشة ماذا صار
     يرى الممنوح. والقرار يبقى هنا: المركز يعرض ولا يقرأ هذه القيمة في أي
     قرار دخول.

     وبلا `state`: المنح لم يتغيّر، وكتابته مع كل ترقية تمحو سحباً صادراً
     من المركز. والفشل لا يُرفع — الترقية نافذة محلياً فور كتابتها. */
  if (isActive === undefined) {
    if (!role || !member.email) return c.json({ ok: true, reported: null });
    try {
      await reportAccessChange(c.env, authConfig(c.env), {
        email: member.email,
        role: currentRole,
      });
      return c.json({ ok: true, reported: true });
    } catch (err) {
      console.error('naf-auth: access_report_failed');
      return c.json({ ok: true, reported: false });
    }
  }

  const next = isActive ? 1 : 0;
  const wasActive = Number(member.is_active) === 1;

  // الإيقاف يُبلَّغ للمركز، والسبب يُعرض للعضو في شبكته كما كُتب.
  if (!next && !String(reason || '').trim()) {
    return c.json(
      { ok: false, error: 'اكتب سبب التعطيل — يُعرض للمستخدمين على البطاقة' },
      400,
    );
  }

  await c.env.DB.prepare(`UPDATE members SET is_active = ? WHERE user_id = ?`)
    .bind(next, userId)
    .run();

  // لا تبليغ بلا تغيّر فعلي في الحالة.
  if (!!next === wasActive) return c.json({ ok: true, reported: null });

  // عضوٌ بلا بريد لا يمكن تبليغ المركز عنه: جدول الوصول هناك يُطابَق
  // بالبريد. والتغيير المحلي قائم على أي حال — والباب مغلق من هنا.
  if (!member.email) return c.json({ ok: true, reported: false });

  // التغيير المحلي وقع أولاً فالوصول ممنوع الآن، ثم يُبلَّغ المركز.
  // وفشل التبليغ لا يُعيد فتح الباب — يُعاد المحاولة من اللوحة.
  try {
    await reportAccessChange(c.env, authConfig(c.env), {
      email: member.email,
      state: next ? 'granted' : 'revoked',
      reason: String(reason || '').trim() || undefined,
      // والصلاحية مع الحالة: السحب لا يمحوها في المركز — يُبقيها `COALESCE`
      // هناك — فيبقى المسؤول يرى ما كان يملكه المسحوب حين يحتاج معرفته.
      role: currentRole,
    });
    return c.json({ ok: true, reported: true });
  } catch (err) {
    console.error('naf-auth: access_report_failed');
    return c.json({ ok: true, reported: false });
  }
});

export default members;

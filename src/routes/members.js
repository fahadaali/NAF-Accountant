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
  if (!who.apiKey && who.role !== 'admin') {
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

  const member = await c.env.DB.prepare(
    `SELECT user_id, is_active FROM members WHERE user_id = ?`,
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

  if (isActive === undefined) return c.json({ ok: true, reported: null });

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

  // التغيير المحلي وقع أولاً فالوصول ممنوع الآن، ثم يُبلَّغ المركز.
  // وفشل التبليغ لا يُعيد فتح الباب — يُعاد المحاولة من اللوحة.
  try {
    await reportAccessChange(c.env, authConfig(c.env), {
      userId,
      status: next ? 'granted' : 'revoked',
      reason: String(reason || '').trim() || undefined,
    });
    return c.json({ ok: true, reported: true });
  } catch (err) {
    console.error('naf-auth: access_report_failed');
    return c.json({ ok: true, reported: false });
  }
});

export default members;

// ============================================================================
// إعداد الدخول الموحّد (naf-auth) لهذه المنصة.
//
// المنطق كله في الحزمة — هنا ما يخصّ هذه المنصة وحدها: قائمة المسارات
// العامة، ومطابقة العضو القادم بسجلّه المحلي القائم.
// ============================================================================

import { createConfig } from 'naf-auth';

// ----------------------------------------------------------------------------
// المسارات العامة — تُكتب صراحةً، وأي مسار غيرها محمي افتراضياً.
// ----------------------------------------------------------------------------
const PUBLIC_PATHS = [
  // مسار الاستقبال وصفحة الرفض — لا تُحمى وإلا دارت الحلقة على نفسها.
  '/auth/callback',
  '/denied',

  // فحص الصحة.
  '/api/health',

  // ويبهوك تليجرام: يستدعيه تليجرام آلياً لا متصفّح، ومحميّ بترويسة
  // X-Telegram-Bot-Api-Secret-Token في المسار نفسه. حمايته بالوسيط تعطّل البوت.
  '/api/telegram-webhook',

  // رجوع OAuth بيسكامب: يستدعيه بيسكامب لا المستخدم، فلا كوكي جلسة معه.
  // أمّا /api/basecamp/start فيبدأه المستخدم من اللوحة ويبقى محمياً.
  '/api/basecamp/callback',
];

// الأصول الساكنة للوحة التحكم — بادئة مُعلنة لا اجتهاد على الامتداد.
const PUBLIC_PREFIXES = ['/assets/'];

// ----------------------------------------------------------------------------
// مقابلة أدوار النظام السابق بأدوار الدخول الموحّد.
// ----------------------------------------------------------------------------
const LEGACY_ROLES = {
  admin: 'admin',
  user: 'editor',
};

/** الطابع الزمني بصيغة الجدول (epoch ثوانٍ) — نفس صيغة الحزمة. */
function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

/**
 * نقطة التعليق بين التحقق والإدراج.
 *
 * تربط العضو القادم من المركز بسجلّه في نظام المستخدمين السابق بمطابقة
 * البريد، فتُنشئ صفّه في `members` بدوره وحالته الحاليين قبل أن يمرّ
 * `upsertMember` — وهو لا يمسّ الدور ولا التفعيل على صفّ قائم، فيبقى ما رُحّل.
 *
 * وبلا سجلّ سابق لا تفعل شيئاً، فيُنشئه `upsertMember` بالدور الافتراضي.
 */
async function linkLegacyMember(claims, env, config) {
  const db = env[config.dbBinding];

  // رُبط من قبل؟ لا شيء — والدخول الثاني لا يمرّ من هنا أصلاً.
  const already = await db
    .prepare(`SELECT user_id FROM members WHERE user_id = ?`)
    .bind(claims.sub)
    .first();
  if (already) return;

  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) return;

  // بريد له صفّ عضوية سابق بمعرّف آخر: لا يُنشأ له صفّ ثانٍ.
  const duplicate = await db
    .prepare(`SELECT user_id FROM members WHERE lower(email) = ?`)
    .bind(email)
    .first();
  if (duplicate) return;

  const legacy = await db
    .prepare(`SELECT role, is_active FROM users WHERE lower(email) = ?`)
    .bind(email)
    .first();
  if (!legacy) return;

  await db
    .prepare(
      `INSERT OR IGNORE INTO members
         (user_id, display_name, email, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      claims.sub,
      claims.name ?? null,
      claims.email ?? null,
      LEGACY_ROLES[legacy.role] || config.defaultRole,
      Number(legacy.is_active) === 1 ? 1 : 0,
      nowEpoch(),
    )
    .run();
}

/**
 * إعداد الحزمة لهذه المنصة.
 *
 * `PLATFORM_ID` و `AUTH_ISSUER` من `wrangler.toml`، و `AUTH_CLIENT_SECRET`
 * من `wrangler secret` — لا يُقرأ هنا ولا يُسجَّل.
 */
export function authConfig(env) {
  return createConfig(env, {
    publicPaths: PUBLIC_PATHS,
    publicPrefixes: PUBLIC_PREFIXES,
    onClaims: linkLegacyMember,

    /**
     * الرمز ورسالته وحدهما — ولا الرمز الموقّع ولا السرّ ولا نصّ استجابة
     * المركز. والرسالة تحمل حالةَ الردّ لا جسمه، فهي آمنة ولازمة:
     * `exchange_failed` وحده يحتمل سرّاً خاطئاً (٤٠١) ورمزاً مستهلَكاً
     * (٤٠٠) وعضواً غير مخوَّل (٤٠٣) — والتفريق بينها بلا الحالة تخمين.
     */
    onError: (code, err) => {
      const status = err && err.message && err.message !== code ? ` — ${err.message}` : '';
      console.error(`naf-auth: ${code}${status}`);
    },
  });
}

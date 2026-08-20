-- ============================================================================
-- أعضاء المنصة تحت الدخول الموحّد (naf-auth)
--
-- المخطّط هو مخطّط `migrations/members.sql` في الحزمة حرفياً، فلا تُضبط أي
-- من متغيّرات MEMBERS_* في wrangler.toml وتبقى المنصة على الافتراضي كبقية
-- المنصات.
--
-- هجرة إضافية بالكامل: جدولا `users` و `sessions` القائمان لا يُمسّان ولا
-- يُحذفان. الهجرات للأمام فقط.
--
-- الترحيل: لا تُبذَر السجلات هنا لأن `user_id` هو `sub` القادم من المركز ولا
-- يُعرف قبل أول دخول. الربط يقع في `onClaims` بمطابقة البريد مع `users`
-- (انظر src/auth/config.js)، ومقابلة الأدوار المعتمدة:
--     admin → admin        (المسؤول الحالي يبقى مسؤولاً)
--     user  → editor       (يحفظ قدرة الأعضاء الحاليين كما هي)
--     بلا سجلّ سابق → viewer (الدور الافتراضي في الحزمة)
-- ============================================================================

CREATE TABLE IF NOT EXISTS members (
  user_id      TEXT PRIMARY KEY,   -- sub القادم من المركز
  display_name TEXT,
  email        TEXT,
  role         TEXT NOT NULL DEFAULT 'viewer',   -- admin | editor | viewer
  perms        TEXT,               -- JSON للصلاحيات الدقيقة
  is_active    INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER,
  created_at   INTEGER NOT NULL
);

-- البحث بالبريد عند مطابقة عضو قادم بسجلّ قائم.
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);

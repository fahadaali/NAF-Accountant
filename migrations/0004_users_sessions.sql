-- ============================================================================
-- المستخدمون والجلسات (Authentication)
-- تسجيل الدخول بالبريد وكلمة المرور مع حساب مسؤول أول.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,          -- PBKDF2-SHA256 (hex)
  password_salt  TEXT NOT NULL,          -- ملح عشوائي (hex)
  role           TEXT NOT NULL DEFAULT 'admin',   -- admin | user
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,          -- رمز جلسة عشوائي
  user_id     INTEGER NOT NULL,
  expires_at  TEXT NOT NULL,             -- انتهاء الصلاحية (UTC)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

-- ============================================================================
-- محادثات تليجرام المصرّح لها + العمليات المتكرّرة
-- ============================================================================

-- ----------------------------------------------------------------------------
-- المحادثات المصرّح لها (بديل إدارة AUTHORIZED_CHAT_IDS يدوياً في Cloudflare)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id     TEXT PRIMARY KEY,              -- معرّف محادثة تليجرام
  label       TEXT,                          -- اسم الموظف/المجموعة للتمييز
  is_admin    INTEGER NOT NULL DEFAULT 0,    -- يستقبل تنبيهات فشل المهام
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tg_chats_active ON telegram_chats(is_active);

-- ----------------------------------------------------------------------------
-- العمليات المتكرّرة (إيجار/رواتب... تُنشأ تلقائياً شهرياً)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT NOT NULL,               -- وصف للتعريف (مثال: إيجار المكتب)
  day_of_month  INTEGER NOT NULL DEFAULT 1,  -- يوم التنفيذ (1..28)
  template_json TEXT NOT NULL,               -- قالب العملية (نفس صيغة processed_json)
  notify_chat_id TEXT,                       -- محادثة تُبلَّغ بالتنفيذ
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_run_ym   TEXT,                        -- آخر شهر نُفّذ فيه (YYYY-MM) لمنع التكرار
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring_transactions(is_active, day_of_month);

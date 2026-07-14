-- ============================================================================
-- NAF Accountant — Cloudflare D1 Schema (المرحلة الأولى)
-- شركة ناف لو — هيكل قاعدة البيانات
-- ============================================================================

-- ----------------------------------------------------------------------------
-- شجرة الحسابات (Chart of Accounts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_code  TEXT    NOT NULL UNIQUE,          -- رمز الحساب (مثال: 1010)
  account_name  TEXT    NOT NULL,                 -- اسم الحساب (مثال: الصندوق)
  account_type  TEXT    NOT NULL,                 -- النوع: asset | liability | equity | revenue | expense
  wafeq_account_id TEXT,                          -- معرّف الحساب المقابل في وافق (للمزامنة)
  is_active     INTEGER NOT NULL DEFAULT 1,       -- هل الحساب نشط؟
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coa_type   ON chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_coa_active ON chart_of_accounts(is_active);

-- ----------------------------------------------------------------------------
-- العمليات المالية (Transactions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_message_id TEXT,                        -- معرّف رسالة تليجرام
  telegram_chat_id    TEXT,                        -- معرّف المحادثة المرسِلة
  source_type         TEXT NOT NULL DEFAULT 'text',-- نوع المصدر: text | voice | image
  raw_text            TEXT,                        -- النص الأصلي / المُفرّغ صوتياً
  media_r2_key        TEXT,                        -- مفتاح الملف في R2 (صوت/صورة)
  processed_json      TEXT,                        -- مخرجات الذكاء الاصطناعي (JSON للقيد)
  wafeq_draft_id      TEXT,                        -- معرّف المسودة في وافق
  status              TEXT NOT NULL DEFAULT 'received',
                       -- الحالات: received | transcribed | analyzed | posted | failed
  error_message       TEXT,                        -- تفاصيل الخطأ إن وجد
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_status  ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_tg_msg  ON transactions(telegram_message_id);

-- ----------------------------------------------------------------------------
-- سجل العمليات (Logs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER,                          -- ربط اختياري بعملية
  action         TEXT NOT NULL,                    -- الإجراء (مثال: whisper_transcribe, claude_analyze, wafeq_post)
  status         TEXT NOT NULL,                    -- success | error | info
  error_details  TEXT,                             -- تفاصيل الخطأ
  timestamp      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_ts     ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);

-- ----------------------------------------------------------------------------
-- إعدادات النظام (Settings) — لتخزين إعدادات غير حساسة قابلة للتعديل من اللوحة
-- ملاحظة: المفاتيح الحساسة تبقى في Cloudflare Secrets وليست هنا.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

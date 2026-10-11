-- ============================================================================
-- حالة المستند في وافق كما قُرئت آخر مرة
--
-- البوت ينشئ المستند مسودةً، ثم يُعتمد أو يُحذف داخل وافق نفسه دون أن يعلم.
-- تُقرأ الحالة من وافق عند عرض المسودة في تليجرام وتُحفظ هنا.
--
-- جدولٌ مستقل لا أعمدة في `transactions`: إضافة عمود في SQLite لا تقبل
-- `IF NOT EXISTS`، فتفشل إعادة تشغيل الترحيلات — و`scripts/migrate.mjs` يعيد
-- تشغيلها كلها ويعتمد على أن تكرارها آمن.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wafeq_doc_status (
  wafeq_id    TEXT PRIMARY KEY,               -- معرّف المستند في وافق (transactions.wafeq_draft_id)
  doc_type    TEXT NOT NULL,                  -- manual_journal | purchase_bill | sales_invoice
  status      TEXT NOT NULL,                  -- كما تُرجعه وافق (DRAFT …)، أو DELETED عند 404
  synced_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

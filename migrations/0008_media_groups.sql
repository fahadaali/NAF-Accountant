-- ============================================================================
-- صور الألبوم (media group) — تُقرأ فاتورةً واحدة
--
-- تليجرام يرسل كل صورة في الألبوم تحديثاً مستقلاً يجمعها `media_group_id`.
-- كانت كل صورة تُحلَّل وحدها فتصير فاتورة من صفحتين مسودتين. يُسجَّل هنا كل
-- عنصر عند وصوله، وبعد هدوء قصير «يستلم» أحدها المجموعة كلها ذرّياً ويحلّلها
-- في طلب واحد، والبقية تنسحب.
-- ============================================================================

CREATE TABLE IF NOT EXISTS media_group_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id        TEXT NOT NULL,               -- media_group_id من تليجرام
  chat_id         TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  transaction_id  INTEGER,                     -- صفّ العملية الذي أنشأته رسالة هذا العنصر
  r2_key          TEXT,                        -- NULL = لم يُحفظ بعد، '' = تعذّر تحضيره
  media_type      TEXT,
  caption         TEXT,
  created_ms      INTEGER NOT NULL,            -- لحظة الوصول بالملّي ثانية (لقياس الهدوء)
  claimed_by      INTEGER                      -- معرّف عملية العنصر الذي استلم المجموعة
);

CREATE INDEX IF NOT EXISTS idx_mgi_group ON media_group_items(group_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_mgi_claimed ON media_group_items(claimed_by);

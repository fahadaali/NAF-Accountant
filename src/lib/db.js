// ============================================================================
// مساعدات قاعدة البيانات (D1 Helpers)
// ============================================================================

/**
 * تسجيل حدث في جدول logs.
 */
export async function writeLog(db, { transactionId = null, action, status, errorDetails = null }) {
  try {
    await db
      .prepare(
        `INSERT INTO logs (transaction_id, action, status, error_details)
         VALUES (?, ?, ?, ?)`
      )
      .bind(transactionId, action, status, errorDetails)
      .run();
  } catch (e) {
    // لا نريد أن يُفشل التسجيل العملية الأساسية
    console.error('writeLog failed:', e);
  }
}

/*
 * أعطال D1 العابرة — انقطاعٌ في الطريق إلى القاعدة لا خطأٌ في الاستعلام.
 * توصي Cloudflare بإعادة المحاولة عندها، والاستعلام نفسه سليم.
 */
const D1_TRANSIENT = /Network connection lost|object to be reset|transient issue/i;

/**
 * تنفيذ عملية D1 مع إعادة المحاولة عند الأعطال العابرة وحدها.
 *
 * ⚠️ للعمليات الآمنة التكرار فقط (upsert، قراءة): انقطاع الاتصال لا يقول
 * هل نُفّذت الكتابة أم لا، فإعادة إدراجٍ عادي قد تكرّره.
 */
export async function withD1Retry(fn, { attempts = 3, delayMs = 500 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const transient = D1_TRANSIENT.test(String((err && err.message) || err));
      if (!transient || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

/**
 * إنشاء سجل عملية جديد وإرجاع معرّفه.
 */
export async function createTransaction(db, data) {
  const {
    telegramMessageId = null,
    telegramChatId = null,
    sourceType = 'text',
    rawText = null,
    mediaR2Key = null,
    status = 'received',
  } = data;

  const result = await db
    .prepare(
      `INSERT INTO transactions
        (telegram_message_id, telegram_chat_id, source_type, raw_text, media_r2_key, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(telegramMessageId, telegramChatId, sourceType, rawText, mediaR2Key, status)
    .run();

  return result.meta.last_row_id;
}

/**
 * تحديث سجل عملية.
 */
export async function updateTransaction(db, id, fields) {
  const columns = [];
  const values = [];

  const map = {
    sourceType: 'source_type',
    rawText: 'raw_text',
    processedJson: 'processed_json',
    wafeqDraftId: 'wafeq_draft_id',
    status: 'status',
    errorMessage: 'error_message',
    mediaR2Key: 'media_r2_key',
  };

  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      columns.push(`${col} = ?`);
      values.push(fields[key]);
    }
  }

  if (columns.length === 0) return;

  columns.push(`updated_at = datetime('now')`);
  values.push(id);

  await db
    .prepare(`UPDATE transactions SET ${columns.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * سحب شجرة الحسابات النشطة القابلة للترحيل إلى وافق فقط.
 * نستبعد أي حساب بلا wafeq_account_id (مثل الحسابات التجريبية المزروعة)
 * حتى لا يختارها Claude فيُرفض القيد في وافق.
 */
export async function getActiveAccounts(db) {
  const { results } = await db
    .prepare(
      `SELECT account_code, account_name, account_type, wafeq_account_id
       FROM chart_of_accounts
       WHERE is_active = 1
         AND wafeq_account_id IS NOT NULL
         AND wafeq_account_id != ''
       ORDER BY account_code ASC`
    )
    .all();
  return results || [];
}

/** تحويل صف عملية إلى كائن هدف موحّد. */
function toTarget(row) {
  if (!row || !row.processed_json) return null;
  try {
    return {
      id: row.id,
      wafeqId: row.wafeq_draft_id,
      // مفتاح المرفق يرافق الهدف كي ينتقل إلى النسخة المعدّلة عند التعديل.
      mediaR2Key: row.media_r2_key || null,
      result: JSON.parse(row.processed_json),
    };
  } catch (_) {
    return null;
  }
}

const POSTED_WHERE = `telegram_chat_id = ? AND status = 'posted' AND wafeq_draft_id IS NOT NULL`;

/**
 * العملية المُرحّلة رقم n من الآخر (1 = الأخيرة، 2 = قبل الأخيرة...).
 * @returns {Promise<null | {id:number, wafeqId:string, mediaR2Key:string|null, result:object}>}
 */
export async function getPostedTransactionByOffset(db, chatId, n = 1) {
  const offset = Math.max(0, (Number(n) || 1) - 1);
  const row = await db
    .prepare(
      `SELECT id, wafeq_draft_id, media_r2_key, processed_json FROM transactions
       WHERE ${POSTED_WHERE} ORDER BY id DESC LIMIT 1 OFFSET ?`
    )
    .bind(String(chatId), offset)
    .first();
  return toTarget(row);
}

/** عملية مُرحّلة بمعرّف وافق (يقبل تطابقاً جزئياً لتسهيل الكتابة). */
export async function getPostedTransactionByWafeqId(db, chatId, wafeqId) {
  const row = await db
    .prepare(
      `SELECT id, wafeq_draft_id, media_r2_key, processed_json FROM transactions
       WHERE ${POSTED_WHERE} AND wafeq_draft_id LIKE ?
       ORDER BY id DESC LIMIT 1`
    )
    .bind(String(chatId), `%${wafeqId}%`)
    .first();
  return toTarget(row);
}

/** بحث في العمليات المُرحّلة بالنص (الوصف/جهة الاتصال/النص الأصلي). */
export async function searchPostedTransactions(db, chatId, query, limit = 5) {
  const { results } = await db
    .prepare(
      `SELECT id, wafeq_draft_id, media_r2_key, processed_json FROM transactions
       WHERE ${POSTED_WHERE} AND (raw_text LIKE ? OR processed_json LIKE ?)
       ORDER BY id DESC LIMIT ?`
    )
    .bind(String(chatId), `%${query}%`, `%${query}%`, limit)
    .all();
  return (results || []).map(toTarget).filter(Boolean);
}

/** قائمة آخر العمليات المُرحّلة (لعرض خيارات الاستهداف). */
export async function listPostedTransactions(db, chatId, limit = 10) {
  const { results } = await db
    .prepare(
      `SELECT id, wafeq_draft_id, media_r2_key, processed_json FROM transactions
       WHERE ${POSTED_WHERE} ORDER BY id DESC LIMIT ?`
    )
    .bind(String(chatId), limit)
    .all();
  return (results || []).map(toTarget).filter(Boolean);
}

/* ═══ قوائم المحادثة: المسودات والقيود ═══

   المسودة في وافق فاتورةُ مشتريات أو مبيعات. والقيد اليدوي يُرحَّل مباشرة
   (وافق لا تدعم مسودته)، فيُعرض في قائمة منفصلة لا بين المسودات. والنوع
   داخل `processed_json`، فيُقرأ بـ`json_extract`. */
const LIST_TYPES = {
  drafts: `json_extract(processed_json, '$.type') IN ('purchase_bill', 'sales_invoice')`,
  journals: `json_extract(processed_json, '$.type') = 'manual_journal'`,
};

/**
 * صفحة من عمليات المحادثة المُرحّلة، الأحدث أولاً.
 * @param {'drafts'|'journals'} kind
 * @returns {Promise<{items:Array, total:number}>}
 */
export async function listChatDocuments(db, chatId, kind, { offset = 0, limit = 5 } = {}) {
  const where = `${POSTED_WHERE} AND ${LIST_TYPES[kind] || LIST_TYPES.drafts}`;
  const { results } = await db
    .prepare(
      `SELECT id, wafeq_draft_id, media_r2_key, processed_json FROM transactions
       WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .bind(String(chatId), limit, Math.max(0, Number(offset) || 0))
    .all();
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE ${where}`)
    .bind(String(chatId))
    .first();
  return { items: (results || []).map(toTarget).filter(Boolean), total: Number(count?.n || 0) };
}

/**
 * عملية مُرحّلة بمعرّفها — محصورة بالمحادثة: زرٌّ في محادثة لا يبلغ عملية
 * غيرها ولو عُدّل معرّفه.
 */
export async function getChatPostedTransaction(db, chatId, txId) {
  const row = await db
    .prepare(
      `SELECT id, wafeq_draft_id, media_r2_key, processed_json FROM transactions
       WHERE ${POSTED_WHERE} AND id = ? LIMIT 1`
    )
    .bind(String(chatId), Number(txId))
    .first();
  return toTarget(row);
}

// ----------------------------------------------------------------------------
// حالة المحادثة (Conversation State) — للحوار التفاعلي عند نقص البيانات.
// ----------------------------------------------------------------------------

/**
 * سحب السياق المعلّق لمحادثة (أو null).
 * السياق الأقدم من maxAgeMinutes يُعتبر منتهياً ويُحذف (يمنع تعليق سياق قديم).
 */
export async function getConversationState(db, chatId, maxAgeMinutes = 30) {
  const row = await db
    .prepare(`SELECT pending_json, updated_at FROM conversation_state WHERE chat_id = ?`)
    .bind(String(chatId))
    .first();
  if (!row || !row.pending_json) return null;

  // انتهاء صلاحية السياق (updated_at مخزّن بتوقيت UTC).
  const updatedMs = Date.parse((row.updated_at || '').replace(' ', 'T') + 'Z');
  if (updatedMs && Date.now() - updatedMs > maxAgeMinutes * 60 * 1000) {
    await clearConversationState(db, chatId);
    return null;
  }

  try {
    return JSON.parse(row.pending_json);
  } catch (_) {
    return null;
  }
}

/**
 * حفظ/تحديث السياق المعلّق لمحادثة.
 */
export async function setConversationState(db, chatId, context) {
  await db
    .prepare(
      `INSERT INTO conversation_state (chat_id, pending_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET
          pending_json = excluded.pending_json,
          updated_at = datetime('now')`
    )
    .bind(String(chatId), JSON.stringify(context))
    .run();
}

/**
 * مسح السياق المعلّق بعد اكتمال العملية أو إلغائها.
 */
export async function clearConversationState(db, chatId) {
  await db
    .prepare(`DELETE FROM conversation_state WHERE chat_id = ?`)
    .bind(String(chatId))
    .run();
}

// ----------------------------------------------------------------------------
// منع التكرار وكشف العمليات المكرّرة
// ----------------------------------------------------------------------------

/**
 * هل عُولجت رسالة تليجرام هذه سابقاً؟ (يمنع الترحيل مرتين عند إعادة الويبهوك)
 */
export async function isMessageProcessed(db, chatId, messageId) {
  const row = await db
    .prepare(
      `SELECT id FROM transactions
       WHERE telegram_chat_id = ? AND telegram_message_id = ? LIMIT 1`
    )
    .bind(String(chatId), String(messageId))
    .first();
  return !!row;
}

/**
 * البحث عن عملية مُرحّلة مشابهة في نفس اليوم (نفس النوع والمبلغ وجهة الاتصال).
 * @returns {Promise<null|{id:number, wafeqId:string, summary:string}>}
 */
export async function findSimilarPostedToday(db, chatId, { type, total, currency, contactName, date }) {
  const { results } = await db
    .prepare(
      `SELECT id, wafeq_draft_id, media_r2_key, processed_json FROM transactions
       WHERE telegram_chat_id = ? AND status = 'posted' AND wafeq_draft_id IS NOT NULL
         AND date(created_at) = date('now')
       ORDER BY id DESC LIMIT 20`
    )
    .bind(String(chatId))
    .all();

  for (const row of results || []) {
    let r;
    try {
      r = JSON.parse(row.processed_json);
    } catch (_) {
      continue;
    }
    if (r.type !== type) continue;
    if (date && r.date !== date) continue;
    if ((contactName || '') !== (r.contact_name || '')) continue;
    // مبلغان متساويان بعملتين مختلفتين ليسا تكراراً — 500 دولار غير 500 ريال.
    if (currency && (r.currency || currency) !== currency) continue;

    // إجمالي العملية السابقة.
    let prevTotal = 0;
    if (r.type === 'manual_journal') {
      prevTotal = (r.manual_journal?.entries || []).reduce((s, e) => s + Number(e.debit || 0), 0);
    } else if (r.type === 'purchase_bill') {
      prevTotal = (r.bill?.line_items || []).reduce((s, li) => s + Number(li.amount || 0), 0);
    } else {
      prevTotal = (r.invoice?.line_items || []).reduce((s, li) => s + Number(li.amount || 0), 0);
    }

    if (Math.abs(prevTotal - Number(total || 0)) < 0.01) {
      return { id: row.id, wafeqId: row.wafeq_draft_id, summary: r.summary || '' };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// محادثات تليجرام المصرّح لها
// ----------------------------------------------------------------------------

/* حُذفت `getActiveChats` و`getAdminChats`: لا مستدعي لهما في المستودع
   كلّه. و`services/telegram.js` يكتب استعلاميهما داخلياً — نسختان من
   استعلام واحد، تُعدَّل إحداهما فتبقى الأخرى. المصدر في `telegram.js`. */

// ----------------------------------------------------------------------------
// العمليات المتكرّرة
// ----------------------------------------------------------------------------

/** القوالب المتكرّرة المستحقّة اليوم ولم تُنفّذ هذا الشهر. */
export async function getDueRecurring(db, dayOfMonth, ym) {
  const { results } = await db
    .prepare(
      `SELECT id, label, template_json, notify_chat_id FROM recurring_transactions
       WHERE is_active = 1 AND day_of_month = ?
         AND (last_run_ym IS NULL OR last_run_ym != ?)`
    )
    .bind(Number(dayOfMonth), ym)
    .all();
  return (results || []).map((r) => {
    try {
      return { ...r, template: JSON.parse(r.template_json) };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

/** تسجيل تنفيذ قالب متكرّر لهذا الشهر. */
export async function markRecurringRun(db, id, ym) {
  await db
    .prepare(`UPDATE recurring_transactions SET last_run_ym = ? WHERE id = ?`)
    .bind(ym, id)
    .run();
}

// ----------------------------------------------------------------------------
// صور الألبوم (media group) — `migrations/0008_media_groups.sql`
// ----------------------------------------------------------------------------

/** تسجيل عنصر ألبوم لحظة وصوله، قبل تنزيل ملفه. */
export async function addAlbumItem(db, { groupId, chatId, messageId, txId, caption }) {
  await db
    .prepare(
      `INSERT INTO media_group_items (group_id, chat_id, message_id, transaction_id, caption, created_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(String(groupId), String(chatId), String(messageId), txId, caption || null, Date.now())
    .run();
}

/** ربط العنصر بملفه المحفوظ — أو '' إن تعذّر تحضيره فلا يُنتظر. */
export async function setAlbumItemMedia(db, txId, r2Key, mediaType = null) {
  await db
    .prepare(`UPDATE media_group_items SET r2_key = ?, media_type = ? WHERE transaction_id = ?`)
    .bind(r2Key, mediaType, txId)
    .run();
}

/**
 * محاولة استلام المجموعة كلها ذرّياً.
 *
 * تنجح حين تكون كل العناصر قد حُفظت ولم يصل جديدٌ منذ `quietMs` — أو دون
 * شرطٍ مع `force`. والتحديث جملة واحدة، فلا يستلم المجموعةَ عنصران.
 * @returns {Promise<boolean>} هل استلمها هذا العنصر.
 */
export async function claimAlbum(db, { groupId, chatId, txId, quietMs, force = false }) {
  const g = String(groupId);
  const c = String(chatId);
  const res = await db
    .prepare(
      `UPDATE media_group_items SET claimed_by = ?
       WHERE group_id = ? AND chat_id = ? AND claimed_by IS NULL
         AND (? = 1 OR (
           NOT EXISTS (SELECT 1 FROM media_group_items
                       WHERE group_id = ? AND chat_id = ? AND r2_key IS NULL)
           AND (SELECT MAX(created_ms) FROM media_group_items
                WHERE group_id = ? AND chat_id = ?) < ?))`
    )
    .bind(txId, g, c, force ? 1 : 0, g, c, g, c, Date.now() - quietMs)
    .run();
  return Number(res?.meta?.changes || 0) > 0;
}

/** من استلم عنصر هذه العملية (null = لم يُستلم بعد). */
export async function albumClaimedBy(db, txId) {
  const row = await db
    .prepare(`SELECT claimed_by FROM media_group_items WHERE transaction_id = ? LIMIT 1`)
    .bind(txId)
    .first();
  return row ? row.claimed_by : null;
}

/** عناصر المجموعة التي استلمتها عملية ما، بترتيب إرسالها. */
export async function listAlbumItems(db, leaderTxId) {
  const { results } = await db
    .prepare(
      `SELECT message_id, transaction_id, r2_key, media_type, caption FROM media_group_items
       WHERE claimed_by = ? ORDER BY CAST(message_id AS INTEGER) ASC`
    )
    .bind(leaderTxId)
    .all();
  return results || [];
}

/** مفاتيح ملفات الألبوم المرتبطة بعملية — لإرفاقها كلها بالمستند وبتعديلاته. */
export async function getAlbumKeys(db, txId) {
  const items = await listAlbumItems(db, txId);
  return items.map((i) => i.r2_key).filter(Boolean);
}

/**
 * ربط ملفات ألبوم بالعملية التي رُحّلت بها.
 *
 * العملية المُرحّلة قد لا تكون التي استلمت الألبوم: جوابٌ على سؤال، أو نسخةٌ
 * معدّلة، يُرحَّل بصفّه هو. فتُنقل الملفات إليه كي تجدها التعديلات اللاحقة.
 */
export async function attachAlbumKeys(db, txId, keys) {
  if (!keys || keys.length < 2) return;
  await db
    .prepare(
      `UPDATE media_group_items SET claimed_by = ?
       WHERE r2_key IN (${keys.map(() => '?').join(', ')})`
    )
    .bind(txId, ...keys)
    .run();
}

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
export async function findSimilarPostedToday(db, chatId, { type, total, contactName, date }) {
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

/** المحادثات النشطة المصرّح لها. */
export async function getActiveChats(db) {
  const { results } = await db
    .prepare(`SELECT chat_id, label, is_admin FROM telegram_chats WHERE is_active = 1`)
    .all();
  return results || [];
}

/** محادثات المسؤولين (لتنبيهات فشل المهام). */
export async function getAdminChats(db) {
  const { results } = await db
    .prepare(`SELECT chat_id FROM telegram_chats WHERE is_active = 1 AND is_admin = 1`)
    .all();
  return (results || []).map((r) => r.chat_id);
}

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

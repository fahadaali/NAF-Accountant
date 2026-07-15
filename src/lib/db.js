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
 * سحب شجرة الحسابات النشطة.
 */
export async function getActiveAccounts(db) {
  const { results } = await db
    .prepare(
      `SELECT account_code, account_name, account_type, wafeq_account_id
       FROM chart_of_accounts
       WHERE is_active = 1
       ORDER BY account_code ASC`
    )
    .all();
  return results || [];
}

// ----------------------------------------------------------------------------
// حالة المحادثة (Conversation State) — للحوار التفاعلي عند نقص البيانات.
// ----------------------------------------------------------------------------

/**
 * سحب السياق المعلّق لمحادثة (أو null).
 */
export async function getConversationState(db, chatId) {
  const row = await db
    .prepare(`SELECT pending_json FROM conversation_state WHERE chat_id = ?`)
    .bind(String(chatId))
    .first();
  if (!row || !row.pending_json) return null;
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

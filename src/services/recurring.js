// ============================================================================
// العمليات المتكرّرة — تنفيذ القوالب المستحقّة شهرياً (يُستدعى من Cron الليلي)
// ============================================================================

import {
  getDueRecurring,
  markRecurringRun,
  createTransaction,
  updateTransaction,
  getActiveAccounts,
  writeLog,
} from '../lib/db.js';
import { postJournalEntryDraft, createBillDraft, createInvoiceDraft } from './wafeq.js';
import { resolveContact } from './contacts.js';
import { sendTelegramMessage, esc } from './telegram.js';

/** تاريخ اليوم بتوقيت السعودية (UTC+3). */
function riyadhNow() {
  return new Date(Date.now() + 3 * 3600 * 1000);
}

/**
 * تنفيذ كل القوالب المتكرّرة المستحقّة اليوم.
 * @returns {Promise<{executed:number, failed:number}>}
 */
export async function runDueRecurring(env) {
  const now = riyadhNow();
  const day = now.getUTCDate();
  const ym = now.toISOString().slice(0, 7); // YYYY-MM
  const today = now.toISOString().slice(0, 10);

  const due = await getDueRecurring(env.DB, day, ym);
  if (due.length === 0) return { executed: 0, failed: 0 };

  const accounts = await getActiveAccounts(env.DB);
  const idMap = {};
  for (const a of accounts) if (a.wafeq_account_id) idMap[a.account_code] = a.wafeq_account_id;

  let executed = 0;
  let failed = 0;

  for (const item of due) {
    const result = { ...item.template, date: today }; // تاريخ اليوم لكل تنفيذ
    const txId = await createTransaction(env.DB, {
      telegramChatId: item.notify_chat_id || null,
      sourceType: 'text',
      rawText: `[متكرّر] ${item.label}`,
      status: 'analyzed',
    });
    await updateTransaction(env.DB, txId, { processedJson: JSON.stringify(result) });

    try {
      let contactId = null;
      if (
        (result.type === 'purchase_bill' || result.type === 'sales_invoice') &&
        result.contact_name
      ) {
        const r = await resolveContact(env, result.contact_name);
        contactId = r.contactId;
      }

      const ref = `${item.label} — عملية متكرّرة`;
      let wafeqId = '';

      if (result.type === 'manual_journal') {
        const { id } = await postJournalEntryDraft(
          env,
          accounts,
          result.manual_journal?.entries || [],
          ref,
          today
        );
        wafeqId = id;
      } else if (result.type === 'purchase_bill') {
        const vat = Number(result.bill?.vat_percent ?? 0);
        const lineItems = (result.bill?.line_items || []).map((li) => ({
          account: idMap[li.account_code] || li.account_code,
          description: li.description,
          amount: li.amount,
          taxRateId: vat > 0 ? env.VAT_TAX_RATE_ID || null : null,
        }));
        const { id } = await createBillDraft(env, { contactId, date: today, lineItems });
        wafeqId = id;
      } else {
        const lineItems = (result.invoice?.line_items || []).map((li) => ({
          account: idMap[li.account_code] || li.account_code,
          description: li.description,
          amount: li.amount,
        }));
        const { id } = await createInvoiceDraft(env, {
          contactId,
          date: today,
          lineItems,
          taxRateId: env.VAT_TAX_RATE_ID || null,
        });
        wafeqId = id;
      }

      await updateTransaction(env.DB, txId, { wafeqDraftId: wafeqId, status: 'posted' });
      await markRecurringRun(env.DB, item.id, ym);
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'recurring_post',
        status: 'success',
        errorDetails: item.label,
      });
      executed++;

      if (item.notify_chat_id) {
        await sendTelegramMessage(
          env,
          item.notify_chat_id,
          `🔁 <b>تم تنفيذ عملية متكرّرة</b>\n\n📌 ${esc(item.label)}\n📅 ${esc(today)}\n🧾 ${esc(wafeqId)}`
        ).catch(() => {});
      }
    } catch (err) {
      failed++;
      const msg = err.message || String(err);
      await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: msg });
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'recurring_post',
        status: 'error',
        errorDetails: `${item.label}: ${msg}`,
      });
      if (item.notify_chat_id) {
        await sendTelegramMessage(
          env,
          item.notify_chat_id,
          `⚠️ <b>فشل تنفيذ عملية متكرّرة</b>\n\n📌 ${esc(item.label)}\n❌ ${esc(msg)}`
        ).catch(() => {});
      }
    }
  }

  return { executed, failed };
}

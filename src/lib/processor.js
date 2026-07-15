// ============================================================================
// خط المعالجة الرئيسي (Processing Pipeline) — متعدد المسارات + حوار تفاعلي
// يُستدعى بشكل غير متزامن عبر ctx.waitUntil() لتجنب مهلة تليجرام.
// ============================================================================

import {
  writeLog,
  createTransaction,
  updateTransaction,
  getActiveAccounts,
  getConversationState,
  setConversationState,
  clearConversationState,
} from './db.js';
import { sendTelegramMessage, downloadTelegramFile } from '../services/telegram.js';
import { transcribeAudio } from '../services/whisper.js';
import { analyzeTransaction } from '../services/claude.js';
import {
  postJournalEntryDraft,
  createBillDraft,
  createInvoiceDraft,
  findOrCreateContact,
  uploadAttachment,
} from '../services/wafeq.js';

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** تاريخ الرسالة (YYYY-MM-DD) بتوقيت السعودية (UTC+3) من طابع تليجرام. */
function messageDateISO(unixSeconds) {
  const ms = (unixSeconds ? unixSeconds : Math.floor(Date.now() / 1000)) * 1000;
  return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** بناء خريطة رمز الحساب -> معرّف وافق. */
function accountIdMap(accounts) {
  const m = {};
  for (const a of accounts) if (a.wafeq_account_id) m[a.account_code] = a.wafeq_account_id;
  return m;
}

// ---------------------------------------------------------------------------
// رسائل التأكيد حسب نوع العملية.
// ---------------------------------------------------------------------------
function confirmManualJournal(result, wafeqId) {
  const entries = result.manual_journal?.entries || [];
  const lines = entries
    .map((e) => {
      const side = Number(e.debit) > 0 ? `مدين ${e.debit}` : `دائن ${e.credit}`;
      return `• ${e.account_name} — ${side}`;
    })
    .join('\n');
  const total = entries.reduce((s, e) => s + Number(e.debit || 0), 0);
  return (
    `✅ <b>تم إنشاء قيد يومية في وافق</b>\n\n` +
    `📅 التاريخ: ${result.date}\n${lines}\n\n` +
    `💰 الإجمالي: ${total}\n🧾 المرجع: ${wafeqId || 'غير متوفر'}\n\n` +
    `ℹ️ ملاحظة: القيود اليدوية تُرحّل مباشرة في وافق (لا تدعم المسودة عبر الـ API).`
  );
}

function confirmBill(result, wafeqId) {
  const items = result.bill?.line_items || [];
  const lines = items.map((li) => `• ${li.account_name} — ${li.amount}`).join('\n');
  const total = items.reduce((s, li) => s + Number(li.amount || 0), 0);
  return (
    `✅ <b>تم إنشاء فاتورة مشتريات (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${result.date}\n🏢 المورّد: ${result.contact_name || 'غير محدّد'}\n${lines}\n\n` +
    `💰 الإجمالي: ${total}\n🧾 رقم المسودة: ${wafeqId || 'غير متوفر'}\n\n` +
    `⚠️ فاتورة <b>مسودة</b> تتطلب مراجعتك واعتمادك في وافق.`
  );
}

function confirmInvoice(result, wafeqId) {
  const items = result.invoice?.line_items || [];
  const vatPercent = Number(result.invoice?.vat_percent || 15);
  const sub = items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const vat = +(sub * vatPercent / 100).toFixed(2);
  const lines = items.map((li) => `• ${li.account_name} — ${li.amount}`).join('\n');
  return (
    `✅ <b>تم إنشاء فاتورة بيع (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${result.date}\n👤 العميل: ${result.contact_name || 'غير محدّد'}\n${lines}\n\n` +
    `💰 قبل الضريبة: ${sub}\n➕ ضريبة ${vatPercent}%: ${vat}\n💵 الإجمالي: ${(sub + vat).toFixed(2)}\n` +
    `🧾 رقم المسودة: ${wafeqId || 'غير متوفر'}\n\n` +
    `⚠️ فاتورة <b>مسودة</b> تتطلب مراجعتك واعتمادك في وافق.`
  );
}

// ---------------------------------------------------------------------------
// الترحيل إلى وافق حسب نوع العملية.
// ---------------------------------------------------------------------------
async function postToWafeq(env, result, accounts, ref, attachmentIds) {
  const idMap = accountIdMap(accounts);

  if (result.type === 'manual_journal') {
    const entries = result.manual_journal?.entries || [];
    const { id } = await postJournalEntryDraft(env, accounts, entries, ref, result.date);
    return { wafeqId: id, confirm: confirmManualJournal(result, id) };
  }

  if (result.type === 'purchase_bill') {
    let contactId = null;
    if (result.contact_name) contactId = await findOrCreateContact(env, result.contact_name);
    const lineItems = (result.bill?.line_items || []).map((li) => ({
      account: idMap[li.account_code] || li.account_code,
      description: li.description,
      amount: li.amount,
    }));
    const { id } = await createBillDraft(env, {
      contactId,
      date: result.date,
      lineItems,
      attachmentIds,
    });
    return { wafeqId: id, confirm: confirmBill(result, id) };
  }

  if (result.type === 'sales_invoice') {
    const contactId = result.contact_name
      ? await findOrCreateContact(env, result.contact_name)
      : null;
    const lineItems = (result.invoice?.line_items || []).map((li) => ({
      account: idMap[li.account_code] || li.account_code,
      description: li.description,
      amount: li.amount,
    }));
    const { id } = await createInvoiceDraft(env, {
      contactId,
      date: result.date,
      lineItems,
      taxRateId: env.VAT_TAX_RATE_ID || null,
      attachmentIds,
    });
    return { wafeqId: id, confirm: confirmInvoice(result, id) };
  }

  throw new Error(`نوع عملية غير معروف: ${result.type}`);
}

// ---------------------------------------------------------------------------
// المعالجة الرئيسية لرسالة تليجرام.
// ---------------------------------------------------------------------------
export async function processTelegramUpdate(env, update) {
  const message = update.message || update.edited_message;
  if (!message) return;

  const chatId = message.chat.id;
  const messageId = message.message_id;
  const dateISO = messageDateISO(message.date);

  let sourceType = 'text';
  if (message.voice || message.audio) sourceType = 'voice';
  else if (message.photo || (message.document && /image/.test(message.document.mime_type || '')))
    sourceType = 'image';

  const txId = await createTransaction(env.DB, {
    telegramMessageId: String(messageId),
    telegramChatId: String(chatId),
    sourceType,
    rawText: message.text || message.caption || null,
    status: 'received',
  });

  try {
    let finalText = message.text || message.caption || '';
    let image = null;
    let mediaR2Key = null;
    let mediaType = null;

    // ---- معالجة الصوت ----
    if (sourceType === 'voice') {
      const audio = message.voice || message.audio;
      const buffer = await downloadTelegramFile(env, audio.file_id);
      mediaR2Key = `voice/${chatId}/${messageId}.ogg`;
      await env.MEDIA.put(mediaR2Key, buffer, {
        httpMetadata: { contentType: audio.mime_type || 'audio/ogg' },
      });
      await updateTransaction(env.DB, txId, { mediaR2Key, status: 'transcribed' });
      finalText = await transcribeAudio(env, buffer);
      await updateTransaction(env.DB, txId, { rawText: finalText });
      await writeLog(env.DB, { transactionId: txId, action: 'whisper_transcribe', status: 'success' });
    }

    // ---- معالجة الصورة (فاتورة) ----
    if (sourceType === 'image') {
      let fileId;
      if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
        mediaType = 'image/jpeg';
      } else {
        fileId = message.document.file_id;
        mediaType = message.document.mime_type || 'image/jpeg';
      }
      const buffer = await downloadTelegramFile(env, fileId);
      const ext = mediaType.split('/')[1] || 'jpg';
      mediaR2Key = `invoice/${chatId}/${messageId}.${ext}`;
      await env.MEDIA.put(mediaR2Key, buffer, { httpMetadata: { contentType: mediaType } });
      await updateTransaction(env.DB, txId, { mediaR2Key });
      image = { mediaType, base64: arrayBufferToBase64(buffer) };
      await writeLog(env.DB, { transactionId: txId, action: 'image_saved_r2', status: 'success' });
    }

    // ---- استرجاع سياق حوار سابق (إن وُجد) ----
    const prior = await getConversationState(env.DB, chatId);
    let priorContext = null;
    if (prior) {
      priorContext = prior.accumulatedText || null;
      // إن كان هناك مرفق سابق ولم تُرسل صورة جديدة، أعِد تحميله من R2 لسياق الرؤية.
      if (!image && prior.mediaR2Key) {
        const obj = await env.MEDIA.get(prior.mediaR2Key);
        if (obj) {
          const buf = await obj.arrayBuffer();
          image = { mediaType: prior.mediaType || 'image/jpeg', base64: arrayBufferToBase64(buf) };
          mediaR2Key = prior.mediaR2Key;
          mediaType = prior.mediaType;
        }
      }
    }

    if (!finalText && !image) {
      throw new Error('لا يوجد محتوى قابل للمعالجة في الرسالة');
    }

    // ---- شجرة الحسابات + الحساب البنكي الافتراضي ----
    const accounts = await getActiveAccounts(env.DB);
    if (accounts.length === 0) throw new Error('شجرة الحسابات فارغة — شغّل المزامنة من وافق أولاً.');

    const defaultBankCode = env.DEFAULT_BANK_ACCOUNT_CODE || null;
    const defaultBank = defaultBankCode
      ? accounts.find((a) => a.account_code === defaultBankCode) || null
      : null;
    const vatPercent = Number(env.VAT_PERCENT || 15);

    // ---- التحليل والتصنيف عبر Claude ----
    const result = await analyzeTransaction(env, {
      accounts,
      defaultBank,
      messageDateISO: dateISO,
      vatPercent,
      text: finalText,
      image,
      priorContext,
    });
    await updateTransaction(env.DB, txId, {
      processedJson: JSON.stringify(result),
      status: 'analyzed',
    });
    await writeLog(env.DB, { transactionId: txId, action: 'claude_analyze', status: 'success' });

    // ---- بيانات ناقصة؟ اسأل واحفظ السياق ----
    if (result.status === 'need_more') {
      const accumulated =
        (priorContext ? priorContext + '\n---\n' : '') + (finalText || '(صورة مرفقة)');
      await setConversationState(env.DB, chatId, {
        accumulatedText: accumulated,
        mediaR2Key,
        mediaType,
      });
      await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
      await sendTelegramMessage(
        env,
        chatId,
        `❓ ${result.question || 'أحتاج معلومات إضافية لإكمال العملية.'}`
      );
      return;
    }

    // ---- رفع المرفق (صورة الفاتورة) إن وُجد ----
    let attachmentIds = [];
    if (image && mediaR2Key && (result.type === 'purchase_bill' || result.type === 'sales_invoice')) {
      try {
        const obj = await env.MEDIA.get(mediaR2Key);
        if (obj) {
          const buf = await obj.arrayBuffer();
          const fname = mediaR2Key.split('/').pop() || 'attachment.jpg';
          const attId = await uploadAttachment(env, buf, fname, mediaType || 'image/jpeg');
          if (attId) attachmentIds.push(attId);
        }
      } catch (e) {
        // لا نُفشل العملية بسبب المرفق فقط — نسجّل ونكمل.
        await writeLog(env.DB, {
          transactionId: txId,
          action: 'wafeq_attachment',
          status: 'error',
          errorDetails: e.message,
        });
      }
    }

    // ---- الترحيل إلى وافق حسب النوع ----
    const ref = `${result.summary || 'عملية آلية'} — تليجرام #${messageId}`;
    const { wafeqId, confirm } = await postToWafeq(env, result, accounts, ref, attachmentIds);

    await updateTransaction(env.DB, txId, { wafeqDraftId: wafeqId, status: 'posted' });
    await writeLog(env.DB, { transactionId: txId, action: 'wafeq_post', status: 'success' });

    // ---- انتهى الحوار: امسح السياق وأرسل التأكيد ----
    await clearConversationState(env.DB, chatId);
    await sendTelegramMessage(env, chatId, confirm);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: msg });
    await writeLog(env.DB, {
      transactionId: txId,
      action: 'process_error',
      status: 'error',
      errorDetails: msg,
    });
    try {
      await sendTelegramMessage(
        env,
        chatId,
        `❌ <b>تعذّرت معالجة العملية</b>\n\nالسبب: ${msg}\n\nيرجى المحاولة مرة أخرى أو التواصل مع الدعم.`
      );
    } catch (_) {
      /* تجاهل فشل إرسال رسالة الخطأ */
    }
  }
}

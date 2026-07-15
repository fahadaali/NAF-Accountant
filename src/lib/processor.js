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
  createContact,
  uploadAttachment,
} from '../services/wafeq.js';
import { resolveContact } from '../services/contacts.js';

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// حد Claude لحجم الصورة (~5MB). نبقى دونه بهامش أمان.
const MAX_IMAGE_BYTES = 4.8 * 1024 * 1024;

/**
 * كشف نوع الصورة الحقيقي من البايتات الأولى (magic bytes) بدل الوثوق بما
 * يعلنه تليجرام. يُرجع نوع MIME مدعوماً من Claude أو null إن كان غير مدعوم.
 * المدعوم: image/jpeg, image/png, image/gif, image/webp
 */
function detectImageType(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length < 12) return null;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // WEBP: "RIFF"...."WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'image/webp';
  return null; // غير مدعوم (مثل HEIC/HEIF من الآيفون)
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
// الترحيل إلى وافق حسب نوع العملية (بمعرّف جهة اتصال مُحلّل مسبقاً).
// ---------------------------------------------------------------------------
async function postToWafeq(env, result, accounts, ref, attachmentIds, contactId) {
  const idMap = accountIdMap(accounts);

  if (result.type === 'manual_journal') {
    const entries = result.manual_journal?.entries || [];
    const { id } = await postJournalEntryDraft(env, accounts, entries, ref, result.date);
    return { wafeqId: id, confirm: confirmManualJournal(result, id) };
  }

  if (result.type === 'purchase_bill') {
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

/** تطبيع اسم للمقارنة (نسخة مبسّطة في المعالج). */
function normName(s) {
  return (s || '')
    .replace(/[ً-ْ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * رفع المرفق (إن وُجد) ثم الترحيل إلى وافق وإنهاء العملية.
 */
async function finalizeAndPost(env, ctx) {
  const { txId, chatId, result, accounts, messageId, contactId, mediaR2Key, mediaType } = ctx;

  let attachmentIds = [];
  if (mediaR2Key && (result.type === 'purchase_bill' || result.type === 'sales_invoice')) {
    try {
      const obj = await env.MEDIA.get(mediaR2Key);
      if (obj) {
        const buf = await obj.arrayBuffer();
        const fname = mediaR2Key.split('/').pop() || 'attachment.jpg';
        const attId = await uploadAttachment(env, buf, fname, mediaType || 'image/jpeg');
        if (attId) attachmentIds.push(attId);
      }
    } catch (e) {
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'wafeq_attachment',
        status: 'error',
        errorDetails: e.message,
      });
    }
  }

  const ref = `${result.summary || 'عملية آلية'} — تليجرام #${messageId}`;
  const { wafeqId, confirm } = await postToWafeq(env, result, accounts, ref, attachmentIds, contactId);

  await updateTransaction(env.DB, txId, { wafeqDraftId: wafeqId, status: 'posted' });
  await writeLog(env.DB, { transactionId: txId, action: 'wafeq_post', status: 'success' });
  await clearConversationState(env.DB, chatId);
  await sendTelegramMessage(env, chatId, confirm);
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
      const fileId = message.photo
        ? message.photo[message.photo.length - 1].file_id
        : message.document.file_id;
      const buffer = await downloadTelegramFile(env, fileId);

      // كشف النوع الحقيقي من البايتات (لا نثق بما يعلنه تليجرام).
      const detected = detectImageType(buffer);
      if (!detected) {
        throw new Error(
          'صيغة الصورة غير مدعومة (قد تكون HEIC من الآيفون). الرجاء إرسالها بصيغة JPG أو PNG — ' +
            'على الآيفون: الإعدادات ← الكاميرا ← التنسيقات ← «الأكثر توافقاً».'
        );
      }
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('حجم الصورة كبير جداً. الرجاء إرسال صورة أصغر (أقل من 5 ميغابايت).');
      }

      mediaType = detected;
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

    // ---- ردّ اختيار جهة الاتصال (بعد سؤال التوضيح) ----
    if (prior && prior.kind === 'contact_choice' && prior.analyzed) {
      const accounts = await getActiveAccounts(env.DB);
      const candidates = prior.candidates || [];
      const sel = (finalText || '').trim();
      let contactId;

      const num = parseInt(sel, 10);
      if (!isNaN(num) && num >= 1 && num <= candidates.length) {
        contactId = candidates[num - 1].id; // اختار بالرقم
      } else {
        const byName = candidates.find((c) => normName(c.name) === normName(sel));
        if (byName) contactId = byName.id; // اختار بالاسم المطابق
        else contactId = await createContact(env, sel || prior.analyzed.contact_name); // اسم جديد
      }

      await finalizeAndPost(env, {
        txId,
        chatId,
        result: prior.analyzed,
        accounts,
        messageId,
        contactId,
        mediaR2Key: prior.mediaR2Key,
        mediaType: prior.mediaType,
      });
      return;
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

    // ---- حلّ جهة الاتصال (للفواتير) — مطابقة ذكية أو سؤال عند التعدد ----
    let contactId = null;
    if (
      (result.type === 'purchase_bill' || result.type === 'sales_invoice') &&
      result.contact_name
    ) {
      const r = await resolveContact(env, result.contact_name);
      if (r.status === 'ambiguous') {
        const optionsText = r.candidates.map((c, i) => `${i + 1}) ${c.name}`).join('\n');
        await setConversationState(env.DB, chatId, {
          kind: 'contact_choice',
          analyzed: result,
          candidates: r.candidates,
          mediaR2Key,
          mediaType,
        });
        await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
        await sendTelegramMessage(
          env,
          chatId,
          `❓ وجدت أكثر من جهة اتصال تشبه «${result.contact_name}». أيّها تقصد؟\n\n${optionsText}\n\n` +
            `اكتب الرقم للاختيار، أو اكتب اسماً جديداً لإنشاء جهة اتصال جديدة.`
        );
        return;
      }
      contactId = r.contactId;
    }

    // ---- الترحيل إلى وافق ----
    await finalizeAndPost(env, {
      txId,
      chatId,
      result,
      accounts,
      messageId,
      contactId,
      mediaR2Key,
      mediaType,
    });
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

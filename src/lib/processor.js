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
  getPostedTransactionByOffset,
  getPostedTransactionByWafeqId,
  searchPostedTransactions,
  listPostedTransactions,
  isMessageProcessed,
  findSimilarPostedToday,
} from './db.js';
import { sendTelegramMessage, downloadTelegramFile } from '../services/telegram.js';
import { transcribeAudio } from '../services/transcription.js';
import {
  analyzeTransaction,
  refineTranscript,
  classifyFollowUp,
  applyEdit,
} from '../services/claude.js';
import {
  postJournalEntryDraft,
  createBillDraft,
  createInvoiceDraft,
  createContact,
  uploadAttachment,
  attachmentLinkState,
  deleteDocument,
  getWafeqDraftSummary,
} from '../services/wafeq.js';
import { resolveContact } from '../services/contacts.js';
import { prepareMedia, prepareStoredMedia, extensionFor } from './media.js';

/** تاريخ الرسالة (YYYY-MM-DD) بتوقيت السعودية (UTC+3) من طابع تليجرام. */
function messageDateISO(unixSeconds) {
  const ms = (unixSeconds ? unixSeconds : Math.floor(Date.now() / 1000)) * 1000;
  return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * تحديد العملية المستهدفة من وصف الاستهداف.
 * @returns {Promise<{ok:true, target:object} | {ok:false, reason:string, options?:Array}>}
 */
async function resolveTarget(env, chatId, spec) {
  const mode = spec?.mode || 'last';

  if (mode === 'id' && spec.id) {
    const t = await getPostedTransactionByWafeqId(env.DB, chatId, spec.id);
    return t ? { ok: true, target: t } : { ok: false, reason: `لم أجد عملية بالمعرّف «${spec.id}».` };
  }

  if (mode === 'search' && spec.query) {
    const found = await searchPostedTransactions(env.DB, chatId, spec.query, 5);
    if (found.length === 0) return { ok: false, reason: `لم أجد عملية تطابق «${spec.query}».` };
    if (found.length > 1) return { ok: false, reason: 'multiple', options: found };
    return { ok: true, target: found[0] };
  }

  const n = mode === 'nth' ? spec.n || 1 : 1;
  const t = await getPostedTransactionByOffset(env.DB, chatId, n);
  return t
    ? { ok: true, target: t }
    : { ok: false, reason: n > 1 ? `لا توجد عملية رقم ${n} من الآخر.` : 'لا توجد عملية سابقة.' };
}

/** سطر وصفي موجز لعملية. */
function targetLabel(t) {
  return `${describeType(t.result.type)} — ${t.result.summary || ''}${
    t.result.contact_name ? ` (${t.result.contact_name})` : ''
  }\n🧾 ${t.wafeqId}`;
}

/** إجمالي العملية (قبل الضريبة) حسب نوعها. */
function resultTotal(result) {
  if (result.type === 'manual_journal') {
    return (result.manual_journal?.entries || []).reduce((s, e) => s + Number(e.debit || 0), 0);
  }
  if (result.type === 'purchase_bill') {
    return (result.bill?.line_items || []).reduce((s, li) => s + Number(li.amount || 0), 0);
  }
  return (result.invoice?.line_items || []).reduce((s, li) => s + Number(li.amount || 0), 0);
}

/* عزل اتجاهي للقيم داخل الجمل العربية — U+2068 و U+2069.
   نفس تعريف `isolate` في naf-format بالسجلّ؛ يُكرَّر هنا لأن الخادم
   لا يستورد من frontend/src/naf. أي تغيير يحدث في السجلّ أولاً. */
const iso = (v) => `\u2068${v}\u2069`;

/** وصف عربي لنوع العملية. */
function describeType(type) {
  return type === 'manual_journal'
    ? 'قيد محاسبي'
    : type === 'purchase_bill'
      ? 'فاتورة مشتريات'
      : type === 'sales_invoice'
        ? 'فاتورة مبيعات'
        : type;
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
    `✅ <b>تم إنشاء قيد محاسبي في وافق</b>\n\n` +
    `📅 التاريخ: ${iso(result.date)}\n${lines}\n\n` +
    `💰 الإجمالي: ${iso(total)}\n🧾 المرجع: ${wafeqId ? iso(wafeqId) : 'غير متوفر'}\n\n` +
    `ℹ️ ملاحظة: القيود اليدوية تُرحّل مباشرة في وافق (لا تدعم المسودة عبر الـ API).`
  );
}

function confirmBill(result, wafeqId) {
  const items = result.bill?.line_items || [];
  const lines = items.map((li) => `• ${li.account_name} — ${li.amount}`).join('\n');
  const sub = items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const vatPercent = Number(result.bill?.vat_percent ?? 0);
  const vat = +((sub * vatPercent) / 100).toFixed(2);
  return (
    `✅ <b>تم إنشاء فاتورة مشتريات (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${iso(result.date)}\n🏢 المورّد: ${result.contact_name || 'غير محدّد'}\n${lines}\n\n` +
    (vatPercent > 0
      ? `💰 قبل الضريبة: ${iso(sub)}\n➕ ضريبة ${iso(vatPercent + '%')}: ${iso(vat)}\n💵 الإجمالي: ${iso((sub + vat).toFixed(2))}\n`
      : `💰 الإجمالي: ${sub} (بدون ضريبة)\n`) +
    `🧾 رقم المسودة: ${wafeqId ? iso(wafeqId) : 'غير متوفر'}\n\n` +
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
    `✅ <b>تم إنشاء فاتورة مبيعات (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${iso(result.date)}\n👤 العميل: ${result.contact_name ? iso(result.contact_name) : 'غير محدّد'}\n${lines}\n\n` +
    `💰 قبل الضريبة: ${iso(sub)}\n➕ ضريبة ${iso(vatPercent + '%')}: ${iso(vat)}\n💵 الإجمالي: ${iso((sub + vat).toFixed(2))}\n` +
    `🧾 رقم المسودة: ${wafeqId ? iso(wafeqId) : 'غير متوفر'}\n\n` +
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
    const { id, raw } = await postJournalEntryDraft(
      env,
      accounts,
      entries,
      ref,
      result.date,
      attachmentIds
    );
    return { wafeqId: id, raw, confirm: confirmManualJournal(result, id) };
  }

  if (result.type === 'purchase_bill') {
    // ضريبة المشتريات (Input VAT) — تُطبّق إن كانت النسبة > 0 ومعرّف الضريبة مضبوط.
    const billVat = Number(result.bill?.vat_percent ?? 0);
    const billTaxRate = billVat > 0 ? env.VAT_TAX_RATE_ID || null : null;
    const lineItems = (result.bill?.line_items || []).map((li) => ({
      account: idMap[li.account_code] || li.account_code,
      description: li.description,
      amount: li.amount,
      taxRateId: billTaxRate,
    }));
    const { id, raw } = await createBillDraft(env, {
      contactId,
      date: result.date,
      lineItems,
      attachmentIds,
    });
    return { wafeqId: id, raw, confirm: confirmBill(result, id) };
  }

  if (result.type === 'sales_invoice') {
    const lineItems = (result.invoice?.line_items || []).map((li) => ({
      account: idMap[li.account_code] || li.account_code,
      description: li.description,
      amount: li.amount,
    }));
    const { id, raw } = await createInvoiceDraft(env, {
      contactId,
      date: result.date,
      lineItems,
      taxRateId: env.VAT_TAX_RATE_ID || null,
      attachmentIds,
    });
    return { wafeqId: id, raw, confirm: confirmInvoice(result, id) };
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
 *
 * كل مصدر يحمل ملفاً — صورة فاتورة، ملف PDF، تسجيل صوتي — يُرفق بالمستند
 * الذي يُنشأ في وافق، أياً كان نوعه: فاتورة مبيعات أو مشتريات أو قيد محاسبي.
 * القيد يحتاج مستنده المؤيِّد كما تحتاجه الفاتورة.
 */
async function finalizeAndPost(env, ctx) {
  const { txId, chatId, result, accounts, messageId, contactId, mediaR2Key, mediaType, prefix } = ctx;

  // تحذير يُلحق برسالة التأكيد حين لا يصل المرفق إلى المستند — الصمت هنا
  // يجعل المستخدم يظنّ الملف مرفقاً وهو ليس كذلك.
  let attachmentWarning = '';
  const attachmentIds = [];

  if (mediaR2Key) {
    try {
      const obj = await env.MEDIA.get(mediaR2Key);
      if (!obj) throw new Error('الملف غير موجود في التخزين');

      const buf = await obj.arrayBuffer();
      const fname = mediaR2Key.split('/').pop() || 'attachment';
      const attId = await uploadAttachment(
        env,
        buf,
        fname,
        mediaType || obj.httpMetadata?.contentType || 'application/octet-stream'
      );
      if (!attId) throw new Error('وافق لم يُرجع معرّفاً للمرفق');
      attachmentIds.push(attId);
    } catch (e) {
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'wafeq_attachment',
        status: 'error',
        errorDetails: `upload failed: ${e.message}`,
      });
      attachmentWarning =
        `\n\n📎 <b>لم يُرفق الملف</b> — تعذّر رفعه إلى وافق (${e.message}).` +
        `\nالملف محفوظ في اللوحة، أرفقه يدوياً بالمستند.`;
    }
  }

  const ref = `${result.summary || 'عملية آلية'} — تليجرام #${messageId}`;

  // حقل `attachments` في حمولة الإنشاء غير موثّق في وافق. إن رفضته الواجهة
  // (رفض 4xx = لم يُنشأ شيء) نعيد المحاولة بلا مرفق: عمليةٌ بلا مرفق أفضل من
  // عملية ضائعة، والمستخدم يُخبَر بالفرق.
  let posted;
  try {
    posted = await postToWafeq(env, result, accounts, ref, attachmentIds, contactId);
  } catch (e) {
    const rejected = /failed: 4\d\d/.test(e.message || '');
    if (!attachmentIds.length || !rejected) throw e;

    await writeLog(env.DB, {
      transactionId: txId,
      action: 'wafeq_attachment',
      status: 'error',
      errorDetails: `document rejected with attachments, retrying without: ${e.message.slice(0, 200)}`,
    });
    posted = await postToWafeq(env, result, accounts, ref, [], contactId);
    attachmentIds.length = 0;
    attachmentWarning =
      `\n\n📎 <b>لم يُرفق الملف</b> — رفضت وافق المستند حين حمل مرفقاً، فأُنشئ بدونه.` +
      `\nالملف محفوظ في اللوحة، أرفقه يدوياً.`;
  }
  const { wafeqId, raw, confirm } = posted;

  // رُفع الملف — لكن هل ربطته وافق بالمستند فعلاً؟ نقرأ ردّ الإنشاء ولا نفترض.
  if (attachmentIds.length) {
    const state = attachmentLinkState(raw);
    await writeLog(env.DB, {
      transactionId: txId,
      action: 'wafeq_attachment',
      status: state === 'dropped' ? 'error' : 'success',
      errorDetails: `link=${state} id=${attachmentIds[0]} doc=${wafeqId}`,
    });
    if (state === 'dropped') {
      attachmentWarning =
        `\n\n📎 <b>لم يُرفق الملف</b> — رُفع إلى وافق لكن المستند أُنشئ بلا مرفق.` +
        `\nأرفقه يدوياً، وأبلغ الدعم بهذا الرقم: ${iso(attachmentIds[0])}`;
    }
  }

  await updateTransaction(env.DB, txId, { wafeqDraftId: wafeqId, status: 'posted' });
  await writeLog(env.DB, { transactionId: txId, action: 'wafeq_post', status: 'success' });
  await clearConversationState(env.DB, chatId);
  await sendTelegramMessage(env, chatId, (prefix || '') + confirm + attachmentWarning);
}

/**
 * تنفيذ تعديل على عملية مُرحّلة: إنتاج نسخة معدّلة، حذف القديمة، ترحيل الجديدة.
 */
async function performEdit(env, { txId, chatId, messageId, chosen, instruction }) {
  const accounts = await getActiveAccounts(env.DB);
  const bankCode = env.DEFAULT_BANK_ACCOUNT_CODE || null;
  const bank = bankCode ? accounts.find((a) => a.account_code === bankCode) || null : null;

  const edited = await applyEdit(env, {
    accounts,
    defaultBank: bank,
    vatPercent: Number(env.VAT_PERCENT || 15),
    previous: chosen.result,
    instruction,
  });

  // جهة الاتصال للفواتير.
  let contactId = null;
  if ((edited.type === 'purchase_bill' || edited.type === 'sales_invoice') && edited.contact_name) {
    const r = await resolveContact(env, edited.contact_name);
    contactId = r.contactId;
  }

  // احذف المستند القديم أولاً لتجنّب التكرار في وافق.
  try {
    await deleteDocument(env, chosen.result.type, chosen.wafeqId);
    await updateTransaction(env.DB, chosen.id, { status: 'deleted' });
  } catch (e) {
    await writeLog(env.DB, {
      transactionId: chosen.id,
      action: 'wafeq_delete_on_edit',
      status: 'error',
      errorDetails: e.message,
    });
    await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: e.message });
    await sendTelegramMessage(
      env,
      chatId,
      `⚠️ تعذّر حذف العملية القديمة من وافق (${e.message}).\nلن أنشئ نسخة جديدة لتجنّب التكرار — عدّلها يدوياً في وافق.`
    );
    return;
  }

  await updateTransaction(env.DB, txId, {
    processedJson: JSON.stringify(edited),
    status: 'analyzed',
  });
  await writeLog(env.DB, { transactionId: txId, action: 'apply_edit', status: 'success' });

  await finalizeAndPost(env, {
    txId,
    chatId,
    result: edited,
    accounts,
    messageId,
    contactId,
    // المرفق ينتقل مع العملية إلى نسختها المعدّلة — التعديل يعيد إنشاء المستند
    // في وافق، فلولا هذا لضاع مرفق الفاتورة عند أول تعديل على المبلغ.
    mediaR2Key: chosen.mediaR2Key || null,
    mediaType: null,
    prefix: '✏️ <b>تم تعديل العملية</b> (حُذفت النسخة السابقة وأُنشئت محدّثة)\n\n',
  });
}

/** نص المساعدة (يظهر عند /help أو /start أو «مساعدة»). */
const HELP_TEXT = `🤖 <b>المحاسب الذكي — ناف القانونية</b>

<b>1) تسجيل عملية</b> — أرسل نصاً أو تسجيلاً صوتياً أو صورة فاتورة أو ملف <code>PDF</code>:
• <code>دفعت 500 ريال إيجار المكتب</code>
• <code>شريت أدوات بـ300 من جرير</code>
• <code>استلمت اشتراك 5750 من شركة الأفق</code>

<b>الفواتير المرفقة</b>
• ملف <code>PDF</code> (حتى 10 ميغابايت) — تُقرأ صفحاته نصّاً وصورةً.
• صور: <code>JPG</code>، <code>PNG</code>، <code>HEIC</code> (الافتراضية في الآيفون)، <code>WebP</code>، <code>GIF</code>، <code>AVIF</code>، <code>TIFF</code>، <code>BMP</code>.
• الصيغ التي لا يقرأها المحلّل تُحوَّل تلقائياً، ويُحفظ الأصل كما أرسلته.

<b>التوجيه التلقائي:</b>
• رواتب/تحويلات صادرة ← قيد محاسبي
• سداد/مشتريات ← فاتورة مشتريات (مسودة)
• وارد من عميل ← فاتورة مبيعات + ضريبة 15٪ (مسودة)

<b>2) تعديل عملية</b> — أرسل التعديل مباشرة:
• <code>عدّل المبلغ إلى 600</code>
• <code>خلّه بدون ضريبة</code>
• <code>غيّر المورّد إلى جرير</code>
• <code>عدّل المسودة قبل الأخيرة المبلغ 900</code>

<b>3) حذف عملية</b> (يطلب كتابة «تأكيد»):
• <code>احذف القيد</code>
• <code>احذف فاتورة جرير</code>
• <code>احذف المسودة mjou_xxx</code>
• <code>احذف جميع المسودات في وافق</code>

<b>4) أوامر أخرى</b>
• <code>جديد</code> — إلغاء أي عملية جارية والبدء من نظيف
• <code>/help</code> — هذه الرسالة

<b>ملاحظات</b>
• إن لم تذكر حساب الدفع فالافتراضي <b>الحساب البنكي</b> (اذكر «نقداً» أو «الخزينة» أو «النثرية» للتغيير).
• التواريخ النسبية مفهومة: «أمس»، «الثلاثاء الماضي».
• إن نقص بيان جوهري (المبلغ أو المورّد/العميل) سأسألك عنه.`;

/** بديل نصّي للمرفق داخل السياق المتراكم حين تخلو الرسالة من نص. */
function mediaPlaceholder(media) {
  if (!media) return '';
  return media.kind === 'document' ? '(ملف PDF مرفق)' : '(صورة مرفقة)';
}

/** تصنيف مبدئي لمرفق تليجرام: هل يبدو ملف PDF من نوعه المعلن أو اسمه؟ */
function looksLikePdf(document) {
  if (!document) return false;
  return (
    /pdf/i.test(document.mime_type || '') || /\.pdf$/i.test(document.file_name || '')
  );
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

  const incomingText = message.text || message.caption || '';

  // ---- أمر المساعدة (لا يُسجّل كعملية) ----
  if (/^\/(help|start)\b/i.test(incomingText.trim()) || /^(مساعدة|المساعدة|الأوامر)$/.test(incomingText.trim())) {
    await sendTelegramMessage(env, chatId, HELP_TEXT);
    return;
  }

  // ---- منع المعالجة المزدوجة عند إعادة إرسال الويبهوك من تليجرام ----
  if (await isMessageProcessed(env.DB, chatId, messageId)) {
    await writeLog(env.DB, {
      action: 'duplicate_webhook_skipped',
      status: 'info',
      errorDetails: `chat=${chatId} msg=${messageId}`,
    });
    return;
  }

  // المرفق قد يصل صورةً مضغوطة (photo) أو ملفاً كما هو (document). النوع
  // المعلن من تليجرام مستنتج من الامتداد فلا يُعتمد عليه — يُحسم بعد التنزيل
  // من بايتات الملف نفسه في prepareMedia، وهنا نضع تصنيفاً مبدئياً فقط.
  const attachment = message.photo
    ? { fileId: message.photo[message.photo.length - 1].file_id }
    : message.document
      ? { fileId: message.document.file_id }
      : null;

  let sourceType = 'text';
  if (message.voice || message.audio) sourceType = 'voice';
  else if (attachment) sourceType = looksLikePdf(message.document) ? 'pdf' : 'image';

  const txId = await createTransaction(env.DB, {
    telegramMessageId: String(messageId),
    telegramChatId: String(chatId),
    sourceType,
    rawText: message.text || message.caption || null,
    status: 'received',
  });

  try {
    let finalText = message.text || message.caption || '';
    let media = null;
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
      const rawTranscript = await transcribeAudio(env, buffer, audio.mime_type || 'audio/ogg');
      // تصحيح أخطاء التفريغ عبر Claude في السياق المحاسبي.
      finalText = await refineTranscript(env, rawTranscript);
      await updateTransaction(env.DB, txId, { rawText: finalText });
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'transcribe',
        status: 'success',
        errorDetails: `raw="${rawTranscript.slice(0, 120)}"`,
      });
    }

    // ---- معالجة المرفق (فاتورة مصوّرة أو ملف PDF) ----
    if (attachment) {
      const buffer = await downloadTelegramFile(env, attachment.fileId);

      // النوع الحقيقي والتحويل عند اللزوم (HEIC من الآيفون مثلاً) — من البايتات.
      const prepared = await prepareMedia(env, buffer);

      sourceType = prepared.kind === 'document' ? 'pdf' : 'image';
      mediaType = prepared.mediaType;
      const base = `invoice/${chatId}/${messageId}`;
      mediaR2Key = `${base}.${extensionFor(mediaType)}`;
      await env.MEDIA.put(mediaR2Key, prepared.bytes, {
        httpMetadata: { contentType: mediaType },
      });

      // الملف المحوّل نسخة لا بديل — نحفظ الأصل كما أرسله المستخدم إلى جانبه.
      if (prepared.originalBytes) {
        await env.MEDIA.put(
          `${base}-original.${extensionFor(prepared.originalType)}`,
          prepared.originalBytes,
          { httpMetadata: { contentType: prepared.originalType } }
        );
      }

      await updateTransaction(env.DB, txId, { mediaR2Key, sourceType });
      media = { kind: prepared.kind, mediaType, base64: prepared.base64 };
      await writeLog(env.DB, {
        transactionId: txId,
        action: prepared.kind === 'document' ? 'pdf_saved_r2' : 'image_saved_r2',
        status: 'success',
        errorDetails:
          prepared.originalType === prepared.mediaType
            ? null
            : `converted ${prepared.originalType} -> ${prepared.mediaType}`,
      });
    }

    // ---- كلمة إعادة/إلغاء تمسح أي سياق عالق وتبدأ من جديد ----
    const RESET_WORDS = ['إلغاء', 'الغاء', 'جديد', 'ابدأ من جديد', 'ابدا من جديد', 'إلغاء العملية', 'reset', 'cancel'];
    if (finalText && RESET_WORDS.includes(finalText.trim())) {
      await clearConversationState(env.DB, chatId);
      await updateTransaction(env.DB, txId, { status: 'received' });
      await sendTelegramMessage(env, chatId, '🔄 تم إلغاء أي عملية جارية. أرسل عمليتك الجديدة الآن.');
      return;
    }

    // ---- تأكيد الحذف (رداً على سؤال التأكيد) ----
    const pendingState = await getConversationState(env.DB, chatId, 60);
    if (pendingState && pendingState.kind === 'confirm_delete') {
      const answer = (finalText || '').trim();
      await clearConversationState(env.DB, chatId);

      if (!/^(تأكيد|تاكيد|نعم|أجل|اجل|تم|أكيد|اكيد|yes|y)$/i.test(answer)) {
        await updateTransaction(env.DB, txId, { status: 'posted' });
        await sendTelegramMessage(env, chatId, '✔️ تم إلغاء الحذف. لم يُحذف شيء.');
        return;
      }

      // --- حذف جماعي ---
      if (Array.isArray(pendingState.bulk)) {
        let done = 0;
        const failed = [];
        for (const d of pendingState.bulk) {
          try {
            await deleteDocument(env, d.docType, d.id);
            await env.DB.prepare(
              `UPDATE transactions SET status='deleted', updated_at=datetime('now')
               WHERE wafeq_draft_id = ?`
            )
              .bind(d.id)
              .run();
            done++;
          } catch (e) {
            failed.push(`${d.id}: ${e.message}`);
          }
        }
        await updateTransaction(env.DB, txId, { status: 'posted' });
        await writeLog(env.DB, {
          transactionId: txId,
          action: 'wafeq_bulk_delete',
          status: failed.length ? 'error' : 'success',
          errorDetails: `deleted=${done} failed=${failed.length}`,
        });
        await sendTelegramMessage(
          env,
          chatId,
          `🗑️ <b>تم الحذف الجماعي</b>\n\n✅ حُذفت: ${done}` +
            (failed.length ? `\n⚠️ فشلت: ${failed.length}\n${failed.slice(0, 5).join('\n')}` : '')
        );
        return;
      }

      // --- حذف مستند واحد ---
      await deleteDocument(env, pendingState.docType, pendingState.wafeqId);
      await updateTransaction(env.DB, pendingState.targetTxId, { status: 'deleted' });
      await updateTransaction(env.DB, txId, { status: 'posted' });
      await writeLog(env.DB, {
        transactionId: pendingState.targetTxId,
        action: 'wafeq_delete',
        status: 'success',
      });
      await sendTelegramMessage(
        env,
        chatId,
        `🗑️ <b>تم حذف العملية من وافق</b>\n\n${pendingState.label || ''}`
      );
      return;
    }

    // ---- تأكيد ترحيل عملية مكرّرة ----
    if (pendingState && pendingState.kind === 'confirm_duplicate') {
      const answer = (finalText || '').trim();
      await clearConversationState(env.DB, chatId);
      if (!/^(تأكيد|تاكيد|نعم|أجل|اجل|تم|أكيد|اكيد|yes|y)$/i.test(answer)) {
        await updateTransaction(env.DB, txId, { status: 'posted' });
        await sendTelegramMessage(env, chatId, '✔️ تم إلغاء الترحيل. لم تُسجّل العملية.');
        return;
      }
      const accountsDup = await getActiveAccounts(env.DB);
      await updateTransaction(env.DB, txId, {
        processedJson: JSON.stringify(pendingState.analyzed),
        status: 'analyzed',
      });
      await finalizeAndPost(env, {
        txId,
        chatId,
        result: pendingState.analyzed,
        accounts: accountsDup,
        messageId,
        contactId: pendingState.contactId || null,
        mediaR2Key: pendingState.mediaR2Key || null,
        mediaType: pendingState.mediaType || null,
        prefix: '⚠️ <b>رُحّلت رغم التشابه</b>\n\n',
      });
      return;
    }

    // ---- اختيار العملية المستهدفة (رداً على سؤال التوضيح) ----
    if (pendingState && pendingState.kind === 'target_choice') {
      const options = pendingState.options || [];
      const num = parseInt((finalText || '').trim(), 10);
      await clearConversationState(env.DB, chatId);

      if (isNaN(num) || num < 1 || num > options.length) {
        await updateTransaction(env.DB, txId, { status: 'posted' });
        await sendTelegramMessage(env, chatId, '✔️ تم الإلغاء (رقم غير صحيح). أعد المحاولة.');
        return;
      }
      const chosen = options[num - 1];

      if (pendingState.intent === 'delete') {
        const label = targetLabel(chosen);
        await setConversationState(env.DB, chatId, {
          kind: 'confirm_delete',
          docType: chosen.result.type,
          wafeqId: chosen.wafeqId,
          targetTxId: chosen.id,
          label,
        });
        await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
        await sendTelegramMessage(
          env,
          chatId,
          `⚠️ <b>تأكيد الحذف</b>\n\nسيتم حذف:\n${label}\n\nاكتب «تأكيد» للمتابعة.`
        );
        return;
      }

      await performEdit(env, {
        txId,
        chatId,
        messageId,
        chosen,
        instruction: pendingState.instruction || '',
      });
      return;
    }

    // ---- تعديل/حذف آخر عملية مُرحّلة (متابعة سياقية) ----
    // نتجاهله إن كان هناك حوار معلّق (استكمال بيانات/اختيار جهة اتصال)،
    // حتى لا يُفسَّر ردّ المستخدم على سؤال سابق كطلب تعديل.
    if (finalText && !media && !pendingState) {
      const recent = await listPostedTransactions(env.DB, chatId, 10);
      if (recent.length > 0) {
        const { intent, instruction, target } = await classifyFollowUp(env, finalText, recent);

        // ============ حذف جماعي: كل المسودات في وافق ============
        if (intent === 'delete' && target.mode === 'all_drafts') {
          const { count, items } = await getWafeqDraftSummary(env);
          if (count === 0) {
            await updateTransaction(env.DB, txId, { status: 'posted' });
            await sendTelegramMessage(env, chatId, 'ℹ️ لا قيود مُرحّلة في وافق للحذف.');
            return;
          }
          const preview = items
            .slice(0, 10)
            .map((d) => `• ${d.type} ${d.number || d.id}`)
            .join('\n');
          await setConversationState(env.DB, chatId, {
            kind: 'confirm_delete',
            bulk: items.map((d) => ({ docType: d.docType, id: d.id })),
            label: `${count} مسودة`,
          });
          await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
          await sendTelegramMessage(
            env,
            chatId,
            `⚠️ <b>تأكيد حذف جماعي</b>\n\nسيتم حذف <b>${count}</b> مسودة من وافق:\n${preview}` +
              `${count > 10 ? `\n… و${count - 10} غيرها` : ''}\n\n` +
              `⛔ لا رجعة في هذا الإجراء. اكتب «تأكيد» للمتابعة، أو أي شيء آخر للإلغاء.`
          );
          return;
        }

        if (intent === 'delete' || intent === 'edit') {
          // ---- حدّد العملية المستهدفة ----
          const res = await resolveTarget(env, chatId, target);

          if (!res.ok && res.reason === 'multiple') {
            const optionsText = res.options
              .map((t, i) => `${i + 1}) ${describeType(t.result.type)} — ${t.result.summary || ''} — ${t.wafeqId}`)
              .join('\n');
            await setConversationState(env.DB, chatId, {
              kind: 'target_choice',
              intent,
              instruction,
              options: res.options,
            });
            await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
            await sendTelegramMessage(
              env,
              chatId,
              `❓ وجدت أكثر من عملية مطابقة. أيّها تقصد؟\n\n${optionsText}\n\nأرسل الرقم.`
            );
            return;
          }
          if (!res.ok) {
            await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: res.reason });
            await sendTelegramMessage(env, chatId, `⚠️ ${res.reason}`);
            return;
          }

          const chosen = res.target;

          // ---- حذف مستند واحد (بتأكيد) ----
          if (intent === 'delete') {
            const label = targetLabel(chosen);
            await setConversationState(env.DB, chatId, {
              kind: 'confirm_delete',
              docType: chosen.result.type,
              wafeqId: chosen.wafeqId,
              targetTxId: chosen.id,
              label,
            });
            await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
            await sendTelegramMessage(
              env,
              chatId,
              `⚠️ <b>تأكيد الحذف</b>\n\nسيتم حذف:\n${label}\n\nاكتب «تأكيد» للمتابعة، أو أي شيء آخر للإلغاء.`
            );
            return;
          }

          // ---- تعديل ----
          await performEdit(env, {
            txId,
            chatId,
            messageId,
            chosen,
            instruction: instruction || finalText,
          });
          return;
        }
      }
    }

    // ---- استرجاع سياق حوار سابق (إن وُجد) ----
    const prior = await getConversationState(env.DB, chatId);
    let priorContext = null;
    if (prior) {
      priorContext = prior.accumulatedText || null;
      // إن كان هناك مرفق سابق ولم يصل مرفق جديد، أعِد تحميله من R2 مع التحقق من صلاحيته.
      if (!media && prior.mediaR2Key) {
        const obj = await env.MEDIA.get(prior.mediaR2Key);
        if (obj) {
          const restored = prepareStoredMedia(await obj.arrayBuffer());
          // نتجاهل المرفق المخزّن إن كان تالفاً أو تجاوز الحدّ ونكمل بالنص وحده.
          if (restored) {
            media = restored;
            mediaR2Key = prior.mediaR2Key;
            mediaType = restored.mediaType;
          }
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

    if (!finalText && !media) {
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
      media,
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
        (priorContext ? priorContext + '\n---\n' : '') + (finalText || mediaPlaceholder(media));
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

    // ---- حلّ جهة الاتصال (للفواتير) — مطابقة ذكية أو سؤال عند النقص/التعدد ----
    let contactId = null;
    if (result.type === 'purchase_bill' || result.type === 'sales_invoice') {
      // المورّد/العميل إلزامي في وافق — إن لم يُذكر فاسأل عنه.
      if (!result.contact_name) {
        const who = result.type === 'purchase_bill' ? 'المورّد' : 'العميل';
        const accumulated =
          (priorContext ? priorContext + '\n---\n' : '') + (finalText || mediaPlaceholder(media));
        await setConversationState(env.DB, chatId, {
          accumulatedText: accumulated,
          mediaR2Key,
          mediaType,
        });
        await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
        await sendTelegramMessage(env, chatId, `❓ من أي ${who}؟ الرجاء ذكر اسم ${who} لإتمام الفاتورة.`);
        return;
      }

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

    // ---- كشف عملية مكرّرة في نفس اليوم (تحذير قبل الترحيل) ----
    const dup = await findSimilarPostedToday(env.DB, chatId, {
      type: result.type,
      total: resultTotal(result),
      contactName: result.contact_name || '',
      date: result.date,
    });
    if (dup) {
      await setConversationState(env.DB, chatId, {
        kind: 'confirm_duplicate',
        analyzed: result,
        contactId,
        mediaR2Key,
        mediaType,
      });
      await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
      await sendTelegramMessage(
        env,
        chatId,
        `⚠️ <b>تحذير: عملية مشابهة اليوم</b>\n\n` +
          `يوجد ${describeType(result.type)} بنفس المبلغ${result.contact_name ? ` ولنفس «${result.contact_name}»` : ''} اليوم:\n` +
          `• ${dup.summary || ''}\n🧾 ${dup.wafeqId}\n\n` +
          `هل تريد ترحيلها مع ذلك؟ اكتب «تأكيد» للمتابعة، أو أي شيء آخر للإلغاء.`
      );
      return;
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
        `❌ <b>تعذّرت معالجة العملية</b>\n\nالسبب: ${msg}\n\nأعد المحاولة، أو تواصل مع الدعم إن تكرّر.`
      );
    } catch (_) {
      /* تجاهل فشل إرسال رسالة الخطأ */
    }
  }
}

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
  getChatPostedTransaction,
  isMessageProcessed,
  findSimilarPostedToday,
  addAlbumItem,
  setAlbumItemMedia,
  claimAlbum,
  albumClaimedBy,
  listAlbumItems,
  getAlbumKeys,
  attachAlbumKeys,
} from './db.js';
import {
  sendTelegramMessage,
  downloadTelegramFile,
  diagnoseWebhook,
} from '../services/telegram.js';
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
  probeAttachmentApi,
  deleteDocument,
  getWafeqDraftSummary,
} from '../services/wafeq.js';
import { resolveContact } from '../services/contacts.js';
import { prepareMedia, prepareStoredMedia, prepareAlbumMedia, extensionFor } from './media.js';
import { validateExtraction, correctionPrompt } from './extraction_check.js';
import { describeType } from './labels.js';
import {
  handleCallbackQuery,
  showDocumentList,
  showSearchResults,
  postedKeyboard,
} from './telegram_actions.js';
import {
  baseCurrency,
  currencyNameAr,
  formatMoney,
  isSupportedCurrency,
  normalizeCurrency,
  resolveExchangeRate,
  toBaseAmount,
} from './currency.js';

/** كلمات تأكيد الإجراء المعلّق (حذف، ترحيل رغم التشابه، ترحيل رغم خلل الأرقام). */
const CONFIRM_WORDS = /^(تأكيد|تاكيد|نعم|أجل|اجل|تم|أكيد|اكيد|yes|y)$/i;

/* مهلة سياق المحادثة — رقم واحد لكل القراءات.
   كانت ٦٠ دقيقة في فحص حالات التأكيد، والافتراضية ٣٠ في استرجاع السياق
   المتراكم — والقراءة الثانية تحذف ما انتهى. فبين الدقيقة ٣٠ و٦٠ يُرى
   الحوار قائماً فيُتخطّى تصنيف المتابعة، ثم يُمحى سياقه، فتُحلَّل إجابةُ
   المستخدم على سؤال البوت كعملية جديدة بلا أي إشعار. */
const CONVERSATION_TTL_MINUTES = 60;

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

/**
 * رسالة تحكّم («تأكيد»، «لا»، رقم اختيار) ليست عملية محاسبية.
 *
 * كانت تُوسم `posted` — أي «مُرحّلة» — فتُحتسب في بطاقة «مسودات في وافق»
 * وتظهر في جدول العمليات صفّاً مُرحّلاً بلا مستند في وافق. والصفّ يبقى، لأنه
 * ما يمنع إعادةَ الويبهوك من معالجة الرسالة مرتين، لكن بحالته الصادقة.
 */
async function markControlReply(env, txId, action) {
  await updateTransaction(env.DB, txId, { status: 'received' });
  await writeLog(env.DB, { transactionId: txId, action: `control_${action}`, status: 'info' });
}

/** سطر وصفي موجز لعملية. */
function targetLabel(t) {
  return `${describeType(t.result.type)} — ${t.result.summary || ''}${
    t.result.contact_name ? ` (${t.result.contact_name})` : ''
  }\n🧾 ${t.wafeqId}`;
}

/**
 * تثبيت عملة العملية وسعر صرفها على نتيجة التحليل.
 *
 * Claude يستخرج العملة وما ذكره المستخدم من سعر؛ وهنا يُطبَّع الرمز ويُحسم
 * السعر من مصادره المرتّبة. القيم تُكتب في النتيجة نفسها كي تُحفظ مع العملية
 * ويعتمدها الترحيل والتقارير معاً — فلا يُعاد استنتاجها في كل موضع.
 *
 * @returns {{ok:true, rate:number, source:string} | {ok:false, reason:'unsupported'|'no_rate'}}
 *   unsupported = عملة لا تقبلها وافق. no_rate = عملة أجنبية بلا سعر معروف.
 */
function settleCurrency(env, result) {
  const base = baseCurrency(env);
  const currency = normalizeCurrency(result.currency) || base;

  result.currency = currency;
  result.base_currency = base;

  // عملة خارج قائمة وافق يرفضها الخادم فيفشل المستند كلّه — نكشفها هنا
  // ونقولها بوضوح بدل تمريرها ليعود رفضٌ غامض.
  if (!isSupportedCurrency(currency)) {
    result.exchange_rate = null;
    return { ok: false, reason: 'unsupported' };
  }

  const state = resolveExchangeRate(env, currency, result.exchange_rate);
  result.exchange_rate = state ? state.rate : null;
  return state ? { ok: true, ...state } : { ok: false, reason: 'no_rate' };
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

/** رقم الفاتورة كما قُرئ منها، أو null إن غاب أو جاء بطول لا يكون لرقم فاتورة. */
function supplierNumber(result) {
  const n = String(result?.invoice_number || '').trim();
  return n && n.length <= 64 ? n : null;
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

/**
 * سطر سعر الصرف والمقابل بعملة الدفاتر — يظهر للعمليات بعملة أجنبية فقط.
 * الدفاتر بالريال، فمن حقّ المستخدم أن يرى بكم دخلت العملية دفاتره.
 */
function exchangeLine(result, cur, total) {
  const base = result.base_currency;
  if (!base || cur === base) return '';
  const rate = Number(result.exchange_rate) || 1;
  return (
    `💱 سعر الصرف: ${iso(rate)} — يعادل ${formatMoney(toBaseAmount(total, rate), base)}\n`
  );
}

function confirmManualJournal(result, wafeqId, cur) {
  const entries = result.manual_journal?.entries || [];
  const lines = entries
    .map((e) => {
      const side =
        Number(e.debit) > 0
          ? `مدين ${formatMoney(e.debit, cur)}`
          : `دائن ${formatMoney(e.credit, cur)}`;
      return `• ${e.account_name} — ${side}`;
    })
    .join('\n');
  const total = entries.reduce((s, e) => s + Number(e.debit || 0), 0);
  return (
    `✅ <b>تم إنشاء قيد محاسبي في وافق</b>\n\n` +
    `📅 التاريخ: ${iso(result.date)}\n${lines}\n\n` +
    `💰 الإجمالي: ${formatMoney(total, cur)}\n` +
    exchangeLine(result, cur, total) +
    `🧾 المرجع: ${wafeqId ? iso(wafeqId) : 'غير متوفر'}\n\n` +
    `ℹ️ ملاحظة: القيود اليدوية تُرحّل مباشرة في وافق (لا تدعم المسودة عبر الـ API).`
  );
}

/**
 * سطور الضريبة — **المطبَّقة فعلاً** في وافق لا التي اقترحها Claude.
 *
 * ═══ لماذا يُمرَّر ما طُبِّق ولا يُعاد حسابه هنا ═══
 *
 * الترحيل لا يُرفق معدّل ضريبة إلا إن كان `VAT_TAX_RATE_ID` مضبوطاً، وهو
 * اختياري ولا شيء يمنع غيابه. وكانت الرسالة تحسب الضريبة من `vat_percent`
 * وتعرضها في الحالين — فيقرأ المستخدم «ضريبة ١٥٪» وإجمالاً يشملها، بينما
 * المستند في وافق بلا ضريبة أصلاً.
 *
 * وفي نظام محاسبي هذا أخطر من عطل ظاهر: البيان الذي يُقرأ لا يطابق ما دخل
 * الدفتر، ولا شيء يقول ذلك. فإن سقطت الضريبة تُقال صراحةً مع سببها.
 *
 * @param {number} requestedVat النسبة التي طلبها التحليل.
 * @param {number} appliedVat   النسبة التي أُرفقت بالمستند فعلاً (0 = لم تُطبَّق).
 * @returns {{lines:string, total:number}}
 */
function vatSection(sub, requestedVat, appliedVat, cur) {
  if (appliedVat > 0) {
    const vat = +((sub * appliedVat) / 100).toFixed(2);
    const total = +(sub + vat).toFixed(2);
    return {
      total,
      lines:
        `💰 قبل الضريبة: ${formatMoney(sub, cur)}\n` +
        `➕ ضريبة ${iso(appliedVat + '%')}: ${formatMoney(vat, cur)}\n` +
        `💵 الإجمالي: ${formatMoney(total, cur)}\n`,
    };
  }
  if (requestedVat > 0) {
    return {
      total: sub,
      lines:
        `💰 الإجمالي: ${formatMoney(sub, cur)} (بدون ضريبة)\n` +
        `⚠️ لم تُطبَّق ضريبة ${iso(requestedVat + '%')}: معرّف الضريبة ` +
        `<code>VAT_TAX_RATE_ID</code> غير مضبوط. أضِفه في إعدادات Cloudflare ` +
        `ثم عدّل المستند في وافق.\n`,
    };
  }
  return { total: sub, lines: `💰 الإجمالي: ${formatMoney(sub, cur)} (بدون ضريبة)\n` };
}

/** سطور ما قُرئ من الفاتورة نفسها: رقمها والرقم الضريبي لمُصدرها. */
function documentRefLines(result) {
  let out = '';
  const number = supplierNumber(result);
  if (number) out += `🔢 رقم الفاتورة: ${iso(number)}\n`;
  const vatNo = String(result.supplier_vat_number || '').trim();
  if (vatNo) out += `🏷️ الرقم الضريبي: ${iso(vatNo)}\n`;
  return out;
}

function confirmBill(result, wafeqId, cur, appliedVat = 0) {
  const items = result.bill?.line_items || [];
  const lines = items
    .map((li) => `• ${li.account_name} — ${formatMoney(li.amount, cur)}`)
    .join('\n');
  const sub = items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const vat = vatSection(sub, Number(result.bill?.vat_percent ?? 0), appliedVat, cur);
  return (
    `✅ <b>تم إنشاء فاتورة مشتريات (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${iso(result.date)}\n🏢 المورّد: ${result.contact_name || 'غير محدّد'}\n` +
    documentRefLines(result) +
    `${lines}\n\n` +
    vat.lines +
    exchangeLine(result, cur, vat.total) +
    `🧾 رقم المسودة: ${wafeqId ? iso(wafeqId) : 'غير متوفر'}\n\n` +
    `⚠️ فاتورة <b>مسودة</b> تتطلب مراجعتك واعتمادك في وافق.`
  );
}

function confirmInvoice(result, wafeqId, cur, appliedVat = 0) {
  const items = result.invoice?.line_items || [];
  const sub = items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const vat = vatSection(sub, Number(result.invoice?.vat_percent ?? 15), appliedVat, cur);
  const lines = items
    .map((li) => `• ${li.account_name} — ${formatMoney(li.amount, cur)}`)
    .join('\n');
  return (
    `✅ <b>تم إنشاء فاتورة مبيعات (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${iso(result.date)}\n👤 العميل: ${result.contact_name ? iso(result.contact_name) : 'غير محدّد'}\n${lines}\n\n` +
    vat.lines +
    exchangeLine(result, cur, vat.total) +
    `🧾 رقم المسودة: ${wafeqId ? iso(wafeqId) : 'غير متوفر'}\n\n` +
    `⚠️ فاتورة <b>مسودة</b> تتطلب مراجعتك واعتمادك في وافق.`
  );
}

// ---------------------------------------------------------------------------
// الترحيل إلى وافق حسب نوع العملية (بمعرّف جهة اتصال مُحلّل مسبقاً).
// ---------------------------------------------------------------------------
async function postToWafeq(env, result, accounts, ref, attachmentIds, contactId) {
  const idMap = accountIdMap(accounts);
  const currency = result.currency || baseCurrency(env);
  const exchangeRate = Number(result.exchange_rate) > 0 ? Number(result.exchange_rate) : 1;

  if (result.type === 'manual_journal') {
    const entries = result.manual_journal?.entries || [];
    const { id, raw } = await postJournalEntryDraft(env, accounts, entries, {
      description: ref,
      date: result.date,
      attachmentIds,
      currency,
      exchangeRate,
    });
    return { wafeqId: id, raw, confirm: confirmManualJournal(result, id, currency) };
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
    /* رقم فاتورة المورّد كما طُبع يُرحَّل بدل رقمٍ مولَّد (`PB-<طابع>`)، فتُطابَق
       المسودة بورقتها في وافق. وإن رفضت وافق الرقم نفسه — مكرّراً أو بصيغة لا
       تقبلها — يُعاد الإنشاء برقمٍ مولَّد: مستندٌ بلا رقم المورّد أفضل من لا مستند. */
    const billOpts = { contactId, date: result.date, currency, lineItems, attachmentIds };
    const number = supplierNumber(result);
    let created;
    try {
      created = await createBillDraft(env, { ...billOpts, number });
    } catch (e) {
      const numberRejected = /failed: 4\d\d/.test(e.message || '') && /number/i.test(e.message || '');
      if (!number || !numberRejected) throw e;
      created = await createBillDraft(env, billOpts);
    }
    const { id, raw } = created;
    // ما يُعرض = ما طُبِّق: لا معرّف ضريبة ⇐ لا ضريبة على المستند.
    return { wafeqId: id, raw, confirm: confirmBill(result, id, currency, billTaxRate ? billVat : 0) };
  }

  if (result.type === 'sales_invoice') {
    /* النسبة تُقرأ من التحليل ولا تُفترض: كان المعدّل يُرفق دائماً، فمن طلب
       «بدون ضريبة» — و`applyEdit` يضبط له `vat_percent = 0` صراحةً بنصّ
       توجيهه — تخرج فاتورته بضريبة رغم ذلك. */
    const invoiceVat = Number(result.invoice?.vat_percent ?? 15);
    const invoiceTaxRate = invoiceVat > 0 ? env.VAT_TAX_RATE_ID || null : null;
    const lineItems = (result.invoice?.line_items || []).map((li) => ({
      account: idMap[li.account_code] || li.account_code,
      description: li.description,
      amount: li.amount,
    }));
    const { id, raw } = await createInvoiceDraft(env, {
      contactId,
      date: result.date,
      currency,
      lineItems,
      taxRateId: invoiceTaxRate,
      attachmentIds,
    });
    return {
      wafeqId: id,
      raw,
      confirm: confirmInvoice(result, id, currency, invoiceTaxRate ? invoiceVat : 0),
    };
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
  // صفحات الألبوم كلها تُرفق بالمستند؛ والمرفق المفرد مصفوفة من عنصر.
  const mediaKeys = ctx.mediaR2Keys?.length ? ctx.mediaR2Keys : mediaR2Key ? [mediaR2Key] : [];

  // تحذير يُلحق برسالة التأكيد حين لا يصل المرفق إلى المستند — الصمت هنا
  // يجعل المستخدم يظنّ الملف مرفقاً وهو ليس كذلك.
  let attachmentWarning = '';
  const attachmentIds = [];

  for (const key of mediaKeys) {
    try {
      const obj = await env.MEDIA.get(key);
      if (!obj) throw new Error('الملف غير موجود في التخزين');

      const buf = await obj.arrayBuffer();
      const fname = key.split('/').pop() || 'attachment';
      const attId = await uploadAttachment(
        env,
        buf,
        fname,
        (mediaKeys.length === 1 && mediaType) || obj.httpMetadata?.contentType || 'application/octet-stream'
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

  // المرفق يُربط بالصفّ الذي رُحّل — قد يكون جواباً على سؤال لا الرسالة التي
  // حملت الملف — فتجده التعديلات اللاحقة ولا يضيع عند أولها.
  await updateTransaction(env.DB, txId, {
    wafeqDraftId: wafeqId,
    status: 'posted',
    mediaR2Key: mediaKeys[0] || undefined,
  });
  await attachAlbumKeys(env.DB, txId, mediaKeys);
  await writeLog(env.DB, { transactionId: txId, action: 'wafeq_post', status: 'success' });
  await clearConversationState(env.DB, chatId);

  // العملية رُحّلت إلى وافق وانتهى أمرها. فشل إشعار المستخدم بعد ذلك حادثٌ
  // في قناة التبليغ لا في المحاسبة، فلا يُصعَّد: تصعيده يُدخل المعالج مسار
  // الخطأ فيسم عمليةً ناجحة بأنها فاشلة، ويبقى قيدها في وافق بلا مقابل هنا.
  try {
    await sendTelegramMessage(env, chatId, (prefix || '') + confirm + attachmentWarning, {
      replyMarkup: postedKeyboard(txId),
    });
  } catch (e) {
    await writeLog(env.DB, {
      transactionId: txId,
      action: 'telegram_notify',
      status: 'error',
      errorDetails: e.message,
    });
  }
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
    baseCurrency: baseCurrency(env),
    previous: chosen.result,
    instruction,
  });

  // سعر الصرف يُحسم على النسخة المعدّلة كما يُحسم على الأصلية — قد يكون
  // التعديل نفسه هو تغيير العملة.
  const editedCurrency = settleCurrency(env, edited);
  if (!editedCurrency.ok) {
    const why =
      editedCurrency.reason === 'unsupported'
        ? `وافق لا تدعم العملة ${iso(edited.currency)}.`
        : `لا أعرف سعر صرف ${currencyNameAr(edited.currency)} (${iso(edited.currency)}). ` +
          `أعد الطلب ذاكراً السعر — مثال: «خلّها بالدولار بسعر ${iso('3.75')}».`;
    await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: why });
    await sendTelegramMessage(env, chatId, `⚠️ ${why}`);
    return;
  }

  // جهة الاتصال للفواتير.
  let contactId = null;
  if ((edited.type === 'purchase_bill' || edited.type === 'sales_invoice') && edited.contact_name) {
    const r = await resolveContact(env, edited.contact_name);
    contactId = r.contactId;
  }

  // صفحات الألبوم تنتقل مع العملية إلى نسختها المعدّلة كما ينتقل المرفق المفرد.
  const albumKeys = await getAlbumKeys(env.DB, chosen.id);

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

  /* القديم حُذف بالفعل. فإن فشل إنشاء البديل — خطأ من وافق، أو حساب غير
     مربوط، أو انقطاع — فلم يبقَ للعملية مستند، والمسار كان يسقط إلى معالج
     الخطأ العام فيقول «تعذّرت معالجة العملية» ولا يذكر أن القديمة حُذفت.
     فيبقى صاحبها يظنّ قيده قائماً وهو ليس في الدفتر ولا في المسودات. */
  try {
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
      mediaR2Keys: albumKeys.length ? albumKeys : null,
      mediaType: null,
      prefix: '✏️ <b>تم تعديل العملية</b> (حُذفت النسخة السابقة وأُنشئت محدّثة)\n\n',
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: msg });
    await writeLog(env.DB, {
      transactionId: txId,
      action: 'apply_edit',
      status: 'error',
      errorDetails: `فشل إنشاء البديل بعد حذف ${chosen.wafeqId}: ${msg}`,
    });
    await sendTelegramMessage(
      env,
      chatId,
      `❌ <b>حُذفت العملية القديمة ولم تُنشأ الجديدة</b>\n\n` +
        `السبب: ${msg}\n\n` +
        `لم يبقَ للعملية مستند في وافق. أعد إرسالها عمليةً جديدة:\n` +
        `<code>${edited.summary || ''}</code>`
    );
  }
}

/**
 * صياغة تقرير التشخيص رسالةً مقروءة.
 * الرسالة محدودة الطول في تليجرام، فنُبقي ما يدلّ ونحذف ما يزحم.
 */
function formatProbeReport(report) {
  const mark = (status) => (status === 200 ? '✅' : status === 404 ? '❌' : '⚠️');

  const paths = Object.entries(report.paths || {})
    .map(([path, r]) => `${mark(r.status)} <code>${path}</code> — ${r.status}`)
    .join('\n');

  const docs = Object.entries(report.documents || {})
    .map(([label, d]) => {
      if (!d.fields?.length) return `• ${label}: ${d.note || d.status}`;
      const found = Object.keys(d.attachmentLike || {});
      const sub = d.subPath ? `\n   فرعي: ${mark(d.subPath.status)} ${d.subPath.status}` : '';
      return (
        `• <b>${label}</b> (${d.fields.length} حقلاً)` +
        `\n   حقول المرفقات: ${found.length ? found.join(', ') : 'لا شيء'}${sub}`
      );
    })
    .join('\n');

  // مسار إجراءٍ يردّ ٤٠٥ على GET موجودٌ ويقبل طريقة أخرى — وهو المرشّح للاعتماد.
  const actionMark = (status) => (status === 405 ? '✅' : status === 404 ? '❌' : '⚠️');
  const approval = Object.entries(report.approval || {})
    .map(([label, a]) => {
      const actions = Object.entries(a.actions || {})
        .map(([name, status]) => `${actionMark(status)} <code>${name}/</code> — ${status}`)
        .join('\n   ');
      return (
        `• <b>${label}</b>: الحالات الموجودة ${a.statuses?.length ? a.statuses.join('، ') : 'لا شيء'}` +
        (a.draftId ? `\n   مسارات الإجراء على مسودة:\n   ${actions}` : '\n   لا مسودة لفحص مسارات الإجراء')
      );
    })
    .join('\n');

  return (
    `🔎 <b>تشخيص واجهة مرفقات وافق</b>\n\n` +
    `<b>المسارات الجذرية</b>\n${paths || 'لا شيء'}\n\n` +
    `<b>حقول المستندات</b>\n${docs || 'لا شيء'}\n\n` +
    `<b>اعتماد المسودات</b> (قراءة فقط — لم يُعتمد شيء)\n${approval || 'لا شيء'}\n` +
    `في هذا القسم: ✅ موجود (يردّ ${iso('405')} على القراءة) · ❌ غير موجود\n\n` +
    `✅ موجود · ❌ غير موجود · ⚠️ صلاحية أو خطأ آخر`
  );
}

/**
 * تقرير حالة القناة والمنصة، يُقرأ داخل المحادثة.
 *
 * يشمل الطرفين معاً: الوارد (ويبهوك تليجرام) والصادر (الرمز)، ثم ما يلزم
 * لإتمام عملية (شجرة الحسابات ومفاتيح الخدمات). فالسؤال «هل رُحّل القيد
 * ولم يصلني الرد أم المنصة متوقفة؟» له هنا جوابٌ واحد لا يحتاج تخميناً.
 */
async function formatHealthReport(env, chatId) {
  const mark = (ok) => (ok ? '✅' : '❌');

  let accounts = 0;
  let dbError = null;
  try {
    accounts = (await getActiveAccounts(env.DB)).length;
  } catch (e) {
    dbError = e.message || String(e);
  }

  const report = await diagnoseWebhook(env);
  const w = report.webhook;

  /* كل سطر يقول حاله بالكلمة لا بالعلامة وحدها: العلامة تُقرأ بسرعة، لكن
     قارئ الشاشة ينطقها باسمٍ غير مقصود، ورسالةً منقولةً قد تُجرَّد منها. */
  const state = (ok, good, bad) => `${mark(ok)} ${ok ? good : bad}`;

  const lines = [
    `<b>حالة المحاسب الذكي</b> — ${state(report.healthy, 'سليمة', 'تحتاج إصلاحاً')}`,
    '',
    `<b>القناة الواردة</b>`,
    `${mark(!!report.bot)} البوت: ${report.bot ? iso('@' + report.bot) : 'رمز البوت لا يعمل'}`,
    `${mark(!!w && !!w.url)} الويبهوك: ${w && w.url ? `<code>${w.url}</code>` : 'غير مسجّل'}`,
  ];
  if (report.expectedUrl) {
    const same = !!w && w.url === report.expectedUrl;
    lines.push(
      `${mark(same)} المطابقة: ` +
        (same ? 'الرابط مطابق للمنصة' : `غير مطابق — المتوقّع <code>${report.expectedUrl}</code>`)
    );
  }
  if (w) {
    lines.push(`${mark(w.pendingUpdateCount === 0)} تحديثات معلّقة: ${iso(w.pendingUpdateCount)}`);
    if (w.lastErrorMessage) lines.push(`⚠️ آخر خطأ تسليم: ${w.lastErrorMessage}`);
  }
  lines.push(`${state(report.secretSet, 'سرّ الويبهوك مضبوط', 'سرّ الويبهوك غير مضبوط')}`);

  lines.push(
    '',
    `<b>ما يلزم لإتمام عملية</b>`,
    `${mark(!dbError)} قاعدة البيانات: ${dbError ? dbError : 'تعمل'}`,
    `${mark(accounts > 0)} شجرة الحسابات: ${iso(accounts)} حساباً قابلاً للترحيل`,
    state(!!env.CLAUDE_API_KEY, 'مفتاح التحليل مضبوط', 'مفتاح التحليل غير مضبوط'),
    state(!!env.WAFEQ_API_KEY, 'مفتاح وافق مضبوط', 'مفتاح وافق غير مضبوط'),
    '',
    `🆔 معرّف هذه المحادثة: <code>${chatId}</code>`
  );

  if (!report.healthy) {
    lines.push('', '<b>ما يحتاج إصلاحاً</b>', ...report.problems.map((p) => `• ${p}`));
  }

  return lines.join('\n');
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
• فاتورة من عدة صفحات؟ أرسل صورها معاً <b>ألبوماً واحداً</b> فتُقرأ فاتورةً واحدة.
• لأدقّ قراءة أرسل الصورة <b>كملف</b> (📎 ← ملف): تليجرام يضغط الصور العادية.
• تُطابَق المجاميع المطبوعة بالبنود قبل الترحيل، فإن اختلفت سألتك.

<b>التوجيه التلقائي:</b>
• رواتب/تحويلات صادرة ← قيد محاسبي
• سداد/مشتريات ← فاتورة مشتريات (مسودة)
• وارد من عميل ← فاتورة مبيعات + ضريبة 15٪ (مسودة)

<b>2) مسوداتك</b> — من زر القائمة بجانب حقل الكتابة:
• <code>/drafts</code> — آخر المسودات، ولكلٍّ منها بطاقة بأزرار: تعديل، حذف، عرض المرفق
• <code>/search جرير</code> — بحث في العمليات المُرحّلة
• رسالة كل ترحيل تحمل أزرار التعديل والحذف مباشرة

<b>3) تعديل عملية</b> — بالزر، أو أرسل التعديل مباشرة:
• <code>عدّل المبلغ إلى 600</code>
• <code>خلّه بدون ضريبة</code>
• <code>غيّر المورّد إلى جرير</code>
• <code>عدّل المسودة قبل الأخيرة المبلغ 900</code>

<b>4) حذف عملية</b> — بالزر، أو كتابةً (يطلب «تأكيد»):
• <code>احذف القيد</code>
• <code>احذف فاتورة جرير</code>
• <code>احذف المسودة mjou_xxx</code>
• <code>احذف جميع المسودات في وافق</code>

<b>5) أوامر أخرى</b>
• <code>/new</code> أو <code>جديد</code> — إلغاء أي عملية جارية والبدء من نظيف
• <code>حالة</code> — فحص القناة والمنصة ومعرّف هذه المحادثة
• <code>تشخيص</code> — فحص اتصال المرفقات بوافق (قراءة فقط)
• <code>/help</code> — هذه الرسالة

<b>6) العملات</b>
• العملة الافتراضية <b>الريال</b> — لا حاجة لذكرها.
• لعملة أخرى اذكرها: <code>دفعت 500 دولار رسوم منصة</code>
• الدولار محسوب بالربط الرسمي <code>3.75</code>. لسعر مختلف اذكره: <code>بسعر 3.78</code>
• عملة بلا سعر معروف؟ سأسألك عن سعرها قبل الترحيل.
• المبلغ يُرحّل بعملته، ويظهر مقابله بالريال في رسالة التأكيد.

<b>ملاحظات</b>
• إن لم تذكر حساب الدفع فالافتراضي <b>الحساب البنكي</b> (اذكر «نقداً» أو «الخزينة» أو «النثرية» للتغيير).
• التواريخ النسبية مفهومة: «أمس»، «الثلاثاء الماضي».
• إن نقص بيان جوهري (المبلغ أو المورّد/العميل) سأسألك عنه.`;

/** بديل نصّي للمرفق داخل السياق المتراكم حين تخلو الرسالة من نص. */
function mediaPlaceholder(media) {
  if (!media) return '';
  return media.kind === 'document' ? '(ملف PDF مرفق)' : '(صورة مرفقة)';
}

/* ═══ توقيت الألبوم ═══
   تصل صور الألبوم تحديثاتٍ متتابعة خلال ثانية أو اثنتين، وكلٌّ منها يُنزَّل
   ويُحضَّر على حدة. فينتظر كل عنصر قليلاً ثم يحاول الاستلام: ينجح حين تكون
   كل العناصر محفوظة ولم يصل جديدٌ منذ ALBUM_QUIET_MS. وبعد آخر محاولة يُستلم
   بلا شرط، فلا يعلق ألبومٌ عنصرُه الأخير لم يكتمل. */
const ALBUM_FIRST_WAIT_MS = 3000;
const ALBUM_POLL_MS = 1500;
const ALBUM_QUIET_MS = 2000;
const ALBUM_MAX_POLLS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {Promise<'leader'|'follower'>} دور هذا العنصر في ألبومه. */
async function coordinateAlbum(env, { groupId, chatId, txId }) {
  await sleep(ALBUM_FIRST_WAIT_MS);
  for (let poll = 0; poll <= ALBUM_MAX_POLLS; poll++) {
    const force = poll === ALBUM_MAX_POLLS;
    if (await claimAlbum(env.DB, { groupId, chatId, txId, quietMs: ALBUM_QUIET_MS, force })) {
      return 'leader';
    }
    const by = await albumClaimedBy(env.DB, txId);
    if (by !== null && by !== undefined) return by === txId ? 'leader' : 'follower';
    if (!force) await sleep(ALBUM_POLL_MS);
  }
  // لم يُستلم ولم يستلم — يُعالَج وحده بدل أن يضيع.
  return 'leader';
}

/** أقصى حجم يسمح تليجرام للبوت بتنزيله عبر getFile. */
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

/**
 * أكبر نسخة من صورة تليجرام المضغوطة.
 * تليجرام يعيد ضغط الصورة المرسلة «صورةً» إلى قرابة ١٢٨٠ بكسل، فتضيع
 * تفاصيل الإيصالات الكثيفة — و`compressed` يُبقي ذلك معروفاً لنصيحة المستخدم.
 */
function photoAttachment(sizes) {
  const largest = sizes[sizes.length - 1];
  return { fileId: largest.file_id, size: largest.file_size || 0, compressed: true };
}

/** نصيحة تُلحق حين تُقرأ صورة مضغوطة قراءةً ناقصة. */
const SEND_AS_FILE_TIP =
  '\n\n💡 لدقة أعلى أرسل الفاتورة <b>كملف</b> لا كصورة (📎 ← ملف): تليجرام يضغط الصور فتضيع أرقامها الصغيرة.';

/** تصنيف مبدئي لمرفق تليجرام: هل يبدو ملف PDF من نوعه المعلن أو اسمه؟ */
function looksLikePdf(document) {
  if (!document) return false;
  return (
    /pdf/i.test(document.mime_type || '') || /\.pdf$/i.test(document.file_name || '')
  );
}

/**
 * إبلاغ المستخدم بفشلٍ ما، وتسجيلُ فشل الإبلاغ نفسه.
 *
 * فشلُ `sendTelegramMessage` كان يُبتلع بتعليق «تجاهل». وهو أخطر ما يُبتلع:
 * رمزُ بوتٍ بُدّل، أو حدُّ معدّل، يجعل **كل** رسالة تفشل — فيرى المستخدم
 * صمتاً تامّاً في كل مسار، ولا يبقى في أي سجلّ سطرٌ يقول لماذا. فالسبب
 * يُكتب هنا ولو تعذّر إيصاله.
 */
async function notifyFailure(env, chatId, text, transactionId = null) {
  try {
    await sendTelegramMessage(env, chatId, text);
  } catch (e) {
    await writeLog(env.DB, {
      transactionId,
      action: 'telegram_notify',
      status: 'error',
      errorDetails: `تعذّر إرسال رسالة الخطأ إلى ${chatId}: ${e.message || String(e)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// المعالجة الرئيسية لرسالة تليجرام.
//
// الغلاف والمعالج منفصلان عمداً: كان أوّلُ ستين سطراً من المعالجة يقع
// **خارج** `try` — قراءةُ منع التكرار، وإنشاء صفّ العملية، وإرسالُ نصّ
// المساعدة. وثلاثتها تلمس قاعدة البيانات أو الشبكة، فأيُّ عطلٍ فيها كان
// يرفض وعد `waitUntil` بلا سجلّ ولا رسالة — أي صمتاً تامّاً قبل أن يُنشأ
// للعملية صفٌّ تُنسب إليه. فصار المعالج كلّه داخل حارسٍ واحد.
// ---------------------------------------------------------------------------
export async function processTelegramUpdate(env, update) {
  // ضغطة زر: لها معالجها، وهو يبلّغ فشله بنفسه ويسجّله.
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  const message = update.message || update.edited_message;
  if (!message || !message.chat) return;
  const chatId = message.chat.id;
  const isEdited = Boolean(update.edited_message);

  try {
    await handleTelegramMessage(env, message, isEdited);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await writeLog(env.DB, {
      action: 'process_error',
      status: 'error',
      errorDetails: `فشل قبل تسجيل العملية (chat=${chatId}): ${msg}`,
    });
    await notifyFailure(
      env,
      chatId,
      `❌ <b>تعذّرت معالجة الرسالة</b>\n\nالسبب: ${msg}\n\nأعد المحاولة، أو تواصل مع الدعم إن تكرّر.`
    );
  }
}

// `isEdited` يُمرَّر من الغلاف: غلافُ التحديث وحده يرى `update`، والمعالج
// يرى الرسالة فقط. كان الفحص هنا يقرأ `update.edited_message` مباشرةً —
// وهو خارج نطاق هذه الدالة، فكان كلُّ رسالةٍ تتجاوز الأوامر ترتدّ بـ
// «update is not defined» قبل أن تُسجَّل عملية.
async function handleTelegramMessage(env, message, isEdited = false) {
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const dateISO = messageDateISO(message.date);

  const incomingText = message.text || message.caption || '';

  // ---- أمر المساعدة (لا يُسجّل كعملية) ----
  if (/^\/(help|start)\b/i.test(incomingText.trim()) || /^(مساعدة|المساعدة|الأوامر)$/.test(incomingText.trim())) {
    await sendTelegramMessage(env, chatId, HELP_TEXT);
    return;
  }

  // ---- أوامر القائمة (لا تُسجّل كعمليات) ----
  // في المجموعات يصل الأمر بلاحقة اسم البوت («‎/drafts@NafBot»)، فتُنزع.
  const command = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(incomingText.trim());
  const commandName = command ? command[1].toLowerCase() : null;
  const commandArgs = command ? (command[2] || '').trim() : '';

  if (commandName === 'drafts' || /^(مسوداتي|المسودات)$/.test(incomingText.trim())) {
    await showDocumentList(env, chatId, 'drafts', 0);
    return;
  }
  if (commandName === 'search') {
    if (commandArgs) {
      await showSearchResults(env, chatId, commandArgs);
    } else {
      // الكلمة تأتي في الرسالة التالية.
      await setConversationState(env.DB, chatId, { kind: 'search_query' });
      await sendTelegramMessage(env, chatId, '🔎 أرسل كلمة البحث: اسم المورّد أو العميل، أو جزءاً من الوصف.');
    }
    return;
  }
  if (commandName === 'new') {
    await clearConversationState(env.DB, chatId);
    await sendTelegramMessage(env, chatId, '🔄 تم إلغاء أي عملية جارية. أرسل عمليتك الجديدة الآن.');
    return;
  }

  // ---- أمر التشخيص (لا يُسجّل كعملية) ----
  // مسار رفع المرفقات في وافق غير موثّق، ويُحسم بسؤال الواجهة نفسها. الأمر
  // متاح من المحادثة لأن من يشغّله هو من يملك الحساب — لا من يملك سطر أوامر.
  if (/^\/(diag|probe)\b/i.test(incomingText.trim()) || /^(تشخيص|التشخيص)$/.test(incomingText.trim())) {
    try {
      const report = await probeAttachmentApi(env);
      await sendTelegramMessage(env, chatId, formatProbeReport(report));
    } catch (e) {
      await sendTelegramMessage(env, chatId, `⚠️ تعذّر التشخيص: ${e.message}`);
    }
    return;
  }

  // ---- أمر حالة القناة (لا يُسجّل كعملية) ----
  // يجيب على السؤال الذي لا تجيب عنه اللوحة: هل يصل تليجرام إلى المنصة؟
  // ووصولُ الجواب نفسه دليلٌ على أن الوارد يعمل — أمّا إن لم يصل، فالجواب
  // في `‎/api/telegram/status` من اللوحة، أو في تنبيه المهمة الليلية.
  if (
    /^\/(status|health)\b/i.test(incomingText.trim()) ||
    /^(حالة|الحالة|حالة البوت)$/.test(incomingText.trim())
  ) {
    await sendTelegramMessage(env, chatId, await formatHealthReport(env, chatId));
    return;
  }

  /* ---- رسالة معدَّلة ----

     تحمل معرّف الرسالة الأصلية، فكان فحص التكرار أدناه يبتلعها ويسجّلها
     «رسالة مكرّرة»: المسار مكتوب — `edited_message` مقروء في الغلاف أعلاه
     وفي باب الويبهوك — ولا يعمل أبداً. فمن صحّح مبلغاً بتعديل رسالته
     لا يجد شيئاً حدث ولا خبراً يقول لماذا.

     والتعديل بعد الترحيل يحتاج تعديل مستند وافق نفسه، وله مسار مخصّص
     («عدّل المبلغ إلى ٦٠٠»). فيُقال ذلك صراحةً بدل الصمت. */
  if (isEdited) {
    await writeLog(env.DB, {
      action: 'telegram_edited_message',
      status: 'info',
      errorDetails: `chat=${chatId} msg=${messageId}`,
    });
    await sendTelegramMessage(
      env,
      chatId,
      'ℹ️ تعديل رسالة سابقة لا يُعالَج. لتصحيح عملية مُرحّلة أرسل التعديل رسالةً ' +
        'جديدة — مثل: <code>عدّل المبلغ إلى 600</code>.'
    );
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
    ? photoAttachment(message.photo)
    : message.document
      ? { fileId: message.document.file_id, size: message.document.file_size || 0, compressed: false }
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

  // عنصر ألبوم: يُسجَّل لحظة وصوله — قبل تنزيله — كي ينتظره بقية العناصر.
  // وإن تعذّر التسجيل — جدول الألبوم لم يُنشأ بعد (الترحيل `0008` لم يُطبَّق)
  // أو القاعدة متعثّرة — تُعالَج الصورة وحدها كما كانت قبل الألبومات، بدل أن
  // تفشل.
  let albumId = attachment && message.media_group_id ? String(message.media_group_id) : null;
  if (albumId) {
    try {
      await addAlbumItem(env.DB, {
        groupId: albumId,
        chatId,
        messageId,
        txId,
        caption: message.caption || null,
      });
    } catch (e) {
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'album_merged',
        status: 'error',
        errorDetails: `تعذّر تسجيل عنصر الألبوم فعولج وحده: ${e.message || String(e)}`,
      });
      albumId = null;
    }
  }

  try {
    let finalText = message.text || message.caption || '';
    let media = null;
    let mediaR2Key = null;
    let mediaR2Keys = null;
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
      // واجهة البوت لا تنزّل ما فوق ٢٠ ميغابايت، وكان ذلك يعود خطأً مبهماً
      // («getFile failed: 400») بعد محاولة التنزيل. فيُقال قبلها بوضوح.
      if (attachment.size > TELEGRAM_DOWNLOAD_LIMIT) {
        throw new Error(
          `حجم الملف (${iso((attachment.size / 1048576).toFixed(1))} ميغابايت) يتجاوز ما يسمح تليجرام ` +
            `للبوت بتنزيله (${iso('20')} ميغابايت). أرسل الصفحات المطلوبة فقط أو صورة مضغوطة.`
        );
      }
      let prepared;
      try {
        const buffer = await downloadTelegramFile(env, attachment.fileId);
        // النوع الحقيقي والتحويل عند اللزوم (HEIC من الآيفون مثلاً) — من البايتات.
        prepared = await prepareMedia(env, buffer);
      } catch (e) {
        // عنصر ألبوم تعذّر تحضيره لا يُنتظر — بقية الصفحات تمضي بدونه.
        if (albumId) await setAlbumItemMedia(env.DB, txId, '');
        throw e;
      }

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
      if (albumId) await setAlbumItemMedia(env.DB, txId, mediaR2Key, mediaType);
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

    /* ---- ألبوم: صفحات فاتورة واحدة تُقرأ معاً ----
       عنصرٌ واحد يستلم المجموعة ويحلّلها في طلب واحد بتعليقها، والبقية
       تنسحب. صفّ العنصر المنسحب يبقى بحالة «مستلمة» كما تبقى رسائل التحكّم:
       رسالةٌ وصلت ولم تصر عملية مستقلة. */
    if (albumId) {
      const role = await coordinateAlbum(env, { groupId: albumId, chatId, txId });
      if (role === 'follower') {
        await markControlReply(env, txId, 'album_merged');
        return;
      }
      const items = (await listAlbumItems(env.DB, txId)).filter((i) => i.r2_key);
      if (items.length > 1) {
        const buffers = [];
        for (const it of items) {
          const obj = await env.MEDIA.get(it.r2_key);
          if (obj) buffers.push(await obj.arrayBuffer());
        }
        media = await prepareAlbumMedia(env, buffers);
        mediaR2Keys = items.map((i) => i.r2_key);
        finalText = finalText || items.map((i) => i.caption).find(Boolean) || '';
        await updateTransaction(env.DB, txId, { rawText: finalText || null });
        await writeLog(env.DB, {
          transactionId: txId,
          action: 'album_merged',
          status: 'info',
          errorDetails: `${items.length} صفحات في طلب واحد`,
        });
      }
    }

    // ---- كلمة إعادة/إلغاء تمسح أي سياق عالق وتبدأ من جديد ----
    const RESET_WORDS = ['إلغاء', 'الغاء', 'جديد', 'ابدأ من جديد', 'ابدا من جديد', 'إلغاء العملية', 'reset', 'cancel'];
    if (finalText && RESET_WORDS.includes(finalText.trim())) {
      await clearConversationState(env.DB, chatId);
      await updateTransaction(env.DB, txId, { status: 'received' });
      await sendTelegramMessage(env, chatId, '🔄 تم إلغاء أي عملية جارية. أرسل عمليتك الجديدة الآن.');
      return;
    }

    const pendingState = await getConversationState(env.DB, chatId, CONVERSATION_TTL_MINUTES);

    // ---- كلمة البحث (بعد ‎/search بلا كلمة) ----
    // رسالة بلا نص (صورة مثلاً) ليست كلمة بحث: يُلغى البحث وتمضي الرسالة عمليةً.
    if (pendingState && pendingState.kind === 'search_query' && !finalText) {
      await clearConversationState(env.DB, chatId);
    } else if (pendingState && pendingState.kind === 'search_query') {
      await clearConversationState(env.DB, chatId);
      await markControlReply(env, txId, 'search');
      await showSearchResults(env, chatId, finalText);
      return;
    }

    // ---- نصّ التعديل (بعد زر «تعديل» على عملية بعينها) ----
    // الهدف معروف من الزر، فلا يُسأل Claude أيّ العمليات المقصودة.
    if (pendingState && pendingState.kind === 'edit_target') {
      if (!finalText) {
        await markControlReply(env, txId, 'edit_without_text');
        await sendTelegramMessage(env, chatId, '✏️ أرسل التعديل نصّاً — مثل: <code>عدّل المبلغ إلى 600</code>.');
        return;
      }
      await clearConversationState(env.DB, chatId);
      const chosen = await getChatPostedTransaction(env.DB, chatId, pendingState.targetTxId);
      if (!chosen) {
        await updateTransaction(env.DB, txId, {
          status: 'failed',
          errorMessage: 'العملية المستهدفة لم تعد قائمة',
        });
        await sendTelegramMessage(env, chatId, '⚠️ العملية لم تعد قائمة — حُذفت أو عُدّلت. افتح /drafts.');
        return;
      }
      await performEdit(env, { txId, chatId, messageId, chosen, instruction: finalText });
      return;
    }

    // ---- تأكيد الحذف (رداً على سؤال التأكيد) ----
    if (pendingState && pendingState.kind === 'confirm_delete') {
      const answer = (finalText || '').trim();
      await clearConversationState(env.DB, chatId);

      if (!CONFIRM_WORDS.test(answer)) {
        await markControlReply(env, txId, 'cancel_delete');
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
        await markControlReply(env, txId, 'confirm_bulk_delete');
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
      await markControlReply(env, txId, 'confirm_delete');
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

      /* حالة «مكرّرة» مسجّلة في `naf-terms.md` وتعرضها الشارة، ولم تكن
         تُنتَج من أي مسار: صفّ العملية المتشابهة يبقى `awaiting_info` إلى
         الأبد فيُقرأ في اللوحة كحوارٍ معلّق لا ينتهي. وهو مكرّر في الحالين —
         رُحّل محتواه عبر صفّ الجواب أو لم يُرحَّل. */
      if (pendingState.originTxId) {
        await updateTransaction(env.DB, pendingState.originTxId, { status: 'duplicate' });
      }

      if (!CONFIRM_WORDS.test(answer)) {
        await markControlReply(env, txId, 'cancel_duplicate');
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
        mediaR2Keys: pendingState.mediaR2Keys || null,
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
        await markControlReply(env, txId, 'invalid_choice');
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
          const { count, items, partial } = await getWafeqDraftSummary(env);
          if (count === 0) {
            await markControlReply(env, txId, 'no_drafts');
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
              ((partial || []).length
                ? `⚠️ بلغ الجلب سقف الصفحات في: ${partial.join('، ')} — قد تبقى مسودات لم تُجلب.\n\n`
                : '') +
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
    const prior = await getConversationState(env.DB, chatId, CONVERSATION_TTL_MINUTES);
    let priorContext = null;
    if (prior) {
      priorContext = prior.accumulatedText || null;
      // صفحات ألبوم سابق تُستعاد كلها، لا الأولى وحدها.
      if (!media && prior.mediaR2Keys?.length > 1) {
        const buffers = [];
        for (const key of prior.mediaR2Keys) {
          const obj = await env.MEDIA.get(key);
          if (obj) buffers.push(await obj.arrayBuffer());
        }
        const restored = await prepareAlbumMedia(env, buffers).catch(() => []);
        if (restored.length) {
          media = restored;
          mediaR2Keys = prior.mediaR2Keys;
          mediaR2Key = prior.mediaR2Key || prior.mediaR2Keys[0];
          mediaType = prior.mediaType || null;
        }
      }
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
        mediaR2Keys: prior.mediaR2Keys || null,
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
    const base = baseCurrency(env);

    // ---- التحليل والتصنيف عبر Claude ----
    const analyzeOpts = {
      accounts,
      defaultBank,
      messageDateISO: dateISO,
      vatPercent,
      baseCurrency: base,
      text: finalText,
      media,
      priorContext,
      priorResult: prior?.previousResult || null,
    };
    const analyzeStarted = Date.now();
    let result = await analyzeTransaction(env, analyzeOpts);
    const analyzeMs = Date.now() - analyzeStarted;

    /* ---- مراجعة حسابية، وإعادة قراءة واحدة عند الخلل ----
       الإعادة تحمل القراءة السابقة وما اختلّ فيها تحديداً، فأغلب أخطاء
       القراءة — سعرٌ شامل قُرئ صافياً، رقمٌ سقطت منه منزلة — تُصحَّح هنا
       دون أن يُسأل المستخدم. وما بقي بعدها يُسأل عنه أدناه. */
    // «تأكيد» رداً على سؤال خلل الأرقام: يُرحَّل كما قُرئ، فلا داعي لإعادة القراءة.
    const acceptedAsRead = !!prior?.mismatchAsked && CONFIRM_WORDS.test((finalText || '').trim());
    let check = validateExtraction(result, { accounts, todayISO: dateISO });
    // والإعادة تضاعف زمن التحليل، والمعالجة محدودة الوقت بعد ردّ الويبهوك:
    // تحليلٌ أوّل بطيء يُسأل بعده المستخدم مباشرة بدل المخاطرة بقطعها.
    if (!check.ok && result.status === 'ready' && !acceptedAsRead && analyzeMs < 12000) {
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'extraction_check',
        status: 'info',
        errorDetails: `إعادة قراءة: ${check.issues.map((i) => i.code).join(',')}`,
      });
      result = await analyzeTransaction(env, {
        ...analyzeOpts,
        correction: { previous: result, prompt: correctionPrompt(check.issues) },
      });
      check = validateExtraction(result, { accounts, todayISO: dateISO });
    }
    const currencyState = settleCurrency(env, result);
    await updateTransaction(env.DB, txId, {
      processedJson: JSON.stringify(result),
      status: 'analyzed',
    });
    await writeLog(env.DB, { transactionId: txId, action: 'claude_analyze', status: 'success' });

    // ---- بيانات ناقصة؟ اسأل واحفظ السياق ----
    // سعر صرف مجهول بيانٌ ناقص كغيره: يُسأل عنه ولا يُخمَّن، فالسعر المخترع
    // يدخل الدفاتر رقماً خاطئاً لا يُكتشف إلا عند المطابقة.
    if (currencyState.reason === 'unsupported') {
      const msg = `وافق لا تدعم العملة ${iso(result.currency)}. أعد إرسال العملية بعملة مدعومة.`;
      await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: msg });
      await sendTelegramMessage(env, chatId, `⚠️ ${msg}`);
      return;
    }

    const needRate = currencyState.reason === 'no_rate';
    // فاتورة لم تُقرأ أصلاً لا تُرحَّل ولو عدّها النموذج جاهزة.
    const unreadable = !!media && result.readability === 'unreadable';
    // الصورة المضغوطة التي قُرئت ناقصة تُلحق بها نصيحة الإرسال كملف.
    const tip = attachment?.compressed && result.readability !== 'clear' ? SEND_AS_FILE_TIP : '';
    if (result.status === 'need_more' || needRate || unreadable) {
      const accumulated =
        (priorContext ? priorContext + '\n---\n' : '') + (finalText || mediaPlaceholder(media));
      await setConversationState(env.DB, chatId, {
        accumulatedText: accumulated,
        mediaR2Key,
        mediaR2Keys,
        mediaType,
        previousResult: unreadable ? null : result,
      });
      await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
      const question = needRate
        ? `كم سعر صرف ${currencyNameAr(result.currency)} (${iso(result.currency)}) مقابل ` +
          `${currencyNameAr(base)}؟ أرسل الرقم فقط — مثال: ${iso('3.75')}`
        : unreadable
          ? 'تعذّرت قراءة الفاتورة من المرفق. أعد إرسالها كاملةً في الإطار وبإضاءة أوضح، ' +
            'أو اكتب المبلغ واسم المورّد نصاً.'
          : result.question || 'أحتاج معلومات إضافية لإكمال العملية.';
      await sendTelegramMessage(
        env,
        chatId,
        `❓ ${question}${unreadable && attachment?.compressed ? SEND_AS_FILE_TIP : tip}`
      );
      return;
    }

    /* ---- قراءةٌ ما زالت مختلّة بعد الإعادة: يُسأل المستخدم ----
       بالسياق المتراكم نفسه، فجوابه («الإجمالي ١١٥٠ شامل الضريبة») يُقرأ مع
       الفاتورة في الجولة التالية. و«تأكيد» يرحّلها كما قُرئت: الفاتورة
       الورقية نفسها قد تكون غير متسقة، والقرار حينها لصاحبها لا للآلة. */
    if (!check.ok && !acceptedAsRead) {
      const accumulated =
        (priorContext ? priorContext + '\n---\n' : '') + (finalText || mediaPlaceholder(media));
      await setConversationState(env.DB, chatId, {
        accumulatedText: accumulated,
        mediaR2Key,
        mediaR2Keys,
        mediaType,
        mismatchAsked: true,
        previousResult: result,
      });
      await updateTransaction(env.DB, txId, { status: 'awaiting_info' });
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'extraction_check',
        status: 'error',
        errorDetails: check.issues.map((i) => i.message).join(' | '),
      });
      await sendTelegramMessage(
        env,
        chatId,
        `⚠️ <b>أرقام الفاتورة لا تتطابق</b>\n\n` +
          check.issues.map((i) => `• ${i.message}`).join('\n') +
          `\n\nأرسل التصحيح (مثل: <code>الإجمالي 1150 شامل الضريبة</code>)، ` +
          `أو اكتب «تأكيد» للترحيل كما قُرئت، أو «جديد» للإلغاء.` +
          tip
      );
      return;
    }
    if (acceptedAsRead) {
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'extraction_check',
        status: 'info',
        errorDetails: `رُحّلت كما قُرئت بتأكيد المستخدم: ${check.issues.map((i) => i.code).join(',')}`,
      });
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
          mediaR2Keys,
          mediaType,
          previousResult: result,
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
          mediaR2Keys,
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
      currency: result.currency,
      contactName: result.contact_name || '',
      date: result.date,
    });
    if (dup) {
      await setConversationState(env.DB, chatId, {
        kind: 'confirm_duplicate',
        analyzed: result,
        contactId,
        mediaR2Key,
        mediaR2Keys,
        mediaType,
        // صفّ العملية التي أُثير عليها التشابه — كان يبقى `awaiting_info`
        // إلى الأبد مهما كان الجواب.
        originTxId: txId,
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
    // ما لا يمنع الترحيل ويستحق المراجعة (رقم ضريبي بصيغة غريبة) يتقدّم التأكيد.
    const notes = check.warnings.map((w) => `ℹ️ ${w.message}`).join('\n');
    await finalizeAndPost(env, {
      txId,
      chatId,
      result,
      accounts,
      messageId,
      contactId,
      mediaR2Key,
      mediaR2Keys,
      mediaType,
      prefix: notes ? `${notes}\n\n` : '',
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
    await notifyFailure(
      env,
      chatId,
      `❌ <b>تعذّرت معالجة العملية</b>\n\nالسبب: ${msg}\n\nأعد المحاولة، أو تواصل مع الدعم إن تكرّر.`,
      txId
    );
  }
}

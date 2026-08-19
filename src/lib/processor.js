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
import { sendTelegramMessage, downloadTelegramFile, esc } from '../services/telegram.js';
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
  deleteDocument,
  getWafeqDraftSummary,
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

// مهلة سياق المحادثة — رقم واحد لكل القراءات.
// كانت ٦٠ في فحص حالات التأكيد و٣٠ في استرجاع السياق المتراكم، والقراءة
// الثانية تحذف المنتهي: فبين الدقيقة ٣٠ و٦٠ يُرى الحوار قائماً ثم يُمحى
// سياقه، فتُحلَّل إجابة المستخدم كعملية جديدة بلا أي إشعار.
const CONVERSATION_TTL_MINUTES = 60;

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

/**
 * تحديد العملية المستهدفة من وصف الاستهداف.
 * @returns {Promise<{ok:true, target:object} | {ok:false, reason:string, options?:Array}>}
 */
async function resolveTarget(env, chatId, spec) {
  const mode = spec?.mode || 'last';

  if (mode === 'id' && spec.id) {
    const t = await getPostedTransactionByWafeqId(env.DB, chatId, spec.id);
    return t ? { ok: true, target: t } : { ok: false, reason: `لم أجد عملية بالمعرّف «${esc(spec.id)}».` };
  }

  if (mode === 'search' && spec.query) {
    const found = await searchPostedTransactions(env.DB, chatId, spec.query, 5);
    if (found.length === 0) return { ok: false, reason: `لم أجد عملية تطابق «${esc(spec.query)}».` };
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
 * وتظهر في جدول العمليات صفّاً مُرحّلاً بلا مستند في وافق. الصفّ يبقى
 * (يمنع إعادة الويبهوك معالجتها مرتين) لكن بحالته الصادقة: مستلمة.
 */
async function markControlReply(env, txId, action) {
  await updateTransaction(env.DB, txId, { status: 'received' });
  await writeLog(env.DB, { transactionId: txId, action: `control_${action}`, status: 'info' });
}

/** سطر وصفي موجز لعملية. */
function targetLabel(t) {
  return `${describeType(t.result.type)} — ${esc(t.result.summary)}${
    t.result.contact_name ? ` (${esc(t.result.contact_name)})` : ''
  }\n🧾 ${esc(t.wafeqId)}`;
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

/** وصف عربي لنوع العملية. */
function describeType(type) {
  return type === 'manual_journal'
    ? 'قيد يومية'
    : type === 'purchase_bill'
      ? 'فاتورة مشتريات'
      : type === 'sales_invoice'
        ? 'فاتورة بيع'
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
//
// قاعدتان في هذه الكتلة:
//   ١. كل قيمة متغيّرة تمرّ على esc() — النصّ يُرسل بـ parse_mode=HTML.
//   ٢. الضريبة المعروضة هي **المطبَّقة فعلاً** في وافق لا التي اقترحها Claude.
//      كانت الرسالة تعلن «ضريبة ١٥٪» دائماً بينما الترحيل لا يطبّقها إلا مع
//      VAT_TAX_RATE_ID مضبوطاً — فيقرأ المستخدم غير ما دخل الدفتر.
// ---------------------------------------------------------------------------

/** سطر الضريبة الصادق: المطبَّق فعلاً، مع تنبيه صريح عند سقوطها. */
function vatLines(sub, requestedVat, appliedVat) {
  if (appliedVat > 0) {
    const vat = +((sub * appliedVat) / 100).toFixed(2);
    return (
      `💰 قبل الضريبة: ${sub}\n➕ ضريبة ${appliedVat}%: ${vat}\n` +
      `💵 الإجمالي: ${(sub + vat).toFixed(2)}\n`
    );
  }
  if (requestedVat > 0) {
    // الضريبة مطلوبة ولم تُطبَّق — لا تُخفِ ذلك خلف إجمالي صحيح ظاهرياً.
    return (
      `💰 الإجمالي: ${sub} (بدون ضريبة)\n` +
      `⚠️ لم تُطبَّق ضريبة ${requestedVat}%: معرّف الضريبة VAT_TAX_RATE_ID غير مضبوط. ` +
      `أضِفه في إعدادات Cloudflare ثم عدّل المستند في وافق.\n`
    );
  }
  return `💰 الإجمالي: ${sub} (بدون ضريبة)\n`;
}

function confirmManualJournal(result, wafeqId) {
  const entries = result.manual_journal?.entries || [];
  const lines = entries
    .map((e) => {
      const side = Number(e.debit) > 0 ? `مدين ${esc(e.debit)}` : `دائن ${esc(e.credit)}`;
      return `• ${esc(e.account_name)} — ${side}`;
    })
    .join('\n');
  const total = entries.reduce((s, e) => s + Number(e.debit || 0), 0);
  return (
    `✅ <b>تم إنشاء قيد يومية في وافق</b>\n\n` +
    `📅 التاريخ: ${esc(result.date)}\n${lines}\n\n` +
    `💰 الإجمالي: ${total}\n🧾 المرجع: ${esc(wafeqId) || 'غير متوفر'}\n\n` +
    `ℹ️ ملاحظة: القيود اليدوية تُرحّل مباشرة في وافق (لا تدعم المسودة عبر الـ API).`
  );
}

function confirmBill(result, wafeqId, appliedVat = 0) {
  const items = result.bill?.line_items || [];
  const lines = items.map((li) => `• ${esc(li.account_name)} — ${esc(li.amount)}`).join('\n');
  const sub = items.reduce((s, li) => s + Number(li.amount || 0), 0);
  return (
    `✅ <b>تم إنشاء فاتورة مشتريات (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${esc(result.date)}\n🏢 المورّد: ${esc(result.contact_name) || 'غير محدّد'}\n${lines}\n\n` +
    vatLines(sub, Number(result.bill?.vat_percent ?? 0), appliedVat) +
    `🧾 رقم المسودة: ${esc(wafeqId) || 'غير متوفر'}\n\n` +
    `⚠️ فاتورة <b>مسودة</b> تتطلب مراجعتك واعتمادك في وافق.`
  );
}

function confirmInvoice(result, wafeqId, appliedVat = 0) {
  const items = result.invoice?.line_items || [];
  const sub = items.reduce((s, li) => s + Number(li.amount || 0), 0);
  const lines = items.map((li) => `• ${esc(li.account_name)} — ${esc(li.amount)}`).join('\n');
  return (
    `✅ <b>تم إنشاء فاتورة بيع (مسودة) في وافق</b>\n\n` +
    `📅 التاريخ: ${esc(result.date)}\n👤 العميل: ${esc(result.contact_name) || 'غير محدّد'}\n${lines}\n\n` +
    vatLines(sub, Number(result.invoice?.vat_percent ?? 15), appliedVat) +
    `🧾 رقم المسودة: ${esc(wafeqId) || 'غير متوفر'}\n\n` +
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
    // ضريبة المشتريات (Input VAT) — تُطبّق إن كانت النسبة > 0 ومعرّف الضريبة مضبوط.
    const billVat = Number(result.bill?.vat_percent ?? 0);
    const billTaxRate = billVat > 0 ? env.VAT_TAX_RATE_ID || null : null;
    const lineItems = (result.bill?.line_items || []).map((li) => ({
      account: idMap[li.account_code] || li.account_code,
      description: li.description,
      amount: li.amount,
      taxRateId: billTaxRate,
    }));
    const { id } = await createBillDraft(env, {
      contactId,
      date: result.date,
      lineItems,
      attachmentIds,
    });
    // ما يُعرض للمستخدم = ما طُبّق فعلاً: لا معرّف ضريبة ⇐ لا ضريبة.
    return { wafeqId: id, confirm: confirmBill(result, id, billTaxRate ? billVat : 0) };
  }

  if (result.type === 'sales_invoice') {
    const invoiceVat = Number(result.invoice?.vat_percent ?? 15);
    const invoiceTaxRate = invoiceVat > 0 ? env.VAT_TAX_RATE_ID || null : null;
    const lineItems = (result.invoice?.line_items || []).map((li) => ({
      account: idMap[li.account_code] || li.account_code,
      description: li.description,
      amount: li.amount,
    }));
    const { id } = await createInvoiceDraft(env, {
      contactId,
      date: result.date,
      lineItems,
      taxRateId: invoiceTaxRate,
      attachmentIds,
    });
    return { wafeqId: id, confirm: confirmInvoice(result, id, invoiceTaxRate ? invoiceVat : 0) };
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
  const { txId, chatId, result, accounts, messageId, contactId, mediaR2Key, mediaType, prefix } = ctx;

  let attachmentIds = [];
  // فشل الرفع لا يُفشل الترحيل، لكنه لا يمرّ صامتاً: المستخدم أرسل صورة
  // فاتورة وسيظنّها مرفقة. نقولها في رسالة التأكيد نفسها.
  let attachmentError = null;
  if (mediaR2Key && (result.type === 'purchase_bill' || result.type === 'sales_invoice')) {
    try {
      const obj = await env.MEDIA.get(mediaR2Key);
      if (obj) {
        const buf = await obj.arrayBuffer();
        const fname = mediaR2Key.split('/').pop() || 'attachment.jpg';
        const attId = await uploadAttachment(env, buf, fname, mediaType || 'image/jpeg');
        if (attId) attachmentIds.push(attId);
        else attachmentError = 'لم يُرجع وافق معرّفاً للمرفق';
      } else {
        attachmentError = 'تعذّر قراءة الملف من التخزين';
      }
    } catch (e) {
      attachmentError = e.message;
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

  const attachmentNote = attachmentError
    ? `\n\n⚠️ الصورة لم تُرفق بالمستند في وافق (${esc(attachmentError)}). المستند أُنشئ، والصورة محفوظة في اللوحة — أرفقها يدوياً إن لزم.`
    : '';

  await sendTelegramMessage(env, chatId, (prefix || '') + confirm + attachmentNote);
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
      `⚠️ تعذّر حذف العملية القديمة من وافق (${esc(e.message)}).\nلن أنشئ نسخة جديدة لتجنّب التكرار — عدّلها يدوياً في وافق.`
    );
    return;
  }

  await updateTransaction(env.DB, txId, {
    processedJson: JSON.stringify(edited),
    status: 'analyzed',
  });
  await writeLog(env.DB, { transactionId: txId, action: 'apply_edit', status: 'success' });

  // القديم حُذف بالفعل. فإن فشل إنشاء البديل فالمستند ضاع من وافق — والصمت
  // هنا يترك المستخدم يظنّ عمليته قائمة. نقولها صراحةً بنصّ العملية كاملاً
  // ليعيد إرسالها.
  try {
    await postEdited(env, { txId, chatId, edited, accounts, messageId, contactId });
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
        `السبب: ${esc(msg)}\n\n` +
        `لم يبقَ للعملية مستند في وافق. أعد إرسالها كعملية جديدة:\n` +
        `<code>${esc(edited.summary || '')}</code>`
    );
  }
}

/** ترحيل النسخة المعدّلة — مفصولة ليُمسَك فشلها بعد حذف القديمة. */
async function postEdited(env, { txId, chatId, edited, accounts, messageId, contactId }) {
  await finalizeAndPost(env, {
    txId,
    chatId,
    result: edited,
    accounts,
    messageId,
    contactId,
    mediaR2Key: null,
    mediaType: null,
    prefix: '✏️ <b>تم تعديل العملية</b> (حُذفت النسخة السابقة وأُنشئت محدّثة)\n\n',
  });
}

/** نص المساعدة (يظهر عند /help أو /start أو «مساعدة»). */
const HELP_TEXT = `🤖 <b>المحاسب الذكي — ناف القانونية</b>

<b>١) تسجيل عملية</b> — أرسل نصاً أو تسجيلاً صوتياً أو صورة فاتورة:
• <code>دفعت ٥٠٠ ريال إيجار المكتب</code>
• <code>شريت أدوات بـ٣٠٠ من جرير</code>
• <code>استلمت اشتراك ٥٧٥٠ من شركة الأفق</code>

<b>التوجيه التلقائي:</b>
• رواتب/تحويلات صادرة ← قيد يومية
• سداد/مشتريات ← فاتورة مشتريات (مسودة)
• وارد من عميل ← فاتورة بيع + ضريبة ١٥٪ (مسودة)

<b>٢) تعديل عملية</b> — أرسل التعديل مباشرة:
• <code>عدّل المبلغ إلى ٦٠٠</code>
• <code>خلّه بدون ضريبة</code>
• <code>غيّر المورّد إلى جرير</code>
• <code>عدّل المسودة قبل الأخيرة المبلغ ٩٠٠</code>

<b>٣) حذف عملية</b> (يطلب كتابة «تأكيد»):
• <code>احذف القيد</code>
• <code>احذف فاتورة جرير</code>
• <code>احذف المسودة mjou_xxx</code>
• <code>احذف جميع المسودات في وافق</code>

<b>٤) أوامر أخرى</b>
• <code>جديد</code> — إلغاء أي عملية جارية والبدء من نظيف
• <code>/help</code> — هذه الرسالة

<b>ملاحظات</b>
• إن لم تذكر حساب الدفع فالافتراضي <b>الحساب البنكي</b> (اذكر «نقداً» أو «الخزينة» أو «النثرية» للتغيير).
• التواريخ النسبية مفهومة: «أمس»، «الثلاثاء الماضي».
• إن نقص بيان جوهري (المبلغ أو المورّد/العميل) سأسألك عنه.`;

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

  // ---- رسالة معدَّلة ----
  // تحمل معرّف الرسالة الأصلية، فكان فحص التكرار أدناه يبتلعها بصمت: المسار
  // مكتوب ولا يعمل أبداً. والتعديل بعد الترحيل يحتاج تعديل مستند وافق نفسه،
  // وله مسار مخصّص («عدّل المبلغ إلى ٦٠٠»). فنقولها صراحةً بدل الصمت.
  if (update.edited_message) {
    await writeLog(env.DB, {
      action: 'telegram_edited_message',
      status: 'info',
      errorDetails: `chat=${chatId} msg=${messageId}`,
    });
    await sendTelegramMessage(
      env,
      chatId,
      'ℹ️ تعديل رسالة سابقة لا يُعالَج. لتصحيح عملية مُرحّلة أرسل التعديل رسالةً جديدة — مثل: ' +
        '<code>عدّل المبلغ إلى 600</code>.'
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

    // ---- كلمة إعادة/إلغاء تمسح أي سياق عالق وتبدأ من جديد ----
    const RESET_WORDS = ['إلغاء', 'الغاء', 'جديد', 'ابدأ من جديد', 'ابدا من جديد', 'إلغاء العملية', 'reset', 'cancel'];
    if (finalText && RESET_WORDS.includes(finalText.trim())) {
      await clearConversationState(env.DB, chatId);
      await updateTransaction(env.DB, txId, { status: 'received' });
      await sendTelegramMessage(env, chatId, '🔄 تم إلغاء أي عملية جارية. أرسل عمليتك الجديدة الآن.');
      return;
    }

    // ---- تأكيد الحذف (رداً على سؤال التأكيد) ----
    const pendingState = await getConversationState(env.DB, chatId, CONVERSATION_TTL_MINUTES);
    if (pendingState && pendingState.kind === 'confirm_delete') {
      const answer = (finalText || '').trim();
      await clearConversationState(env.DB, chatId);

      if (!/^(تأكيد|تاكيد|نعم|أجل|اجل|تم|أكيد|اكيد|yes|y)$/i.test(answer)) {
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
               WHERE wafeq_draft_id = ? AND telegram_chat_id = ?`
            )
              .bind(d.id, String(chatId))
              .run();
            done++;
          } catch (e) {
            failed.push(`${esc(d.id)}: ${esc(e.message)}`);
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
      if (!/^(تأكيد|تاكيد|نعم|أجل|اجل|تم|أكيد|اكيد|yes|y)$/i.test(answer)) {
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
    if (finalText && !image && !pendingState) {
      const recent = await listPostedTransactions(env.DB, chatId, 10);
      if (recent.length > 0) {
        const { intent, instruction, target } = await classifyFollowUp(env, finalText, recent);

        // ============ حذف جماعي: كل المسودات في وافق ============
        if (intent === 'delete' && target.mode === 'all_drafts') {
          const { count, items, partial } = await getWafeqDraftSummary(env);
          if (count === 0) {
            await markControlReply(env, txId, 'no_drafts');
            await sendTelegramMessage(env, chatId, 'ℹ️ لا توجد مسودات في وافق للحذف.');
            return;
          }
          const preview = items
            .slice(0, 10)
            .map((d) => `• ${esc(d.type)} ${esc(d.number || d.id)}`)
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
                ? `⚠️ بلغ الجلب سقف الصفحات في: ${esc(partial.join('، '))} — قد تبقى مسودات لم تُجلب.\n\n`
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
              .map((t, i) => `${i + 1}) ${describeType(t.result.type)} — ${esc(t.result.summary)} — ${esc(t.wafeqId)}`)
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
            await sendTelegramMessage(env, chatId, `⚠️ ${res.reason}`); // reason مُهرَّب في المصدر
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
      // إن كان هناك مرفق سابق ولم تُرسل صورة جديدة، أعِد تحميله من R2 مع التحقق من صلاحيته.
      if (!image && prior.mediaR2Key) {
        const obj = await env.MEDIA.get(prior.mediaR2Key);
        if (obj) {
          const buf = await obj.arrayBuffer();
          const t = detectImageType(buf);
          // نتجاهل الصورة المخزّنة إن كانت غير مدعومة/تالفة ونكمل بالنص فقط.
          if (t && buf.byteLength <= MAX_IMAGE_BYTES) {
            image = { mediaType: t, base64: arrayBufferToBase64(buf) };
            mediaR2Key = prior.mediaR2Key;
            mediaType = t;
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
        `❓ ${esc(result.question) || 'أحتاج معلومات إضافية لإكمال العملية.'}`
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
          (priorContext ? priorContext + '\n---\n' : '') + (finalText || '(صورة مرفقة)');
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
        const optionsText = r.candidates.map((c, i) => `${i + 1}) ${esc(c.name)}`).join('\n');
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
          `❓ وجدت أكثر من جهة اتصال تشبه «${esc(result.contact_name)}». أيّها تقصد؟\n\n${optionsText}\n\n` +
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
          `يوجد ${describeType(result.type)} بنفس المبلغ${result.contact_name ? ` ولنفس «${esc(result.contact_name)}»` : ''} اليوم:\n` +
          `• ${esc(dup.summary)}\n🧾 ${esc(dup.wafeqId)}\n\n` +
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
        `❌ <b>تعذّرت معالجة العملية</b>\n\nالسبب: ${esc(msg)}\n\nأعد المحاولة، أو تواصل مع الدعم إن تكرّر.`
      );
    } catch (_) {
      /* تجاهل فشل إرسال رسالة الخطأ */
    }
  }
}

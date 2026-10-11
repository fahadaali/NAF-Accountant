// ============================================================================
// المسودات من تليجرام — القائمة والبطاقة والأزرار
// ============================================================================
//
// كان الوصول إلى عملية سابقة يمرّ بجملة يفهمها Claude («احذف فاتورة جرير»)
// فيخمّن أيّها المقصودة. وهنا يُشار إليها بالزر: قائمةٌ بالمسودات، وبطاقةٌ
// لكل واحدة، وأفعالٌ عليها — بلا تخمين.
//
// ═══ صيغة callback_data (حدّ تليجرام ٦٤ بايتاً) ═══
//
//   d:l:<offset>   قائمة المسودات        d:j:<offset>   قائمة القيود المرحّلة
//   d:v:<txId>     بطاقة عملية            d:f:<txId>     إرسال مرفقها
//   d:e:<txId>     تعديل (يطلب نصّه)      d:x:<txId>     طلب الحذف
//   d:xy:<txId>    تأكيد الحذف
//
// ═══ الحالة في وافق ═══
//
// المسودة تُعتمد أو تُحذف داخل وافق دون أن يعلم البوت. فتُقرأ حالتها من
// وافق عند كل عرض، ولا يُعرض تعديلٌ أو حذفٌ لفاتورةٍ اعتُمدت: التعديل هنا
// حذفٌ وإعادة إنشاء، ولا يصحّ على مستندٍ دخل الدفتر.
//
// كل عملية تُقرأ محصورةً بالمحادثة التي ضُغط فيها الزر (`getChatPostedTransaction`)،
// فلا يبلغ زرٌّ عمليةَ محادثة أخرى ولو عُدّلت بياناته.
// ============================================================================

import {
  writeLog,
  updateTransaction,
  setConversationState,
  listChatDocuments,
  getChatPostedTransaction,
  searchPostedTransactions,
  getAlbumKeys,
  saveWafeqStatus,
} from './db.js';
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerCallbackQuery,
  sendTelegramDocument,
} from '../services/telegram.js';
import { deleteDocument, getDocumentStatus } from '../services/wafeq.js';
import { formatMoney } from './currency.js';
import { describeType } from './labels.js';

/* عزل اتجاهي للقيم داخل الجمل العربية — U+2068 و U+2069.
   نفس تعريف `isolate` في naf-format بالسجلّ؛ يُكرَّر هنا لأن الخادم
   لا يستورد من frontend/src/naf. أي تغيير يحدث في السجلّ أولاً. */
const iso = (v) => `⁨${v}⁩`;

const PAGE_SIZE = 5;

const LIST_TITLES = {
  drafts: 'مسوداتي في وافق',
  journals: 'القيود المرحّلة',
};

const LIST_EMPTY = {
  drafts: 'لا مسودات بعد. أرسل صورة فاتورة أو اكتب العملية لتُسجَّل مسودةً في وافق.',
  journals: 'لا قيود مرحّلة بعد. أرسل عملية صرف أو تحويل لتُسجَّل قيداً في وافق.',
};

// ---------------------------------------------------------------------------
// الحالة في وافق
// ---------------------------------------------------------------------------

const APPROVED_STATUSES = new Set(['AUTHORIZED', 'APPROVED', 'POSTED', 'SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE']);
const VOID_STATUSES = new Set(['VOID', 'VOIDED', 'CANCELLED', 'CANCELED']);

/** وصف حالة المستند في وافق للقارئ. */
function statusLabel(t, status) {
  if (!status) return 'تعذّرت قراءتها الآن';
  if (status === 'DELETED') return 'محذوفة من وافق';
  // القيد اليدوي لا مسودة له في وافق — يُرحَّل مباشرة.
  if (t.result.type === 'manual_journal') return 'مُرحّلة';
  if (status === 'DRAFT') return 'مسودة';
  if (APPROVED_STATUSES.has(status)) return 'معتمدة';
  if (VOID_STATUSES.has(status)) return 'ملغاة';
  return iso(status);
}

/**
 * هل يُعدَّل المستند أو يُحذف من هنا؟
 * الفاتورة ما دامت مسودة، أو ما لم تُعرف حالتها (تعذّر القراءة لا يحجب ما
 * كان متاحاً قبل الأزرار). والقيد اليدوي كما كان دائماً.
 */
function isEditable(t, status) {
  if (status === 'DELETED') return false;
  if (t.result.type === 'manual_journal') return true;
  return !status || status === 'DRAFT';
}

/**
 * قراءة حالة المستند من وافق الآن، وحفظها.
 * مستندٌ حُذف داخل وافق تُوسم عمليته محذوفة هنا أيضاً، فتخرج من القوائم.
 */
async function syncStatus(env, t) {
  const status = await getDocumentStatus(env, t.result.type, t.wafeqId);
  if (!status) return null;
  // الحفظ تحسينٌ لا شرط: قبل تطبيق ترحيل الجدول يفشل، والعرض يمضي.
  await saveWafeqStatus(env.DB, t.wafeqId, t.result.type, status).catch(() => {});
  if (status === 'DELETED') {
    await updateTransaction(env.DB, t.id, { status: 'deleted' });
    await writeLog(env.DB, {
      transactionId: t.id,
      action: 'wafeq_status_sync',
      status: 'info',
      errorDetails: `المستند ${t.wafeqId} لم يعد في وافق`,
    });
  }
  return status;
}

// ---------------------------------------------------------------------------
// قراءة العملية
// ---------------------------------------------------------------------------

/** بنود العملية وإجماليها قبل الضريبة ونسبة ضريبتها. */
function documentFigures(result) {
  const cur = result.currency || 'SAR';
  if (result.type === 'manual_journal') {
    const entries = result.manual_journal?.entries || [];
    return {
      cur,
      rate: 0,
      sub: entries.reduce((s, e) => s + Number(e.debit || 0), 0),
      lines: entries.map((e) =>
        Number(e.debit) > 0
          ? `• ${e.account_name} — مدين ${formatMoney(e.debit, cur)}`
          : `• ${e.account_name} — دائن ${formatMoney(e.credit, cur)}`
      ),
    };
  }
  const doc = result.type === 'purchase_bill' ? result.bill : result.invoice;
  const items = doc?.line_items || [];
  return {
    cur,
    rate: Number(doc?.vat_percent ?? 0),
    sub: items.reduce((s, li) => s + Number(li.amount || 0), 0),
    lines: items.map((li) => `• ${li.account_name} — ${formatMoney(li.amount, cur)}`),
  };
}

/** سطرٌ موجز يصلح نصّاً لزر في القائمة. */
function shortLabel(t) {
  const r = t.result;
  const who = r.contact_name || r.summary || describeType(r.type);
  const { sub, cur } = documentFigures(r);
  return `${who} · ${formatMoney(sub, cur)} · ${r.date || ''}`.slice(0, 60);
}

/** نصّ بطاقة عملية، بحالتها في وافق إن قُرئت. */
export function documentCardText(t, status = undefined) {
  const r = t.result;
  const { cur, rate, sub, lines } = documentFigures(r);
  const contactLabel = r.type === 'sales_invoice' ? '👤 العميل' : '🏢 المورّد';
  const out = [`<b>${describeType(r.type)}</b>`, ''];
  if (r.summary) out.push(r.summary);
  out.push(`📅 التاريخ: ${iso(r.date || '—')}`);
  if (r.type !== 'manual_journal') out.push(`${contactLabel}: ${r.contact_name ? iso(r.contact_name) : 'غير محدّد'}`);
  if (r.invoice_number) out.push(`🔢 رقم الفاتورة: ${iso(r.invoice_number)}`);
  out.push('', ...lines, '');
  if (r.type === 'manual_journal') {
    out.push(`💰 الإجمالي: ${formatMoney(sub, cur)}`);
  } else {
    out.push(`💰 قبل الضريبة: ${formatMoney(sub, cur)}`);
    out.push(rate > 0 ? `➕ الضريبة: ${iso(rate + '%')}` : 'بدون ضريبة');
  }
  out.push(`🧾 المرجع في وافق: ${iso(t.wafeqId)}`);
  if (status !== undefined) {
    out.push(`📌 الحالة في وافق: ${statusLabel(t, status)}`);
    if (!isEditable(t, status) && status !== 'DELETED') {
      out.push('', 'اعتُمدت في وافق، فتعديلها أو حذفها من وافق نفسه.');
    }
  }
  return out.join('\n');
}

/** أزرار بطاقة العملية — التعديل والحذف لما يزال قابلاً لهما. */
export function documentCardKeyboard(t, { backOffset = 0, status = null } = {}) {
  const back = t.result.type === 'manual_journal' ? `d:j:${backOffset}` : `d:l:${backOffset}`;
  const rows = [];
  if (isEditable(t, status)) {
    rows.push([
      { text: 'تعديل', callback_data: `d:e:${t.id}` },
      { text: 'حذف', callback_data: `d:x:${t.id}` },
    ]);
  }
  if (t.mediaR2Key) rows.push([{ text: 'عرض المرفق', callback_data: `d:f:${t.id}` }]);
  rows.push([{ text: 'رجوع إلى القائمة', callback_data: back }]);
  return { inline_keyboard: rows };
}

/** أزرار تُرفق برسالة تأكيد الترحيل — الوصول إلى العملية بلا بحث. */
export function postedKeyboard(txId) {
  return {
    inline_keyboard: [
      [
        { text: 'تعديل', callback_data: `d:e:${txId}` },
        { text: 'حذف', callback_data: `d:x:${txId}` },
        { text: 'عرض', callback_data: `d:v:${txId}` },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// القوائم
// ---------------------------------------------------------------------------

/** يرسل رسالة جديدة، أو يعدّل رسالة الزر في مكانها إن عُرفت. */
function show(env, chatId, messageId, text, replyMarkup) {
  return messageId
    ? editTelegramMessage(env, chatId, messageId, text, { replyMarkup })
    : sendTelegramMessage(env, chatId, text, { replyMarkup });
}

/**
 * صفحة من المسودات أو القيود، بزرٍّ لكل عملية وأزرار تنقّل.
 * @param {'drafts'|'journals'} kind
 */
export async function showDocumentList(env, chatId, kind, offset = 0, messageId = null) {
  const start = Math.max(0, Number(offset) || 0);
  const { items, total } = await listChatDocuments(env.DB, chatId, kind, {
    offset: start,
    limit: PAGE_SIZE,
  });
  const other = kind === 'drafts' ? 'journals' : 'drafts';
  const switchRow = [
    { text: other === 'journals' ? 'القيود المرحّلة' : 'المسودات', callback_data: `d:${other === 'journals' ? 'j' : 'l'}:0` },
  ];

  if (!items.length) {
    return show(env, chatId, messageId, `<b>${LIST_TITLES[kind]}</b>\n\n${LIST_EMPTY[kind]}`, {
      inline_keyboard: [switchRow],
    });
  }

  const code = kind === 'drafts' ? 'l' : 'j';
  // حالة كل مسودة في الصفحة من وافق الآن — خمسة طلبات متوازية على الأكثر.
  const statuses = kind === 'drafts' ? await Promise.all(items.map((t) => syncStatus(env, t))) : [];
  const rows = items.map((t, i) => {
    const mark = statuses[i] ? ` · ${statusLabel(t, statuses[i])}` : '';
    return [{ text: `${shortLabel(t)}${mark}`.slice(0, 64), callback_data: `d:v:${t.id}` }];
  });
  const nav = [];
  if (start > 0) nav.push({ text: 'السابق', callback_data: `d:${code}:${Math.max(0, start - PAGE_SIZE)}` });
  if (start + PAGE_SIZE < total) nav.push({ text: 'التالي', callback_data: `d:${code}:${start + PAGE_SIZE}` });
  if (nav.length) rows.push(nav);
  rows.push(switchRow);

  const range = `${start + 1}–${start + items.length}`;
  return show(
    env,
    chatId,
    messageId,
    `<b>${LIST_TITLES[kind]}</b> — ${iso(range)} من ${iso(total)}\n\nاختر عملية لعرضها وتعديلها:`,
    { inline_keyboard: rows }
  );
}

/** نتائج البحث بزرٍّ لكل عملية. */
export async function showSearchResults(env, chatId, query) {
  const q = String(query || '').trim();
  const found = await searchPostedTransactions(env.DB, chatId, q, 8);
  if (!found.length) {
    return sendTelegramMessage(
      env,
      chatId,
      `لم أجد عملية مُرحّلة تطابق «${q}». جرّب اسم المورّد أو جزءاً من الوصف، أو تصفّح /drafts.`
    );
  }
  return sendTelegramMessage(env, chatId, `🔎 نتائج «${q}» — ${iso(found.length)}:`, {
    replyMarkup: {
      inline_keyboard: found.map((t) => [{ text: `${describeType(t.result.type)} · ${shortLabel(t)}`.slice(0, 64), callback_data: `d:v:${t.id}` }]),
    },
  });
}

// ---------------------------------------------------------------------------
// الأزرار
// ---------------------------------------------------------------------------

/** إرسال مرفقات العملية كما حُفظت. */
async function sendAttachments(env, chatId, t) {
  const album = await getAlbumKeys(env.DB, t.id);
  const keys = (album.length ? album : [t.mediaR2Key]).filter(Boolean).slice(0, 10);
  let sent = 0;
  for (const key of keys) {
    const obj = await env.MEDIA.get(key);
    if (!obj) continue;
    await sendTelegramDocument(
      env,
      chatId,
      await obj.arrayBuffer(),
      key.split('/').pop() || 'attachment',
      obj.httpMetadata?.contentType,
      keys.length > 1 ? `${sent + 1}/${keys.length}` : ''
    );
    sent++;
  }
  return sent;
}

/**
 * معالجة ضغطة زر.
 *
 * كل ضغطة تُجاب بـ`answerCallbackQuery` — وإلا بقي مؤشّر الانتظار يدور على
 * الزر — حتى حين تفشل: الفشل يصل المستخدمَ رسالةً، ويُسجَّل.
 */
export async function handleCallbackQuery(env, cq) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const [scope, action, arg] = String(cq.data || '').split(':');

  if (scope !== 'd' || !chatId) {
    await answerCallbackQuery(env, cq.id);
    return;
  }

  try {
    // ---- القوائم ----
    if (action === 'l' || action === 'j') {
      await answerCallbackQuery(env, cq.id);
      await showDocumentList(env, chatId, action === 'l' ? 'drafts' : 'journals', Number(arg) || 0, messageId);
      return;
    }

    const t = await getChatPostedTransaction(env.DB, chatId, arg);
    if (!t) {
      // حُذفت أو عُدّلت (التعديل ينشئ عمليةً بديلة) منذ ظهر الزر.
      await answerCallbackQuery(env, cq.id, 'هذه العملية لم تعد قائمة — حُذفت أو عُدّلت.');
      return;
    }

    // ---- البطاقة ----
    if (action === 'v') {
      await answerCallbackQuery(env, cq.id);
      const status = await syncStatus(env, t);
      await show(env, chatId, messageId, documentCardText(t, status), documentCardKeyboard(t, { status }));
      return;
    }

    // ---- ما يغيّر المستند يُفحص على حالته الآن لا على حالته يوم ظهر الزر ----
    if (action === 'e' || action === 'x' || action === 'xy') {
      const status = await syncStatus(env, t);
      if (!isEditable(t, status)) {
        await answerCallbackQuery(env, cq.id, `الفاتورة ${statusLabel(t, status)} — لا تُعدَّل من هنا.`);
        await show(env, chatId, messageId, documentCardText(t, status), documentCardKeyboard(t, { status }));
        return;
      }
    }

    // ---- المرفق ----
    if (action === 'f') {
      await answerCallbackQuery(env, cq.id);
      const sent = await sendAttachments(env, chatId, t);
      if (!sent) await sendTelegramMessage(env, chatId, 'المرفق غير موجود في التخزين.');
      return;
    }

    // ---- التعديل: الرسالة التالية هي نصّه ----
    if (action === 'e') {
      await answerCallbackQuery(env, cq.id);
      await setConversationState(env.DB, chatId, { kind: 'edit_target', targetTxId: t.id });
      await sendTelegramMessage(
        env,
        chatId,
        `✏️ <b>تعديل ${describeType(t.result.type)}</b>\n${shortLabel(t)}\n\n` +
          `أرسل التعديل المطلوب — مثل: <code>عدّل المبلغ إلى 600</code> أو ` +
          `<code>خلّه بدون ضريبة</code>. أو «جديد» للإلغاء.`
      );
      return;
    }

    // ---- الحذف: تأكيد ثم تنفيذ ----
    if (action === 'x') {
      await answerCallbackQuery(env, cq.id);
      await show(
        env,
        chatId,
        messageId,
        `⚠️ <b>تأكيد الحذف</b>\n\nسيُحذف من وافق:\n${describeType(t.result.type)} — ${shortLabel(t)}\n` +
          `🧾 ${iso(t.wafeqId)}\n\nلا رجعة في هذا الإجراء.`,
        {
          inline_keyboard: [
            [
              { text: 'تأكيد الحذف', callback_data: `d:xy:${t.id}` },
              { text: 'إلغاء', callback_data: `d:v:${t.id}` },
            ],
          ],
        }
      );
      return;
    }
    if (action === 'xy') {
      await deleteDocument(env, t.result.type, t.wafeqId);
      await updateTransaction(env.DB, t.id, { status: 'deleted' });
      await writeLog(env.DB, { transactionId: t.id, action: 'wafeq_delete', status: 'success' });
      await answerCallbackQuery(env, cq.id, 'تم الحذف');
      await show(
        env,
        chatId,
        messageId,
        `🗑️ <b>تم الحذف من وافق</b>\n\n${describeType(t.result.type)} — ${shortLabel(t)}`,
        { inline_keyboard: [[{ text: 'رجوع إلى القائمة', callback_data: 'd:l:0' }]] }
      );
      return;
    }

    await answerCallbackQuery(env, cq.id);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await writeLog(env.DB, {
      action: 'telegram_callback',
      status: 'error',
      errorDetails: `${cq.data}: ${msg}`,
    });
    await answerCallbackQuery(env, cq.id, 'تعذّر تنفيذ الإجراء');
    await sendTelegramMessage(env, chatId, `⚠️ تعذّر تنفيذ الإجراء: ${msg}`).catch(() => {});
  }
}

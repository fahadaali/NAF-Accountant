// ============================================================================
// خدمة وافق (Wafeq API) — إنشاء قيود يومية (Manual Journals) كمسودات (DRAFT)
// ============================================================================
//
// المسار الصحيح: POST https://api.wafeq.com/v1/manual-journals/
// المصادقة:      Authorization: Api-Key <WAFEQ_API_KEY>
// بنية السطر:    { account, amount, currency, description }
//   - amount موجب = مدين (debit)، وسالب = دائن (credit).
//   - account يجب أن يكون معرّف الحساب في وافق (مثل acc_xxx) — لذا يلزم
//     مزامنة شجرة الحسابات من وافق أولاً لتعبئة wafeq_account_id.
// ============================================================================

import { briefApiError } from '../lib/http.js';

/** مسار مستند وافق حسب نوع العملية. */
const DOC_PATHS = {
  manual_journal: 'manual-journals',
  purchase_bill: 'bills',
  sales_invoice: 'invoices',
};

/**
 * حذف مستند من وافق (قيد يومية / فاتورة مشتريات / فاتورة بيع).
 * @param {string} type - manual_journal | purchase_bill | sales_invoice
 * @param {string} id   - معرّف المستند في وافق.
 */
export async function deleteDocument(env, type, id) {
  const path = DOC_PATHS[type];
  if (!path) throw new Error(`نوع مستند غير معروف للحذف: ${type}`);

  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const res = await fetch(`${base}/${path}/${encodeURIComponent(id)}/`, {
    method: 'DELETE',
    headers: { Authorization: `Api-Key ${env.WAFEQ_API_KEY}` },
  });

  // 204/200 نجاح، و404 نعتبره محذوفاً مسبقاً.
  if (res.ok || res.status === 404) return true;
  const body = await res.text();
  throw new Error(`Wafeq delete ${path} failed: ${res.status} ${body.slice(0, 300)}`);
}

/**
 * تحويل أسطر القيد القادمة من Claude إلى صيغة وافق وإرسالها كمسودة.
 * شرط حاسم: حالة القيد "DRAFT" لتتطلب مراجعة يدوية.
 *
 * @param {Array} accounts - شجرة الحسابات (لتعيين wafeq_account_id).
 * @param {Array} entries - أسطر القيد من Claude (account_code, debit, credit, ...).
 * @param {object} opts
 * @param {string} opts.description - مرجع القيد.
 * @param {string|null} opts.date - تاريخ القيد YYYY-MM-DD.
 * @param {Array} opts.attachmentIds - معرّفات المرفقات المرفوعة مسبقاً.
 * @param {string} opts.currency - عملة العملية (الافتراضي: عملة الدفاتر).
 * @param {number} opts.exchangeRate - سعر صرف العملة مقابل عملة الدفاتر.
 * @returns {Promise<{id: string, raw: object}>}
 */
export async function postJournalEntryDraft(env, accounts, entries, opts = {}) {
  const {
    description = 'قيد آلي — ناف لو',
    date = null,
    attachmentIds = [],
    currency = env.WAFEQ_CURRENCY || 'SAR',
    exchangeRate = 1,
  } = opts;

  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;

  // خريطة رمز الحساب -> معرّف وافق
  const codeToWafeqId = {};
  for (const a of accounts) {
    if (a.wafeq_account_id) codeToWafeqId[a.account_code] = a.wafeq_account_id;
  }

  const lineItems = entries.map((e) => {
    // amount موجب للمدين، سالب للدائن.
    const amount = Number(e.debit || 0) - Number(e.credit || 0);
    const account = codeToWafeqId[e.account_code] || e.account_code;
    if (!/^acc_/.test(account)) {
      throw new Error(
        `الحساب «${e.account_name || e.account_code}» (${e.account_code}) غير مربوط بوافق. شغّل المزامنة أو اختر حساباً مزامناً.`
      );
    }
    return {
      account,
      amount,
      // المبلغ مقابل عملة الدفاتر الأساسية. يتطابق مع amount حين تكون العملة
      // هي الأساسية (السعر 1)، ويُضرب في سعر الصرف حين تختلف — وبدون ذلك
      // يدخل مبلغ الدولار الدفاتر كأنه ريال فيختلّ الميزان.
      amount_to_bcy: +(amount * rate).toFixed(2),
      currency,
      description: e.description || '',
    };
  });

  const payload = {
    status: 'DRAFT', // (وافق يتجاهله للقيود اليدوية ويرحّلها — راجع README)
    date: date || new Date().toISOString().slice(0, 10),
    reference: description,
    currency,
    // لا نرسل حقل سعر صرف على مستوى القيد: التحويل محمولٌ في amount_to_bcy
    // لكل سطر، وهو المسار الموثّق. وإضافة حقل غير موثّق تخاطر برفض القيد كلّه.
    line_items: lineItems,
    // المصدر يُرفق بالقيد كما يُرفق بالفاتورة — القيد يحتاج مستنده المؤيِّد مثلها.
    ...(attachmentIds && attachmentIds.length ? { attachments: attachmentIds } : {}),
  };

  const res = await fetch(`${env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1'}/manual-journals/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${env.WAFEQ_API_KEY}`,
      // مفتاح منع التكرار (idempotency) لكل عملية.
      'X-Wafeq-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq manual-journal failed: ${res.status} ${briefApiError(body)}`);
  }

  const data = await res.json();
  return { id: String(data.id || data.uuid || ''), raw: data };
}

/**
 * سحب ملخص المسودات من وافق (للتقرير الشهري).
 * المسودات الفعلية هي فواتير البيع والمشتريات (القيود اليدوية تُرحّل مباشرة).
 * مرِن: يتجاوز أي نوع يفشل جلبه بدل إفشال التقرير كاملاً.
 * @returns {Promise<{count:number, items:Array, partial:string[]}>}
 *   partial: أنواع بلغت سقف الصفحات — العدد أدنى من الحقيقي.
 */
export async function getWafeqDraftSummary(env) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const headers = { Authorization: `Api-Key ${env.WAFEQ_API_KEY}` };
  const items = [];
  const partial = []; // أنواع بلغت سقف الصفحات فبقي منها ما لم يُجلب

  /* ═══ ترقيم الصفحات ═══

     كان الجلب صفحةً واحدة بـ`page_size=100` بلا متابعة `next`، فالسقف مئة
     لكل نوع. والنتيجة تُستعمل في موضعين لا يحتملان النقص:

       • «احذف جميع المسودات» يعرض «سيتم حذف N» ثم يحذف ما جُلب وحده —
         فيؤكّد المستخدم حذفاً شاملاً ويحصل على حذف جزئي دون أن يُخبَر.
       • تقرير بيسكامب الشهري ينشر العدد على أنه الإجمالي.

     ونمط المتابعة معروف في هذا المستودع — `sync.js` يتبع `data.next` منذ
     البداية. */
  const PAGE_GUARD = 50; // سقف صفحات يحمي من حلقة لا نهائية

  async function pull(path, label, docType) {
    let url = `${base}/${path}/?status=DRAFT&page_size=100`;
    let guard = 0;
    try {
      while (url && guard < PAGE_GUARD) {
        guard++;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const data = await res.json();
        const list = data.results || data.data || [];
        for (const d of list) {
          items.push({
            type: label,
            docType, // المفتاح الداخلي (لعمليات الحذف)
            id: String(d.id || d.uuid || ''),
            number: d.bill_number || d.invoice_number || '',
            date: d.bill_date || d.invoice_date || d.date || '',
          });
        }
        url = data.next || null;
        // بلغ السقف وبقيت صفحات: يُقال ولا يُقتطع صامتاً.
        if (url && guard >= PAGE_GUARD) partial.push(label);
      }
    } catch (_) {
      /* تجاهل نوعاً فشل جلبه */
    }
  }

  await pull('bills', 'فاتورة مشتريات', 'purchase_bill');
  await pull('invoices', 'فاتورة مبيعات', 'sales_invoice');

  return { count: items.length, items, partial };
}

// ============================================================================
// جهات الاتصال (Contacts) — للبحث عن عميل/مورّد أو إنشائه.
// ============================================================================

/** أسماء الحقول المحتملة لاسم جهة الاتصال في وافق. */
function contactName(c) {
  return c.name || c.name_ar || c.name_en || c.display_name || c.legal_name || '';
}

/**
 * بحث عن جهات اتصال بكلمة/اسم. يُرجع قائمة موحّدة [{id, name}].
 */
export async function searchContacts(env, query) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const res = await fetch(
    `${base}/contacts/?search=${encodeURIComponent(query)}&page_size=50`,
    { headers: { Authorization: `Api-Key ${env.WAFEQ_API_KEY}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const list = data.results || data.data || [];
  return list
    .filter((c) => c.id)
    .map((c) => ({ id: String(c.id), name: contactName(c) }));
}

/**
 * إنشاء جهة اتصال جديدة بالاسم. يُرجع المعرّف.
 */
export async function createContact(env, name) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const res = await fetch(`${base}/contacts/`, {
    method: 'POST',
    headers: {
      Authorization: `Api-Key ${env.WAFEQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq contact create failed: ${res.status} ${briefApiError(body)}`);
  }
  const created = await res.json();
  return String(created.id || created.uuid || '');
}

// ============================================================================
// المرفقات (Attachments) — رفع ملف وربطه بمستند.
// ============================================================================

/**
 * فحص المستند الذي أنشأته وافق: هل وصلت المرفقات فعلاً؟
 *
 * الحقل `attachments` في حمولة الإنشاء غير موثّق، وواجهات REST كثيرة تتجاهل
 * الحقول التي لا تعرفها بصمت — فيُنشأ المستند بلا مرفق ولا يُرفع أي خطأ.
 * لذلك نقرأ ردّ الإنشاء بدل افتراض النجاح.
 *
 * @returns {'linked'|'dropped'|'unknown'}
 *   linked  : الردّ يذكر مرفقاً واحداً على الأقل.
 *   dropped : الردّ يذكر الحقل فارغاً — أي أن وافق أسقط ما أرسلناه.
 *   unknown : الحقل غائب عن الردّ — لا يمكن الجزم من الردّ وحده.
 */
export function attachmentLinkState(raw) {
  const list = raw?.attachments ?? raw?.attachment_ids ?? raw?.files;
  if (list === undefined || list === null) return 'unknown';
  if (Array.isArray(list)) return list.length > 0 ? 'linked' : 'dropped';
  return 'linked';
}

/**
 * استكشاف واجهة المرفقات في وافق — قراءةٌ محضة، لا تُنشئ شيئاً ولا تُعدّله.
 *
 * مسار الرفع صار معروفاً وموثّقاً (POST /files/raw/)، لكن الحقل الذي يربط
 * الملف المرفوع بالمستند ما يزال غير موثّق. فيبقى التشخيص مفيداً لسؤالين:
 *
 *   1. أي المسارات المتصلة بالملفات موجود (GET على قائمة كل مسار).
 *   2. ما أسماء الحقول في مستند حقيقي — منها يُعرف اسم حقل المرفقات.
 *
 * @returns {Promise<object>} تقرير يُقرأ مباشرة، لا يُخزَّن.
 */
export async function probeAttachmentApi(env) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const headers = { Authorization: `Api-Key ${env.WAFEQ_API_KEY}` };

  const get = async (path) => {
    try {
      const res = await fetch(`${base}/${path}`, { headers });
      const body = await res.text();
      return { status: res.status, body };
    } catch (e) {
      return { status: 0, body: `fetch failed: ${e.message}` };
    }
  };

  // 1) أي مسار للمرفقات موجود؟ 404 = غير موجود، 200 = موجود، 401/403 = صلاحية.
  //
  // `files/` أولاً: هو المسار الموثّق لرفع الملفات، ووجوده يؤكّد الاتصال
  // والصلاحية قبل النظر في غيره.
  const candidates = ['files/', 'attachments/', 'documents/', 'uploads/', 'expenses/'];
  const paths = {};
  for (const path of candidates) {
    const { status, body } = await get(`${path}?page_size=1`);
    paths[path] = { status, sample: briefApiError(body, 120) };
  }

  // 2) أسماء الحقول في مستند حقيقي — منها يُعرف اسم حقل المرفقات وشكله.
  const documents = {};
  for (const [label, path] of [
    ['bill', 'bills'],
    ['invoice', 'invoices'],
    ['manual_journal', 'manual-journals'],
  ]) {
    const list = await get(`${path}/?page_size=1`);
    if (list.status !== 200) {
      documents[label] = { status: list.status, note: briefApiError(list.body, 120) };
      continue;
    }
    let first;
    try {
      const data = JSON.parse(list.body);
      first = (data.results || data.data || [])[0];
    } catch (_) {
      first = null;
    }
    if (!first?.id) {
      documents[label] = { status: 200, note: 'لا مستندات لفحصها' };
      continue;
    }
    // `expand=attachments` يوسّع الكائنات المشار إليها بمعرّفاتها. فإن كان
    // الحقل موجوداً عاد بكائنات كاملة يظهر منها شكل المرفق، وإن لم يكن
    // موجوداً ردّت وافق بخطأ يسمّي الحقل — وكلا الجوابين يفيد.
    const detail = await get(`${path}/${encodeURIComponent(first.id)}/?expand=attachments`);
    let fields = [];
    let attachmentLike = {};
    try {
      const doc = JSON.parse(detail.body);
      fields = Object.keys(doc);
      for (const k of fields) {
        if (/attach|file|document|media/i.test(k)) attachmentLike[k] = doc[k];
      }
    } catch (_) {
      /* ردّ غير JSON */
    }

    // مسار فرعي تحت المستند — شكل شائع في واجهات REST ولا يظهر في قائمة
    // المسارات الجذرية، فيُسأل عنه صراحةً.
    const sub = await get(`${path}/${encodeURIComponent(first.id)}/attachments/`);

    documents[label] = {
      status: detail.status,
      id: first.id,
      fields,
      attachmentLike,
      subPath: { path: `${path}/{id}/attachments/`, status: sub.status, sample: briefApiError(sub.body, 120) },
    };
  }

  return { base, paths, documents };
}

/**
 * اسم ملف صالح لترويسة Content-Disposition.
 *
 * قيم الترويسات تُنقل بترميز لاتيني، فالاسم العربي أو المحتوي على اقتباس
 * يكسر الطلب. أسماؤنا مشتقّة من معرّف الرسالة فهي لاتينية أصلاً، والتنظيف
 * احتياطٌ لما قد يأتي من مصدر آخر.
 */
function headerSafeFilename(name) {
  const safe = String(name || '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .trim();
  // اسمٌ ذهب كلّه فبقيت لاحقته («فاتورة.pdf» ← «.pdf») يُعطى اسماً محايداً
  // مع إبقاء اللاحقة، فهي ما يحدّد كيف يُفتح الملف.
  return !safe || safe.startsWith('.') ? `attachment${safe}` : safe;
}

/**
 * يرفع ملفاً (صورة فاتورة أو ملف PDF) إلى وافق ويُرجع معرّفه لإرفاقه بالمستند.
 *
 * المسار الموثّق: POST /files/raw/ بوسم Files — لا «attachments».
 * الجسم بايتات الملف خاماً لا نموذج multipart، واسم الملف يُمرَّر في ترويسة
 * Content-Disposition. الردّ 201 يحمل معرّفاً بالبادئة att_.
 */
export async function uploadAttachment(env, buffer, filename, contentType) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';

  const res = await fetch(`${base}/files/raw/`, {
    method: 'POST',
    headers: {
      Authorization: `Api-Key ${env.WAFEQ_API_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${headerSafeFilename(filename)}"`,
    },
    body: buffer,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq file upload failed: ${res.status} ${briefApiError(body)}`);
  }

  const data = await res.json();
  const id = String(data.id || '');
  if (!id) throw new Error('وافق قبلت الملف ولم تُرجع معرّفاً له');
  return id;
}

// ============================================================================
// فاتورة مشتريات (Bill) — مسار السداد/المشتريات.
// ============================================================================

/**
 * إنشاء فاتورة مشتريات كمسودة.
 * @param {object} opts { contactId, date, currency, lineItems, attachmentIds }
 *   lineItems: [{ account, description, amount, taxRateId? }]
 */
export async function createBillDraft(env, opts) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const currency = opts.currency || env.WAFEQ_CURRENCY || 'SAR';

  const line_items = (opts.lineItems || []).map((li) => ({
    account: li.account,
    description: li.description || '',
    quantity: 1,
    unit_amount: Number(li.amount || 0),
    ...(li.taxRateId ? { tax_rate: li.taxRateId } : {}),
  }));

  const payload = {
    status: 'DRAFT',
    contact: opts.contactId || null,
    currency,
    bill_date: opts.date,
    bill_due_date: opts.dueDate || opts.date,
    bill_number: opts.number || `PB-${Date.now()}`,
    line_items,
    ...(opts.attachmentIds && opts.attachmentIds.length
      ? { attachments: opts.attachmentIds }
      : {}),
  };

  const res = await fetch(`${base}/bills/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${env.WAFEQ_API_KEY}`,
      'X-Wafeq-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq bill failed: ${res.status} ${briefApiError(body)}`);
  }
  const data = await res.json();
  return { id: String(data.id || data.uuid || ''), raw: data };
}

// ============================================================================
// فاتورة بيع (Invoice) — مسار الوارد (دفعات/اشتراكات) + ضريبة القيمة المضافة.
// ============================================================================

/**
 * إنشاء فاتورة بيع كمسودة مع ضريبة القيمة المضافة.
 * @param {object} opts { contactId, date, currency, lineItems, taxRateId, attachmentIds }
 *   lineItems: [{ account, description, amount }]
 */
export async function createInvoiceDraft(env, opts) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const currency = opts.currency || env.WAFEQ_CURRENCY || 'SAR';

  const line_items = (opts.lineItems || []).map((li) => ({
    account: li.account,
    description: li.description || '',
    quantity: 1,
    unit_amount: Number(li.amount || 0),
    ...(opts.taxRateId ? { tax_rate: opts.taxRateId } : {}),
  }));

  const payload = {
    status: 'DRAFT',
    contact: opts.contactId || null,
    currency,
    invoice_date: opts.date,
    invoice_due_date: opts.dueDate || opts.date,
    invoice_number: opts.number || `INV-${Date.now()}`,
    line_items,
    ...(opts.attachmentIds && opts.attachmentIds.length
      ? { attachments: opts.attachmentIds }
      : {}),
  };

  const res = await fetch(`${base}/invoices/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${env.WAFEQ_API_KEY}`,
      'X-Wafeq-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq invoice failed: ${res.status} ${briefApiError(body)}`);
  }
  const data = await res.json();
  return { id: String(data.id || data.uuid || ''), raw: data };
}

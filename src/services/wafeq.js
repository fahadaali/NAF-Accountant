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

/**
 * تحويل أسطر القيد القادمة من Claude إلى صيغة وافق وإرسالها كمسودة.
 * شرط حاسم: حالة القيد "DRAFT" لتتطلب مراجعة يدوية.
 *
 * @param {Array} accounts - شجرة الحسابات (لتعيين wafeq_account_id).
 * @param {Array} entries - أسطر القيد من Claude (account_code, debit, credit, ...).
 * @returns {Promise<{id: string, raw: object}>}
 */
export async function postJournalEntryDraft(env, accounts, entries, description = 'قيد آلي — ناف لو', date = null) {
  const currency = env.WAFEQ_CURRENCY || 'SAR';

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
      // المبلغ بالعملة الأساسية للشركة. بما أن العملة نفسها الأساسية فالقيمة متطابقة.
      // (لو اختلفت العملات مستقبلاً، اضرب في سعر الصرف هنا.)
      amount_to_bcy: amount,
      currency,
      description: e.description || '',
    };
  });

  const payload = {
    status: 'DRAFT', // (وافق يتجاهله للقيود اليدوية ويرحّلها — راجع README)
    date: date || new Date().toISOString().slice(0, 10),
    reference: description,
    currency,
    line_items: lineItems,
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
    throw new Error(`Wafeq manual-journal failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return { id: String(data.id || data.uuid || ''), raw: data };
}

/**
 * سحب ملخص المسودات من وافق (للتقرير الشهري).
 */
export async function getWafeqDraftSummary(env) {
  const res = await fetch(
    `${env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1'}/manual-journals/?status=DRAFT`,
    {
      headers: { Authorization: `Api-Key ${env.WAFEQ_API_KEY}` },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq draft summary failed: ${res.status} ${body}`);
  }

  return res.json();
}

// ============================================================================
// جهات الاتصال (Contacts) — للبحث عن عميل/مورّد أو إنشائه.
// ============================================================================

/** تطبيع اسم للمقارنة: توحيد المسافات وإزالة التشكيل وتوحيد الألف/الياء/التاء. */
function normalizeName(s) {
  return (s || '')
    .replace(/[ً-ْ]/g, '') // إزالة التشكيل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

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
    throw new Error(`Wafeq contact create failed: ${res.status} ${body}`);
  }
  const created = await res.json();
  return String(created.id || created.uuid || '');
}

// ============================================================================
// المرفقات (Attachments) — رفع ملف وربطه بمستند.
// ============================================================================

/**
 * يرفع ملفاً (صورة فاتورة) إلى وافق ويُرجع معرّفه لإرفاقه بالمستند.
 * ملاحظة: صيغة نقطة النهاية تقديرية وتُضبط بالاختبار.
 */
export async function uploadAttachment(env, buffer, filename, contentType) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);

  const res = await fetch(`${base}/attachments/`, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${env.WAFEQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq attachment upload failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return String(data.id || data.uuid || '');
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
    throw new Error(`Wafeq bill failed: ${res.status} ${body}`);
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
    throw new Error(`Wafeq invoice failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return { id: String(data.id || data.uuid || ''), raw: data };
}

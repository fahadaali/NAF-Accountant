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
export async function postJournalEntryDraft(env, accounts, entries, description = 'قيد آلي — ناف لو') {
  const currency = env.WAFEQ_CURRENCY || 'SAR';

  // خريطة رمز الحساب -> معرّف وافق
  const codeToWafeqId = {};
  for (const a of accounts) {
    if (a.wafeq_account_id) codeToWafeqId[a.account_code] = a.wafeq_account_id;
  }

  const lineItems = entries.map((e) => {
    // amount موجب للمدين، سالب للدائن.
    const amount = Number(e.debit || 0) - Number(e.credit || 0);
    return {
      account: codeToWafeqId[e.account_code] || e.account_code,
      amount,
      // المبلغ بالعملة الأساسية للشركة. بما أن العملة نفسها الأساسية فالقيمة متطابقة.
      // (لو اختلفت العملات مستقبلاً، اضرب في سعر الصرف هنا.)
      amount_to_bcy: amount,
      currency,
      description: e.description || '',
    };
  });

  const payload = {
    status: 'DRAFT', // <-- شرط حاسم: مسودة تتطلب مراجعة يدوية
    date: new Date().toISOString().slice(0, 10),
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

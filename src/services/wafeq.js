// ============================================================================
// خدمة وافق (Wafeq API) — إنشاء قيود اليومية كمسودات (DRAFT)
// ============================================================================

/**
 * تحويل أسطر القيد القادمة من Claude إلى صيغة وافق وإرسالها كمسودة.
 * شرط حاسم: حالة القيد "DRAFT" لتتطلب مراجعة يدوية.
 *
 * @param {Array} accounts - شجرة الحسابات (لتعيين wafeq_account_id).
 * @param {Array} entries - أسطر القيد من Claude.
 * @returns {Promise<{id: string, raw: object}>}
 */
export async function postJournalEntryDraft(env, accounts, entries, description = 'قيد آلي — ناف لو') {
  // خريطة رمز الحساب -> معرّف وافق
  const codeToWafeqId = {};
  for (const a of accounts) {
    if (a.wafeq_account_id) codeToWafeqId[a.account_code] = a.wafeq_account_id;
  }

  const lineItems = entries.map((e) => ({
    // نستخدم معرّف وافق إن توفّر، وإلا نمرر رمز الحساب (يتطلب المزامنة).
    account: codeToWafeqId[e.account_code] || e.account_code,
    description: e.description || '',
    debit_amount: Number(e.debit || 0),
    credit_amount: Number(e.credit || 0),
  }));

  const payload = {
    status: 'DRAFT', // <-- شرط حاسم
    date: new Date().toISOString().slice(0, 10),
    description,
    line_items: lineItems,
  };

  const res = await fetch(`${env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1'}/journal-entries/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${env.WAFEQ_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Wafeq journal-entry failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return { id: String(data.id || data.uuid || ''), raw: data };
}

/**
 * سحب ملخص المسودات / ميزان المراجعة من وافق (للتقرير الشهري).
 * ملاحظة: نقاط النهاية قد تختلف حسب خطة الحساب — عدّلها حسب حسابك.
 */
export async function getWafeqDraftSummary(env) {
  const res = await fetch(
    `${env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1'}/journal-entries/?status=DRAFT`,
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

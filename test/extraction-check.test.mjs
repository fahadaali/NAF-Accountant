// ============================================================================
// التحقق الحسابي من قراءة الفاتورة — بلا شبكة.
//   npm run check:routes
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateExtraction } from '../src/lib/extraction_check.js';

const ACCOUNTS = [
  { account_code: '5100', account_name: 'مصروفات مكتبية' },
  { account_code: '1100', account_name: 'البنك' },
];
const OPTS = { accounts: ACCOUNTS, todayISO: '2026-10-11' };

const bill = (lines, extra = {}) => ({
  type: 'purchase_bill',
  date: '2026-10-10',
  bill: {
    line_items: lines.map((amount) => ({ account_code: '5100', account_name: 'م', description: '', amount })),
    vat_percent: 15,
  },
  ...extra,
});

const codes = (r) => r.issues.map((i) => i.code);

test('فاتورة متسقة تمرّ', () => {
  const r = validateExtraction(
    bill([100, 200], { printed_subtotal: 300, printed_vat: 45, printed_total: 345 }),
    OPTS
  );
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test('أسعار شاملة قُرئت كما هي تُكشف قبل أن تُضاف الضريبة مرتين', () => {
  const r = validateExtraction(bill([115], { printed_total: 115 }), OPTS);
  assert.deepEqual(codes(r), ['vat_inclusive']);
});

test('فرق تقريب الهللات عند قسمة الشامل لا يُعدّ خللاً', () => {
  // ثلاثة بنود شاملة 10 ريالات قُسمت على 1.15 فقُرّب كلٌّ منها.
  const r = validateExtraction(bill([8.7, 8.7, 8.7], { printed_total: 30 }), OPTS);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test('إجمالي لا يطابق البنود يُكشف', () => {
  const r = validateExtraction(bill([1000], { printed_total: 1500 }), OPTS);
  assert.deepEqual(codes(r), ['total']);
});

test('ضريبة مطبوعة على فاتورة صُنّفت بلا ضريبة تُكشف', () => {
  const r = validateExtraction(
    { ...bill([100], { printed_vat: 15 }), bill: { line_items: [{ account_code: '5100', amount: 100 }], vat_percent: 0 } },
    OPTS
  );
  assert.deepEqual(codes(r), ['vat']);
});

test('قيد غير متوازن يُكشف', () => {
  const r = validateExtraction(
    {
      type: 'manual_journal',
      date: '2026-10-10',
      manual_journal: {
        entries: [
          { account_code: '5100', debit: 500, credit: 0 },
          { account_code: '1100', debit: 0, credit: 450 },
        ],
      },
    },
    OPTS
  );
  assert.deepEqual(codes(r), ['balance']);
});

test('رمز حساب ليس في الشجرة يُكشف', () => {
  const r = validateExtraction(
    { type: 'purchase_bill', date: '2026-10-10', bill: { line_items: [{ account_code: '9999', amount: 10 }], vat_percent: 0 } },
    OPTS
  );
  assert.deepEqual(codes(r), ['account']);
});

test('تاريخ في المستقبل يُكشف، والصيغة الخاطئة كذلك', () => {
  assert.deepEqual(codes(validateExtraction(bill([1], { date: '2027-01-01' }), OPTS)), ['date']);
  assert.deepEqual(codes(validateExtraction(bill([1], { date: '1447/04/10' }), OPTS)), ['date']);
});

test('رقم ضريبي بصيغة خاطئة تحذيرٌ لا مانع، والأرقام الهندية تُقرأ', () => {
  const bad = validateExtraction(bill([1], { supplier_vat_number: '12345' }), OPTS);
  assert.equal(bad.ok, true);
  assert.equal(bad.warnings[0].code, 'vat_number');

  const good = validateExtraction(bill([1], { supplier_vat_number: '٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣' }), OPTS);
  assert.equal(good.warnings.length, 0);
});

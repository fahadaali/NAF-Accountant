// فاتورة المشتريات تأخذ معدّل ضريبة المشتريات — لا معدّل المبيعات `VAT_TAX_RATE_ID`.
// شكل الردّ من مرجع وافق: GET /tax-rates/ → { count, next, results: [{ id, name, rate, tax_type }] }
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePurchaseTaxRateId, _resetPurchaseTaxRateCache } from '../src/services/wafeq.js';

const realFetch = globalThis.fetch;
let calls;

function mockRates(pages) {
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const page = pages[calls.length - 1];
    if (!page) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => page };
  };
}

const page = (results, next = null) => ({ count: results.length, next, results });
const SALES = { id: 'tax_sales', name: 'Standard rated sales', tax_type: 'SALES', rate: 15 };
const PURCHASE = { id: 'tax_purchase', name: 'Standard rated purchases', tax_type: 'PURCHASES', rate: 15 };
const IMPORTS = { id: 'tax_imports', name: 'Imports subject to VAT paid at customs', tax_type: 'PURCHASES', rate: 15 };
const ZERO = { id: 'tax_zero', name: 'Zero rated purchases', tax_type: 'PURCHASES', rate: 0 };
const REVERSE = { id: 'tax_rc', name: 'Imports subject to reverse charge', tax_type: 'REVERSE_CHARGE', rate: 15 };

beforeEach(() => _resetPurchaseTaxRateCache());
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('المتغيّر الصريح يتقدّم ولا جلب', async () => {
  mockRates([]);
  const id = await resolvePurchaseTaxRateId(
    { VAT_PURCHASE_TAX_RATE_ID: 'tax_explicit', VAT_TAX_RATE_ID: 'tax_sales' },
    15
  );
  assert.equal(id, 'tax_explicit');
  assert.equal(calls.length, 0);
});

test('يطلب معدّلات المشتريات وحدها ويختار القياسي', async () => {
  mockRates([page([PURCHASE, ZERO])]);
  const id = await resolvePurchaseTaxRateId({ VAT_TAX_RATE_ID: 'tax_sales' }, 15);
  assert.equal(id, 'tax_purchase');
  assert.match(calls[0], /\/tax-rates\/\?tax_type=PURCHASES/);
});

test('لا يقبل معدّل مبيعات أو احتساب عكسي ولو أعاده الردّ', async () => {
  mockRates([page([SALES, REVERSE])]);
  assert.equal(await resolvePurchaseTaxRateId({ VAT_TAX_RATE_ID: 'tax_sales' }, 15), null);
});

test('القياسي يتقدّم على الاستيراد عند تعدّد معدّلات 15%', async () => {
  mockRates([page([IMPORTS, PURCHASE, ZERO])]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), 'tax_purchase');
});

test('يتبع الصفحات', async () => {
  mockRates([page([ZERO], 'https://api.wafeq.com/v1/tax-rates/?page=2'), page([PURCHASE])]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), 'tax_purchase');
  assert.equal(calls.length, 2);
});

test('يفهم النسبة الكسرية والاسم العربي', async () => {
  mockRates([page([{ id: 'tax_ar', name: 'مشتريات خاضعة للنسبة الأساسية', tax_type: 'PURCHASES', rate: 0.15 }])]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), 'tax_ar');
});

test('فشل الجلب ⇐ null، لا رجوع إلى معرّف المبيعات، ويُعاد الجلب لاحقاً', async () => {
  mockRates([]);
  assert.equal(await resolvePurchaseTaxRateId({ VAT_TAX_RATE_ID: 'tax_sales' }, 15), null);
  mockRates([page([PURCHASE])]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), 'tax_purchase');
});

test('تعدّد بلا فاصل ⇐ null بدل التخمين', async () => {
  mockRates([page([PURCHASE, { ...PURCHASE, id: 'tax_purchase_2' }])]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), null);
});

test('النتيجة تُخزَّن فلا جلب في كل فاتورة', async () => {
  mockRates([page([PURCHASE])]);
  await resolvePurchaseTaxRateId({}, 15);
  await resolvePurchaseTaxRateId({}, 15);
  assert.equal(calls.length, 1);
});

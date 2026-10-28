// فاتورة المشتريات تأخذ معدّل ضريبة المشتريات — لا معدّل المبيعات `VAT_TAX_RATE_ID`.
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

const SALES = { id: 'tax_sales', name: 'VAT on Sales', type: 'SALES', rate: 15 };
const PURCHASE = { id: 'tax_purchase', name: 'VAT on Purchases', type: 'PURCHASES', rate: 15 };
const ZERO = { id: 'tax_zero', name: 'Zero-rated Purchases', type: 'PURCHASES', rate: 0 };

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

test('يكتشف معدّل المشتريات ويتجاوز المبيعات والصفري', async () => {
  mockRates([{ results: [SALES, ZERO, PURCHASE], next: null }]);
  const id = await resolvePurchaseTaxRateId({ VAT_TAX_RATE_ID: 'tax_sales' }, 15);
  assert.equal(id, 'tax_purchase');
  assert.match(calls[0], /\/tax-rates\//);
});

test('يتبع الصفحات', async () => {
  mockRates([
    { results: [SALES], next: 'https://api.wafeq.com/v1/tax-rates/?page=2' },
    { results: [PURCHASE], next: null },
  ]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), 'tax_purchase');
  assert.equal(calls.length, 2);
});

test('يفهم النسبة الكسرية والاسم العربي', async () => {
  mockRates([[{ id: 'tax_ar', name_ar: 'ضريبة المشتريات 15%', rate: 0.15 }, SALES]]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), 'tax_ar');
});

test('فشل الجلب ⇐ null، لا رجوع إلى معرّف المبيعات', async () => {
  mockRates([]);
  assert.equal(await resolvePurchaseTaxRateId({ VAT_TAX_RATE_ID: 'tax_sales' }, 15), null);
});

test('أكثر من مرشّح ⇐ null بدل التخمين', async () => {
  mockRates([{ results: [PURCHASE, { ...PURCHASE, id: 'tax_purchase_2' }], next: null }]);
  assert.equal(await resolvePurchaseTaxRateId({}, 15), null);
});

test('النتيجة تُخزَّن فلا جلب في كل فاتورة', async () => {
  mockRates([{ results: [PURCHASE], next: null }]);
  await resolvePurchaseTaxRateId({}, 15);
  await resolvePurchaseTaxRateId({}, 15);
  assert.equal(calls.length, 1);
});

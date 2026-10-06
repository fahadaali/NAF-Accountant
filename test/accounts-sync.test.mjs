// ============================================================================
// مزامنة شجرة الحسابات — صمودها أمام انقطاع D1 العابر.
//   npm run check:routes
//
// فشلت المزامنة الليلية بـ «D1_ERROR: Network connection lost». كانت تكتب
// كل حساب بنداء D1 مستقل، فانقطاعٌ واحد بين مئة نداء يُسقطها في منتصفها.
// وهذه الاختبارات تحرس ما استُبدل به: دفعة واحدة لكل صفحة من وافق، تُعاد
// عند العطل العابر وحده.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { syncChartOfAccounts } from '../src/services/sync.js';
import { withD1Retry } from '../src/lib/db.js';

/** قاعدة مصغّرة: تسجّل الدفعات، وتفشل أول `failures` منها بالخطأ المعطى. */
function stubDb({ failures = 0, error = 'D1_ERROR: Network connection lost.' } = {}) {
  const batches = [];
  let calls = 0;
  return {
    batches,
    get calls() {
      return calls;
    },
    prepare: (sql) => ({
      sql,
      bind: (...args) => ({ sql, args, run: async () => {} }),
    }),
    batch: async (statements) => {
      calls += 1;
      if (calls <= failures) throw new Error(error);
      batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  };
}

const page = (results, next = null) =>
  new Response(JSON.stringify({ count: results.length, next, results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const account = (code) => ({ id: `acc_${code}`, account_code: code, account_type: 'EXPENSE', name_ar: `حساب ${code}` });

function stubFetch(pages) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async () => pages[i++];
  return () => {
    globalThis.fetch = original;
  };
}

test('كل صفحة من وافق تُكتب في دفعة D1 واحدة', async () => {
  const db = stubDb();
  const restore = stubFetch([
    page([account('521'), account('522'), account('523')], 'https://api.wafeq.com/v1/accounts/?page=2'),
    page([account('524')]),
  ]);
  try {
    const { synced } = await syncChartOfAccounts({ WAFEQ_API_KEY: 'k', DB: db });
    assert.equal(synced, 4);
    assert.deepEqual(
      db.batches.map((b) => b.length),
      [3, 1],
      'دفعة لكل صفحة، لا نداء لكل حساب'
    );
    assert.deepEqual(db.batches[0][0].args, ['521', 'حساب 521', 'expense', 'acc_521']);
  } finally {
    restore();
  }
});

test('انقطاع D1 العابر يُعاد ولا يُسقط المزامنة', async () => {
  const db = stubDb({ failures: 1 });
  const restore = stubFetch([page([account('521')])]);
  try {
    const { synced } = await syncChartOfAccounts({ WAFEQ_API_KEY: 'k', DB: db });
    assert.equal(synced, 1);
    assert.equal(db.calls, 2, 'محاولة فشلت ثم أخرى نجحت');
  } finally {
    restore();
  }
});

test('انقطاعٌ يتكرّر بعد المحاولات كلها يُرفع كما هو', async () => {
  const db = stubDb({ failures: 10 });
  const restore = stubFetch([page([account('521')])]);
  try {
    await assert.rejects(
      () => syncChartOfAccounts({ WAFEQ_API_KEY: 'k', DB: db }),
      /Network connection lost/
    );
    assert.equal(db.calls, 3, 'ثلاث محاولات ثم يُرفع العطل لينبّه المسؤولين');
  } finally {
    restore();
  }
});

test('خطأ الاستعلام لا يُعاد — إعادته لا تُصلحه', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withD1Retry(
        async () => {
          calls += 1;
          throw new Error('D1_ERROR: no such table: chart_of_accounts');
        },
        { delayMs: 0 }
      ),
    /no such table/
  );
  assert.equal(calls, 1);
});

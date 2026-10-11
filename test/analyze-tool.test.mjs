// ============================================================================
// عقد نداء التحليل — أداةٌ مُلزَمة لا JSON حرّ.
//   npm run check:routes
//
// كان ردّ التحليل نصّاً يُقصّ بين أول `{` وآخر `}`. فيُثبَّت هنا أن الطلب
// يُلزم النموذج بأداة `record_transaction`، وأن النتيجة تُقرأ من
// كتلة `tool_use` نفسها — ولو سبقها نصٌّ يحوي أقواساً.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeTransaction } from '../src/services/claude.js';

const ACCOUNTS = [{ account_code: '5100', account_name: 'مصروفات مكتبية', account_type: 'expense' }];

async function withFakeClaude(reply, fn) {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    return { out: await fn(), requests };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const OPTS = {
  accounts: ACCOUNTS,
  defaultBank: null,
  messageDateISO: '2026-10-11',
  vatPercent: 15,
  baseCurrency: 'SAR',
  text: '',
  priorContext: null,
};

const BILL = {
  status: 'ready',
  type: 'purchase_bill',
  date: '2026-10-10',
  contact_name: 'مكتبة جرير',
  currency: 'SAR',
  summary: 'أدوات مكتبية',
  invoice_number: 'INV-2291',
  printed_total: 115,
  readability: 'clear',
  bill: { line_items: [{ account_code: '5100', account_name: 'مصروفات مكتبية', description: 'أقلام', amount: 100 }], vat_percent: 15 },
};

test('التحليل يُلزم النموذج بأداة record_transaction ولا يرسل temperature', async () => {
  const { out, requests } = await withFakeClaude(
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'سأسجّل {الفاتورة} الآن' },
        { type: 'tool_use', name: 'record_transaction', input: BILL },
      ],
    },
    () =>
      analyzeTransaction({ CLAUDE_API_KEY: 'k' }, {
        ...OPTS,
        media: { kind: 'image', mediaType: 'image/jpeg', base64: 'AAAA' },
      })
  );

  const body = requests[0].body;
  // النماذج الحديثة ترفض المعامل بـ٤٠٠ فيفشل التحليل كلّه.
  assert.equal('temperature' in body, false);
  assert.equal(body.tool_choice.name, 'record_transaction');
  assert.equal(body.tools[0].name, 'record_transaction');
  assert.equal(body.max_tokens, 4096, 'المرفق يرفع حدّ الرموز');
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(out.invoice_number, 'INV-2291');
});

test('عدّة صور تُرسل كتلاً بالترتيب في طلب واحد', async () => {
  const { requests } = await withFakeClaude(
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_transaction', input: BILL }] },
    () =>
      analyzeTransaction({ CLAUDE_API_KEY: 'k' }, {
        ...OPTS,
        media: [
          { kind: 'image', mediaType: 'image/jpeg', base64: 'AA' },
          { kind: 'image', mediaType: 'image/png', base64: 'BB' },
        ],
      })
  );
  const blocks = requests[0].body.messages[0].content;
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['image', 'image', 'text']
  );
  assert.match(blocks[2].text, /2 صور لفاتورة واحدة/);
});

test('ردّ بلا كتلة أداة يُرفض برسالة عربية لا بخطأ تحليل JSON', async () => {
  await assert.rejects(
    withFakeClaude({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'لا أعرف' }] }, () =>
      analyzeTransaction({ CLAUDE_API_KEY: 'k' }, { ...OPTS, text: 'دفعت 500' })
    ),
    /لم يُرجع النموذج نتيجة منظّمة/
  );
});

test('ضغط الخدمة (529) يُعاد بعده الطلب بدل إفشال العملية', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response('{"type":"error","error":{"type":"overloaded_error"}}', {
        status: 529,
        headers: { 'retry-after': '0' },
      });
    }
    return new Response(
      JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_transaction', input: BILL }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  // الانتظار الأول ثانيتان — يُختصر هنا ليبقى الاختبار سريعاً.
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    const out = await analyzeTransaction({ CLAUDE_API_KEY: 'k' }, { ...OPTS, text: 'دفعت 100' });
    assert.equal(calls, 2);
    assert.equal(out.type, 'purchase_bill');
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
  }
});

test('القراءة السابقة تُمرَّر مع السياق في جولة الاستكمال', async () => {
  const { requests } = await withFakeClaude(
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_transaction', input: BILL }] },
    () =>
      analyzeTransaction({ CLAUDE_API_KEY: 'k' }, {
        ...OPTS,
        text: 'المورّد جرير',
        priorContext: '(صورة مرفقة)',
        priorResult: { ...BILL, contact_name: null },
      })
  );
  const text = requests[0].body.messages[0].content.at(-1).text;
  assert.match(text, /قراءتك السابقة للعملية/);
  assert.match(text, /INV-2291/);
});

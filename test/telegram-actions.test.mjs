// ============================================================================
// المسودات من تليجرام: القائمة والبطاقة والحذف بالأزرار — بلا شبكة.
//   npm run check:routes
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processTelegramUpdate } from '../src/lib/processor.js';

const CHAT = 4242;

const row = (id, type, extra = {}) => ({
  id,
  wafeq_draft_id: `bill_${id}`,
  media_r2_key: null,
  processed_json: JSON.stringify({
    type,
    date: '2026-10-10',
    contact_name: `مورّد ${id}`,
    currency: 'SAR',
    summary: 'أدوات',
    bill: { line_items: [{ account_code: '5100', account_name: 'مصروفات', amount: 100 * id }], vat_percent: 15 },
    ...extra,
  }),
});

/** D1 مصغّر: صفوف مُرحّلة لمحادثة واحدة، ويلتقط التحديثات والسجلّ. */
function fakeDb(rows) {
  const updates = [];
  const logs = [];
  let state = null;
  const handle = (sql, args) => ({
    async run() {
      if (sql.includes('UPDATE transactions')) updates.push({ sql, args });
      if (sql.includes('INSERT INTO logs')) logs.push({ action: args[1], status: args[2] });
      if (sql.includes('INSERT INTO conversation_state')) state = JSON.parse(args[1]);
      return { meta: { changes: 1, last_row_id: 900 } };
    },
    async first() {
      if (sql.includes('COUNT(*)')) return { n: rows.length };
      if (sql.includes('AND id = ?')) {
        // محصورة بالمحادثة: معرّف المحادثة أولاً ثم معرّف العملية.
        if (args[0] !== String(CHAT)) return null;
        return rows.find((r) => r.id === args[1]) || null;
      }
      return null;
    },
    async all() {
      if (sql.includes('LIMIT ? OFFSET ?')) return { results: rows.slice(args[2], args[2] + args[1]) };
      return { results: [] };
    },
  });
  return {
    updates,
    logs,
    get state() {
      return state;
    },
    prepare(sql) {
      return Object.assign(handle(sql, []), { bind: (...args) => handle(sql, args) });
    },
  };
}

async function run(update, DB) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await processTelegramUpdate({ DB, TELEGRAM_BOT_TOKEN: 't', WAFEQ_API_KEY: 'w' }, update);
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

const press = (data, chatId = CHAT) => ({
  update_id: 1,
  callback_query: {
    id: 'cq1',
    data,
    message: { message_id: 55, chat: { id: chatId, type: 'private' } },
  },
});

test('‎/drafts يعرض المسودات بزرٍّ لكل واحدة وزرّ «التالي»', async () => {
  const rows = [1, 2, 3, 4, 5, 6].map((i) => row(i, 'purchase_bill'));
  const calls = await run(
    { update_id: 1, message: { message_id: 1, date: 1791000000, chat: { id: CHAT, type: 'private' }, text: '/drafts' } },
    fakeDb(rows)
  );
  const sent = calls.find((c) => c.url.includes('/sendMessage'));
  assert.ok(sent, 'أُرسلت القائمة');
  const kb = sent.body.reply_markup.inline_keyboard;
  assert.equal(kb.filter((r) => r[0].callback_data.startsWith('d:v:')).length, 5, 'خمس مسودات في الصفحة');
  assert.ok(kb.some((r) => r.some((b) => b.callback_data === 'd:l:5')), 'زرّ الصفحة التالية');
});

test('الأمر بلاحقة اسم البوت في المجموعات يُفهم', async () => {
  const calls = await run(
    {
      update_id: 1,
      message: { message_id: 1, date: 1791000000, chat: { id: CHAT, type: 'group' }, text: '/drafts@naf_accountant_bot' },
    },
    fakeDb([row(1, 'purchase_bill')])
  );
  assert.ok(calls.some((c) => c.url.includes('/sendMessage') && c.body.reply_markup));
});

test('زرّ البطاقة يعدّل الرسالة في مكانها ويُجيب الضغطة', async () => {
  const calls = await run(press('d:v:2'), fakeDb([row(2, 'purchase_bill', { invoice_number: 'A-77' })]));
  const edit = calls.find((c) => c.url.includes('/editMessageText'));
  assert.ok(edit, 'البطاقة تُعرض بتعديل الرسالة');
  assert.equal(edit.body.message_id, 55);
  assert.match(edit.body.text, /A-77/);
  assert.ok(edit.body.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'd:x:2'));
  assert.ok(calls.some((c) => c.url.includes('/answerCallbackQuery')), 'مؤشّر الانتظار يُنهى');
});

test('تأكيد الحذف يحذف من وافق ويسم العملية محذوفة', async () => {
  const DB = fakeDb([row(3, 'purchase_bill')]);
  const calls = await run(press('d:xy:3'), DB);
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del, 'طلب حذف إلى وافق');
  assert.match(del.url, /\/bills\/bill_3\//);
  assert.ok(DB.updates.some((u) => u.args.includes('deleted') && u.args.includes(3)));
  assert.ok(DB.logs.some((l) => l.action === 'wafeq_delete'));
});

test('زرٌّ يشير إلى عملية محادثة أخرى لا يبلغها', async () => {
  const calls = await run(press('d:xy:3', 9999), fakeDb([row(3, 'purchase_bill')]));
  assert.ok(!calls.some((c) => c.method === 'DELETE'), 'لا حذف');
  const answer = calls.find((c) => c.url.includes('/answerCallbackQuery'));
  assert.match(answer.body.text, /لم تعد قائمة/);
});

test('زرّ التعديل يحفظ هدفه، فالرسالة التالية تعديلٌ لتلك العملية بعينها', async () => {
  const DB = fakeDb([row(4, 'purchase_bill')]);
  await run(press('d:e:4'), DB);
  assert.deepEqual(DB.state, { kind: 'edit_target', targetTxId: 4 });
});

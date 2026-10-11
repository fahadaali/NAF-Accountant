// ============================================================================
// صور الألبوم تُقرأ فاتورةً واحدة — بلا شبكة.
//   npm run check:routes
//
// صورتان من ألبوم واحد تصلان تحديثين متزامنين. المطلوب: طلب Claude واحد
// يحمل الصورتين بالترتيب، وسؤالٌ واحد يصل المستخدم — لا فاتورتان.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processTelegramUpdate } from '../src/lib/processor.js';

/** D1 مصغّر يحاكي ما يمسّه مسار الألبوم، ومنه الاستلام الذرّي. */
function fakeDb() {
  let nextTx = 100;
  const items = [];
  const logs = [];
  let state = null;

  const handle = (sql, args) => ({
    async run() {
      if (sql.includes('INSERT INTO transactions')) return { meta: { last_row_id: ++nextTx } };
      if (sql.includes('INSERT INTO logs')) logs.push({ action: args[1], details: args[3] });
      if (sql.includes('INSERT INTO media_group_items')) {
        const [group_id, chat_id, message_id, transaction_id, caption, created_ms] = args;
        items.push({ group_id, chat_id, message_id, transaction_id, caption, created_ms, r2_key: null, claimed_by: null });
      }
      if (sql.includes('UPDATE media_group_items SET r2_key')) {
        const it = items.find((i) => i.transaction_id === args[2]);
        if (it) Object.assign(it, { r2_key: args[0], media_type: args[1] });
      }
      if (sql.includes('UPDATE media_group_items SET claimed_by = ?') && sql.includes('group_id')) {
        const [txId, g, c, force, , , , , before] = args;
        const group = items.filter((i) => i.group_id === g && i.chat_id === c);
        const quiet =
          !group.some((i) => i.r2_key === null) && Math.max(...group.map((i) => i.created_ms)) < before;
        let changes = 0;
        if (force === 1 || quiet) {
          for (const i of group) if (i.claimed_by === null) (i.claimed_by = txId), changes++;
        }
        return { meta: { changes } };
      }
      if (sql.includes('INSERT INTO conversation_state')) state = args[1];
      return { meta: { changes: 0 } };
    },
    async first() {
      if (sql.includes('SELECT claimed_by FROM media_group_items')) {
        const it = items.find((i) => i.transaction_id === args[0]);
        return it ? { claimed_by: it.claimed_by } : null;
      }
      return null;
    },
    async all() {
      if (sql.includes('FROM chart_of_accounts')) {
        return {
          results: [{ account_code: '5100', account_name: 'مصروفات', account_type: 'expense', wafeq_account_id: 'acc_1' }],
        };
      }
      if (sql.includes('FROM media_group_items') && sql.includes('claimed_by = ?')) {
        return {
          results: items
            .filter((i) => i.claimed_by === args[0])
            .sort((a, b) => Number(a.message_id) - Number(b.message_id)),
        };
      }
      return { results: [] };
    },
  });

  return {
    items,
    logs,
    get state() {
      return state;
    },
    prepare(sql) {
      return Object.assign(handle(sql, []), { bind: (...args) => handle(sql, args) });
    },
  };
}

function fakeR2() {
  const store = new Map();
  return {
    store,
    async put(key, bytes) {
      store.set(key, bytes);
    },
    async get(key) {
      const b = store.get(key);
      return b ? { arrayBuffer: async () => b, httpMetadata: {} } : null;
    },
  };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]).buffer;

test('صورتا ألبوم واحد تُحلَّلان في طلب واحد ويصل سؤالٌ واحد', async () => {
  const DB = fakeDb();
  const MEDIA = fakeR2();
  const sent = [];
  const claudeBodies = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const json = (o) =>
      new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/getFile')) return json({ ok: true, result: { file_path: 'photos/x.jpg' } });
    if (u.includes('/file/bot')) return new Response(JPEG, { status: 200 });
    if (u.includes('/sendMessage')) {
      sent.push(JSON.parse(init.body).text);
      return json({ ok: true, result: {} });
    }
    if (u.includes('/messages')) {
      claudeBodies.push(JSON.parse(init.body));
      return json({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            name: 'record_transaction',
            input: {
              status: 'need_more',
              question: 'من أي مورّد؟',
              type: 'purchase_bill',
              date: '2026-10-10',
              currency: 'SAR',
              summary: 'فاتورة',
              readability: 'clear',
              bill: { line_items: [], vat_percent: 15 },
            },
          },
        ],
      });
    }
    return new Response('offline', { status: 503 });
  };

  const env = { DB, MEDIA, TELEGRAM_BOT_TOKEN: 't', CLAUDE_API_KEY: 'k' };
  const photo = (id, extra = {}) => ({
    update_id: id,
    message: {
      message_id: id,
      date: 1791000000,
      chat: { id: 77, type: 'private' },
      media_group_id: 'album-1',
      photo: [{ file_id: `f${id}`, file_size: 1000 }],
      ...extra,
    },
  });

  try {
    await Promise.all([
      processTelegramUpdate(env, photo(1, { caption: 'فاتورة صيانة' })),
      processTelegramUpdate(env, photo(2)),
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(claudeBodies.length, 1, `طلب تحليل واحد للألبوم كله:\n${sent.join('\n')}\n${JSON.stringify(DB.logs)}`);
  const blocks = claudeBodies[0].messages[0].content;
  assert.deepEqual(blocks.map((b) => b.type), ['image', 'image', 'text']);
  assert.match(blocks[2].text, /فاتورة صيانة/, 'التعليق من الصورة الأولى يصل');
  assert.equal(sent.length, 1, `رسالة واحدة تصل المستخدم:\n${sent.join('\n---\n')}`);
  assert.match(sent[0], /من أي مورّد/);
  assert.ok(DB.logs.some((l) => l.action === 'control_album_merged'), 'العنصر المنسحب يُسجَّل');

  const saved = JSON.parse(DB.state);
  assert.equal(saved.mediaR2Keys.length, 2, 'السياق يحفظ الصفحتين للجولة التالية');
});

test('صورة ألبوم قبل تطبيق ترحيل الجدول تُعالَج وحدها ولا تفشل', async () => {
  const DB = fakeDb();
  const realPrepare = DB.prepare.bind(DB);
  DB.prepare = (sql) => {
    if (sql.includes('media_group_items')) {
      const boom = async () => {
        throw new Error('no such table: media_group_items');
      };
      return { bind: () => ({ run: boom, first: boom, all: boom }), run: boom, first: boom, all: boom };
    }
    return realPrepare(sql);
  };
  const sent = [];
  let claude = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/getFile')) return json({ ok: true, result: { file_path: 'p.jpg' } });
    if (u.includes('/file/bot')) return new Response(JPEG, { status: 200 });
    if (u.includes('/sendMessage')) {
      sent.push(JSON.parse(init.body).text);
      return json({ ok: true, result: {} });
    }
    if (u.includes('/messages')) {
      claude++;
      return json({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'record_transaction', input: { status: 'need_more', question: 'من أي مورّد؟', type: 'purchase_bill', date: '2026-10-10', currency: 'SAR', summary: 'ف', readability: 'clear', bill: { line_items: [], vat_percent: 15 } } }],
      });
    }
    return new Response('offline', { status: 503 });
  };
  try {
    await processTelegramUpdate(
      { DB, MEDIA: fakeR2(), TELEGRAM_BOT_TOKEN: 't', CLAUDE_API_KEY: 'k' },
      { update_id: 9, message: { message_id: 9, date: 1791000000, chat: { id: 77, type: 'private' }, media_group_id: 'g', photo: [{ file_id: 'f', file_size: 10 }] } }
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(claude, 1, 'حُلّلت الصورة');
  assert.match(sent[0], /من أي مورّد/);
});

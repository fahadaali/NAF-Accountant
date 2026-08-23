// ============================================================================
// عقد نطاق التحديث — بلا شبكة: مُشغّل الاختبارات المدمج.
//   npm run check:routes
//
// ═══ لماذا هذا الملف ═══
//
// `processTelegramUpdate` غلافٌ يرى كائن التحديث، و`handleTelegramMessage`
// معالجٌ يرى الرسالة وحدها. وكان المعالج يقرأ `update.edited_message` —
// معرّفاً لا وجود له في نطاقه — فكانت كلُّ رسالةٍ تتجاوز الأوامر ترتدّ على
// المستخدم بـ «تعذّرت معالجة الرسالة … السبب: update is not defined» قبل أن
// تُسجَّل عملية أصلاً. أي أن البوت لم يكن يعالج شيئاً.
//
// العطل لا يظهر في قراءة الدالة وحدها: نصُّها سليم، والخلل في حدّ النطاق
// بينها وبين غلافها. فيُفحص الحدّ نفسه — تُشغَّل رسالةٌ عاديةٌ كاملةً ويُتحقَّق
// أن ما وصل المستخدم ليس خطأ مرجعٍ.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processTelegramUpdate } from '../src/lib/processor.js';

// ---------------------------------------------------------------------------
// بديل مصغّر لـ D1 — يكفي المسارات التي تُنادى هنا: لا رسالة سابقة، ولا
// سياق محادثة عالق، وصفُّ عمليةٍ جديدٍ برقمٍ ثابت.
// ---------------------------------------------------------------------------
function fakeDb() {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { last_row_id: 1, changes: 0 } }),
  };
  return { prepare: () => stmt };
}

/**
 * يشغّل تحديثاً كاملاً بشبكةٍ مُعطَّلة، ويعيد نصوص ما أُرسل إلى المحادثة.
 *
 * الشبكة المُعطَّلة مقصودة: ما بعد حدّ النطاق يفشل حتماً، والمطلوب إثباته
 * أن سبب الفشل ليس `update is not defined` — أي أن المعالجة بلغت الشبكة.
 */
async function runUpdate(update) {
  const sent = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes('/sendMessage')) {
      sent.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // كل ما عدا تليجرام: خدمةٌ لا تُنادى في اختبار.
    return new Response('offline', { status: 503 });
  };

  try {
    await processTelegramUpdate(
      { DB: fakeDb(), TELEGRAM_BOT_TOKEN: 'test-token' },
      update
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  return sent;
}

const CHAT = { id: 4242, type: 'private' };
const DATE = Math.floor(Date.parse('2026-08-23T10:00:00Z') / 1000);

// ---------------------------------------------------------------------------

test('رسالة نصية عادية لا ترتدّ بخطأ مرجعٍ على معرّف خارج النطاق', async () => {
  const sent = await runUpdate({
    update_id: 1,
    message: { message_id: 11, chat: CHAT, date: DATE, text: 'فاتورة 600 ريال من مكتب النور' },
  });

  const joined = sent.join('\n');
  assert.ok(
    !/is not defined/i.test(joined),
    `المعالجة ارتدّت بخطأ مرجع بدل أن تعمل:\n${joined}`
  );
});

test('الأوامر لا تمرّ بحدّ النطاق أصلاً فتصل كاملة', async () => {
  const sent = await runUpdate({
    update_id: 2,
    message: { message_id: 12, chat: CHAT, date: DATE, text: '/help' },
  });

  assert.equal(sent.length, 1);
  assert.ok(!/is not defined/i.test(sent[0]));
});

test('الرسالة المعدَّلة تُعرَف بأنها معدَّلة ويُردّ عليها بنصّها الخاص', async () => {
  const sent = await runUpdate({
    update_id: 3,
    edited_message: { message_id: 13, chat: CHAT, date: DATE, text: 'المبلغ 600' },
  });

  assert.equal(sent.length, 1, `عدد الرسائل غير متوقّع:\n${sent.join('\n')}`);
  assert.match(sent[0], /تعديل رسالة سابقة لا يُعالَج/);
});

test('الرسالة الجديدة لا تُصنَّف معدَّلة', async () => {
  const sent = await runUpdate({
    update_id: 4,
    message: { message_id: 14, chat: CHAT, date: DATE, text: 'المبلغ 600' },
  });

  assert.ok(
    !sent.some((t) => /تعديل رسالة سابقة لا يُعالَج/.test(t)),
    'رسالة جديدة عوملت معاملة المعدَّلة'
  );
});

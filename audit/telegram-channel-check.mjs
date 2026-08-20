// ============================================================================
// فحص قناة تليجرام — لا مسار يصمت.
//
// كل عطلٍ في هذا الباب كان يظهر للمستخدم شيئاً واحداً: لا شيء. سرٌّ اختلف
// طرفاه، ورابطٌ بقي على نطاقٍ سابق، ومحادثةٌ غير مضافة، وعطلُ قاعدةٍ قبل
// إنشاء صفّ العملية — أربعة أسباب مختلفة تماماً، وأثرُها واحد: صمت. فلا
// يعرف صاحبُ المنصة أرُحّل القيد ولم يصله الردّ أم توقفت المنصة.
//
// وهذا الملف يثبّت أن كلّاً منها يترك أثراً يُقرأ. يعمل بلا شبكة — `fetch`
// و`D1` مُستبدلان — فيصلح للتشغيل قبل كل نشر:  npm run check:telegram
// ============================================================================

import assert from 'node:assert/strict';
import { Hono } from 'hono';
import telegramRoute from '../src/routes/telegram.js';
import { diagnoseWebhook, runWebhookWatchdog } from '../src/services/telegram.js';

// ---------------------------------------------------------------------------
// قاعدة بيانات وهمية: تلتقط أسطر السجلّ، وتقدر أن تتعطّل عند عبارة بعينها.
// ---------------------------------------------------------------------------
function fakeDb({ failOn = null, chats = [] } = {}) {
  const logs = [];
  return {
    logs,
    prepare(sql) {
      if (failOn && sql.includes(failOn)) {
        const boom = async () => {
          throw new Error('D1 مقطوعة');
        };
        return { bind: () => ({ run: boom, first: boom, all: boom }) };
      }
      const stmt = (...args) => ({
        async run() {
          if (sql.includes('INSERT INTO logs')) {
            logs.push({ action: args[1], status: args[2], details: args[3] });
          }
          return { meta: { last_row_id: 1 } };
        },
        async first() {
          if (sql.includes('FROM telegram_chats')) {
            return chats.includes(String(args[0])) ? { chat_id: args[0] } : null;
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
      });
      // D1 يقبل prepare().all() بلا bind، وprepare().bind().all() معاً.
      return Object.assign(stmt(), { bind: stmt });
    },
  };
}

// ---------------------------------------------------------------------------
// تليجرام وهميّ: يحفظ الرابط المسجَّل فيتغيّر بـ setWebhook كما يتغيّر فعلاً.
// ---------------------------------------------------------------------------
let calls = [];
const tg = {
  url: 'https://naf-accountant.naflaw-sa.workers.dev/api/telegram-webhook', // نطاق سابق
  lastError: 'Wrong response from the webhook: 401 Unauthorized',
  pending: 12,
};

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, body });
  const json = (o) =>
    new Response(JSON.stringify(o), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  if (u.includes('/getMe')) return json({ ok: true, result: { username: 'naf_accountant_bot' } });
  if (u.includes('/getWebhookInfo')) {
    return json({
      ok: true,
      result: {
        url: tg.url,
        pending_update_count: tg.pending,
        last_error_message: tg.lastError,
      },
    });
  }
  if (u.includes('/setWebhook')) {
    tg.url = body.url;
    tg.lastError = null;
    tg.pending = 0;
    return json({ ok: true, result: true });
  }
  return json({ ok: true, result: {} });
};

const app = new Hono();
app.route('/api', telegramRoute);

/* السرّ في البيئة الأساسية: الباب صار يفشل مغلقاً، فغيابه يردّ ٥٠٣ قبل أي
   فحصٍ آخر — وحالاتُ هذا الملف تفحص ما بعده. */
const SECRET = 's3cret';
const BASE = {
  TELEGRAM_BOT_TOKEN: 'tok',
  PUBLIC_ORIGIN: 'https://acc.naflaw.sa',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
};

const post = (payload, headers = {}) =>
  new Request('https://acc.naflaw.sa/api/telegram-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': SECRET,
      ...headers,
    },
    body: JSON.stringify(payload),
  });

const ctx = () => {
  const settled = [];
  return { waitUntil: (p) => settled.push(p), settled };
};

const msg = (chatId, text) => ({
  update_id: 1,
  message: {
    message_id: 7,
    date: 1754300000,
    chat: { id: chatId, type: 'private' },
    text,
  },
});

let passed = 0;
const ok = (label) => {
  passed++;
  console.log(`  [ok] ${label}`);
};

// ═══ سرّ لا يطابق ═══
// كان: ٤٠١ بلا سطرٍ في أي سجلّ. وهذا أشيع أسباب موت البوت وأقلّها ظهوراً.
{
  const DB = fakeDb();
  const res = await app.fetch(
    post(msg(555, 'دفعت 500'), { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }),
    { ...BASE, DB },
    ctx()
  );
  assert.equal(res.status, 401);
  assert.equal(DB.logs.length, 1, 'رفضُ السرّ يُسجَّل');
  assert.match(DB.logs[0].details, /سرّ الترويسة لا يطابق/);
  ok('سرّ غير مطابق يترك سطراً يقول السبب');
}

// ═══ السرّ غير مضبوط ⇐ الباب يفشل مغلقاً ═══
// كان الشرط `env.TELEGRAM_WEBHOOK_SECRET && …`، أي أن الفحص كلّه يُتخطّى
// حين لا يُضبط السرّ. والباب عامّ ومعرّف المحادثة يُخمَّن، فيكفي من يعرف
// الرابط أن يرسل تحديثاً مزوّراً لينشئ قيوداً في وافق.
{
  const DB = fakeDb();
  const res = await app.fetch(
    post(msg(555, 'دفعت 500')),
    { ...BASE, DB, TELEGRAM_WEBHOOK_SECRET: undefined },
    ctx()
  );
  assert.equal(res.status, 503, 'غياب السرّ خطأ إعداد لا إذن بالمرور');
  assert.match(DB.logs[0].details, /TELEGRAM_WEBHOOK_SECRET غير مضبوط/);
  ok('سرّ غير مضبوط يُغلق الباب ويقول السبب');
}

// ═══ تحديث بلا رسالة ═══
// كان يُسجَّل «unauthorized chat: undefined» فيُقرأ منعَ صلاحية، وهو نوعٌ
// غير معالَج أصلاً — والفرق بينهما يغيّر وجهة البحث كلّها.
{
  const DB = fakeDb();
  const res = await app.fetch(
    post({ update_id: 2, channel_post: { message_id: 1 } }),
    { ...BASE, DB },
    ctx()
  );
  assert.equal(res.status, 200);
  assert.equal(DB.logs[0].status, 'info');
  assert.match(DB.logs[0].details, /تحديث بلا رسالة — النوع: channel_post/);
  ok('تحديث بلا رسالة يُميَّز عن رفض الصلاحية');
}

// ═══ محادثة غير مصرّح لها ═══
// كان: ٢٠٠ صامت. والمستخدم يقرؤه «المنصة متوقفة» وهو إعدادٌ ناقص يُصلَح
// بسطر — لكنه يحتاج المعرّف ولا سبيل له إليه.
{
  const DB = fakeDb({ chats: [] });
  calls = [];
  const res = await app.fetch(post(msg(999, 'دفعت 500')), { ...BASE, DB }, ctx());
  assert.equal(res.status, 200);
  assert.match(DB.logs[0].details, /محادثة غير مصرّح لها: 999/);
  const sent = calls.find((c) => c.url.includes('/sendMessage'));
  assert.ok(sent, 'المرسِل يُخبَر');
  assert.match(sent.body.text, /999/, 'ومعه معرّف محادثته');
  ok('محادثة غير مصرّح لها تُخبَر بمعرّفها بدل الصمت');
}

// ═══ عطلٌ قبل إنشاء صفّ العملية ═══
// كان: أوّل ستين سطراً من المعالجة خارج `try`، فرفضُ الوعد داخل
// `waitUntil` لا يوقف شيئاً ولا يُسجَّل — صمتٌ تامّ.
{
  const DB = fakeDb({ chats: ['555'], failOn: 'INSERT INTO transactions' });
  calls = [];
  const c = ctx();
  const res = await app.fetch(post(msg(555, 'دفعت 500 ريال إيجار')), { ...BASE, DB }, c);
  assert.equal(res.status, 200);
  await Promise.all(c.settled);
  const sent = calls.find((x) => x.url.includes('/sendMessage'));
  assert.ok(sent, 'يصل المستخدم إشعار فشل');
  assert.match(sent.body.text, /تعذّرت معالجة الرسالة/);
  assert.ok(DB.logs.some((l) => l.action === 'process_error'), 'ويُسجَّل السبب');
  ok('عطلٌ قبل تسجيل العملية يُبلَّغ ولا يصمت');
}

// ═══ التشخيص يسمّي السبب ═══
{
  const r = await diagnoseWebhook({ ...BASE, DB: fakeDb(), TELEGRAM_WEBHOOK_SECRET: 's3cret' });
  assert.equal(r.healthy, false);
  assert.ok(r.problems.some((p) => /workers\.dev/.test(p)), 'يكشف رابطاً على نطاق سابق');
  assert.ok(
    r.problems.some((p) => /السرّ المسجّل عند تليجرام لا يطابق/.test(p)),
    'ويترجم ٤٠١ إلى سببه'
  );
  assert.ok(r.problems.some((p) => /تحديثاً معلّقاً/.test(p)), 'ويعدّ الطابور المتراكم');
  ok('التشخيص يسمّي السبب: نطاق سابق، سرّ مختلف، طابور متراكم');
}

// ═══ الحارس الليلي ═══
{
  const DB = fakeDb();
  calls = [];
  const out = await runWebhookWatchdog({ ...BASE, DB, AUTHORIZED_CHAT_IDS: '555' });
  assert.equal(out.repaired, true);
  assert.equal(tg.url, 'https://acc.naflaw.sa/api/telegram-webhook');
  const notice = calls.find((x) => x.url.includes('/sendMessage'));
  assert.match(notice.body.text, /صُحّح رابط الويبهوك/);
  assert.ok(DB.logs.some((l) => l.action === 'telegram_webhook'));
  ok('الحارس الليلي يصحّح الرابط ويُنبّه المسؤولين');
}

// ═══ ولا يُصلَح بالتخمين ═══
// بلا `PUBLIC_ORIGIN` يُبلَّغ العطل ولا يُخترع رابط: اشتقاقُه من نطاق الطلب
// يجعل أيّ مضيفٍ يبلغ الـWorker قادراً على تحويل البوت إليه.
{
  const DB = fakeDb();
  tg.url = 'https://someone-else.example/api/telegram-webhook';
  calls = [];
  const out = await runWebhookWatchdog({ TELEGRAM_BOT_TOKEN: 'tok', DB, AUTHORIZED_CHAT_IDS: '555' });
  assert.equal(out.repaired, null, 'لا إصلاح بلا مرجع');
  assert.equal(tg.url, 'https://someone-else.example/api/telegram-webhook', 'ولا يُمسّ الرابط');
  assert.ok(calls.some((x) => x.url.includes('/sendMessage')), 'لكنّ العطل يُبلَّغ');
  ok('بلا PUBLIC_ORIGIN: يُبلَّغ العطل ولا يُخمَّن رابط');
}

console.log(`\n${passed}/${passed} فحصاً مرّت.`);

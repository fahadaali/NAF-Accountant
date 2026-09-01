// ============================================================================
// عقد التقرير المالي — بلا شبكة وبلا نموذج توليدي.
//   npm run check:routes
//
// ═══ لماذا هذا الملف ═══
//
// التقرير المالي الشهري كان يُبنى بتمرير بيانات وافق إلى Claude ليُخرجها
// جداول. فتوقّف إصداره يوم نفد رصيد حساب Anthropic — عطلٌ في طرفٍ ثالث
// يُسقط تقريراً لا ذكاء في بنائه أصلاً. وهذه الاختبارات تحرس ما استُبدل به:
//
//   1. البناء حتميّ: نفس المُدخل يعطي نفس المُخرج، بلا نداء شبكة.
//   2. لا رقم يُخترع ولا يُحتسب — ما يظهر هو ما أرسلته وافق.
//   3. البنية المجهولة تُعرض ولا تُسقَط: مفتاحٌ لا تسمية مسجّلة له يظهر باسمه.
//   4. تعثّرُ قسمٍ لا يُسقط القسم الآخر، والنقص يُعلَن في متن التقرير.
//   5. خطأ Anthropic يُصنَّف فيقول ما حدث وما العمل.
//   6. المسار كلّه لا يمسّ api.anthropic.com — وهو بيت القصيد.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderFinancialReport, renderSection } from '../src/lib/report_render.js';
import { generateAndSendFinancialReport } from '../src/routes/reports.js';
import { diagnoseClaudeError } from '../src/services/claude.js';

const PERIOD = {
  kindLabel: 'شهري',
  periodLabel: 'يوليو 2026',
  after: '2026-07-01',
  before: '2026-07-31',
  currency: 'SAR',
};

const build = (sections) => renderFinancialReport({ ...PERIOD, sections });

// ---------------------------------------------------------------------------
// ١. حتميّة البناء
// ---------------------------------------------------------------------------

test('نفس المُدخل يعطي نفس المُخرج حرفياً', () => {
  const data = { results: [{ account_name: 'البنك', debit: '10.00', credit: '0.00' }] };
  const once = build([{ title: 'ميزان المراجعة', data }]);
  const twice = build([{ title: 'ميزان المراجعة', data }]);
  assert.equal(once, twice);
});

// ---------------------------------------------------------------------------
// ٢. الأرقام كما وردت — لا اختراع ولا احتساب
// ---------------------------------------------------------------------------

test('كل مبلغ يظهر كما ورد، بصيغة المبالغ المسجّلة وبالبديل «ر.س»', () => {
  const html = build([
    { title: 'الأرباح والخسائر', data: { results: [{ account_name: 'أتعاب', amount: '120000.5' }] } },
  ]);
  assert.match(html, /120,000\.50 ر\.س/);
  // رمز U+20C1 للواجهات وحدها — بيسكامب لا يحمّل خطّه.
  assert.ok(!html.includes('⃁'), 'لا رمز ريال في سطح طرف ثالث');
  assert.ok(!html.includes('﷼') && !html.includes(''), 'لا رمز ريال قديم ولا خاص');
});

test('لا مجموع يُحتسب هنا — يظهر ما أرسلته وافق فقط', () => {
  const html = build([
    {
      title: 'الأرباح والخسائر',
      data: { results: [{ account_name: 'أ', amount: 100 }, { account_name: 'ب', amount: 50 }] },
    },
  ]);
  assert.match(html, /100\.00 ر\.س/);
  assert.match(html, /50\.00 ر\.س/);
  assert.ok(!html.includes('150'), 'المجموع غير المرسَل لا يُشتقّ');
});

test('كل مبلغ وتاريخ معزول اتجاهياً', () => {
  const html = build([
    { title: 'الأرباح والخسائر', data: { results: [{ account_name: 'أتعاب', amount: 12 }] } },
  ]);
  assert.match(html, /⁨12\.00 ر\.س⁩/);
  assert.match(html, /⁨2026\/07\/01⁩/); // الفترة بالصيغة المسجّلة
});

test('الرقم غير المالي لا يلحقه رمز عملة', () => {
  const html = build([
    { title: 'الأرباح والخسائر', data: { results: [{ name: 'حسابات', count: 12, amount: 5 }] } },
  ]);
  assert.match(html, /count ⁨12⁩/);
  assert.match(html, /⁨5\.00 ر\.س⁩/);
});

// ---------------------------------------------------------------------------
// ٣. البنية المجهولة تُعرض ولا تُسقَط
// ---------------------------------------------------------------------------

test('الأشكال المختلفة كلها تُعرض — لا افتراض لمفاتيح بعينها', () => {
  const shapes = [
    { results: [{ account_name: 'أ', amount: 1 }] },
    { rows: [{ name: 'ب', balance: 2 }] },
    { sections: [{ name: 'الأصول', accounts: [{ account_name: 'ج', debit: 3, credit: 0 }] }] },
    [{ account_name: 'د', amount: 4 }],
    { data: { items: [{ title: 'هـ', total: 5 }] } },
  ];
  for (const data of shapes) {
    const html = renderSection('الأرباح والخسائر', { data }, 'SAR');
    assert.match(html, /<li>/, `شكل لم يُعرض: ${JSON.stringify(data)}`);
  }
});

test('المفتاح غير المسجّل يظهر باسمه ولا يُترجم بالتخمين', () => {
  const html = renderSection(
    'ميزان المراجعة',
    { data: { results: [{ account_name: 'البنك', opening_balance: '5.00', debit: '1.00' }] } },
    'SAR'
  );
  assert.match(html, /opening_balance ⁨5\.00 ر\.س⁩/);
  assert.match(html, /مدين ⁨1\.00 ر\.س⁩/); // «مدين» مسجّل في naf-terms
});

test('الحساب المتفرّع يُعرض بأبنائه', () => {
  const html = renderSection(
    'ميزان المراجعة',
    {
      data: {
        accounts: [
          {
            account_code: '1100',
            account_name: 'البنوك',
            debit: 250,
            children: [{ account_code: '1101', account_name: 'الراجحي', debit: 250 }],
          },
        ],
      },
    },
    'SAR'
  );
  // رمز الحساب معزول اتجاهياً — رقمٌ داخل جملة عربية.
  assert.match(html, /⁨1100⁩ · البنوك/);
  assert.match(html, /⁨1101⁩ · الراجحي/);
});

test('المرجع ذو الشرطات المائلة معزول — أخطر حالات الاختلاط', () => {
  const html = renderSection(
    'الأرباح والخسائر',
    { data: { results: [{ account_name: 'أتعاب', reference: '2291/ت/1447', amount: 1 }] } },
    'SAR'
  );
  assert.match(html, /⁨2291\/ت\/1447⁩/);
});

test('اسم الحساب يُهرَّب فلا يكسر متن الرسالة', () => {
  const html = renderSection(
    'الأرباح والخسائر',
    { data: { results: [{ account_name: '<b>خصم</b> & رسوم', amount: 1 }] } },
    'SAR'
  );
  assert.ok(!html.includes('<b>خصم</b>'), 'الوسم الوارد لا يُنفَّذ');
  assert.match(html, /&lt;b&gt;خصم&lt;\/b&gt; &amp; رسوم/);
});

test('ما يتجاوز السقف يُعلَن اقتطاعه', () => {
  const results = Array.from({ length: 400 }, (_, i) => ({ account_name: `ح${i}`, amount: i }));
  const html = renderSection('ميزان المراجعة', { data: { results } }, 'SAR');
  assert.match(html, /عُرض أول ⁨300⁩ بنداً من ⁨400⁩/);
});

test('الفترة بلا حركة تُقال صراحة', () => {
  assert.match(renderSection('الأرباح والخسائر', { data: { results: [] } }, 'SAR'), /لا حركة/);
  assert.match(renderSection('الأرباح والخسائر', { data: null }, 'SAR'), /لا حركة/);
});

test('بياناتٌ يتعذّر عرضها لا تُقال «لا حركة»', () => {
  let deep = { amount: 1 };
  for (let i = 0; i < 12; i += 1) deep = { children: [deep] };
  const html = renderSection('ميزان المراجعة', { data: deep }, 'SAR');
  assert.match(html, /يتعذّر عرضها/);
  assert.ok(!html.includes('لا حركة'), 'وجودُ بياناتٍ لا يُقال عنه عدم');
});

// ---------------------------------------------------------------------------
// ٤. تعثّر قسم لا يُسقط الآخر
// ---------------------------------------------------------------------------

test('القسم المتعثّر يُعلن سببه، والسليم يُنشر معه', () => {
  const html = build([
    { title: 'الأرباح والخسائر', data: { results: [{ account_name: 'أتعاب', amount: 9 }] } },
    { title: 'ميزان المراجعة', error: 'Wafeq report failed: 500' },
  ]);
  assert.match(html, /أتعاب/);
  assert.match(html, /تعذّر جلب هذا القسم/);
  assert.match(html, /Wafeq report failed: 500/);
});

test('العنوان والتذييل يذكران نوع التقرير وفترته', () => {
  const html = build([{ title: 'الأرباح والخسائر', data: { results: [] } }]);
  assert.match(html, /التقرير المالي \(شهري\) — يوليو 2026/);
  assert.match(html, /الفترة من ⁨2026\/07\/01⁩ إلى ⁨2026\/07\/31⁩/);
});

test('لا وسم جدول في متن بيسكامب — الجدول المُنقّى يفقد أعمدته', () => {
  const html = build([
    { title: 'ميزان المراجعة', data: { results: [{ account_name: 'البنك', debit: 1, credit: 0 }] } },
  ]);
  assert.ok(!/<t(able|r|d|h)\b/.test(html), 'الصفوف قوائم لا جداول');
});

// ---------------------------------------------------------------------------
// ٥. تصنيف خطأ Anthropic
// ---------------------------------------------------------------------------

test('نفاد الرصيد يُصنَّف ويقول ما يُعمل', () => {
  // متن الردّ الحقيقي الذي أوقف تقرير أول سبتمبر.
  const body = JSON.stringify({
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message:
        'Your credit balance is too low to access the Anthropic API. ' +
        'Please go to Plans & Billing to upgrade or purchase credits.',
    },
  });
  const diag = diagnoseClaudeError(400, body);
  assert.equal(diag.reason, 'billing');
  assert.match(diag.message, /رصيد/);
  assert.match(diag.message, /Plans & Billing/);
});

test('كل سبب يُميَّز عن غيره — علاج كلٍّ مختلف', () => {
  const cases = [
    [401, '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}', 'auth'],
    [403, '{"error":{"type":"permission_error","message":"no access"}}', 'permission'],
    [429, '{"error":{"type":"rate_limit_error","message":"rate limited"}}', 'rate_limit'],
    [529, '{"error":{"message":"Overloaded"}}', 'unavailable'],
    [500, 'upstream failure', 'unavailable'],
    [404, '{"error":{"message":"model claude-x not_found"}}', 'model'],
    [404, '<html>Not Found</html>', 'not_found'],
  ];
  for (const [status, body, reason] of cases) {
    assert.equal(diagnoseClaudeError(status, body).reason, reason, `${status} ${body}`);
  }
});

test('الرسالة عربية ولا تعتذر', () => {
  const messages = [
    diagnoseClaudeError(400, '{"error":{"message":"credit balance is too low"}}').message,
    diagnoseClaudeError(429, '{"error":{"message":"rate_limit"}}').message,
  ];
  for (const message of messages) {
    assert.match(message, /[؀-ۿ]/, 'الرسالة بالعربية');
    assert.ok(!/عذرا|عذراً|للأسف|نأسف/.test(message), 'الخطأ لا يعتذر — naf-terms §٤');
  }
});

// ---------------------------------------------------------------------------
// ٦. المسار كاملاً — بلا نداء إلى Anthropic
// ---------------------------------------------------------------------------

/** بيئة مصغّرة: قاعدة تبتلع الإدراج، وأسرار بيسكامب وحدها. */
function stubEnv() {
  const logs = [];
  return {
    logs,
    env: {
      WAFEQ_API_KEY: 'k',
      WAFEQ_CURRENCY: 'SAR',
      BASECAMP_TOKEN: 't',
      BASECAMP_ACCOUNT_ID: '1',
      BASECAMP_PROJECT_ID: '2',
      BASECAMP_MESSAGE_BOARD_ID: '3',
      DB: {
        prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: [] }) }) }),
      },
    },
  };
}

/** يعترض نداءات الشبكة ويسجّلها، ويردّ ردوداً معدّة حسب المضيف. */
function stubFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push(href);
    for (const [pattern, respond] of handlers) {
      if (href.includes(pattern)) return respond(href, init);
    }
    throw new Error(`نداء غير متوقّع: ${href}`);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('التقرير يصدر كاملاً دون أي نداء إلى Anthropic', async () => {
  const { env } = stubEnv();
  let posted = null;
  const net = stubFetch([
    ['profit-and-loss', () => json({ results: [{ account_name: 'أتعاب', amount: '120000.00' }] })],
    ['trial-balance', () => json({ results: [{ account_name: 'البنك', debit: '250000.00', credit: '0.00' }] })],
    ['basecampapi.com', (_href, init) => { posted = JSON.parse(init.body); return json({ id: 1 }); }],
  ]);

  try {
    const result = await generateAndSendFinancialReport(env, 'monthly');
    assert.deepEqual(result.missing, []);
    assert.match(posted.content, /120,000\.00 ر\.س/);
    assert.match(posted.content, /250,000\.00 ر\.س/);
    assert.ok(
      !net.calls.some((u) => u.includes('anthropic')),
      'لا نداء إلى Anthropic في مسار التقرير'
    );
  } finally {
    net.restore();
  }
});

test('تعثّر أحد التقريرين لا يمنع نشر الآخر', async () => {
  const { env } = stubEnv();
  let posted = null;
  const net = stubFetch([
    ['profit-and-loss', () => json({ results: [{ account_name: 'أتعاب', amount: '9.00' }] })],
    ['trial-balance', () => json({ detail: 'server error' }, 500)],
    ['basecampapi.com', (_href, init) => { posted = JSON.parse(init.body); return json({ id: 1 }); }],
  ]);

  try {
    const result = await generateAndSendFinancialReport(env, 'monthly');
    assert.deepEqual(result.missing, ['ميزان المراجعة']);
    assert.match(posted.content, /9\.00 ر\.س/); // ما وصل نُشر
    assert.match(posted.content, /تعذّر جلب هذا القسم/); // وما تعذّر قيل
  } finally {
    net.restore();
  }
});

test('تعثّر التقريرين معاً يرفع الخطأ ولا يَنشر متناً فارغاً', async () => {
  const { env } = stubEnv();
  let postedCount = 0;
  const net = stubFetch([
    ['profit-and-loss', () => json({ detail: 'down' }, 500)],
    ['trial-balance', () => json({ detail: 'down' }, 500)],
    ['basecampapi.com', () => { postedCount += 1; return json({ id: 1 }); }],
  ]);

  try {
    await assert.rejects(
      () => generateAndSendFinancialReport(env, 'monthly'),
      /تعذّر جلب بيانات التقرير/
    );
    assert.equal(postedCount, 0, 'لا رسالة تُنشر بلا بيانات');
  } finally {
    net.restore();
  }
});

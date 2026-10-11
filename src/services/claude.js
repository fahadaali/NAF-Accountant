// ============================================================================
// خدمة الذكاء الاصطناعي (Claude API) — محرّك التصنيف والتوجيه المحاسبي
// ============================================================================
//
// يصنّف Claude كل عملية إلى أحد ثلاثة مسارات ويُخرج JSON منظّماً:
//   - manual_journal : قيد يومية يدوي (رواتب، تحويلات صادرة عامة).
//   - purchase_bill  : فاتورة مشتريات (سداد / مشتريات).
//   - sales_invoice  : فاتورة بيع (وارد: دفعات / اشتراكات) + ضريبة 15%.
//
// كما يتولّى: تحليل التاريخ (مطلق أو نسبي مثل "أمس")، افتراض الحساب البنكي
// عند عدم ذكر حساب الدفع، وكشف البيانات الناقصة وصياغة سؤال لاستكمالها.
// ============================================================================
import { briefApiError } from '../lib/http.js';


function buildSystemPrompt(accounts, defaultBank, messageDateISO, vatPercent, baseCurrency) {
  const accountsList = accounts
    .map((a) => `- ${a.account_code} | ${a.account_name} (${a.account_type})`)
    .join('\n');

  const bankLine = defaultBank
    ? `${defaultBank.account_code} | ${defaultBank.account_name}`
    : '(غير محدّد — استخدم أنسب حساب بنكي/نقدي من القائمة ولا تسأل عنه)';

  return `أنت محاسب قانوني خبير في شركة ناف لو (شركة سعودية، عملة الدفاتر ${baseCurrency}). مهمتك تحليل العملية المالية الواردة وتوجيهها للمسار المحاسبي الصحيح في نظام وافق.

# شجرة الحسابات المتاحة (استخدم رموزها حصرياً، لا تخترع حسابات):
${accountsList}

# الحساب البنكي الافتراضي:
${bankLine}

# تاريخ الرسالة (استخدمه مرجعاً للتواريخ النسبية): ${messageDateISO}

# قواعد التوجيه (صنّف "type"):
1. "manual_journal" — صرف عادي أو تحويلات صادرة عامة (مثل الرواتب والأجور).
2. "purchase_bill" — أي سداد أو مشتريات أو مصروف لمورّد (فاتورة مشتريات).
3. "sales_invoice" — أي مبلغ وارد كسداد دفعات أو اشتراكات من عميل (فاتورة بيع)، وتُضاف عليه ضريبة قيمة مضافة ${vatPercent}%، ويجب تحديد اسم العميل.

# قاعدة حساب الدفع/الاستلام (صارمة — لا تخالفها):
- ⛔ لا تسأل إطلاقاً عن الحساب البنكي أو مصدر الدفع أو حساب الاستلام. عدم ذكره ليس بياناً ناقصاً.
- إذا لم يُذكر مصدر الدفع/الاستلام صراحةً، فهو دائماً الحساب البنكي الافتراضي أعلاه.
- استخدم حساباً آخر فقط إذا ذكره المستخدم صراحةً، مثل: "نقداً" أو "الصندوق" أو "الخزينة" أو "المصروفات النثرية" أو "sifi" أو أي اسم حساب في القائمة.

# قاعدة العملة (صارمة):
- العملة الافتراضية هي ${baseCurrency}. إن لم تُذكر عملة فاضبط "currency": "${baseCurrency}" ولا تسأل عنها.
- إن ذُكرت عملة أخرى — «دولار» أو «$» أو «USD» أو «يورو» أو «درهم» أو ما شابه، أو كانت
  الفاتورة المرفقة محرّرة بها — فاضبط "currency" برمزها الدولي (ISO 4217) بثلاثة أحرف كبيرة:
  دولار → USD، يورو → EUR، جنيه إسترليني → GBP، درهم إماراتي → AED، دينار كويتي → KWD.
- المبالغ في "amount" و"debit" و"credit" تبقى دائماً بعملة العملية نفسها. ⛔ لا تحوّلها بنفسك.
- "exchange_rate": املأه فقط إذا ذكر المستخدم سعر الصرف صراحةً («بسعر 3.78»، «الدولار بـ3.76»،
  أو رقماً مجرداً رداً على سؤال عن سعر الصرف في السياق السابق). وإلا اضبطه null.
- ⛔ لا تسأل عن سعر الصرف ولا تخترعه — النظام يتولّاه.

# قواعد عامة:
- التاريخ: إن ذُكر تاريخ صريح أو نسبي ("أمس"، "الثلاثاء الماضي"، "قبل يومين") فحوّله إلى YYYY-MM-DD بناءً على تاريخ الرسالة. وإن لم يُذكر تاريخ فاستخدم تاريخ الرسالة.
- قيم القيد اليدوي يجب أن تتوازن (مجموع المدين = مجموع الدائن).
- لفاتورة البيع: احسب الضريبة ${vatPercent}% على قيمة البنود.
- لفاتورة المشتريات: اضبط "vat_percent" = ${vatPercent} إذا كانت الفاتورة تحتوي ضريبة قيمة مضافة
  (وهو الأصل لمعظم المشتريات من منشآت مسجّلة)، واضبطها 0 إذا ذُكر صراحةً «بدون ضريبة»
  أو كان المورّد غير مسجّل في الضريبة.
- المورّد (لفاتورة المشتريات) والعميل (لفاتورة البيع) حقلٌ إلزامي في وافق (contact_name).

# البيانات الناقصة (اسأل عن الجوهري المفقود فقط):
- اسأل عند نقص أيٍّ من: المبلغ؛ أو اسم المورّد لفاتورة المشتريات؛ أو اسم العميل لفاتورة البيع.
  (مثال: "شرينا أدوات بـ200 ريال" بلا مورّد → اسأل: من أي مورّد تم الشراء؟)
- ⛔ لا تسأل عن حساب الدفع/الاستلام (الافتراضي البنكي)، ولا عن نوع المصروف (استنتجه واختر أنسب حساب من القائمة).
- إن توفّرت البيانات الجوهرية (المبلغ + المورّد/العميل حسب النوع)، اضبط "status":"ready" وأكمل دون سؤال.

# الفواتير المرفقة (صورة أو PDF):
- اقرأ الفاتورة كما هي مطبوعة: الأرقام الهندية (٠١٢٣٤٥٦٧٨٩) تُكتب بالأرقام الغربية، والفاصلة
  العربية (٫ ،) تُفهم فاصلةً عشرية أو فاصلة آلاف حسب موضعها.
- التاريخ الهجري يُحوَّل إلى ما يقابله بالميلادي. وإن طُبع التاريخان فاعتمد الميلادي المطبوع.
- إيصالات الورق الحراري الباهتة وخط اليد: اقرأ ما تستطيع قراءته بثقة فقط.
- ⛔ لا تخمّن رقماً لا تقرؤه. إن تعذّرت قراءة المبلغ الإجمالي أو اسم المورّد/العميل فاضبط
  "status":"need_more" واسأل عن الناقص تحديداً، واذكره في "unreadable_fields".
- "readability": "clear" إن قُرئت الفاتورة كاملة، و"partial" إن غمض بعضها، و"unreadable" إن
  تعذّرت قراءتها أصلاً (صورة مهزوزة أو مظلمة أو مقصوصة أو ليست فاتورة).
- انقل من الفاتورة: رقمها ("invoice_number")، والرقم الضريبي للمورّد ("supplier_vat_number" —
  ١٥ رقماً)، والمجاميع كما طُبعت حرفياً: قبل الضريبة ("printed_subtotal")، والضريبة
  ("printed_vat")، والإجمالي ("printed_total"). ما لم يُطبع منها اتركه null.
- ⚠️ مبالغ البنود ("amount") تُكتب دائماً **قبل الضريبة** — النظام يضيف الضريبة بنفسه.
  فإن كانت أسعار الفاتورة شاملة الضريبة فاقسم كل مبلغ على (1 + ${vatPercent}/100) وقرّبه
  لمنزلتين، واضبط "amounts_include_vat": true. وإن كانت قبل الضريبة فاضبطها false.
- في رسالة نصية بلا مرفق: المبلغ الذي يذكره المستخدم هو قيمة العملية قبل الضريبة إلا إن قال
  «شامل الضريبة»، والحقول المطبوعة كلها null، و"readability": "clear".

# صيغة الإخراج:
سجّل النتيجة باستدعاء الأداة record_transaction وحدها، ولا تكتب نصاً خارجها.
املأ فقط الكائن المطابق لـ "type" واترك الآخرين بمصفوفات فارغة.`;
}

// اسم النموذج الافتراضي في موضع واحد — كان مكرّراً في خمسة نداءات، وتحديثُ
// أحدها يترك أربعة خلفه.
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * تشخيص ردّ خطأ من واجهة Anthropic: ما حدث وما العمل.
 *
 * كان الخطأ يُمرَّر خاماً: «API failed: 400 {"type":"error","error":{...}}»
 * مبتوراً عند ٢٢٠ محرفاً. فرسالةُ المسؤول تُخفي نصف السبب، ولا تقول ما
 * يُعمل — ونفادُ الرصيد وانقطاعُ الخدمة وبطلانُ المفتاح تظهر كلّها بصورة
 * واحدة، مع أن علاج كلٍّ منها مختلف: الأول شحنٌ، والثاني انتظار، والثالث
 * تبديلُ سرّ. فتُقرأ حالة الردّ ورسالتها ويُقال أيّها وقع.
 *
 * @param {number} status رمز حالة HTTP.
 * @param {string} body   متن الردّ.
 * @returns {{reason:string, message:string}} سبب مصنّف، ورسالة عربية صالحة للعرض.
 */
export function diagnoseClaudeError(status, body) {
  let apiMessage = '';
  try {
    apiMessage = JSON.parse(String(body || ''))?.error?.message || '';
  } catch (_) {
    /* ردّ غير JSON (صفحة وسيط مثلاً) — يُلخَّص خاماً أدناه. */
  }
  const detail = apiMessage || briefApiError(body);
  const low = String(apiMessage || body || '').toLowerCase();

  if (/credit balance is too low|insufficient (credit|funds|balance)|billing/.test(low)) {
    return {
      reason: 'billing',
      message:
        'رصيد حساب Anthropic نفد، فتوقّف التحليل الآلي. اشحن الرصيد من ' +
        '«Plans & Billing» في لوحة Anthropic ثم أعد المحاولة.',
    };
  }
  if (status === 401 || /authentication_error|invalid x-api-key/.test(low)) {
    return {
      reason: 'auth',
      message:
        'مفتاح CLAUDE_API_KEY مرفوض. حدّثه في أسرار Cloudflare ' +
        '(wrangler secret put CLAUDE_API_KEY) ثم أعد المحاولة.',
    };
  }
  if (status === 403 || /permission_error/.test(low)) {
    return {
      reason: 'permission',
      message: `مفتاح CLAUDE_API_KEY لا يملك صلاحية هذا الطلب: ${detail}`,
    };
  }
  if (/model/.test(low) && /not[_ ]found|does not exist|unknown model/.test(low)) {
    return {
      reason: 'model',
      message:
        `النموذج المضبوط في CLAUDE_MODEL غير متاح لهذا المفتاح: ${detail}. ` +
        'صحّح الاسم في إعدادات العامل.',
    };
  }
  if (status === 404) {
    // 404 بلا ذكر نموذج يعني مساراً خاطئاً لا نموذجاً مفقوداً — والفرق
    // يحدّد أي إعداد يُراجَع.
    return {
      reason: 'not_found',
      message: `مسار واجهة Claude غير موجود (404). راجع CLAUDE_API_BASE و CLAUDE_MODEL: ${detail}`,
    };
  }
  if (status === 429 || /rate_limit/.test(low)) {
    return {
      reason: 'rate_limit',
      message: 'تجاوزت الطلبات حدّ المعدّل في Anthropic. أعد المحاولة بعد دقائق.',
    };
  }
  if (status === 529 || /overloaded/.test(low) || status >= 500) {
    return {
      reason: 'unavailable',
      message: `خدمة Claude غير متاحة مؤقتاً (رمز ${status}). أعد المحاولة بعد قليل.`,
    };
  }
  return { reason: 'unknown', message: `تعذّر الاتصال بخدمة Claude (رمز ${status}): ${detail}` };
}

/* ═══ إعادة المحاولة عند الضغط العابر ═══

   ٤٢٩ (حدّ المعدّل) و٥٢٩ (ضغط الخدمة) و٥xx أعطالٌ عابرة توصي Anthropic
   بإعادة المحاولة عندها، وكانت تُفشل العملية من أول ردّ فيُطلب من المستخدم
   إعادة الإرسال يدوياً. فتُعاد مرتين بانتظارٍ متزايد يحترم `retry-after`.

   والمعالجة تجري في `waitUntil` بعد ردّ الويبهوك، ووقتها محدود؛ فلا إعادة
   بعد أن يتجاوز الطلب الأول ميزانيته — انتظارٌ يُسقط العملية كلّها عند حدّ
   المنصة أسوأ من خطأٍ واضح الآن. */
const RETRY_WAITS_MS = [2000, 5000];
const RETRY_BUDGET_MS = 12000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransientStatus(status) {
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

async function fetchWithRetry(url, init) {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    const wait = RETRY_WAITS_MS[attempt];
    if (!isTransientStatus(res.status) || wait === undefined) return res;
    const after = Number(res.headers?.get?.('retry-after')) * 1000;
    const delay = Math.min(Number.isFinite(after) && after > 0 ? after : wait, 10000);
    if (Date.now() - started + delay > RETRY_BUDGET_MS) return res;
    await sleep(delay);
  }
}

/**
 * نداء واحد إلى Claude يمرّ منه كل استدعاء في هذا الملف.
 *
 * ═══ فحص stop_reason ═══
 *
 * بلوغ `max_tokens` يعني رداً مبتوراً، وكان يمرّ صامتاً في كل المواضع:
 * فيُحلَّل نصٌّ صوتيّ ناقص كأنه كامل، ويُقرأ نصفُ عمليةٍ على أنه العملية.
 * والبتر لا يُميَّز من الاكتمال إلا من هذا الحقل.
 *
 * ═══ تصنيف الخطأ ═══
 *
 * وردّ الخطأ يمرّ بـ`diagnoseClaudeError` أعلاه، فيصل المستخدمَ والمسؤولَ
 * سببٌ عربيّ يقول ما يُعمل، لا متنُ JSON إنجليزيّ مبتور.
 *
 * @param {object} opts
 * @param {string} opts.system
 * @param {string|Array} opts.content نصّ، أو مصفوفة كتل (لإرسال صورة).
 * @param {number} opts.maxTokens
 * @param {string} [opts.label] اسم يظهر في رسالة الخطأ.
 * @param {object} [opts.extra] حقول إضافية في جسم الطلب (أدوات، حرارة).
 * @returns {Promise<object>} ردّ الواجهة كاملاً بعد فحص stop_reason.
 */
async function requestClaude(env, { system, content, maxTokens = 2048, label = 'Claude', extra = {} }) {
  const res = await fetchWithRetry(`${env.CLAUDE_API_BASE || 'https://api.anthropic.com/v1'}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: 'user',
          content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
        },
      ],
      ...extra,
    }),
  });

  if (!res.ok) {
    const diag = diagnoseClaudeError(res.status, await res.text());
    const err = new Error(`${label}: ${diag.message}`);
    err.reason = diag.reason;
    err.status = res.status;
    throw err;
  }

  const data = await res.json();

  if (data.stop_reason === 'max_tokens') {
    throw new Error(
      `${label}: الرد بلغ حدّ ${maxTokens} رمزاً فجاء مبتوراً. قسّم المُدخل أو ارفع الحدّ.`
    );
  }
  if (data.stop_reason === 'refusal') {
    throw new Error(`${label}: رفض النموذج إكمال الطلب.`);
  }
  return data;
}

/** نداء يُرجع نصّ الردّ — للمهام اللغوية الحرّة (تدقيق، مطابقة، تصنيف). */
async function callClaude(env, opts) {
  const data = await requestClaude(env, opts);
  return (data.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

/**
 * نداء يُلزم النموذج بأداة واحدة ويُرجع مُدخلاتها كائناً جاهزاً.
 *
 * ═══ لماذا أداة لا JSON حرّ ═══
 *
 * كان ردّ التحليل نصّاً يُقصّ ما بين أول `{` وآخر `}` ثم يُحلَّل. فجملةٌ
 * قبل الكائن تحوي قوساً، أو فاصلةٌ زائدة، تُفشل العملية كلّها بـ«تعذّر
 * تحليل رد Claude». والأداة المُلزَمة تُرجع كائناً مُحلَّلاً بمخطّطٍ معروف،
 * والحرارة صفر لأن قراءة فاتورة لا تحتمل الإبداع.
 */
async function callClaudeTool(env, { tool, ...opts }) {
  const data = await requestClaude(env, {
    ...opts,
    extra: {
      temperature: 0,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    },
  });
  const block = (data.content || []).find((c) => c.type === 'tool_use' && c.name === tool.name);
  if (!block || !block.input || typeof block.input !== 'object') {
    throw new Error(`${opts.label || 'Claude'}: لم يُرجع النموذج نتيجة منظّمة.`);
  }
  return block.input;
}

function extractJson(text) {
  const trimmed = (text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('تعذّر تحليل رد Claude كـ JSON: ' + trimmed.slice(0, 200));
  }
}

/* ═══ مخطّط نتيجة التحليل ═══

   نفس شكل `processed_json` المحفوظ مع كل عملية — تقرؤه رسائل التأكيد
   والترحيل والتقارير كما هو — وتُضاف إليه حقول القراءة من الفاتورة: رقمها،
   والرقم الضريبي للمورّد، ومجاميعها كما طُبعت. هذه الأخيرة لا تُرحَّل؛
   تُقارَن بما يُرحَّل (`src/lib/extraction_check.js`). */
const LINE_ITEM = {
  type: 'object',
  properties: {
    account_code: { type: 'string' },
    account_name: { type: 'string' },
    description: { type: 'string' },
    amount: { type: 'number', description: 'المبلغ قبل الضريبة بعملة العملية' },
    quantity: { type: ['number', 'null'] },
    unit_price: { type: ['number', 'null'] },
  },
  required: ['account_code', 'account_name', 'description', 'amount'],
};

const RECORD_TRANSACTION_TOOL = {
  name: 'record_transaction',
  description: 'تسجيل نتيجة تحليل العملية المالية وتوجيهها في وافق.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ready', 'need_more'] },
      question: { type: ['string', 'null'] },
      type: { type: 'string', enum: ['manual_journal', 'purchase_bill', 'sales_invoice'] },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      contact_name: { type: ['string', 'null'] },
      currency: { type: 'string', description: 'ISO 4217' },
      exchange_rate: { type: ['number', 'null'] },
      summary: { type: 'string' },
      invoice_number: { type: ['string', 'null'] },
      supplier_vat_number: { type: ['string', 'null'] },
      printed_subtotal: { type: ['number', 'null'] },
      printed_vat: { type: ['number', 'null'] },
      printed_total: { type: ['number', 'null'] },
      amounts_include_vat: { type: 'boolean' },
      readability: { type: 'string', enum: ['clear', 'partial', 'unreadable'] },
      unreadable_fields: { type: 'array', items: { type: 'string' } },
      manual_journal: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                account_code: { type: 'string' },
                account_name: { type: 'string' },
                debit: { type: 'number' },
                credit: { type: 'number' },
                description: { type: 'string' },
              },
              required: ['account_code', 'account_name', 'debit', 'credit'],
            },
          },
        },
        required: ['entries'],
      },
      bill: {
        type: 'object',
        properties: {
          line_items: { type: 'array', items: LINE_ITEM },
          vat_percent: { type: 'number' },
        },
        required: ['line_items', 'vat_percent'],
      },
      invoice: {
        type: 'object',
        properties: {
          line_items: { type: 'array', items: LINE_ITEM },
          vat_percent: { type: 'number' },
        },
        required: ['line_items', 'vat_percent'],
      },
    },
    required: ['status', 'type', 'date', 'currency', 'summary', 'readability'],
  },
};

/** كتلة مرفق واحد بصيغة واجهة Claude. */
function mediaBlock(m) {
  return {
    type: m.kind === 'document' ? 'document' : 'image',
    source: { type: 'base64', media_type: m.mediaType, data: m.base64 },
  };
}

/**
 * تحليل عملية وتصنيفها.
 * @param {object} opts
 * @param {Array}  opts.accounts       شجرة الحسابات النشطة.
 * @param {object|null} opts.defaultBank الحساب البنكي الافتراضي {account_code, account_name}.
 * @param {string} opts.messageDateISO تاريخ الرسالة YYYY-MM-DD.
 * @param {number} opts.vatPercent     نسبة الضريبة (مثل 15).
 * @param {string} opts.baseCurrency   عملة الدفاتر الأساسية (مثل SAR).
 * @param {string} opts.text           نص العملية الحالي.
 * @param {object|Array|null} opts.media  { kind:'image'|'document', mediaType, base64 } لتحليل فاتورة
 *                                      مصوّرة أو ملف PDF، أو مصفوفة منها لصفحات فاتورة واحدة
 *                                      (ألبوم صور). الصور تُرسل ككتل image، وملفات PDF ككتلة
 *                                      document يقرأها Claude نصّاً ورؤيةً لكل صفحة.
 * @param {string|null} opts.priorContext  سياق سابق متراكم (عند استكمال حوار ناقص).
 * @param {object|null} [opts.priorResult]  نتيجة الجولة السابقة من الحوار نفسه، تُحدَّث لا تُعاد.
 * @param {{previous:object, prompt:string}|null} [opts.correction] إعادة قراءة بعد مراجعة
 *                                      حسابية كشفت خللاً (`src/lib/extraction_check.js`).
 * @returns {Promise<object>} كائن التصنيف المنظّم.
 */
export async function analyzeTransaction(env, opts) {
  const {
    accounts,
    defaultBank,
    messageDateISO,
    vatPercent,
    baseCurrency,
    text,
    media,
    priorContext,
    priorResult,
    correction,
  } = opts;
  const system = buildSystemPrompt(accounts, defaultBank, messageDateISO, vatPercent, baseCurrency);

  const files = (Array.isArray(media) ? media : media ? [media] : []).filter(Boolean);
  const userContent = files.map(mediaBlock);

  let userText = '';
  if (priorContext) {
    userText += `# سياق سابق من نفس المحادثة (عملية غير مكتملة):\n${priorContext}\n\n`;
    // القراءة السابقة للمرفق تُبنى عليها الجولة: كانت كل جولة تقرأ الفاتورة
    // من الصفر، فيتغيّر ما صحّ فيها بين جواب وآخر.
    if (priorResult) {
      userText +=
        `# قراءتك السابقة للعملية — حدّثها بما في الرسالة الجديدة، وأبقِ ما لم يتغيّر:\n` +
        `${JSON.stringify(priorResult)}\n\n`;
    }
    userText += `# رسالة المستخدم الجديدة لاستكمال الناقص:\n`;
  }
  userText += text || '';
  if (files.some((m) => m.kind === 'document')) {
    userText +=
      '\n\n(المرفق ملف PDF لفاتورة وقد يكون متعدد الصفحات — استخرج بياناتها: المورّد/العميل، ' +
      'رقم الفاتورة وتاريخها، الرقم الضريبي، البنود، المجاميع المطبوعة. إن حوى الملف أكثر من ' +
      'فاتورة فاعتمد الأولى واذكر ذلك في "summary".)';
  } else if (files.length > 1) {
    userText +=
      `\n\n(المرفق ${files.length} صور لفاتورة واحدة بالترتيب — صفحاتها أو أجزاؤها. اجمعها ` +
      'فاتورةً واحدة: لا تكرّر بنداً ظهر في صورتين، والمجاميع من الصفحة التي تحملها.)';
  } else if (files.length === 1) {
    userText +=
      '\n\n(المرفق صورة فاتورة — استخرج بياناتها: المورّد/العميل، رقم الفاتورة وتاريخها، ' +
      'الرقم الضريبي، البنود، المجاميع المطبوعة.)';
  }
  // إعادة القراءة بعد مراجعة حسابية: النتيجة السابقة وما اختلّ فيها.
  if (correction) {
    userText +=
      `\n\n# قراءتك السابقة:\n${JSON.stringify(correction.previous)}\n\n${correction.prompt}`;
  }
  userContent.push({ type: 'text', text: userText || '(بدون نص)' });

  const result = await callClaudeTool(env, {
    system,
    content: userContent,
    tool: RECORD_TRANSACTION_TOOL,
    // فاتورة طويلة البنود تتجاوز ٢٠٤٨ رمزاً فتُبتر — والمرفق مظنّتها.
    maxTokens: files.length ? 4096 : 2048,
    label: 'تحليل العملية',
  });

  if (!result || !result.type) {
    throw new Error('رد Claude لا يحتوي على تصنيف صالح');
  }
  return result;
}

/**
 * تصحيح نص مُفرّغ من الصوت عبر Claude في السياق المحاسبي.
 * يصلح الكلمات والمصطلحات المشوّهة دون اختراع معلومات.
 * عند أي فشل يُعيد النص الأصلي (لا يكسر التدفق).
 */
export async function refineTranscript(env, rawText) {
  const text = (rawText || '').trim();
  if (!text) return text;

  const system = `أنت مدقّق لنصوص مُفرّغة آلياً من الصوت في سياق محاسبي عربي سعودي (شركة ناف القانونية، العملة ريال سعودي).
النص التالي مُفرّغ آلياً وقد يحوي أخطاء تفريغ (كلمات متشابهة صوتياً، مصطلحات محاسبية مكتوبة خطأً، أرقام مكتوبة كلمات).
مهمتك تصحيح النص بأقل تدخّل:
- صحّح الكلمات المشوّهة والمصطلحات المحاسبية (قيد، مدين، دائن، فاتورة، ضريبة القيمة المضافة، إيجار، رواتب، سداد، مشتريات، الصندوق، الخزينة، المصروفات النثرية، تحويل).
- حوّل الأرقام المكتوبة كلمات إلى ما يقابلها بوضوح إن كان جلياً (مثل: «ألفين» تبقى كما هي أو تُكتب 2000 إن ناسب السياق) لكن لا تخترع رقماً غير موجود.
- ⛔ لا تُضِف أي معلومة غير موجودة، ولا تغيّر الأسماء أو المبالغ إلا إذا كانت مشوّهة بوضوح.
- أعد النص المصحّح فقط، دون أي شرح أو مقدمة أو تنسيق.`;

  try {
    // الحدّ يتبع طول النصّ: تفريغُ مقطعٍ طويل كان يُبتر عند 1024 بصمت،
    // فيُحلَّل نصفُ العملية على أنه العملية.
    const maxTokens = Math.min(4096, Math.max(1024, Math.ceil(text.length / 2) + 512));
    const out = await callClaude(env, { system, content: text, maxTokens, label: 'تدقيق التفريغ' });
    return out || text;
  } catch (_) {
    // التدقيق تحسينٌ لا شرط — عند أي فشل (ومنه البتر) يبقى النصّ الأصلي.
    return text;
  }
}

/**
 * مطابقة اسم جهة اتصال مذكور مع قائمة جهات الاتصال الموجودة عبر Claude.
 * يتعامل مع الأسماء الجزئية/المختصرة/المعاد ترتيبها.
 * @param {string} mentionedName
 * @param {Array<{id,name}>} candidates
 * @returns {Promise<{decision:'match'|'new'|'ambiguous', index:number, candidates:number[]}>}
 *   index: رقم المطابقة (1-based) أو 0 للجديد. candidates: أرقام الاحتمالات عند التعدد.
 */
export async function matchContactWithClaude(env, mentionedName, candidates) {
  const numbered = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');

  const system = `أنت مساعد لمطابقة أسماء جهات الاتصال (عملاء/موردين) في نظام محاسبي عربي.
المستخدم يذكر اسماً قد يكون مختصراً أو جزئياً أو بترتيب مختلف عن الاسم المسجّل.
أمثلة على المطابقة الصحيحة:
- "جرير" ↔ "شركة جرير"
- "شركة بن عوض" ↔ "شركة بن عوض التجارية العالمية"
- "محمد العبدالله" ↔ "محمد بن خالد العبدالله"
مهمتك: تحديد إن كان الاسم المذكور يشير إلى إحدى جهات الاتصال الموجودة.

أرجع JSON فقط بهذا الشكل (بدون أي نص آخر):
{ "decision": "match" | "new" | "ambiguous", "index": <رقم المطابقة 1..N أو 0>, "candidates": [أرقام] }

القواعد:
- إن طابق جهة واحدة بثقة عالية → "match" مع index رقمها.
- إن لم يطابق أي جهة (اسم جديد فعلاً) → "new" مع index=0.
- إن كان هناك أكثر من احتمال قوي ولا يمكن الجزم → "ambiguous" مع candidates تحوي أرقام الاحتمالات.
- كن حذراً: لا تطابق بمجرد تشابه كلمة عامة (مثل "شركة" أو "مؤسسة" أو اسم أول شائع وحده).`;

  const user = `الاسم المذكور: "${mentionedName}"

جهات الاتصال الموجودة:
${numbered}`;

  let textPart;
  try {
    textPart = await callClaude(env, {
      system,
      content: user,
      maxTokens: 300,
      label: 'مطابقة جهة الاتصال',
    });
  } catch (_) {
    // عند فشل المطابقة الذكية، اعتبرها جديدة (الأكثر أماناً من نسبها لخطأ).
    return { decision: 'new', index: 0, candidates: [] };
  }

  try {
    const parsed = extractJson(textPart);
    return {
      decision: parsed.decision || 'new',
      index: Number(parsed.index || 0),
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.map(Number) : [],
    };
  } catch (_) {
    return { decision: 'new', index: 0, candidates: [] };
  }
}

/* ═══ تنسيق التقرير المالي لم يعد هنا ═══

   كانت `formatFinancialReport` تمرّر JSON تقريري وافق إلى Claude ليُخرجهما
   جداول HTML. فارتبط التقرير الشهري بحساب Anthropic بلا داعٍ: نفادُ الرصيد
   أوقف إصدار التقرير كلَّه («credit balance is too low»، رمز 400)، وهو عملٌ
   لا ذكاء فيه — تحويلُ جدولٍ إلى جدول. وأخطرُ منه أنّ أرقام تقريرٍ ماليّ
   رسميّ كانت تمرّ عبر نموذج توليدي، وحدُّ الرموز يبترها في منتصف صفّ.

   البناء الآن حتميّ في `src/lib/report_render.js`. ولا يُعاد هنا: كلّ ما
   يُنادى في هذا الملف يحتاج حكماً لغوياً لا يُكتب شرطاً — والتنسيق ليس منه. */


/**
 * تحديد نيّة الرسالة (جديدة/تعديل/حذف) والهدف المقصود.
 * @param {string} text - رسالة المستخدم.
 * @param {Array} recent - آخر العمليات المُرحّلة [{wafeqId, result}] للسياق.
 * @returns {Promise<{intent:'new'|'edit'|'delete', instruction:string, target:object}>}
 */
export async function classifyFollowUp(env, text, recent) {
  const list = recent
    .map((t, i) => {
      const pos = i === 0 ? 'الأخيرة' : i === 1 ? 'قبل الأخيرة' : `رقم ${i + 1} من الآخر`;
      return `${i + 1}. [${pos}] ${t.result.type} | ${t.result.summary || ''} | ${t.result.contact_name || '—'} | ${t.result.date || ''} | معرّف: ${t.wafeqId}`;
    })
    .join('\n');

  const system = `أنت مساعد يحدّد نيّة رسالة المستخدم في نظام محاسبي عربي، والعملية المقصودة.

# النوايا:
- "edit"   : تعديل عملية سابقة (المبلغ، الضريبة، الحساب، المورّد/العميل، التاريخ، نوع العملية...).
- "delete" : حذف/إلغاء عملية سابقة (أو عدة عمليات).
- "new"    : عملية مالية جديدة مستقلة.

# الهدف (target) — حدّد كيف أشار المستخدم للعملية:
- { "mode": "last" }                    : لم يحدّد، أو قال "الأخيرة"/"القيد"/"الفاتورة".
- { "mode": "nth", "n": 2 }             : "قبل الأخيرة" (n=2)، "الثالثة من الآخر" (n=3)، وهكذا.
- { "mode": "id", "id": "mjou_xxx" }    : ذكر رقم/معرّف المسودة صراحةً.
- { "mode": "search", "query": "جرير" } : أشار بالاسم أو الوصف ("فاتورة جرير").
- { "mode": "all_drafts" }              : طلب شاملاً لكل المسودات ("احذف جميع المسودات").

# أمثلة:
- "عدل المبلغ إلى 600"                → edit,  target: last
- "خله بدون ضريبة"                    → edit,  target: last
- "عدل المسودة قبل الأخيرة المبلغ 900" → edit,  target: nth n=2
- "احذف القيد"                         → delete, target: last
- "احذف المسودة mjou_abc123"           → delete, target: id
- "احذف فاتورة جرير"                   → delete, target: search query="جرير"
- "احذف جميع المسودات في وافق"          → delete, target: all_drafts
- "شريت أدوات بـ200 من جرير"           → new

أرجع JSON فقط:
{ "intent": "new"|"edit"|"delete", "instruction": "وصف التعديل بالعربية أو نص فارغ", "target": { "mode": "...", "n": 1, "id": "", "query": "" } }
لا تضف أي شرح خارج JSON.`;

  const user = `# آخر العمليات المُرحّلة (الأحدث أولاً):
${list || '(لا يوجد)'}

# رسالة المستخدم:
${text}`;

  try {
    const out = await callClaude(env, { system, content: user, maxTokens: 600, label: 'تصنيف النيّة' });
    const parsed = extractJson(out);
    const intent = ['new', 'edit', 'delete'].includes(parsed.intent) ? parsed.intent : 'new';
    const t = parsed.target || {};
    const mode = ['last', 'nth', 'id', 'search', 'all_drafts'].includes(t.mode) ? t.mode : 'last';
    return {
      intent,
      instruction: parsed.instruction || text,
      target: { mode, n: Number(t.n) || 1, id: t.id || '', query: t.query || '' },
    };
  } catch (_) {
    // عند أي فشل، اعتبرها عملية جديدة (الأكثر أماناً — لا نحذف/نعدّل بالخطأ).
    return { intent: 'new', instruction: '', target: { mode: 'last' } };
  }
}

/**
 * تطبيق تعديل على عملية سابقة وإنتاج نتيجة كاملة مصحّحة (نفس صيغة analyzeTransaction).
 * @param {object} opts { accounts, defaultBank, vatPercent, baseCurrency, previous, instruction }
 */
export async function applyEdit(env, opts) {
  const { accounts, defaultBank, vatPercent, baseCurrency, previous, instruction } = opts;
  const accountsList = accounts
    .map((a) => `- ${a.account_code} | ${a.account_name} (${a.account_type})`)
    .join('\n');
  const bankLine = defaultBank
    ? `${defaultBank.account_code} | ${defaultBank.account_name}`
    : '(غير محدّد)';

  const system = `أنت محاسب قانوني خبير في شركة ناف القانونية (السعودية، عملة الدفاتر ${baseCurrency}).
لديك عملية محاسبية سابقة، وطلب تعديل عليها. مهمتك إنتاج نسخة كاملة معدّلة من العملية.

# شجرة الحسابات المتاحة (استخدم رموزها حصرياً):
${accountsList}

# الحساب البنكي الافتراضي: ${bankLine}

# قواعد:
- طبّق التعديل المطلوب فقط، وأبقِ بقية الحقول كما هي.
- إن غُيّر المبلغ، أعِد حساب الضريبة (${vatPercent}% لفاتورة البيع) والتوازن (للقيد اليدوي: مجموع المدين = مجموع الدائن).
- إن طُلب "بدون ضريبة" لفاتورة بيع، اجعل vat_percent = 0.
- العملة: أبقِ "currency" كما هي إلا إن طلب التعديل تغييرها صراحةً («خلّها بالدولار»)، فاضبطها
  برمزها الدولي. المبالغ تبقى بعملة العملية — ⛔ لا تحوّلها. و"exchange_rate" لا يُملأ إلا إن
  ذكر المستخدم سعراً صريحاً، وإلا فانقله كما كان.
- يمكن تغيير نوع العملية (type) إذا كان التعديل يقتضيه.
- المورّد/العميل (contact_name) إلزامي للفواتير.
- ⛔ لا تسأل عن شيء — أنتج أفضل نسخة معدّلة. اضبط "status":"ready" دائماً.

# أرجع JSON صحيحاً فقط بنفس الصيغة التالية (بدون Markdown أو شرح):
{
  "status": "ready",
  "question": null,
  "type": "manual_journal" | "purchase_bill" | "sales_invoice",
  "date": "YYYY-MM-DD",
  "contact_name": "الاسم أو null",
  "currency": "${baseCurrency}",
  "exchange_rate": null,
  "summary": "وصف موجز بالعربية",
  "manual_journal": { "entries": [ { "account_code": "..", "account_name": "..", "debit": 0, "credit": 0, "description": ".." } ] },
  "bill": { "line_items": [ { "account_code": "..", "account_name": "..", "description": "..", "amount": 0 } ], "vat_percent": ${vatPercent} },
  "invoice": { "line_items": [ { "account_code": "..", "account_name": "..", "description": "..", "amount": 0 } ], "vat_percent": ${vatPercent} }
}
املأ فقط الكائن المطابق لـ type واترك الآخرين بمصفوفات فارغة.`;

  const user = `# العملية السابقة (JSON):
${JSON.stringify(previous)}

# التعديل المطلوب:
${instruction}`;

  const out = await callClaude(env, { system, content: user, maxTokens: 2048, label: 'تطبيق التعديل' });
  const result = extractJson(out);
  if (!result || !result.type) throw new Error('تعذّر إنتاج النسخة المعدّلة من العملية');
  result.status = 'ready';
  return result;
}

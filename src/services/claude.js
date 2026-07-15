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

function buildSystemPrompt(accounts, defaultBank, messageDateISO, vatPercent) {
  const accountsList = accounts
    .map((a) => `- ${a.account_code} | ${a.account_name} (${a.account_type})`)
    .join('\n');

  const bankLine = defaultBank
    ? `${defaultBank.account_code} | ${defaultBank.account_name}`
    : '(غير محدّد — استخدم أنسب حساب بنكي/نقدي من القائمة ولا تسأل عنه)';

  return `أنت محاسب قانوني خبير في شركة ناف لو (شركة سعودية، العملة SAR). مهمتك تحليل العملية المالية الواردة وتوجيهها للمسار المحاسبي الصحيح في نظام وافق.

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

# قواعد عامة:
- التاريخ: إن ذُكر تاريخ صريح أو نسبي ("أمس"، "الثلاثاء الماضي"، "قبل يومين") فحوّله إلى YYYY-MM-DD بناءً على تاريخ الرسالة. وإن لم يُذكر تاريخ فاستخدم تاريخ الرسالة.
- قيم القيد اليدوي يجب أن تتوازن (مجموع المدين = مجموع الدائن).
- لفاتورة البيع: احسب الضريبة ${vatPercent}% على قيمة البنود، واذكر اسم العميل (contact_name).
- لفاتورة المشتريات: اذكر اسم المورّد (contact_name) إن توفّر (وإن لم يُذكر فلا تسأل عنه).

# البيانات الناقصة (كن مقتصداً جداً في السؤال):
- اسأل فقط عند نقص بيان جوهري لا بديل عنه: المبلغ، أو اسم العميل لفاتورة البيع فقط.
- ⛔ لا تسأل أبداً عن: حساب الدفع/الاستلام، أو المورّد، أو نوع المصروف (استنتج نوع المصروف من الوصف واختر أنسب حساب من القائمة).
- إن توفّر المبلغ (واسم العميل لفاتورة البيع)، اضبط "status":"ready" وأكمل دون سؤال.

# صيغة الإخراج — أرجع JSON صحيحاً تماماً فقط (بدون Markdown أو أي نص خارجه) بهذا الشكل:
{
  "status": "ready" | "need_more",
  "question": "سؤال بالعربية عند الحاجة، أو null",
  "type": "manual_journal" | "purchase_bill" | "sales_invoice",
  "date": "YYYY-MM-DD",
  "contact_name": "اسم العميل أو المورّد أو null",
  "summary": "وصف موجز بالعربية للعملية",
  "manual_journal": {
    "entries": [
      { "account_code": "..", "account_name": "..", "debit": 0, "credit": 0, "description": ".." }
    ]
  },
  "bill": {
    "line_items": [
      { "account_code": "..", "account_name": "..", "description": "..", "amount": 0 }
    ]
  },
  "invoice": {
    "line_items": [
      { "account_code": "..", "account_name": "..", "description": "..", "amount": 0 }
    ],
    "vat_percent": ${vatPercent}
  }
}

املأ فقط الكائن المطابق لـ "type" واترك الآخرين فارغين (arrays فارغة). لا تضف أي تعليقات.`;
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

/**
 * تحليل عملية وتصنيفها.
 * @param {object} opts
 * @param {Array}  opts.accounts       شجرة الحسابات النشطة.
 * @param {object|null} opts.defaultBank الحساب البنكي الافتراضي {account_code, account_name}.
 * @param {string} opts.messageDateISO تاريخ الرسالة YYYY-MM-DD.
 * @param {number} opts.vatPercent     نسبة الضريبة (مثل 15).
 * @param {string} opts.text           نص العملية الحالي.
 * @param {object|null} opts.image      { mediaType, base64 } لتحليل فاتورة بالرؤية.
 * @param {string|null} opts.priorContext  سياق سابق متراكم (عند استكمال حوار ناقص).
 * @returns {Promise<object>} كائن التصنيف المنظّم.
 */
export async function analyzeTransaction(env, opts) {
  const { accounts, defaultBank, messageDateISO, vatPercent, text, image, priorContext } = opts;
  const system = buildSystemPrompt(accounts, defaultBank, messageDateISO, vatPercent);

  const userContent = [];

  if (image) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    });
  }

  let userText = '';
  if (priorContext) {
    userText += `# سياق سابق من نفس المحادثة (عملية غير مكتملة):\n${priorContext}\n\n# رسالة المستخدم الجديدة لاستكمال الناقص:\n`;
  }
  userText += text || '';
  if (image) {
    userText += '\n\n(المرفق صورة فاتورة — استخرج بياناتها: المورّد/العميل، البنود، المبالغ، الضريبة إن وُجدت.)';
  }
  userContent.push({ type: 'text', text: userText || '(بدون نص)' });

  const res = await fetch(`${env.CLAUDE_API_BASE || 'https://api.anthropic.com/v1'}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-opus-4-8',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const textPart = (data.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  const result = extractJson(textPart);
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
    const res = await fetch(`${env.CLAUDE_API_BASE || 'https://api.anthropic.com/v1'}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || 'claude-opus-4-8',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      }),
    });
    if (!res.ok) return text;
    const data = await res.json();
    const out = (data.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();
    return out || text;
  } catch (_) {
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

  const res = await fetch(`${env.CLAUDE_API_BASE || 'https://api.anthropic.com/v1'}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-opus-4-8',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    }),
  });

  if (!res.ok) {
    // عند فشل المطابقة الذكية، اعتبرها جديدة (الأكثر أماناً من نسبها لخطأ).
    return { decision: 'new', index: 0, candidates: [] };
  }

  const data = await res.json();
  const textPart = (data.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

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

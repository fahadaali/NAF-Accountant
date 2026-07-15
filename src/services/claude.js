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
    : '(غير محدّد — إن لزم حساب بنكي وكان مفقوداً فاعتبر البيانات ناقصة)';

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

# قواعد عامة:
- إذا لم يُذكر حساب الدفع (صادر) أو حساب الاستلام (وارد)، فالأصل أنه الحساب البنكي الافتراضي أعلاه.
- التاريخ: إن ذُكر تاريخ صريح أو نسبي ("أمس"، "الثلاثاء الماضي"، "قبل يومين") فحوّله إلى YYYY-MM-DD بناءً على تاريخ الرسالة. وإن لم يُذكر تاريخ فاستخدم تاريخ الرسالة.
- قيم القيد اليدوي يجب أن تتوازن (مجموع المدين = مجموع الدائن).
- لفاتورة البيع: احسب الضريبة ${vatPercent}% على قيمة البنود، واذكر اسم العميل (contact_name).
- لفاتورة المشتريات: اذكر اسم المورّد (contact_name) إن توفّر.

# البيانات الناقصة:
- إذا نقص ما يمنع إنشاء العملية (مثل: المبلغ، أو اسم العميل لفاتورة البيع، أو نوع المصروف)، اضبط "status":"need_more" وضع سؤالاً عربياً موجزاً واضحاً في "question" لاستكمال الناقص فقط.
- إذا اكتمل كل شيء، اضبط "status":"ready".

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

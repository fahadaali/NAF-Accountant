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

# صيغة الإخراج — أرجع JSON صحيحاً تماماً فقط (بدون Markdown أو أي نص خارجه) بهذا الشكل:
{
  "status": "ready" | "need_more",
  "question": "سؤال بالعربية عند الحاجة، أو null",
  "type": "manual_journal" | "purchase_bill" | "sales_invoice",
  "date": "YYYY-MM-DD",
  "contact_name": "اسم العميل أو المورّد أو null",
  "currency": "${baseCurrency}",
  "exchange_rate": null,
  "summary": "وصف موجز بالعربية للعملية",
  "manual_journal": {
    "entries": [
      { "account_code": "..", "account_name": "..", "debit": 0, "credit": 0, "description": ".." }
    ]
  },
  "bill": {
    "line_items": [
      { "account_code": "..", "account_name": "..", "description": "..", "amount": 0 }
    ],
    "vat_percent": ${vatPercent}
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

// اسم النموذج الافتراضي في موضع واحد — كان مكرّراً في خمسة نداءات، وتحديثُ
// أحدها يترك أربعة خلفه.
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * نداء واحد إلى Claude يمرّ منه كل استدعاء في هذا الملف.
 *
 * ═══ فحص stop_reason ═══
 *
 * بلوغ `max_tokens` يعني رداً مبتوراً، وكان يمرّ صامتاً في المواضع الخمسة:
 * فيُنشر تقريرٌ ماليّ مقطوعٌ في منتصف جدول على بيسكامب، ويُحلَّل نصٌّ صوتيّ
 * ناقص كأنه كامل. والبتر لا يُميَّز من الاكتمال إلا من هذا الحقل.
 *
 * @param {object} opts
 * @param {string} opts.system
 * @param {string|Array} opts.content نصّ، أو مصفوفة كتل (لإرسال صورة).
 * @param {number} opts.maxTokens
 * @param {string} [opts.label] اسم يظهر في رسالة الخطأ.
 * @returns {Promise<string>} نصّ الرد.
 */
async function callClaude(env, { system, content, maxTokens = 2048, label = 'Claude' }) {
  const res = await fetch(`${env.CLAUDE_API_BASE || 'https://api.anthropic.com/v1'}/messages`, {
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
    }),
  });

  if (!res.ok) {
    throw new Error(`${label} API failed: ${res.status} ${briefApiError(await res.text())}`);
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

  return (data.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
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
 * @param {string} opts.baseCurrency   عملة الدفاتر الأساسية (مثل SAR).
 * @param {string} opts.text           نص العملية الحالي.
 * @param {object|null} opts.media      { kind:'image'|'document', mediaType, base64 } لتحليل فاتورة
 *                                      مصوّرة أو ملف PDF. الصور تُرسل ككتلة image، وملفات PDF
 *                                      ككتلة document يقرأها Claude نصّاً ورؤيةً لكل صفحة.
 * @param {string|null} opts.priorContext  سياق سابق متراكم (عند استكمال حوار ناقص).
 * @returns {Promise<object>} كائن التصنيف المنظّم.
 */
export async function analyzeTransaction(env, opts) {
  const { accounts, defaultBank, messageDateISO, vatPercent, baseCurrency, text, media, priorContext } = opts;
  const system = buildSystemPrompt(accounts, defaultBank, messageDateISO, vatPercent, baseCurrency);

  const userContent = [];

  if (media) {
    userContent.push({
      type: media.kind === 'document' ? 'document' : 'image',
      source: { type: 'base64', media_type: media.mediaType, data: media.base64 },
    });
  }

  let userText = '';
  if (priorContext) {
    userText += `# سياق سابق من نفس المحادثة (عملية غير مكتملة):\n${priorContext}\n\n# رسالة المستخدم الجديدة لاستكمال الناقص:\n`;
  }
  userText += text || '';
  if (media?.kind === 'document') {
    userText +=
      '\n\n(المرفق ملف PDF لفاتورة وقد يكون متعدد الصفحات — استخرج بياناتها: المورّد/العميل، ' +
      'رقم الفاتورة وتاريخها، البنود، المبالغ، الضريبة إن وُجدت. إن حوى الملف أكثر من فاتورة ' +
      'فاعتمد الأولى واذكر ذلك في "summary".)';
  } else if (media) {
    userText += '\n\n(المرفق صورة فاتورة — استخرج بياناتها: المورّد/العميل، البنود، المبالغ، الضريبة إن وُجدت.)';
  }
  userContent.push({ type: 'text', text: userText || '(بدون نص)' });

  const textPart = await callClaude(env, {
    system,
    content: userContent,
    maxTokens: 2048,
    label: 'تحليل العملية',
  });

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

/**
 * تنسيق بيانات تقرير مالي (JSON من وافق) إلى HTML عربي أنيق عبر Claude.
 * مرن مع اختلاف بنية البيانات. لا يخترع أرقاماً.
 * @param {string} periodLabel - وصف الفترة (مثل «يوليو 2026»).
 * @param {object} pnl - بيانات قائمة الدخل.
 * @param {object} trialBalance - بيانات ميزان المراجعة.
 * @returns {Promise<string>} محتوى HTML للتقرير.
 */
export async function formatFinancialReport(env, periodLabel, pnl, trialBalance) {
  const system = `أنت محاسب قانوني تُعِدّ تقريراً مالياً بالعربية لشركة ناف القانونية (SAR).
ستستلم بيانات JSON خام لتقريرين من نظام وافق: قائمة الدخل (الأرباح والخسائر) وميزان المراجعة.
مهمتك: توليد تقرير HTML عربي (RTL) أنيق ومنظّم يعرض البيانات في جداول واضحة، مع عناوين ومجاميع.

قواعد صارمة:
- استخدم الأرقام كما هي في البيانات فقط. ⛔ لا تخترع أو تُقدّر أي رقم.
- إن كان قسم فارغاً، اذكر «لا توجد بيانات».
- أخرج HTML فقط (وسوم <h2>,<h3>,<table>,<tr>,<td>,<p> بسيطة) بدون <html> أو <body> أو <style> أو أي شرح خارج الـ HTML.
- نسّق المبالغ برقمين عشريين مع «ر.س».`;

  const user = `الفترة: ${periodLabel}

# بيانات قائمة الدخل (JSON):
${JSON.stringify(pnl).slice(0, 12000)}

# بيانات ميزان المراجعة (JSON):
${JSON.stringify(trialBalance).slice(0, 12000)}`;

  /* 16000 لا 4096: المُدخل جدولان قد يبلغان ٢٤ ألف محرف، والمخرج جداول
     HTML كاملة. والحدّ السابق كان يبتره في منتصف صفّ، فيُنشر على بيسكامب
     تقريرٌ ماليّ ناقص بلا ما يقول إنه ناقص. */
  const html = await callClaude(env, {
    system,
    content: user,
    maxTokens: 16000,
    label: 'تنسيق التقرير المالي',
  });
  if (!html) throw new Error('Claude لم يُنتج محتوى للتقرير');
  return html;
}


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

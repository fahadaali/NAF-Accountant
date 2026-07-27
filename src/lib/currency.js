// ============================================================================
// وحدة العملات — العملة الأساسية، أسعار الصرف، والتحويل إليها
// ============================================================================
//
// دفاتر الشركة بالريال السعودي، لكن العمليات قد ترد بعملة أخرى — والدولار
// أكثرها. وافق يخزّن مبلغ السطر بعملته ومقابله بالعملة الأساسية معاً
// (`amount_to_bcy`)، فكل عملية بعملة أجنبية تحتاج سعر صرف، وإلا اختلّ
// ميزان الدفاتر.
//
// ترتيب مصادر السعر — من الأوثق إلى الأعمّ:
//   1. ما ذكره المستخدم في الرسالة صراحةً («بسعر 3.78»).
//   2. الإعداد EXCHANGE_RATES في لوحة Cloudflare.
//   3. الربط الرسمي للريال بالدولار.
// وإن لم يتوفّر أيٌّ منها، يُسأل المستخدم — ولا يُخمَّن سعر.
// ============================================================================

/** العملة الأساسية للدفاتر ما لم يُضبط غير ذلك. */
export const DEFAULT_BASE_CURRENCY = 'SAR';

/**
 * أسعار مثبّتة مقابل الريال.
 *
 * الريال مربوط بالدولار عند 3.75 منذ 1986 بقرار من مؤسسة النقد، وهو سعر
 * ثابت لا متغيّر سوقي — فذكره هنا تسجيلٌ لواقع لا تقديرٌ لسعر. أي عملة
 * أخرى ليست مربوطة، فسعرها يأتي من الإعداد أو من المستخدم.
 */
const PEGGED_TO_SAR = { USD: 3.75 };

/** أسماء عربية للعملات الشائعة — لعرضها في رسائل التأكيد. */
const CURRENCY_NAMES_AR = {
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  GBP: 'جنيه إسترليني',
  AED: 'درهم إماراتي',
  KWD: 'دينار كويتي',
  BHD: 'دينار بحريني',
  QAR: 'ريال قطري',
  OMR: 'ريال عماني',
  EGP: 'جنيه مصري',
  JOD: 'دينار أردني',
  TRY: 'ليرة تركية',
  CNY: 'يوان صيني',
  INR: 'روبية هندية',
};

/** العملة الأساسية المضبوطة للبيئة. */
export function baseCurrency(env) {
  return normalizeCurrency(env?.WAFEQ_CURRENCY) || DEFAULT_BASE_CURRENCY;
}

/**
 * مرادفات شائعة ترد بدل الرمز الدولي — شبكة أمان لا مسار أساسي.
 *
 * المطالبة تُلزم النموذج بالرمز الدولي، لكن انزلاقه إلى «دولار» يجعل العملية
 * تُقرأ كأنها بالعملة الأساسية فتدخل الدفاتر بمبلغ خاطئ صامت. لذلك يُقبل
 * الواضح منها فقط: «دينار» و«جنيه» مفردتين غامضتان (كويتي/بحريني/أردني،
 * مصري/إسترليني) فلا تُترجمان بالتخمين.
 */
const CURRENCY_ALIASES = {
  'دولار': 'USD',
  'دولار أمريكي': 'USD',
  'دولار امريكي': 'USD',
  $: 'USD',
  'يورو': 'EUR',
  '€': 'EUR',
  'استرليني': 'GBP',
  'إسترليني': 'GBP',
  '£': 'GBP',
  'ريال': 'SAR',
  'ريال سعودي': 'SAR',
  'درهم': 'AED',
  'درهم إماراتي': 'AED',
  'درهم اماراتي': 'AED',
};

/**
 * تطبيع رمز العملة إلى ثلاثة أحرف لاتينية كبيرة (ISO 4217).
 * @returns {string|null} الرمز، أو null إن لم يكن رمزاً صالح الشكل ولا مرادفاً معروفاً.
 */
export function normalizeCurrency(code) {
  const raw = String(code || '').trim();
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  return CURRENCY_ALIASES[raw] || CURRENCY_ALIASES[raw.replace(/\s+/g, ' ')] || null;
}

/** الاسم العربي للعملة، أو رمزها إن لم يكن مسجّلاً. */
export function currencyNameAr(code) {
  return CURRENCY_NAMES_AR[code] || code;
}

/**
 * قراءة أسعار الصرف من الإعداد: "USD:3.75,EUR:4.10,AED:1.021".
 * الأسعار مقابل العملة الأساسية (كم وحدة أساسية للوحدة الواحدة).
 * السطر المشوّه يُتجاهل ولا يُفشل الإعداد كلّه.
 */
export function configuredRates(env) {
  const rates = {};
  for (const pair of String(env?.EXCHANGE_RATES || '').split(',')) {
    const [code, value] = pair.split(':');
    const c = normalizeCurrency(code);
    const r = Number(value);
    if (c && Number.isFinite(r) && r > 0) rates[c] = r;
  }
  return rates;
}

/**
 * تحديد سعر صرف عملة مقابل العملة الأساسية.
 *
 * @param {object} env
 * @param {string} currency رمز العملة (مطبّع).
 * @param {number|null} explicitRate السعر الذي ذكره المستخدم، إن ذكره.
 * @returns {{rate:number, source:'base'|'explicit'|'config'|'peg'} | null}
 *   null تعني: عملة أجنبية بلا سعر معروف — تُسأل ولا تُخمَّن.
 */
export function resolveExchangeRate(env, currency, explicitRate = null) {
  if (!currency || currency === baseCurrency(env)) return { rate: 1, source: 'base' };

  const explicit = Number(explicitRate);
  if (Number.isFinite(explicit) && explicit > 0) return { rate: explicit, source: 'explicit' };

  const configured = configuredRates(env)[currency];
  if (configured) return { rate: configured, source: 'config' };

  // الربط الرسمي لا يُعتمد إلا حين تكون الأساسية هي الريال فعلاً.
  if (baseCurrency(env) === 'SAR' && PEGGED_TO_SAR[currency]) {
    return { rate: PEGGED_TO_SAR[currency], source: 'peg' };
  }

  return null;
}

/** تحويل مبلغ إلى العملة الأساسية بخانتين عشريتين. */
export function toBaseAmount(amount, rate) {
  return +(Number(amount || 0) * Number(rate || 1)).toFixed(2);
}

/* عزل اتجاهي للقيم داخل الجمل العربية — U+2068 و U+2069.
   نفس تعريف `isolate` في naf-format بالسجلّ؛ يُكرَّر هنا لأن الخادم
   لا يستورد من frontend/src/naf. أي تغيير يحدث في السجلّ أولاً. */
const iso = (v) => `⁨${v}⁩`;

/** تنسيق رقم بفاصل آلاف وخانتين عشريتين — قاعدة naf-format. */
const AMOUNT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * مبلغ مُنسَّق بعملته، معزولاً اتجاهياً، لرسائل تليجرام.
 *
 * الريال يظهر بالبديل النصّي «ر.س» لا برمز U+20C1: تليجرام لا يحمّل خط
 * الرمز، فيظهر مربّع فارغ مكانه — وهو نفس سبب استعمال البديل في المستندات
 * المطبوعة. والعملات الأخرى ترافقها رموزها الدولية، فلا تلتبس.
 *
 * ⛔ ليست لواجهة اللوحة — هناك يُعرض المبلغ عبر `Money` من `naf-currency`.
 */
export function formatMoney(amount, currency) {
  const value = AMOUNT_FORMAT.format(Number(amount || 0));
  return iso(`${value} ${currency === 'SAR' ? 'ر.س' : currency}`);
}

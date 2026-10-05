// ============================================================================
// تنسيق القيم — النظير الخادمي لـ `naf-format` في السجلّ
// ============================================================================
//
// اللوحة تستورد `naf-format` من السجلّ، والعامل لا يستطيع: `frontend/src/naf`
// ليس على مسار الاستيراد هنا. فتُكرَّر القواعد الثلاث التي يحتاجها الخادم —
// العزل الاتجاهي، وصيغة الرقم، وصيغة التاريخ — في ملف واحد لا في كل مستدعٍ.
// أي تغيير في القاعدة يحدث في السجلّ أولاً ثم يُنقل هنا.
// ============================================================================

/**
 * عزل اتجاهي — U+2068 … U+2069.
 *
 * كل رقم وتاريخ ومبلغ داخل نصّ عربي يُعزل، وإلا انقلب ترتيبه. و`<bdi>` لا
 * يصلح في السلاسل الخام ولا في الأسطح التي تُنقّي الوسوم (تليجرام، بيسكامب)،
 * فالمحرفان أسلم: نصٌّ عادي لا يستطيع مُنقٍّ حذفه.
 */
export function isolate(value) {
  return `⁨${value}⁩`;
}

/* المبالغ: خانتان عشريتان دائماً وفاصلة للآلاف — قاعدة `naf-terms` §٥. */
const AMOUNT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/* الأرقام غير المالية (عدد، نسبة): فاصلة للآلاف بلا أصفار زائدة. إلزام
   العدد بخانتين عشريتين يجعل «١٢ عملية» تُقرأ «12.00 عملية». */
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** مبلغ بخانتين عشريتين، بلا رمز عملة. غير معزول — العزل عند التركيب. */
export function formatAmount(value) {
  return AMOUNT_FORMAT.format(Number(value || 0));
}

/** رقم غير ماليّ (عدد، نسبة) بفاصلة آلاف. */
export function formatNumber(value) {
  return NUMBER_FORMAT.format(Number(value || 0));
}

/**
 * تاريخ ميلادي بصيغة `2026/07/26` من `2026-07-26` (وما يبدأ بها من طوابع ISO).
 * @returns {string|null} null إن لم تكن القيمة تاريخاً بهذا الشكل — فلا يُخمَّن.
 */
export function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(String(value || '').trim());
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

/** أسماء الأشهر الميلادية — لعناوين الفترات وأعمدة التقارير. */
export const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** قيمة رقمية نصّاً — وافق تُرجع الأعشار سلاسل ("1234.00") لا أرقاماً. */
export function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

/** تهريب نصّ وارد قبل وضعه في متن HTML. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

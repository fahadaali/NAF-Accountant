/**
 * تنسيق الأرقام والتواريخ والمبالغ — مصدر واحد للمنصة.
 *
 * القواعد من naf-terms.md §٥:
 * - الأرقام غربية دائماً (123 لا ١٢٣)، وفاصل الآلاف فاصلة
 * - المبلغ بخانتين عشريتين والرمز بعده
 * - التاريخ الميلادي 2026/07/26، والوقت بنظام ٢٤ ساعة 14:30
 * - كل رقم وتاريخ ومبلغ داخل عزل اتجاهي
 *
 * هذا بديل مؤقت عن حزمة `naf-format` وعنصر `Money` من `naf-currency`،
 * وهما غير موجودين في السجلّ عند الإصدار v1.1.1. حين تتوفّران يُستبدل
 * هذا الملف بالاستيراد منهما — لا تُنسخ هذه الدوال إلى منصة أخرى.
 *
 * رمز الريال U+20C1 غير مستعمل هنا عمداً: عنصر `Money` هو من يضمن
 * البديل التلقائي حين يتعذّر تحميل الخط، وبدونه يظهر مربع فارغ.
 * فالنصّ «ر.س» — وهو البديل المعتمد نفسه — أسلم إلى حين توفّرها.
 */

const NUM_LOCALE = 'en-US'; // أرقام غربية وفاصلة آلاف
export const CURRENCY = 'ر.س';

/** عدد صحيح بفاصل آلاف: 12,400 */
export function fmtNumber(n, { decimals = 0 } = {}) {
  return Number(n || 0).toLocaleString(NUM_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** مبلغ بخانتين عشريتين: 12,400.00 */
export function fmtAmount(n) {
  return fmtNumber(n, { decimals: 2 });
}

const pad = (v) => String(v).padStart(2, '0');

/** 2026/07/26 */
export function fmtDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** 2026/07/26 14:30 — نظام ٢٤ ساعة */
export function fmtDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** تواريخ D1 تُخزَّن UTC بلا لاحقة، فتُضاف قبل التحويل. */
function toDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const s = typeof value === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * وسيط إلى `naf-format` من السجلّ: naf/lib/format.js
 *
 * كان هذا الملف بديلاً محلياً كُتب حين ظننتُ الحزمة غير موجودة في
  * الإصدار المثبَّت آنذاك — وهي موجودة. حلّت وحدة السجلّ محلّ التنفيذ المحلي،
 * وبقي هذا الملف وسيطاً حتى لا ينكسر استيراد قائم.
 *
 * الأسماء هنا هي أسماء المنصة القديمة؛ أسماء السجلّ هي المعتمدة.
 * استورد من naf/lib/format.js مباشرةً في أي كود جديد.
 */
export {
  formatAmount,
  formatNumber,
  formatDate,
  formatHijriDate,
  formatDualDate,
  formatTime,
  formatPhone,
  formatMonth,
  formatDateTime,
  isolate,
} from '../naf/lib/format.js';

import { formatNumber, formatAmount, formatDate, formatDateTime } from '../naf/lib/format.js';

export const fmtNumber = (n) => formatNumber(Number(n || 0));
export const fmtAmount = (n) => formatAmount(Number(n || 0));
export const CURRENCY = 'ر.س';

/** تواريخ D1 تُخزَّن UTC بلا لاحقة، فتُضاف قبل التحويل. */
function toUtc(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const s = typeof value === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const fmtDate = (v) => { const d = toUtc(v); return d ? formatDate(d) : '—'; };
export const fmtDateTime = (v) => { const d = toUtc(v); return d ? formatDateTime(d) : '—'; };

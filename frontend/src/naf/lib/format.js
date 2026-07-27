/* من سجلّ ناف: fahadaali/naf-ui — العنصر «naf-format».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS): حُذفت
   التعليقات النوعية ووسائط forwardRef النوعية وكتل interface،
   وعُدّلت مسارات الاستيراد. لا سطر منطق تغيّر.
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً. */

/* ============================================================
   دوال التنسيق المشتركة لمنصات ناف.
   لا تنسّق رقماً ولا تاريخاً ولا مبلغاً في مكوّن. من هنا حصراً.

   القواعد المعتمدة:
   - أرقام غربية دائماً
   - فاصل الآلاف بالفاصلة
   - المبالغ بخانتين عشريتين دائماً
   - الوقت بنظام ٢٤ ساعة
   - التاريخ الميلادي: 2026/07/26
   - التاريخ الهجري: 1448/02/11 هـ
   ============================================================ */

const AMOUNT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

const HIJRI_FORMAT = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura-nu-latn", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function toDate(value) {
  return value instanceof Date ? value : new Date(value)
}

function pad(value) {
  return String(value).padStart(2, "0")
}

/**
 * يعزل قيمة اتجاهياً داخل نص عربي.
 *
 * للسلاسل الخام التي لا يصلح فيها <bdi>: رسائل confirm ونصوص الحالة
 * والتنبيهات. في JSX استعمل <bdi> لا هذه.
 *
 * المحرفان U+2068 (عزل أول) و U+2069 (إنهاء العزل).
 *
 * القاعدة توجب عزل كل رقم وتاريخ ومبلغ، و<bdi> يغطّي JSX وحده — فبدون
 * هذه الدالة تبقى كل رسالة فيها رقم منحرفة.
 *
 * @example
 *   setMsg(`تم حذف ${isolate(count)} عنصراً`)
 *   confirm(`حذف ${isolate(n)} عنصراً نهائياً؟`)
 */
export function isolate(value) {
  return `\u2068${value}\u2069`
}

/** المبلغ بلا رمز العملة: 12400 -> "12,400.00" */
export function formatAmount(value) {
  return AMOUNT_FORMAT.format(value)
}

/** عدد صحيح بفاصل آلاف: 12400 -> "12,400" */
export function formatNumber(value) {
  return NUMBER_FORMAT.format(value)
}

/** ميلادي: "2026/07/26" */
export function formatDate(value) {
  const date = toDate(value)
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

/** هجري أم القرى: "1448/02/11 هـ" */
export function formatHijriDate(value) {
  const parts = HIJRI_FORMAT.formatToParts(toDate(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ""
  return `${get("year")}/${get("month")}/${get("day")} هـ`
}

/** المزدوج: الميلادي أولاً ثم الهجري بين قوسين */
export function formatDualDate(value) {
  return `${formatDate(value)} (${formatHijriDate(value)})`
}

/**
 * الشهر والسنة لعناوين التقويم ومنتقي التاريخ: "2026/07".
 *
 * مشتقّة من الصيغة الميلادية المعتمدة بحذف اليوم — ليست صيغة جديدة.
 * أسماء الأشهر العربية ليست صيغة معتمدة لعرض قيمة تاريخ.
 */
export function formatMonth(value) {
  const date = toDate(value)
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}`
}

/** نظام ٢٤ ساعة: "14:30" */
export function formatTime(value) {
  const date = toDate(value)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** الجوال السعودي: "+966 5X XXX XXXX" */
export function formatPhone(value) {
  const digits = value.replace(/\D/g, "").replace(/^00966|^966|^0/, "")
  if (digits.length !== 9) return value
  return `+966 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`
}

/** الميلادي مع الوقت: "2026/07/26 14:30" */
export function formatDateTime(value) {
  return `${formatDate(value)} ${formatTime(value)}`
}

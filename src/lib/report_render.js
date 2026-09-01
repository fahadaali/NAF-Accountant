// ============================================================================
// بناء التقرير المالي HTML من بيانات وافق — بلا ذكاء اصطناعي
// ============================================================================
//
// كان هذا التقرير يُبنى بتمرير JSON وافق إلى Claude ليُخرجه جداول. وهو عملٌ
// لا ذكاء فيه — تحويلُ جدولٍ إلى جدول — لكنه كان يربط التقرير الشهري بحساب
// Anthropic: نفاد الرصيد، أو حدّ معدّل، أو انقطاع الخدمة، يعني ألّا يصدر
// التقرير أصلاً. وهو ما وقع فعلاً («credit balance is too low»، رمز 400).
//
// وفيه ما هو أخطر من التعطّل: أرقامُ تقريرٍ ماليّ رسميّ كانت تمرّ عبر نموذج
// توليدي. تعليمة «لا تخترع رقماً» رجاءٌ لا ضمان، والبتر عند حدّ الرموز كان
// يقصّ صفّاً في منتصفه فيُنشر تقريرٌ ناقص لا يقول إنه ناقص.
//
// فالبناء هنا حتميّ: كل رقم يظهر كما ورد من وافق، ولا مجموع يُحتسب هنا —
// المجاميع تُعرض إن أرسلتها وافق، ولا تُشتقّ (اشتقاقُها فوق شجرة حسابات
// يحتمل ازدواج احتساب الأب مع أبنائه).
//
// ⚠️ بنية تقارير وافق غير موثّقة في هذا المستودع، وقد تختلف بين الحسابات.
// فالعارض أدناه يتبع الشكل الوارد أياً كان — لا يفترض مفاتيح بعينها — ولا
// يُسقط قيمة لأنه لم يعرفها: ما لا يُعرف اسمه يظهر باسمه كما جاء من وافق.
// ============================================================================

import { formatMoney } from './currency.js';
import { formatDate, formatNumber, isolate } from './format.js';

/* بيسكامب ينقّي محتوى الرسالة ويحتفظ بمجموعة وسوم محدودة. الجداول ليست منها
   على وجه اليقين — وجدولٌ يُنقّى تبقى خلاياه نصّاً متلاصقاً بلا أعمدة، وهو
   أسوأ من قائمة. فكل صفّ سطرٌ يحمل اسمه وأرقامه معاً، يُقرأ سليماً ولو حُذف
   كل وسم حوله. */
const MAX_ROWS = 300; // سقف صفوف القسم الواحد — رسالة بيسكامب ليست ملفّاً.
const MAX_DEPTH = 6; // سقف التداخل — حارسٌ من بنية دائرية أو عميقة بلا طائل.

/** مفاتيح تُقرأ اسماً للصفّ، بترتيب الأولوية. */
const LABEL_KEYS = ['account_name', 'account', 'name', 'label', 'title', 'description'];
/** مفاتيح تُقرأ رمزاً يسبق الاسم. */
const CODE_KEYS = ['account_code', 'code', 'number'];

/**
 * تسميات المفاتيح — المسجّل في `naf-terms.md` وحده.
 *
 * ما ليس هنا يظهر بمفتاحه الإنجليزي كما ورد من وافق. وهو مقصود: اختراع
 * تسمية عربية لمصطلح محاسبي غير مسجّل هو الانحراف الذي يمنعه `CLAUDE.md`،
 * وترجمةٌ مظنونة لبندٍ ماليّ أسوأ من مفتاحٍ صريح. ما ينقص يُسجَّل في
 * `naf-ui` أولاً ثم يُضاف هنا.
 */
const KEY_LABELS = {
  debit: 'مدين',
  credit: 'دائن',
  net: 'الصافي',
  type: 'النوع',
  account_type: 'النوع',
  description: 'التفاصيل',
  id: 'المعرّف',
  amount: 'المبلغ',
  total: 'الإجمالي',
  date_from: 'من تاريخ',
  date_after: 'من تاريخ',
  start_date: 'من تاريخ',
  date_to: 'إلى تاريخ',
  date_before: 'إلى تاريخ',
  end_date: 'إلى تاريخ',
};

/*
 * مفاتيح تحمل الأبناء ولا تحمل معنى يُعرض — أغلفةُ نقلٍ لا أقسامَ تقرير.
 * عنوانٌ اسمه «results» ضجيجٌ في تقرير ماليّ، فيُعرض ما تحتها مباشرة.
 */
const CONTAINER_KEYS = new Set([
  'results', 'data', 'rows', 'items', 'records', 'list', 'values',
  'entries', 'lines', 'children', 'accounts', 'sections', 'groups',
]);

/* مفاتيح قيمتها مبلغ — تُعرض بالعملة. وما عداها رقمٌ مجرّد: النسبة والعدد
   لا يلحقهما «ر.س». */
const MONEY_KEY =
  /(amount|balance|debit|credit|total|net|value|profit|loss|revenue|income|expense|cost|tax|vat|opening|closing|sum)/i;

/** قيمة رقمية نصّاً — وافق تُرجع الأعشار سلاسل ("1234.00") لا أرقاماً. */
function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** تسمية المفتاح: المسجّلة إن وُجدت، وإلا المفتاح كما ورد. */
function keyLabel(key) {
  return KEY_LABELS[key] || key;
}

/** قيمة مفردة مُنسَّقة ومعزولة اتجاهياً، حسب دلالة مفتاحها. */
function formatScalar(key, value, currency) {
  const num = asNumber(value);
  if (num !== null) {
    return MONEY_KEY.test(key) ? formatMoney(num, currency) : isolate(formatNumber(num));
  }
  if (typeof value === 'boolean') return isolate(String(value));
  const date = formatDate(value);
  if (date) return isolate(date);
  return isolateMixed(value);
}

/*
 * كل ما يخالط العربية من رقم أو حرف لاتيني يُعزل — رمز حساب، رمز عملة،
 * رقم مرجع بشرطات مائلة. وأشدّها خطراً المراجع ذات الشرطات: بلا عزل يعيد
 * المحرّك ترتيب أجزائها داخل الجملة العربية، فيُقرأ الرقم مقلوباً.
 */
function isolateMixed(value) {
  const safe = escapeHtml(value);
  return /[0-9A-Za-z]/.test(String(value)) ? isolate(safe) : safe;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBranch = (v) => Array.isArray(v) || isPlainObject(v);
const isEmptyValue = (v) => v === null || v === undefined || v === '';

/** هل في البيانات ما يُعرض أصلاً؟ */
export function hasContent(data) {
  if (isEmptyValue(data)) return false;
  if (Array.isArray(data)) return data.some(hasContent);
  if (isPlainObject(data)) return Object.values(data).some(hasContent);
  return true;
}

/** اسم الصفّ من مفاتيحه الاسمية، مع المفاتيح التي استُهلكت فيه. */
function pickLabel(row) {
  const used = new Set();
  const parts = [];

  for (const key of CODE_KEYS) {
    if (!isEmptyValue(row[key]) && !isBranch(row[key])) {
      parts.push(isolateMixed(row[key]));
      used.add(key);
      break;
    }
  }
  for (const key of LABEL_KEYS) {
    if (!isEmptyValue(row[key]) && !isBranch(row[key])) {
      parts.push(isolateMixed(row[key]));
      used.add(key);
      break;
    }
  }
  return { label: parts.join(' · '), used };
}

/** صفّ واحد: اسمه، ثم أرقامه، ثم ما تفرّع عنه. */
function renderRow(row, currency, depth) {
  const { label, used } = pickLabel(row);
  const facts = [];
  const branches = [];

  for (const [key, value] of Object.entries(row)) {
    if (used.has(key) || isEmptyValue(value)) continue;
    if (isBranch(value)) {
      branches.push([key, value]);
      continue;
    }
    facts.push(`${escapeHtml(keyLabel(key))} ${formatScalar(key, value, currency)}`);
  }

  const head = label ? `<strong>${label}</strong>` : '';
  const body = facts.join(' · ');
  const line = [head, body].filter(Boolean).join(' — ');
  const nested = branches
    .map(([key, value]) => {
      const inner = renderValue(value, currency, depth + 1);
      if (!inner) return '';
      // المفتاح يظهر فقط حين لا يكون مجرّد وعاء للأبناء («children»).
      const name = CONTAINER_KEYS.has(key) ? '' : `<br>${escapeHtml(keyLabel(key))}`;
      return `${name}${inner}`;
    })
    .join('');

  // صفٌّ لم يبقَ منه شيء (كلُّ محتواه تحت سقف العمق) لا يُخرج عنصراً فارغاً.
  if (!line && !nested) return '';
  return `<li>${line}${nested}</li>`;
}

/** مصفوفة: قائمة صفوف، مع تصريحٍ بما اقتُطع عند تجاوز السقف. */
function renderArray(items, currency, depth) {
  const shown = items.slice(0, MAX_ROWS).filter((item) => hasContent(item));
  if (shown.length === 0) return '';

  const rows = shown
    .map((item) =>
      isPlainObject(item)
        ? renderRow(item, currency, depth)
        : `<li>${formatScalar('', item, currency)}</li>`
    )
    .filter(Boolean)
    .join('');
  if (!rows) return '';

  // ما اقتُطع يُقال — تقريرٌ ناقص لا يعلن نقصه هو ما نتجنّبه هنا.
  const trimmed =
    items.length > MAX_ROWS
      ? `<p>عُرض أول ${isolate(formatNumber(MAX_ROWS))} بنداً من ${isolate(
          formatNumber(items.length)
        )}.</p>`
      : '';

  return `<ul>${rows}</ul>${trimmed}`;
}

/** كائن: أرقامه المباشرة قائمةً، ثم كل فرع تحت عنوانه. */
function renderObject(node, currency, depth) {
  const facts = [];
  const branches = [];

  for (const [key, value] of Object.entries(node)) {
    if (isEmptyValue(value)) continue;
    if (isBranch(value)) branches.push([key, value]);
    else facts.push(`<li>${escapeHtml(keyLabel(key))} — ${formatScalar(key, value, currency)}</li>`);
  }

  const factList = facts.length ? `<ul>${facts.join('')}</ul>` : '';
  const branchHtml = branches
    .map(([key, value]) => {
      const inner = renderValue(value, currency, depth + 1);
      if (!inner) return '';
      return CONTAINER_KEYS.has(key) ? inner : `<h3>${escapeHtml(keyLabel(key))}</h3>${inner}`;
    })
    .join('');

  /* الفروع قبل الأرقام المباشرة: المجموع يلي ما جُمِع، لا يسبقه. وهو ترتيب
     كل قائمة مالية — والمجموعُ فوق بنوده يُقرأ رصيداً افتتاحياً. */
  return `${branchHtml}${factList}`;
}

function renderValue(value, currency, depth = 0) {
  if (isEmptyValue(value)) return '';
  if (depth > MAX_DEPTH) return '';
  if (Array.isArray(value)) return renderArray(value, currency, depth);
  if (isPlainObject(value)) return renderObject(value, currency, depth);
  return `<p>${formatScalar('', value, currency)}</p>`;
}

/**
 * قسم واحد من التقرير (الأرباح والخسائر، ميزان المراجعة...).
 * @param {string} title   عنوان القسم — من `naf-terms.md`.
 * @param {object} section { data } بيانات وافق، أو { error } سبب تعذّر جلبها.
 */
export function renderSection(title, section, currency) {
  const head = `<h2>${escapeHtml(title)}</h2>`;

  // القسم المتعذّر يُعلن سببه في متن التقرير: قارئُ التقرير هو من يحتاج أن
  // يعرف أن الرقم غائب، لا سجلُّ النظام وحده.
  if (section && section.error) {
    return `${head}<p><strong>تعذّر جلب هذا القسم:</strong> ${escapeHtml(section.error)}</p>`;
  }

  const data = section ? section.data : null;
  if (!hasContent(data)) return `${head}<p>لا حركة في هذه الفترة.</p>`;

  const body = renderValue(data, currency, 0);
  /* بياناتٌ موجودة لم يُخرج العارضُ منها شيئاً (تداخلٌ يتجاوز السقف مثلاً)
     ليست «لا حركة» — والقول بذلك كذبٌ على قارئ التقرير. تُقال كما هي. */
  if (!body) {
    return `${head}<p>وردت بيانات لهذا القسم بِبنية يتعذّر عرضها. راجع سجلّ النظام.</p>`;
  }
  return `${head}${body}`;
}

/**
 * التقرير المالي كاملاً.
 *
 * @param {object} opts
 * @param {string} opts.kindLabel   شهري | ربعي | سنوي.
 * @param {string} opts.periodLabel وصف الفترة كما يظهر في العنوان.
 * @param {string} opts.after       بداية الفترة YYYY-MM-DD.
 * @param {string} opts.before      نهايتها YYYY-MM-DD.
 * @param {string} opts.currency    عملة التقرير.
 * @param {Array<{title:string, data?:object, error?:string}>} opts.sections
 * @returns {string} HTML لمتن رسالة بيسكامب.
 */
export function renderFinancialReport({
  kindLabel,
  periodLabel,
  after,
  before,
  currency,
  sections,
}) {
  const range = `الفترة من ${isolate(formatDate(after) || after)} إلى ${isolate(
    formatDate(before) || before
  )}`;

  const header =
    `<h2>التقرير المالي (${escapeHtml(kindLabel)}) — ${escapeHtml(periodLabel)}</h2>` +
    `<p>${range}</p>`;

  const body = (sections || [])
    .map((section) => renderSection(section.title, section, currency))
    .join('');

  const footer =
    `<hr><p><em>تقرير ${escapeHtml(kindLabel)} آلي — الأرقام كما وردت من وافق ` +
    `دون احتساب أو تعديل — منصة ناف القانونية.</em></p>`;

  return `${header}${body}${footer}`;
}

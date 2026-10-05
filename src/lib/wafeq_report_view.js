// ============================================================================
// عرض تقريرَي وافق بشكلهما المعروف — قائمة مالية لا تفريغ للبنية
// ============================================================================
//
// العارض العام في `report_render.js` يتبع أي شكل ولا يُسقط مفتاحاً، فكان
// تقرير بيسكامب يحمل كل ما في ردّ وافق: المعرّفات (acc_…)، وأغلفة metadata
// وsub_totals، ومفاتيح إنجليزية، ومصفوفات أرقام بلا أسماء أعمدة. والقارئ
// محاسبٌ أو شريك يريد: كل حساب ومبلغه، ومجموع كل مجموعة، والنتيجة.
//
// فهنا يُعرف شكلا وافق الفعليّان ويُعرضان قائمةً مالية:
//
//   الأرباح والخسائر — `columns` (أشهر الفترة ثم عمود الإجمالي)، ومجموعات
//   (INCOME، OPERATING_EXPENSE، NET_PROFIT…) تحتها حسابات، ولكل صفّ مصفوفة
//   أرقام بطول الأعمدة، وللمجموعة `summary` يحمل مجموعها.
//
//   ميزان المراجعة — مجموعات (ASSET > CURRENT_ASSET > حسابات)، ولكل صفّ
//   الحقول `*_to_bcy` الأربعة، و`summary.totals` للإجمالي العام.
//
// لا رقم يُحتسب هنا: المجموع هو ما أرسلته وافق في `summary`، والإجمالي هو
// عمود الإجماليات في ردّها. وما لا يطابق هذا الشكل يعود فارغاً، فيعرضه
// العارض العام كما كان — لا يضيع قسم لأن وافق غيّرت شكلها.
// ============================================================================

import { formatMoney } from './currency.js';
import { AR_MONTHS, asNumber, escapeHtml, formatDate, isolate } from './format.js';

const MAX_DEPTH = 8; // حارسٌ من بنية دائرية أو عميقة بلا طائل.

/*
 * عناوين المجموعات بالرمز الذي ترسله وافق في `group`/`id`.
 *
 * ⚠️ بانتظار التسجيل في `naf-terms.md` (naf-ui) — لم تُسجَّل بعد. ما ليس
 * هنا يظهر بتسمية وافق الإنجليزية كما وردت، ولا يُترجم بالتخمين.
 */
const GROUP_TERMS = {
  // الأرباح والخسائر
  INCOME: { title: 'الإيرادات', total: 'إجمالي الإيرادات' },
  COGS: { title: 'تكلفة المبيعات', total: 'إجمالي تكلفة المبيعات' },
  GROSS_MARGIN: { title: 'مجمل الربح' },
  OPERATING_EXPENSE: { title: 'المصروفات التشغيلية', total: 'إجمالي المصروفات التشغيلية' },
  OPERATING_PROFIT: { title: 'الربح التشغيلي' },
  OTHER_INCOME: { title: 'إيرادات أخرى', total: 'إجمالي الإيرادات الأخرى' },
  NON_OPERATING_EXPENSE: {
    title: 'مصروفات غير تشغيلية',
    total: 'إجمالي المصروفات غير التشغيلية',
  },
  NET_PROFIT: { title: 'صافي الربح' },
  // ميزان المراجعة
  ASSET: { title: 'الأصول', total: 'إجمالي الأصول' },
  CURRENT_ASSET: { title: 'الأصول المتداولة', total: 'إجمالي الأصول المتداولة' },
  NON_CURRENT_ASSET: { title: 'الأصول غير المتداولة', total: 'إجمالي الأصول غير المتداولة' },
  LIABILITY: { title: 'الخصوم', total: 'إجمالي الخصوم' },
  CURRENT_LIABILITY: { title: 'الخصوم المتداولة', total: 'إجمالي الخصوم المتداولة' },
  NON_CURRENT_LIABILITY: {
    title: 'الخصوم غير المتداولة',
    total: 'إجمالي الخصوم غير المتداولة',
  },
  EQUITY: { title: 'حقوق الملكية', total: 'إجمالي حقوق الملكية' },
  OWNERS_EQUITY: { title: 'حقوق الملاك', total: 'إجمالي حقوق الملاك' },
  RETAINED_EARNINGS: { title: 'الأرباح المبقاة', total: 'إجمالي الأرباح المبقاة' },
  REVENUE: { title: 'الإيرادات', total: 'إجمالي الإيرادات' },
  EXPENSE: { title: 'المصروفات', total: 'إجمالي المصروفات' },
};

/* مجموعات هي نتيجة لا بنود: تُعرض سطراً واحداً ولو كانت صفراً. */
const RESULT_GROUPS = new Set(['GROSS_MARGIN', 'OPERATING_PROFIT', 'NET_PROFIT']);

/* حقول ميزان المراجعة بترتيب قراءتها: من أين بدأ الحساب، ما دخله وما خرج،
   وأين انتهى. «مدين» و«دائن» مسجّلان؛ الرصيدان بانتظار التسجيل. */
const BALANCE_FIELDS = [
  ['opening_balance_to_bcy', 'الرصيد الافتتاحي'],
  ['debit_to_bcy', 'مدين'],
  ['credit_to_bcy', 'دائن'],
  ['running_balance_to_bcy', 'الرصيد الختامي'],
];

/* مفاتيح ليست صفوفاً في التقرير وإن احتوت أسماء — رأسه وأعمدته ومجاميعه. */
const SKIP_KEYS = new Set(['summary', 'overview', 'columns', 'metadata_columns']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasText = (v) => typeof v === 'string' && v.trim() !== '';

/** نصٌّ وارد مُهرَّب، معزولٌ إن خالط العربيةَ رقمٌ أو حرف لاتيني. */
function text(value) {
  const safe = escapeHtml(value);
  return /[0-9A-Za-z]/.test(String(value)) ? isolate(safe) : safe;
}

/** اسم الصفّ: `label` كما أرسلته وافق («415 Attorney's fees»)، وإلا رمزه واسمه. */
function lineLabel(node) {
  if (hasText(node.label)) return node.label;
  return [node.code, node.name].filter(hasText).join(' ');
}

const groupCode = (node) => String(node.group || node.id || '').toUpperCase();

/**
 * الصفوف المباشرة تحت عقدة: أول ما يُصادَف على كل مسار مما يحقّق `isLine`،
 * دون النزول داخله — أبناؤه يُجمعون حين يُعرض هو.
 */
function childLines(node, isLine) {
  const found = [];
  const visit = (value, depth) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
    } else if (isObj(value)) {
      if (isLine(value)) {
        found.push(value);
        return;
      }
      for (const [key, inner] of Object.entries(value)) {
        if (!SKIP_KEYS.has(key)) visit(inner, depth + 1);
      }
    }
  };
  for (const [key, value] of Object.entries(node)) {
    if (!SKIP_KEYS.has(key)) visit(value, 0);
  }
  return found;
}

// ---------------------------------------------------------------------------
// الأرباح والخسائر — أعمدة زمنية
// ---------------------------------------------------------------------------

/** عنوان العمود: اسم الشهر حين يغطّي شهراً كاملاً، وإلا تسمية وافق. */
function columnTitle(column) {
  const meta = isObj(column.metadata) ? column.metadata : {};
  const from = /^(\d{4})-(\d{2})-01/.exec(String(meta.from_date || ''));
  const to = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(meta.to_date || ''));
  if (from && to && from[1] === to[1] && from[2] === to[2]) {
    const year = Number(from[1]);
    const month = Number(from[2]) - 1;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    if (Number(to[3]) === lastDay) return AR_MONTHS[month];
  }
  return hasText(column.label) ? text(column.label) : '';
}

/** أعمدة التقرير، وموضع عمود الإجماليات إن أرسلته وافق. */
function readColumns(data) {
  if (!Array.isArray(data.columns) || data.columns.length === 0) return null;
  const columns = data.columns.map((column) => (isObj(column) ? column : {}));
  let totalIndex = columns.findIndex(
    (c) => String(c.id || '') === 'row_totals' || /^totals?$/i.test(String(c.label || ''))
  );
  // عمود واحد هو الفترة كلها — قيمته إجماليها.
  if (totalIndex === -1 && columns.length === 1) totalIndex = 0;
  return { count: columns.length, totalIndex, titles: columns.map(columnTitle) };
}

/** مصفوفة الأرقام في الصفّ — كل عناصرها أرقام، وطولها طول الأعمدة. */
function ownValues(node, count) {
  if (!isObj(node)) return null;
  for (const value of Object.values(node)) {
    if (
      Array.isArray(value) &&
      value.length === count &&
      value.every((item) => asNumber(item) !== null)
    ) {
      return value.map(asNumber);
    }
  }
  return null;
}

function renderProfitAndLoss(data, currency) {
  const columns = readColumns(data);
  if (!columns) return '';

  const valuesOf = (node) => ownValues(node, columns.count) || ownValues(node.summary, columns.count);
  const isLine = (node) => (hasText(node.label) || hasText(node.name)) && valuesOf(node) !== null;

  const groups = childLines(data, isLine);
  if (groups.length === 0) return '';

  const total = (values) =>
    columns.totalIndex === -1 ? '' : formatMoney(values[columns.totalIndex], currency);

  /* توزيع المجموع على أشهر الفترة — للمجاميع وحدها، فسطر الحساب يكفيه
     إجماليه. ولا يُذكر حين يكون للفترة عمود واحد. */
  const byPeriod = (values) => {
    const parts = values
      .map((value, i) => (i === columns.totalIndex ? '' : `${columns.titles[i]} ${formatMoney(value, currency)}`))
      .filter(Boolean);
    return parts.length > 1 ? `<br>${parts.join(' · ')}` : '';
  };

  const renderAccounts = (lines, depth) => {
    if (lines.length === 0 || depth > MAX_DEPTH) return '';
    const items = lines.map((line) => {
      const children = renderAccounts(childLines(line, isLine), depth + 1);
      return `<li>${text(lineLabel(line))} — ${total(valuesOf(line))}${children}</li>`;
    });
    return `<ul>${items.join('')}</ul>`;
  };

  const blocks = groups.map((group) => {
    const code = groupCode(group);
    const term = GROUP_TERMS[code];
    const values = valuesOf(group);
    const accounts = childLines(group, isLine);

    if (accounts.length === 0) {
      // مجموعة بلا حسابات ولا مبلغ (تكلفة مبيعات صفرية مثلاً) لا تُثقل التقرير.
      if (!RESULT_GROUPS.has(code) && values.every((v) => v === 0)) return '';
      const title = term ? term.title : text(lineLabel(group));
      return `<div><strong>${title} — ${total(values)}</strong>${byPeriod(values)}</div>`;
    }

    const title = term ? term.title : text(lineLabel(group));
    const summaryLabel = isObj(group.summary) && hasText(group.summary.label) ? group.summary.label : '';
    const totalTitle = term && term.total ? term.total : text(summaryLabel || lineLabel(group));
    return (
      `<div><strong>${title}</strong></div>` +
      renderAccounts(accounts, 0) +
      `<div><strong>${totalTitle} — ${total(values)}</strong>${byPeriod(values)}</div>`
    );
  });

  return blocks.filter(Boolean).join('<br>');
}

// ---------------------------------------------------------------------------
// ميزان المراجعة — أرصدة
// ---------------------------------------------------------------------------

const hasBalances = (node) =>
  isObj(node) && BALANCE_FIELDS.some(([key]) => asNumber(node[key]) !== null);

/** الحقول الأربعة سطراً واحداً، بالترتيب المحاسبي. */
function balances(node, currency) {
  return BALANCE_FIELDS.filter(([key]) => asNumber(node[key]) !== null)
    .map(([key, title]) => `${title} ${formatMoney(asNumber(node[key]), currency)}`)
    .join(' · ');
}

function renderTrialBalance(data, currency) {
  const isLine = (node) =>
    (hasText(node.label) || hasText(node.name)) && (hasBalances(node) || hasBalances(node.summary));

  const groups = childLines(data, isLine);
  if (groups.length === 0) return '';

  const totalsOf = (node) => (hasBalances(node.summary) ? node.summary : hasBalances(node) ? node : null);
  const titleOf = (node) => {
    const term = GROUP_TERMS[groupCode(node)];
    return term ? term.title : text(lineLabel(node));
  };
  const totalTitleOf = (node) => {
    const term = GROUP_TERMS[groupCode(node)];
    if (term && term.total) return term.total;
    const label = isObj(node.summary) && hasText(node.summary.label) ? node.summary.label : lineLabel(node);
    return text(label);
  };

  /* حساب: اسمه في سطر، وأرصدته تحته. وما تفرّع عنه قائمةٌ داخله. */
  const renderAccounts = (lines, depth) => {
    if (lines.length === 0 || depth > MAX_DEPTH) return '';
    const items = lines.map((line) => {
      const children = renderAccounts(childLines(line, isLine), depth + 1);
      return `<li>${text(lineLabel(line))}<br>${balances(line, currency)}${children}</li>`;
    });
    return `<ul>${items.join('')}</ul>`;
  };

  /* مجموعة أعلى (الأصول) تحتها مجموعات (المتداولة) تحتها حسابات. الحساب
     يُعرف بأنه لا يحمل `summary` — أرصدته فيه مباشرة. والعرض مسطّح: نصٌّ
     بعد قائمة داخل بند يُعيد بيسكامب ترتيبه فيسبق القائمة. */
  const isGroup = (node) => hasBalances(node.summary);

  const renderGroup = (group, depth, showTotal, parentTitle) => {
    const children = childLines(group, isLine);
    const subgroups = children.filter(isGroup);
    const accounts = children.filter((child) => !isGroup(child));
    const totals = totalsOf(group);
    const strong = (html) => (depth === 0 ? `<strong>${html}</strong>` : html);

    // مجموعة فرعية وحيدة مجموعها مجموع أبيها — فلا يتكرّر السطر.
    const showSubtotals = subgroups.length > 1 || accounts.length > 0;

    // «الإيرادات» تحت «الإيرادات» عنوانٌ مكرّر لا يُضيف شيئاً.
    const title = titleOf(group);
    let html = title === parentTitle ? '' : `<div>${strong(title)}</div>`;
    html += renderAccounts(accounts, 0);
    html += subgroups.map((sub) => renderGroup(sub, depth + 1, showSubtotals, title)).join('');
    if (totals && showTotal) {
      html += `<div>${strong(`${totalTitleOf(group)}<br>${balances(totals, currency)}`)}</div>`;
    }
    return html;
  };

  const blocks = groups.map((group) => renderGroup(group, 0, true));

  // الإجمالي العام: `summary.totals` في ردّ وافق، أو `summary` نفسه.
  const summary = isObj(data.summary) ? data.summary : null;
  const grand = summary && hasBalances(summary.totals) ? summary.totals : hasBalances(summary) ? summary : null;
  if (grand) {
    blocks.push(`<div><strong>الإجمالي<br>${balances(grand, currency)}</strong></div>`);
  }

  return blocks.join('<br>');
}

// ---------------------------------------------------------------------------

/** فترة التقرير كما أعادتها وافق في `overview`، إن أعادتها. */
export function reportedPeriod(data) {
  const overview = isObj(data) && isObj(data.overview) ? data.overview : null;
  if (!overview) return null;
  const pick = (keys) => keys.map((k) => formatDate(overview[k])).find(Boolean) || null;
  const from = pick(['from_date', 'date_from', 'date_after', 'start_date']);
  const to = pick(['to_date', 'date_to', 'date_before', 'end_date']);
  return from && to ? { from, to } : null;
}

/**
 * متن قسمٍ من تقرير وافق قائمةً مالية، أو '' إن لم يطابق شكلاً معروفاً —
 * فيعرضه المستدعي بالعارض العام ولا يضيع.
 */
export function renderWafeqReport(data, currency) {
  if (!isObj(data)) return '';
  if (Array.isArray(data.columns)) return renderProfitAndLoss(data, currency);
  return renderTrialBalance(data, currency);
}

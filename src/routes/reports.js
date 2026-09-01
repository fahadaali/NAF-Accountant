// ============================================================================
// مسار التقارير (GET /api/reports/basecamp)
// يعمل يدوياً أو عبر Cron Trigger لإرسال ملخص المسودات إلى بيسكامب.
// ============================================================================

import { Hono } from 'hono';
import { getWafeqDraftSummary } from '../services/wafeq.js';
import { getProfitAndLoss, getTrialBalance } from '../services/wafeq_reports.js';
import { postBasecampMessage } from '../services/basecamp.js';
import { notifyAdmins } from '../services/telegram.js';
import { baseCurrency } from '../lib/currency.js';
import { renderFinancialReport } from '../lib/report_render.js';
import { authenticate } from '../lib/auth.js';
import { writeLog } from '../lib/db.js';

const reports = new Hono();

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** آخر يوم في شهر (0-based month). */
function lastDay(year, monthIdx) {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * حساب نطاق الفترة السابقة حسب النوع (بناءً على تاريخ التشغيل).
 * @returns {{ after:string, before:string, label:string }}
 */
export function periodRange(type, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based

  if (type === 'annual') {
    const py = y - 1;
    return { after: iso(py, 0, 1), before: iso(py, 11, 31), label: `السنة المالية ${py}` };
  }

  if (type === 'quarterly') {
    // الربع السابق للربع الحالي.
    const curQ = Math.floor(m / 3); // 0..3
    let qy = y;
    let prevQ = curQ - 1;
    if (prevQ < 0) { prevQ = 3; qy = y - 1; }
    const startM = prevQ * 3;
    return {
      after: iso(qy, startM, 1),
      before: iso(qy, startM + 2, lastDay(qy, startM + 2)),
      label: `الربع ${prevQ + 1} من ${qy}`,
    };
  }

  // monthly (افتراضي): الشهر السابق.
  let my = y;
  let pm = m - 1;
  if (pm < 0) { pm = 11; my = y - 1; }
  return {
    after: iso(my, pm, 1),
    before: iso(my, pm, lastDay(my, pm)),
    label: `${AR_MONTHS[pm]} ${my}`,
  };
}

/** نتيجة `allSettled` قسماً في التقرير: بياناتٌ، أو سببُ تعذّرها. */
function toSection(title, settled) {
  if (settled.status === 'fulfilled') return { title, data: settled.value };
  const reason = settled.reason;
  return { title, error: (reason && reason.message) || String(reason) };
}

/**
 * توليد وإرسال التقرير المالي (الأرباح والخسائر + ميزان المراجعة) إلى بيسكامب.
 *
 * المتن يُبنى هنا حتمياً من بيانات وافق — لا يمرّ بنموذج توليدي. تفصيل
 * السبب في رأس `src/lib/report_render.js`.
 *
 * والقسمان يُجلبان مستقلَّين: `Promise.all` كان يُسقط التقرير كلَّه لتعثّر
 * أحد التقريرين، فيضيع القسم الذي جاء سليماً. فما وصل يُنشر، وما تعذّر
 * يُذكر سببه في متن التقرير وفي السجلّ وفي تنبيه المسؤولين — ولا يُنشر
 * تقريرٌ ناقصٌ صامتٌ عن نقصه.
 *
 * type: 'monthly' | 'quarterly' | 'annual'
 */
export async function generateAndSendFinancialReport(env, type) {
  const { after, before, label } = periodRange(type, new Date());

  const settled = await Promise.allSettled([
    getProfitAndLoss(env, after, before),
    getTrialBalance(env, after, before),
  ]);
  const sections = [
    toSection('الأرباح والخسائر', settled[0]),
    toSection('ميزان المراجعة', settled[1]),
  ];

  const failed = sections.filter((s) => s.error);
  if (failed.length === sections.length) {
    // لا بيانات أصلاً — يُرفع الفشل لينبّه معالجُ المهام المجدولة المسؤولين.
    throw new Error(`تعذّر جلب بيانات التقرير: ${failed.map((s) => s.error).join(' | ')}`);
  }

  const kindLabel =
    type === 'annual' ? 'سنوي' : type === 'quarterly' ? 'ربعي' : 'شهري';
  const contentHtml = renderFinancialReport({
    kindLabel,
    periodLabel: label,
    after,
    before,
    currency: baseCurrency(env),
    sections,
  });

  await postBasecampMessage(env, `📊 التقرير المالي (${kindLabel}) — ${label}`, contentHtml);

  await writeLog(env.DB, {
    action: 'financial_report',
    status: failed.length ? 'error' : 'success',
    errorDetails: failed.length
      ? `${type}:${label} — نُشر ناقصاً: ${failed.map((s) => `${s.title} (${s.error})`).join(' | ')}`
      : `${type}:${label}`,
  });

  if (failed.length) {
    await notifyAdmins(
      env,
      `⚠️ <b>التقرير المالي نُشر ناقصاً</b>\n\n📌 ${kindLabel} — ${label}\n` +
        failed.map((s) => `❌ ${s.title}: ${s.error}`).join('\n') +
        `\n\nالأقسام الأخرى نُشرت على بيسكامب.`
    );
  }

  return { type, label, after, before, missing: failed.map((s) => s.title) };
}

// حماية التشغيل اليدوي للتقرير (جلسة مستخدم أو DASHBOARD_API_KEY).
reports.use('/reports/*', async (c, next) => {
  const who = await authenticate(c);
  if (!who) return c.json({ ok: false, error: 'unauthorized' }, 401);
  await next();
});

/**
 * بناء وإرسال التقرير الشهري. مشترك بين المسار والـ Cron.
 */
export async function generateAndSendReport(env) {
  const { count, items, partial } = await getWafeqDraftSummary(env);

  const now = new Date();
  const monthLabel = now.toLocaleDateString('ar', { year: 'numeric', month: 'long' });

  const rows = items
    .slice(0, 100)
    .map((d) => `<li>${d.type} #${d.number || d.id} <em>(${d.date})</em></li>`)
    .join('');

  // ما اقتُطع يُقال: العدد أعلاه أدنى من الحقيقي لا مساوٍ له.
  const partialNote = (partial || []).length
    ? `<p><strong>تنبيه:</strong> بلغ الجلب سقف الصفحات في: ${partial.join('، ')}. ` +
      `العدد أعلاه أدنى من الحقيقي.</p>`
    : '';
  const shownNote = items.length > 100 ? `<p>يُعرض أول 100 مستند من ${count}.</p>` : '';

  const contentHtml =
    `<h2>التقرير المحاسبي — ${monthLabel}</h2>` +
    `<p>إجمالي القيود بحالة مسودة بانتظار المراجعة: <strong>${count}</strong></p>` +
    partialNote +
    shownNote +
    (rows ? `<ul>${rows}</ul>` : `<p>لا توجد مسودات معلّقة.</p>`) +
    `<p><em>تم إنشاء هذا التقرير آلياً بواسطة منصة ناف لو المحاسبية.</em></p>`;

  const subject = `تقرير المسودات المحاسبية — ${monthLabel}`;

  await postBasecampMessage(env, subject, contentHtml);

  await writeLog(env.DB, {
    action: 'basecamp_report',
    status: 'success',
    errorDetails: `drafts=${count}`,
  });

  return { count, monthLabel };
}

reports.get('/reports/basecamp', async (c) => {
  try {
    const result = await generateAndSendReport(c.env);
    return c.json({ ok: true, ...result });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await writeLog(c.env.DB, {
      action: 'basecamp_report',
      status: 'error',
      errorDetails: msg,
    });
    return c.json({ ok: false, error: msg }, 500);
  }
});

// التقرير المالي (يدوياً): /reports/financial?period=monthly|quarterly|annual
reports.get('/reports/financial', async (c) => {
  const period = c.req.query('period') || 'monthly';
  if (!['monthly', 'quarterly', 'annual'].includes(period)) {
    return c.json({ ok: false, error: 'period يجب أن يكون monthly أو quarterly أو annual' }, 400);
  }
  try {
    const result = await generateAndSendFinancialReport(c.env, period);
    return c.json({ ok: true, ...result });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await writeLog(c.env.DB, {
      action: 'financial_report',
      status: 'error',
      errorDetails: msg,
    });
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default reports;

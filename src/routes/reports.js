// ============================================================================
// مسار التقارير (GET /api/reports/basecamp)
// يعمل يدوياً أو عبر Cron Trigger لإرسال ملخص المسودات إلى بيسكامب.
// ============================================================================

import { Hono } from 'hono';
import { getWafeqDraftSummary } from '../services/wafeq.js';
import { postBasecampMessage } from '../services/basecamp.js';
import { writeLog } from '../lib/db.js';

const reports = new Hono();

/**
 * بناء وإرسال التقرير الشهري. مشترك بين المسار والـ Cron.
 */
export async function generateAndSendReport(env) {
  const summary = await getWafeqDraftSummary(env);

  const drafts = summary.results || summary.data || summary || [];
  const count = Array.isArray(drafts) ? drafts.length : 0;

  const now = new Date();
  const monthLabel = now.toLocaleDateString('ar', { year: 'numeric', month: 'long' });

  const rows = (Array.isArray(drafts) ? drafts : [])
    .slice(0, 100)
    .map((d) => {
      const id = d.id || d.uuid || '';
      const desc = d.description || '';
      const date = d.date || '';
      return `<li>#${id} — ${desc} <em>(${date})</em></li>`;
    })
    .join('');

  const contentHtml =
    `<h2>التقرير المحاسبي — ${monthLabel}</h2>` +
    `<p>إجمالي القيود بحالة مسودة بانتظار المراجعة: <strong>${count}</strong></p>` +
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

export default reports;

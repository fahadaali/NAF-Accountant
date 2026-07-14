// ============================================================================
// NAF Accountant — نقطة الدخول الرئيسية لـ Cloudflare Worker
// المسارات: Hono.js | fetch handler + scheduled (Cron) handler
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import telegramRoute from './routes/telegram.js';
import reportsRoute, { generateAndSendReport } from './routes/reports.js';
import dashboardRoute from './routes/dashboard.js';
import basecampOauthRoute from './routes/basecamp_oauth.js';
import { syncChartOfAccounts } from './services/sync.js';
import { writeLog } from './lib/db.js';

const app = new Hono();

// CORS للسماح للوحة التحكم (Cloudflare Pages) بالاتصال.
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// فحص الصحة
app.get('/', (c) => c.json({ ok: true, service: 'naf-accountant', ts: Date.now() }));
app.get('/api/health', (c) => c.json({ ok: true }));

// المسارات
app.route('/api', telegramRoute);
app.route('/api', reportsRoute);
app.route('/api', dashboardRoute);
app.route('/api', basecampOauthRoute);

// معالج شامل للأخطاء
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ ok: false, error: err.message || 'internal error' }, 500);
});

export default {
  fetch: app.fetch,

  // ------------------------------------------------------------------
  // معالج المهام المجدولة (Cron Triggers):
  //   "0 22 * * *" (كل ليلة)   → مزامنة شجرة الحسابات من وافق.
  //   "0 6 1 * *"  (أول الشهر) → التقرير الشهري إلى بيسكامب.
  // ------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    // المزامنة الليلية لشجرة الحسابات.
    if (event.cron === '0 22 * * *') {
      ctx.waitUntil(
        (async () => {
          try {
            const result = await syncChartOfAccounts(env);
            console.log('Nightly accounts sync done:', result);
          } catch (err) {
            console.error('Nightly accounts sync failed:', err);
            await writeLog(env.DB, {
              action: 'cron_accounts_sync',
              status: 'error',
              errorDetails: err.message || String(err),
            });
          }
        })()
      );
      return;
    }

    // التقرير الشهري إلى بيسكامب (أي جدولة أخرى، افتراضياً أول الشهر).
    ctx.waitUntil(
      (async () => {
        try {
          const result = await generateAndSendReport(env);
          console.log('Scheduled Basecamp report sent:', result);
        } catch (err) {
          console.error('Scheduled report failed:', err);
          await writeLog(env.DB, {
            action: 'cron_basecamp_report',
            status: 'error',
            errorDetails: err.message || String(err),
          });
        }
      })()
    );
  },
};

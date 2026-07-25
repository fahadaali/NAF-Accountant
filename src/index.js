// ============================================================================
// NAF Accountant — نقطة الدخول الرئيسية لـ Cloudflare Worker
// المسارات: Hono.js | fetch handler + scheduled (Cron) handler
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import telegramRoute from './routes/telegram.js';
import reportsRoute, {
  generateAndSendReport,
  generateAndSendFinancialReport,
} from './routes/reports.js';
import dashboardRoute from './routes/dashboard.js';
import basecampOauthRoute from './routes/basecamp_oauth.js';
import authRoute from './routes/auth.js';
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
app.get('/api/health', (c) => c.json({ ok: true }));

// مسارات الـ API
// ملاحظة: المسارات العامة (auth, telegram, reports, basecamp_oauth) تُسجّل قبل
// لوحة التحكم، لأن وسيط حماية اللوحة (use '*') يُطبّق على ما يليه من مسارات /api.
app.route('/api', authRoute);
app.route('/api', telegramRoute);
app.route('/api', reportsRoute);
app.route('/api', basecampOauthRoute);
app.route('/api', dashboardRoute);

// مسار API غير موجود → 404 JSON (لا تُخدم صفحة SPA لطلبات الـ API).
app.all('/api/*', (c) => c.json({ ok: false, error: 'not found' }, 404));

// أي مسار آخر يخدمه ملفات لوحة التحكم الثابتة (SPA).
app.all('*', async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.json({ ok: true, service: 'naf-accountant', ts: Date.now() });
});

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
    const runSafe = (action, fn) =>
      ctx.waitUntil(
        (async () => {
          try {
            const result = await fn();
            console.log(`${action} done:`, result);
          } catch (err) {
            console.error(`${action} failed:`, err);
            await writeLog(env.DB, {
              action,
              status: 'error',
              errorDetails: err.message || String(err),
            });
          }
        })()
      );

    switch (event.cron) {
      case '0 22 * * *': // كل ليلة — مزامنة شجرة الحسابات
        return runSafe('cron_accounts_sync', () => syncChartOfAccounts(env));

      case '0 6 1 * *': // أول الشهر — ملخص المسودات المعلّقة
        return runSafe('cron_basecamp_report', () => generateAndSendReport(env));

      case '0 7 1 * *': {
        // أول كل شهر — التقارير المالية (المنطق يحدّد النوع لتقليل مهام Cron):
        const month = new Date().getUTCMonth(); // 0-based
        runSafe('cron_financial_monthly', () => generateAndSendFinancialReport(env, 'monthly'));
        if (month % 3 === 0) {
          // يناير/أبريل/يوليو/أكتوبر → بداية ربع جديد → تقرير الربع السابق
          runSafe('cron_financial_quarterly', () => generateAndSendFinancialReport(env, 'quarterly'));
        }
        if (month === 0) {
          // يناير → تقرير السنة السابقة
          runSafe('cron_financial_annual', () => generateAndSendFinancialReport(env, 'annual'));
        }
        return;
      }

      default:
        return runSafe('cron_basecamp_report', () => generateAndSendReport(env));
    }
  },
};

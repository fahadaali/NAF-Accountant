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
import adminRoute from './routes/admin.js';
import { syncChartOfAccounts } from './services/sync.js';
import { runDueRecurring } from './services/recurring.js';
import { notifyAdmins, esc } from './services/telegram.js';
import { requireSession } from './lib/auth.js';
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

// ----------------------------------------------------------------------------
// مسارات الـ API — الترتيب جزء من الحماية، فاقرأه قبل تغييره.
//
// Hono يُركّب كل التطبيقات الفرعية على البادئة /api نفسها، ثم ينفّذ ما يطابق
// الطلب **بترتيب التسجيل**. فالوسيط المسجّل قبل معالِج ما يحرسه، والمسجّل بعده
// لا يمسّه (لأن المعالج يردّ ويقطع السلسلة).
//
// لذلك: المسارات العامة أولاً، ثم سطر المصادقة الواحد، ثم كل ما هو محمي.
// ولا `use('*')` داخل أي تطبيق فرعي — وسيط كهذا يحرس مسارات غيره، وهو ما
// جعل حارس الإدارة يحجب اللوحة كلّها عن صلاحية «مستخدم».
// ----------------------------------------------------------------------------

// (١) عامة — لكلٍّ حمايته الخاصة: سرّ الويبهوك، أو حارس /reports/*، أو الإعداد.
app.route('/api', authRoute);
app.route('/api', telegramRoute);
app.route('/api', reportsRoute);
app.route('/api', basecampOauthRoute);

// (٢) كل ما بعد هذا السطر يتطلب مصادقة: جلسة مستخدم أو DASHBOARD_API_KEY.
app.use('/api/*', requireSession);

// (٣) محمية — القراءة لكل مُصادَق، والتعديل للمسؤول (requireAdmin داخل المعالج).
app.route('/api', dashboardRoute);
app.route('/api', adminRoute);

// مسار API غير موجود → 404 JSON (لا تُخدم صفحة SPA لطلبات الـ API).
// يقع بعد وسيط المصادقة، فالمجهول يرد 401 لغير المُصادَق و404 للمُصادَق.
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

// يُصدَّر للاختبارات فقط: جرد المسارات (app.routes) يتحقّق أن كل مسار محمي
// يقع فعلاً بعد وسيط المصادقة. لا يستعمله وقت التشغيل.
export { app };

export default {
  fetch: app.fetch,

  // ------------------------------------------------------------------
  // معالج المهام المجدولة (Cron Triggers):
  //   "0 22 * * *" (كل ليلة)   → مزامنة شجرة الحسابات من وافق.
  //   "0 6 1 * *"  (أول الشهر) → التقرير الشهري إلى بيسكامب.
  // ------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    const runSafe = (action, label, fn) =>
      ctx.waitUntil(
        (async () => {
          try {
            const result = await fn();
            console.log(`${action} done:`, result);
          } catch (err) {
            const msg = err.message || String(err);
            console.error(`${action} failed:`, err);
            await writeLog(env.DB, { action, status: 'error', errorDetails: msg });
            // تنبيه المسؤولين عبر تليجرام عند فشل مهمة مجدولة.
            await notifyAdmins(
              env,
              `🚨 <b>فشل مهمة مجدولة</b>\n\n📌 ${esc(label)}\n❌ ${esc(msg)}\n\nراجع سجلّات اللوحة للتفاصيل.`
            );
          }
        })()
      );

    switch (event.cron) {
      case '0 22 * * *': // كل ليلة — مزامنة الحسابات + العمليات المتكرّرة المستحقّة
        runSafe('cron_accounts_sync', 'مزامنة شجرة الحسابات', () => syncChartOfAccounts(env));
        runSafe('cron_recurring', 'تنفيذ العمليات المتكرّرة', () => runDueRecurring(env));
        return;

      case '0 6 1 * *': // أول الشهر — ملخص المسودات المعلّقة
        return runSafe('cron_basecamp_report', 'ملخص المسودات إلى بيسكامب', () =>
          generateAndSendReport(env)
        );

      case '0 7 1 * *': {
        // أول كل شهر — التقارير المالية (المنطق يحدّد النوع لتقليل مهام Cron):
        const month = new Date().getUTCMonth(); // 0-based
        runSafe('cron_financial_monthly', 'التقرير المالي الشهري', () =>
          generateAndSendFinancialReport(env, 'monthly')
        );
        if (month % 3 === 0) {
          // يناير/أبريل/يوليو/أكتوبر → بداية ربع جديد → تقرير الربع السابق
          runSafe('cron_financial_quarterly', 'التقرير المالي الربعي', () =>
            generateAndSendFinancialReport(env, 'quarterly')
          );
        }
        if (month === 0) {
          // يناير → تقرير السنة السابقة
          runSafe('cron_financial_annual', 'التقرير المالي السنوي', () =>
            generateAndSendFinancialReport(env, 'annual')
          );
        }
        return;
      }

      default:
        return runSafe('cron_basecamp_report', 'ملخص المسودات إلى بيسكامب', () =>
          generateAndSendReport(env)
        );
    }
  },
};

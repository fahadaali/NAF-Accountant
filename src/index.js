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
// باب الدخول المحلي لم يعد يُركَّب — انظر الشرح عند موضع تركيبه أدناه.
// import authRoute from './routes/auth.js';
import adminRoute from './routes/admin.js';
import membersRoute from './routes/members.js';
import { ssoMiddleware, requireWriter } from './auth/middleware.js';
import { ssoCallback } from './auth/callback.js';
import { ssoBackchannelLogout, ssoLogout } from './auth/logout.js';
import { syncChartOfAccounts } from './services/sync.js';
import { runDueRecurring } from './services/recurring.js';
import { notifyAdmins, runWebhookWatchdog } from './services/telegram.js';
import { writeLog } from './lib/db.js';

const app = new Hono();

/* CORS — الأصل المُعلن وحده لا `*`.

   `origin: '*'` بقيّة من يوم كانت اللوحة على Cloudflare Pages بنطاق مستقلّ.
   واليوم يخدم هذا العامل نفسُه اللوحةَ والواجهةَ البرمجية معاً، فطلبُ اللوحة
   من أصلها لا يمرّ بـCORS أصلاً — والفتح الكامل لا يخدم شيئاً قائماً ويدع
   أي صفحة في أي نطاق تنادي الواجهة من متصفّح الزائر.

   والأتمتة بـ`DASHBOARD_API_KEY` لا يمسّها هذا: `curl` وما شابهه لا يطبّق
   CORS، وهو حكمُ متصفّحٍ لا حكمُ خادم. */
app.use('/api/*', cors({
  origin: (origin, c) => {
    const declared = String(c?.env?.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
    return declared && origin === declared ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// ----------------------------------------------------------------------------
// الدخول الموحّد (naf-auth).
// الوسيط يُسجّل قبل كل المسارات لأن وسيط Hono يُطبّق على ما يليه وحده،
// وقائمة المسارات العامة داخل src/auth/config.js هي ما يمرّ منه — وأي مسار
// جديد خارجها محمي افتراضياً.
// ----------------------------------------------------------------------------
app.use('*', ssoMiddleware);
// القارئ يقرأ ولا يكتب — بعد الوسيط لأنه يقرأ الدور الذي يحقنه، وقبل كل
// مسار لأن الحكم بالطريقة لا بالمسار. تفصيله في `src/auth/middleware.js`.
app.use('*', requireWriter);
app.get('/auth/callback', ssoCallback);
app.post('/auth/logout', ssoLogout);
app.post('/auth/backchannel-logout', ssoBackchannelLogout);

// فحص الصحة
app.get('/api/health', (c) => c.json({ ok: true }));

// مسارات الـ API
// ملاحظة: المسارات العامة (auth, telegram, reports, basecamp_oauth) تُسجّل قبل
// لوحة التحكم، لأن وسيط حماية اللوحة (use '*') يُطبّق على ما يليه من مسارات /api.
/* ═══ باب الدخول المحلي لم يعد يُركَّب ═══

   `routes/auth.js` نظامُ الدخول السابق: `‎/api/auth/login` يطابق كلمة مرورٍ
   بجدول `users` القديم ويُصدر رمز جلسة، و`‎/api/auth/bootstrap` يُنشئ
   مسؤولاً فيه.

   وهو خلف وسيط الدخول الموحّد، فلا يبلغه مجهول — لكنّ ذلك ليس كافياً:

   `bootstrap` لا يشترط إلا أن يكون جدول `users` القديم فارغاً، وحمايتُه
   بـ`ADMIN_BOOTSTRAP_TOKEN` **اختيارية** بنصّ تعليقها. فأيّ عضوٍ داخلٍ —
   ولو كان `viewer` — يستطيع أن يُدرج صفّاً دورُه `admin` ببريدٍ يختاره.
   ثم يقرأ `linkLegacyMember` في `auth/config.js` ذلك الصفَّ عند أوّل دخولٍ
   لصاحب البريد فيمنحه `admin` في `members`. فترقيةٌ تقع بلا مسؤولٍ يقرّرها.

   والمصادقة صارت مركزية، فلا حاجة إلى بابٍ ثانٍ أصلاً. والملف يبقى في
   مكانه للمراجعة ولا يُحذف — يكفي ألّا يُركَّب.

   ويُستثنى منه ما لا يُنشئ ولا يمنح: لا شيء. الأربعة كلها إمّا تُصدر جلسةً
   محلية وإمّا تقرأ حالة نظامٍ لم يعد قائماً. */
// app.route('/api', authRoute);
app.route('/api', telegramRoute);
app.route('/api', reportsRoute);
app.route('/api', basecampOauthRoute);
app.route('/api', adminRoute);
app.route('/api', membersRoute);
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
              `🚨 <b>فشل مهمة مجدولة</b>\n\n📌 ${label}\n❌ ${msg}\n\nراجع سجلّات اللوحة للتفاصيل.`
            );
          }
        })()
      );

    switch (event.cron) {
      case '0 22 * * *': // كل ليلة — مزامنة الحسابات + العمليات المتكرّرة المستحقّة
        /* وفحصُ القناة الواردة معها. المنصة كانت تعرف حال وافق وحسابها
           ولا تعرف هل يصل إليها تليجرام أصلاً — وانقطاعُ الوارد لا يترك
           أثراً في أي سجلّ هنا، لأن الطلب لا يبلغها. فتُسأل تليجرام. */
        runSafe('telegram_webhook', 'فحص قناة تليجرام', () => runWebhookWatchdog(env));
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

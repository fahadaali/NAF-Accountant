// ============================================================================
// مسار مساعد لمرّة واحدة: الحصول على Refresh Token من بيسكامب عبر OAuth.
//
// الاستخدام (مرة واحدة فقط للإعداد):
//   1) في تطبيق بيسكامب (launchpad.37signals.com/integrations) اضبط
//      Redirect URI ليكون:
//        https://<your-worker>.workers.dev/api/basecamp/callback
//   2) أضِف BASECAMP_CLIENT_ID و BASECAMP_CLIENT_SECRET كـ Secrets في Cloudflare.
//   3) افتح في المتصفح: https://<your-worker>.workers.dev/api/basecamp/start
//   4) وافِق على الصلاحيات، وستظهر لك صفحة فيها refresh_token — انسخه وأضِفه
//      كـ Secret باسم BASECAMP_REFRESH_TOKEN، ثم يمكنك حذف هذا المسار لاحقاً.
// ============================================================================

import { Hono } from 'hono';

const oauth = new Hono();

/**
 * رابط ورقة أنماط الواجهة المبنيّة، مُلتقطاً من index.html.
 * اسم الملف يحمل بصمة تتغيّر مع كل بناء، فلا يصحّ تثبيته في الكود.
 * تعيد null لو تعذّر — والصفحة تظلّ مقروءة بأنماط المتصفّح الافتراضية.
 */
async function appStylesheetHref(c) {
  if (!c.env.ASSETS) return null;
  try {
    const url = new URL(c.req.url);
    const res = await c.env.ASSETS.fetch(new Request(`${url.origin}/index.html`));
    if (!res.ok) return null;
    const m = (await res.text()).match(/href="(\/assets\/[^"]+\.css)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function redirectUri(c) {
  const url = new URL(c.req.url);
  return `${url.origin}/api/basecamp/callback`;
}

// الخطوة 1: إعادة توجيه المستخدم إلى صفحة موافقة بيسكامب.
oauth.get('/basecamp/start', (c) => {
  if (!c.env.BASECAMP_CLIENT_ID) {
    return c.text('أضِف BASECAMP_CLIENT_ID كـ Secret أولاً.', 400);
  }
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: c.env.BASECAMP_CLIENT_ID,
    redirect_uri: redirectUri(c),
  });
  return c.redirect(`https://launchpad.37signals.com/authorization/new?${params.toString()}`);
});

// الخطوة 2: بيسكامب يعيد التوجيه هنا مع ?code=... — نبادله بالتوكنات.
oauth.get('/basecamp/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('لا يوجد code في الرابط.', 400);
  if (!c.env.BASECAMP_CLIENT_ID || !c.env.BASECAMP_CLIENT_SECRET) {
    return c.text('أضِف BASECAMP_CLIENT_ID و BASECAMP_CLIENT_SECRET كـ Secrets أولاً.', 400);
  }

  const params = new URLSearchParams({
    type: 'web_server',
    client_id: c.env.BASECAMP_CLIENT_ID,
    client_secret: c.env.BASECAMP_CLIENT_SECRET,
    redirect_uri: redirectUri(c),
    code,
  });

  const res = await fetch(
    `https://launchpad.37signals.com/authorization/token?${params.toString()}`,
    { method: 'POST', headers: { 'User-Agent': 'NAF Accountant (fahad2ao@gmail.com)' } }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    return c.text(`فشل الحصول على التوكن: ${res.status} ${JSON.stringify(data)}`, 500);
  }

  // تهريب القيم لعرضها بأمان داخل خاصية HTML (منع كسر النسخ).
  const esc = (s) =>
    String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  const accessToken = esc(data.access_token);
  const refreshToken = esc(data.refresh_token || '');

  // الصفحة تُعرَض من المنصة نفسها، فهي واجهة تخضع لقواعد ناف:
  // لا إيموجي، ولا قيمة لون مباشرة، ولا خطّ غير خطّ الهوية. وبما أنها
  // خارج حزمة الواجهة، نلتقط ورقة الأنماط المبنيّة من index.html —
  // اسمها يحمل بصمة تتغيّر مع كل بناء، فلا يصحّ تثبيتها.
  const styleHref = await appStylesheetHref(c);

  // نعرض التوكنين ليُحفظا يدوياً كـ Secrets. لا نخزّنهما في مكان عام.
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- الاستثناء الرابع في CLAUDE.md §1: الوسم يأخذ قيمة مباشرة ولا شيء
         غيرها. القيمتان مرآة --background في الوضعين، كما في frontend/index.html. -->
    <meta name="theme-color" content="#e8ebed" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1c2433" media="(prefers-color-scheme: dark)">
    <title>ربط بيسكامب</title>
    ${styleHref ? `<link rel="stylesheet" href="${styleHref}">` : ''}
    </head>
    <body class="bg-background text-foreground p-8">
    <div class="max-w-2xl mx-auto bg-card border border-border rounded-lg p-8 shadow-sm">
    <h2 class="text-2xl font-bold mb-4">تم ربط بيسكامب</h2>
    <p class="text-muted-foreground mb-6">انسخ القيمتين التاليتين وأضِفهما في Cloudflare بنوع <b>Secret</b> بالاسمين المذكورين.</p>

    <label for="bc-token" class="block font-semibold mb-2">BASECAMP_TOKEN (توكن الوصول — يُستخدم مباشرة)</label>
    <input id="bc-token" readonly onclick="this.select()" value="${accessToken}"
      class="w-full mb-6 border border-border rounded-md px-4 py-3 bg-muted font-mono text-sm" dir="ltr">

    <label for="bc-refresh" class="block font-semibold mb-2">BASECAMP_REFRESH_TOKEN (للتجديد التلقائي كل أسبوعين)</label>
    <input id="bc-refresh" readonly onclick="this.select()" value="${refreshToken}"
      class="w-full mb-6 border border-border rounded-md px-4 py-3 bg-muted font-mono text-sm" dir="ltr">

    <div class="flex items-start gap-3 border border-warning/30 bg-warning-soft rounded-lg p-4 text-sm">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true"
           class="shrink-0 mt-0.5 text-warning-strong">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
        <path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
      <div>
        <b>تحذير</b> — اضغط على الحقل لتحديده ثم انسخه. بعد حفظ القيمتين، يُفضّل
        تعطيل مسار <b>/api/basecamp/*</b>. توكن الوصول صالح أسبوعين ويُجدَّد
        تلقائياً بعدها.
      </div>
    </div>
    </div></body></html>`;

  return c.html(html);
});

export default oauth;

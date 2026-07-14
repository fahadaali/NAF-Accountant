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
  if (!res.ok || !data.refresh_token) {
    return c.text(`فشل الحصول على التوكن: ${res.status} ${JSON.stringify(data)}`, 500);
  }

  // نعرض refresh_token ليُحفظ يدوياً كـ Secret. لا نخزّنه في مكان عام.
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <title>ربط بيسكامب</title>
    <style>body{font-family:system-ui;background:#f0f7f4;padding:40px;color:#052e2b}
    .box{background:#fff;max-width:640px;margin:auto;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.06)}
    code{display:block;background:#052e2b;color:#4ade80;padding:16px;border-radius:12px;word-break:break-all;margin:16px 0;direction:ltr}
    .warn{background:#fef2f2;color:#b91c1c;padding:12px;border-radius:12px;margin-top:16px}</style></head>
    <body><div class="box">
    <h2>✅ تم ربط بيسكامب بنجاح</h2>
    <p>انسخ القيمة التالية وأضِفها في Cloudflare كـ <b>Secret</b> باسم <b>BASECAMP_REFRESH_TOKEN</b>:</p>
    <code>${data.refresh_token}</code>
    <div class="warn">⚠️ لأمانك: بعد حفظ التوكن، احذف مسار <b>/api/basecamp/*</b> من الكود أو عطّله.</div>
    </div></body></html>`;

  return c.html(html);
});

export default oauth;

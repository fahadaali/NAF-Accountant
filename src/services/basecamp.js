// ============================================================================
// خدمة بيسكامب (Basecamp 3 API) — إرسال التقارير مع تجديد التوكن عند الحاجة
// ============================================================================
//
// توكن الوصول (Access Token) في بيسكامب صالح لأسبوعين. لذلك نستخدمه مباشرة،
// ولا نجدّده إلا إذا انتهى (رد 401) — وهذا أكثر متانة من التجديد في كل مرة.
//
// المتغيرات (تُضاف من لوحة Cloudflare بنوع Secret):
//   BASECAMP_TOKEN            (توكن الوصول الحالي — يُستخدم مباشرة)
//   للتجديد التلقائي عند انتهائه:
//     BASECAMP_CLIENT_ID
//     BASECAMP_CLIENT_SECRET
//     BASECAMP_REFRESH_TOKEN
//   وفي كل الأحوال:
//     BASECAMP_ACCOUNT_ID
//     BASECAMP_PROJECT_ID
//     BASECAMP_MESSAGE_BOARD_ID
// ============================================================================

const LAUNCHPAD_TOKEN_URL = 'https://launchpad.37signals.com/authorization/token';
const USER_AGENT = 'NAF Accountant (fahad2ao@gmail.com)';

function canRefresh(env) {
  return !!(env.BASECAMP_CLIENT_ID && env.BASECAMP_CLIENT_SECRET && env.BASECAMP_REFRESH_TOKEN);
}

/**
 * تجديد توكن الوصول عبر Refresh Token. يُرجع توكناً جديداً.
 */
export async function refreshAccessToken(env) {
  const params = new URLSearchParams({
    type: 'refresh',
    refresh_token: env.BASECAMP_REFRESH_TOKEN,
    client_id: env.BASECAMP_CLIENT_ID,
    client_secret: env.BASECAMP_CLIENT_SECRET,
  });

  const res = await fetch(`${LAUNCHPAD_TOKEN_URL}?${params.toString()}`, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Basecamp token refresh failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('Basecamp token refresh returned no access_token');
  return data.access_token;
}

/**
 * نشر رسالة على لوحة رسائل مشروع في بيسكامب.
 * يستخدم التوكن الحالي مباشرة، ويجدّده تلقائياً مرة واحدة عند انتهائه (401).
 */
export async function postBasecampMessage(env, subject, contentHtml) {
  const url =
    `https://3.basecampapi.com/${env.BASECAMP_ACCOUNT_ID}` +
    `/buckets/${env.BASECAMP_PROJECT_ID}` +
    `/message_boards/${env.BASECAMP_MESSAGE_BOARD_ID}/messages.json`;

  const send = (token) =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ subject, content: contentHtml, status: 'active' }),
    });

  let token = env.BASECAMP_TOKEN;
  let res;

  if (token) {
    // 1) جرّب التوكن الحالي مباشرة.
    res = await send(token);
    // 2) إن انتهى (401) وأمكن التجديد → جدّد وأعد المحاولة مرة واحدة.
    if ((res.status === 401 || res.status === 403) && canRefresh(env)) {
      token = await refreshAccessToken(env);
      res = await send(token);
    }
  } else if (canRefresh(env)) {
    // لا يوجد توكن مباشر → جدّد للحصول على واحد.
    token = await refreshAccessToken(env);
    res = await send(token);
  } else {
    throw new Error(
      'إعدادات بيسكامب ناقصة: أضِف BASECAMP_TOKEN (توكن الوصول)، ويفضّل مع ' +
        'BASECAMP_CLIENT_ID و BASECAMP_CLIENT_SECRET و BASECAMP_REFRESH_TOKEN للتجديد التلقائي.'
    );
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Basecamp message failed: ${res.status} ${body}`);
  }
  return res.json();
}

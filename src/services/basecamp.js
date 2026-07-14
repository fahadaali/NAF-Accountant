// ============================================================================
// خدمة بيسكامب (Basecamp 3 API) — إرسال التقارير + تجديد التوكن تلقائياً
// ============================================================================
//
// توكن وصول بيسكامب (Access Token) ينتهي خلال ~ساعتين، لذلك نستخدم
// Refresh Token لتوليد توكن جديد عند كل استخدام (مناسب للتقارير المجدولة).
//
// المتغيرات المطلوبة (تُضاف من لوحة Cloudflare بنوع Secret):
//   الوضع الآلي (مُفضّل):
//     BASECAMP_CLIENT_ID
//     BASECAMP_CLIENT_SECRET
//     BASECAMP_REFRESH_TOKEN
//   الوضع اليدوي (بديل مؤقت — توكن ثابت ينتهي بسرعة):
//     BASECAMP_TOKEN
//
//   في الحالتين:
//     BASECAMP_ACCOUNT_ID
//     BASECAMP_PROJECT_ID
//     BASECAMP_MESSAGE_BOARD_ID
// ============================================================================

const LAUNCHPAD_TOKEN_URL = 'https://launchpad.37signals.com/authorization/token';

/**
 * الحصول على توكن وصول صالح.
 * - إذا توفّرت بيانات Refresh، نجدّد للحصول على توكن جديد.
 * - وإلا نعود للتوكن الثابت BASECAMP_TOKEN (للاختبار فقط).
 */
export async function getBasecampAccessToken(env) {
  const canRefresh =
    env.BASECAMP_CLIENT_ID && env.BASECAMP_CLIENT_SECRET && env.BASECAMP_REFRESH_TOKEN;

  if (canRefresh) {
    const params = new URLSearchParams({
      type: 'refresh',
      refresh_token: env.BASECAMP_REFRESH_TOKEN,
      client_id: env.BASECAMP_CLIENT_ID,
      client_secret: env.BASECAMP_CLIENT_SECRET,
    });

    const res = await fetch(`${LAUNCHPAD_TOKEN_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { 'User-Agent': 'NAF Accountant (fahad2ao@gmail.com)' },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Basecamp token refresh failed: ${res.status} ${body}`);
    }

    const data = await res.json();
    if (!data.access_token) {
      throw new Error('Basecamp token refresh returned no access_token');
    }
    return data.access_token;
  }

  // الوضع البديل: توكن ثابت.
  if (env.BASECAMP_TOKEN) return env.BASECAMP_TOKEN;

  throw new Error(
    'إعدادات بيسكامب ناقصة: أضِف BASECAMP_CLIENT_ID و BASECAMP_CLIENT_SECRET و BASECAMP_REFRESH_TOKEN (أو BASECAMP_TOKEN للاختبار).'
  );
}

/**
 * نشر رسالة على لوحة رسائل مشروع في بيسكامب.
 * @param {string} subject - عنوان الرسالة.
 * @param {string} contentHtml - محتوى الرسالة (HTML مسموح).
 */
export async function postBasecampMessage(env, subject, contentHtml) {
  const accessToken = await getBasecampAccessToken(env);

  const url =
    `https://3.basecampapi.com/${env.BASECAMP_ACCOUNT_ID}` +
    `/buckets/${env.BASECAMP_PROJECT_ID}` +
    `/message_boards/${env.BASECAMP_MESSAGE_BOARD_ID}/messages.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      // بيسكامب يشترط User-Agent يحوي وسيلة تواصل.
      'User-Agent': 'NAF Accountant (fahad2ao@gmail.com)',
    },
    body: JSON.stringify({
      subject,
      content: contentHtml,
      status: 'active',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Basecamp message failed: ${res.status} ${body}`);
  }

  return res.json();
}

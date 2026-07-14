// ============================================================================
// خدمة بيسكامب (Basecamp 3 API) — إرسال التقارير الشهرية
// ============================================================================

/**
 * نشر رسالة على لوحة رسائل مشروع في بيسكامب.
 * يتطلب: BASECAMP_TOKEN (OAuth), BASECAMP_ACCOUNT_ID, BASECAMP_PROJECT_ID,
 *         BASECAMP_MESSAGE_BOARD_ID.
 *
 * @param {string} subject - عنوان الرسالة.
 * @param {string} contentHtml - محتوى الرسالة (HTML مسموح).
 */
export async function postBasecampMessage(env, subject, contentHtml) {
  const url =
    `https://3.basecampapi.com/${env.BASECAMP_ACCOUNT_ID}` +
    `/buckets/${env.BASECAMP_PROJECT_ID}` +
    `/message_boards/${env.BASECAMP_MESSAGE_BOARD_ID}/messages.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.BASECAMP_TOKEN}`,
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

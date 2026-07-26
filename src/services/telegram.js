// ============================================================================
// خدمة تليجرام (Telegram Bot API)
// ============================================================================

const TG_API = 'https://api.telegram.org';

/**
 * إرسال رسالة نصية إلى محادثة تليجرام.
 */
export async function sendTelegramMessage(env, chatId, text) {
  const res = await fetch(`${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * الحصول على رابط تنزيل ملف من تليجرام عبر file_id.
 */
export async function getTelegramFileUrl(env, fileId) {
  const res = await fetch(
    `${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  if (!res.ok) {
    throw new Error(`Telegram getFile failed: ${res.status}`);
  }
  const data = await res.json();
  const filePath = data.result.file_path;
  return `${TG_API}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

/**
 * تنزيل ملف تليجرام كـ ArrayBuffer.
 */
export async function downloadTelegramFile(env, fileId) {
  const url = await getTelegramFileUrl(env, fileId);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Telegram file download failed: ${res.status}`);
  }
  return res.arrayBuffer();
}

/**
 * التحقق من أن معرّف المحادثة مصرّح له.
 * المصدر الأول: جدول telegram_chats (يُدار من اللوحة).
 * المصدر الثاني (احتياطي): AUTHORIZED_CHAT_IDS في Cloudflare (قائمة بفواصل).
 */
export async function isAuthorizedChat(env, chatId) {
  const id = String(chatId);

  // 1) قاعدة البيانات (قابلة للإدارة من اللوحة).
  try {
    const row = await env.DB.prepare(
      `SELECT chat_id FROM telegram_chats WHERE chat_id = ? AND is_active = 1 LIMIT 1`
    )
      .bind(id)
      .first();
    if (row) return true;
  } catch (_) {
    // الجدول غير موجود بعد → نكمل إلى الاحتياطي.
  }

  // 2) الاحتياطي: قائمة الأسرار.
  const allowed = (env.AUTHORIZED_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(id);
}

/**
 * إرسال تنبيه إلى محادثات المسؤولين (فشل مهمة مجدولة مثلاً).
 * لا يرمي أخطاء — التنبيه لا يجب أن يُفشل العملية الأصلية.
 */
export async function notifyAdmins(env, text) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT chat_id FROM telegram_chats WHERE is_active = 1 AND is_admin = 1`
    ).all();
    let chats = (results || []).map((r) => r.chat_id);

    // احتياطي: أول معرّف في قائمة الأسرار.
    if (chats.length === 0) {
      chats = (env.AUTHORIZED_CHAT_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 1);
    }
    for (const chatId of chats) {
      await sendTelegramMessage(env, chatId, text).catch(() => {});
    }
  } catch (_) {
    /* تجاهل */
  }
}

// ============================================================================
// خدمة تليجرام (Telegram Bot API)
// ============================================================================

const TG_API = 'https://api.telegram.org';

/**
 * الوسوم التي يقبلها تليجرام في وضع parse_mode = HTML.
 * ما عداها يرفضه بخطأ 400 ولا يُرسل الرسالة أصلاً.
 */
const TELEGRAM_TAGS =
  /^\/?(b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|a|span|tg-spoiler|tg-emoji)(\s|\/|>|$)/i;

/**
 * تحييد كل ما ليس وسماً مقبولاً في رسالة تليجرام.
 *
 * الرسائل تُبنى بوسوم قليلة معروفة، لكنها تحمل نصوصاً لا نتحكّم بها: ردود
 * واجهات برمجية، أسماء موردين مقروءة من فاتورة، رسائل أخطاء. وردُّ خطأ
 * بصفحة HTML كاملة يحمل `<!doctype html>` فيرفض تليجرام الرسالة كلها —
 * فتضيع رسالة تأكيد عملية رُحّلت فعلاً.
 *
 * التحييد هنا لا عند كل استدعاء: موضع واحد يغطّي كل الرسائل، الحالية
 * والتي تُضاف لاحقاً.
 */
export function sanitizeTelegramHtml(text) {
  return String(text ?? '')
    // محرف & خارج الكيانات المعروفة يُربك المحلّل.
    .replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/<[^>]*>?/g, (tag) => (TELEGRAM_TAGS.test(tag.slice(1)) ? tag : tag.replace(/</g, '&lt;')));
}

/**
 * إرسال رسالة نصية إلى محادثة تليجرام.
 *
 * عند رفض تليجرام للتنسيق (وسم غير مقبول أو غير مغلق) تُعاد المحاولة نصّاً
 * صرفاً بلا parse_mode: وصولُ الرسالة بلا تنسيق أفضل من ضياعها، خاصة أنها
 * قد تكون تأكيد عملية رُحّلت إلى وافق.
 */
export async function sendTelegramMessage(env, chatId, text) {
  const clean = sanitizeTelegramHtml(text);

  const post = (payload) =>
    fetch(`${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, ...payload }),
    });

  let res = await post({ text: clean, parse_mode: 'HTML' });
  if (res.ok) return res.json();

  const body = await res.text();
  if (res.status === 400 && /can't parse entities/i.test(body)) {
    // نزع الوسوم وإرسالها نصّاً صرفاً.
    const plain = clean.replace(/<[^>]*>/g, '');
    res = await post({ text: plain });
    if (res.ok) return res.json();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  throw new Error(`Telegram sendMessage failed: ${res.status} ${body.slice(0, 300)}`);
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

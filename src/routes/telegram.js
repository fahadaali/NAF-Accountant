// ============================================================================
// مسار ويبهوك تليجرام (POST /api/telegram-webhook)
// ============================================================================

import { Hono } from 'hono';
import { isAuthorizedChat } from '../services/telegram.js';
import { processTelegramUpdate } from '../lib/processor.js';
import { writeLog } from '../lib/db.js';

const telegram = new Hono();

telegram.post('/telegram-webhook', async (c) => {
  const env = c.env;

  // 1) التحقق من السر (Secret Token) الذي يرسله تليجرام في الترويسة.
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let update;
  try {
    update = await c.req.json();
  } catch (_) {
    return c.json({ ok: true }); // نتجاهل أي جسم غير صالح بهدوء
  }

  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;

  // 2) التحقق من أن المحادثة مصرّح لها.
  if (!chatId || !isAuthorizedChat(env, chatId)) {
    await writeLog(env.DB, {
      action: 'telegram_webhook',
      status: 'error',
      errorDetails: `unauthorized chat: ${chatId}`,
    });
    // نُرجع 200 حتى لا يعيد تليجرام المحاولة، لكن لا نعالج شيئاً.
    return c.json({ ok: true });
  }

  // 3) تنفيذ غير متزامن — نُرجع 200 فوراً ونعالج في الخلفية.
  c.executionCtx.waitUntil(processTelegramUpdate(env, update));

  return c.json({ ok: true });
});

export default telegram;

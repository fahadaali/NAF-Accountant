// ============================================================================
// مسار ويبهوك تليجرام (POST /api/telegram-webhook)
//
// ═══ لماذا يُسجَّل كل ردّ هنا ═══
//
// كان هذا الباب يردّ أربعة ردود صامتة: سرٌّ لا يطابق (٤٠١)، وجسمٌ غير
// صالح، وتحديثٌ بلا رسالة، ومحادثةٌ غير مصرّح لها. ثلاثةٌ منها لا تكتب
// سطراً في أي سجلّ، والرابع يكتب سطراً واحداً لا يفرّق بين حالتين.
//
// وأثرُ ذلك أن أشيع أعطال البوت — سرٌّ اختلف طرفاه، أو رابطٌ بقي على نطاق
// سابق — يظهر للمستخدم صمتاً تامّاً، ولا يظهر لمسؤول المنصة شيئاً إطلاقاً:
// لا في اللوحة ولا في السجلّات. فيبقى السؤال بلا جواب: هل رُحّل القيد ولم
// يصلني الرد، أم المنصة متوقفة؟
//
// فصار كل ردٍّ يمرّ من هنا يترك أثراً يُقرأ من صفحة السجلّات، ومن يُردّ في
// محادثة خاصة يُخبَر بسبب ردّه. وحالةُ القناة نفسها تُقرأ من
// `‎/api/telegram/status`، وتُفحص كل ليلة في المهمة المجدولة.
// ============================================================================

import { Hono } from 'hono';
import { checkChatAuthorization, sendTelegramMessage } from '../services/telegram.js';
import { processTelegramUpdate } from '../lib/processor.js';
import { writeLog } from '../lib/db.js';

const telegram = new Hono();

/** كل ردود هذا الباب تحت مفتاح سجلّ واحد مسجَّل في `naf-terms.md`. */
const LOG_ACTION = 'telegram_webhook';

/** نوع التحديث الوارد — لتمييز ما لا نعالجه عمّا لا نعرفه. */
function updateKind(update) {
  const keys = Object.keys(update || {}).filter((k) => k !== 'update_id');
  return keys.length ? keys.join(',') : 'empty';
}

telegram.post('/telegram-webhook', async (c) => {
  const env = c.env;

  // 1) التحقق من السر (Secret Token) الذي يرسله تليجرام في الترويسة.
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    /* هذا السطر هو الفرق بين عطلٍ يُشخَّص وعطلٍ يُخمَّن. تليجرام يعيد
       المحاولة ثم يستسلم، ويسجّل السبب عنده في `last_error_message` — وهنا
       لم يكن يُسجَّل شيء، فيبدو البوت ميتاً بلا دليل واحد. */
    await writeLog(env.DB, {
      action: LOG_ACTION,
      status: 'error',
      errorDetails: secret
        ? 'رُفض تحديث وارد: سرّ الترويسة لا يطابق TELEGRAM_WEBHOOK_SECRET'
        : 'رُفض تحديث وارد: وصل بلا ترويسة سرّ والمنصة تشترطها',
    });
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let update;
  try {
    update = await c.req.json();
  } catch (_) {
    await writeLog(env.DB, {
      action: LOG_ACTION,
      status: 'error',
      errorDetails: 'جسم طلب غير صالح (تعذّر تحليله كـ JSON)',
    });
    return c.json({ ok: true }); // نُرجع ٢٠٠ حتى لا يعيد تليجرام المحاولة
  }

  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;

  // 2) تحديث لا رسالة فيه (منشور قناة، تغيّر عضوية، ردّ استعلام...).
  //    هذا ليس رفض صلاحية — وخلطُه بالرفض كان يكتب «unauthorized chat:
  //    undefined» فيُقرأ على أنه منع، والسبب أن نوع التحديث غير معالَج أصلاً.
  if (!chatId) {
    await writeLog(env.DB, {
      action: LOG_ACTION,
      status: 'info',
      errorDetails: `تحديث بلا رسالة — النوع: ${updateKind(update)}`,
    });
    return c.json({ ok: true });
  }

  // 3) التحقق من أن المحادثة مصرّح لها.
  const auth = await checkChatAuthorization(env, chatId);
  if (!auth.allowed) {
    /* تعذُّرُ قراءة `telegram_chats` يُسقط الجميع إلى قائمة الأسرار، فإن
       كانت فارغة قُفلت المحادثات كلها. وهذا عطلُ قاعدة بيانات لا رفضُ
       صلاحية، فيُقال صراحةً بدل أن يُقرأ منعاً. */
    await writeLog(env.DB, {
      action: LOG_ACTION,
      status: 'error',
      errorDetails: auth.dbError
        ? `تعذّر التحقق من المحادثة ${chatId} — قاعدة البيانات: ${auth.dbError}`
        : `محادثة غير مصرّح لها: ${chatId}`,
    });

    /* والمرسِل يُخبَر بمعرّفه في المحادثات الخاصة وحدها.
       الصمت هنا يبدو للمستخدم عطلاً في المنصة، وهو في الحقيقة إعدادٌ ناقص
       يُصلَح بسطر واحد في اللوحة — لكنه يحتاج المعرّف، ولا سبيل له إليه.
       ويُقصر على الخاصة كي لا يردّ البوت في مجموعة لم يُدعَ إليها. */
    if (message.chat.type === 'private') {
      await sendTelegramMessage(
        env,
        chatId,
        `🚫 <b>هذه المحادثة غير مصرّح لها</b>\n\n` +
          `معرّف محادثتك: <code>${chatId}</code>\n\n` +
          `أرسله إلى مسؤول المنصة ليضيفه من اللوحة (الإعدادات ← محادثات تليجرام).`
      ).catch(() => {});
    }

    // نُرجع 200 حتى لا يعيد تليجرام المحاولة، لكن لا نعالج شيئاً.
    return c.json({ ok: true });
  }

  /* 4) تنفيذ غير متزامن — نُرجع 200 فوراً ونعالج في الخلفية.

     والغلاف لازم: وعدٌ يُرفض داخل `waitUntil` لا يُوقف شيئاً ولا يُسجَّل
     في مكان يقرؤه أحد، فيصير أي عطلٍ يسبق مسار الخطأ في المعالج صمتاً
     تامّاً. وهذه آخر شبكة قبل الصمت. */
  c.executionCtx.waitUntil(
    processTelegramUpdate(env, update).catch(async (err) => {
      const msg = err && err.message ? err.message : String(err);
      console.error('processTelegramUpdate rejected:', err);
      await writeLog(env.DB, {
        action: LOG_ACTION,
        status: 'error',
        errorDetails: `فشلت المعالجة بعد الاستلام (chat=${chatId}): ${msg}`,
      });
    })
  );

  return c.json({ ok: true });
});

export default telegram;

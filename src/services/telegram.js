// ============================================================================
// خدمة تليجرام (Telegram Bot API)
// ============================================================================

import { writeLog } from '../lib/db.js';

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
 *
 * @returns {Promise<{allowed:boolean, source:'db'|'secret'|'none', dbError:string|null}>}
 *   `source` و `dbError` للتشخيص: تعذُّرُ قراءة الجدول يسقط إلى قائمة الأسرار،
 *   فإن كانت فارغة قُفلت المحادثات كلها — وذلك عطلُ قاعدة بيانات لا رفضُ
 *   صلاحية، والفرق بينهما لا يُقرأ من نتيجة منطقية واحدة.
 */
export async function checkChatAuthorization(env, chatId) {
  const id = String(chatId);
  let dbError = null;

  // 1) قاعدة البيانات (قابلة للإدارة من اللوحة).
  try {
    const row = await env.DB.prepare(
      `SELECT chat_id FROM telegram_chats WHERE chat_id = ? AND is_active = 1 LIMIT 1`
    )
      .bind(id)
      .first();
    if (row) return { allowed: true, source: 'db', dbError: null };
  } catch (e) {
    // الجدول غير موجود بعد أو القاعدة متعثّرة → نكمل إلى الاحتياطي، ونحتفظ
    // بالسبب كي لا يُقرأ عطلُ القاعدة على أنه محادثة غير مصرّح لها.
    dbError = e.message || String(e);
  }

  // 2) الاحتياطي: قائمة الأسرار.
  const allowed = (env.AUTHORIZED_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes(id)) return { allowed: true, source: 'secret', dbError };
  return { allowed: false, source: 'none', dbError };
}

// ---------------------------------------------------------------------------
// حالة الويبهوك — الطرف الذي لا يُرى من داخل المنصة.
//
// الاتجاهان مستقلّان: المنصة تستطيع أن **ترسل** إلى تليجرام وهي لا تستقبل
// منه شيئاً. فرابطُ ويبهوك يشير إلى نطاقٍ سابق، أو سرٌّ لا يطابق ما سُجّل
// عند تليجرام، يقطعان الوارد وحده — ولا أثر لهما في أي سجلّ هنا، لأن
// الطلب لا يصل أصلاً. والنتيجة صمتٌ تامّ لا يفرّق فيه المستخدم بين
// «المنصة متوقفة» و«رُحّل القيد ولم يصلني الرد».
//
// فهذه الدوال تسأل تليجرام نفسه بدل أن تستنتج، وهي التي يقوم عليها فحصُ
// المهمة الليلية وأمرُ «حالة» في المحادثة.
// ---------------------------------------------------------------------------

/**
 * نداء واجهة تليجرام بلا رمي.
 *
 * التشخيص يحتاج نصّ الخطأ لا انقطاع التنفيذ: «رمز البوت خاطئ» و«الشبكة
 * متعثّرة» و«الرابط مرفوض» ثلاثة أسباب مختلفة، ورميُها جميعاً استثناءً
 * واحداً يخلطها.
 */
async function tgCall(env, method, payload = null) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'رمز بوت تليجرام (TELEGRAM_BOT_TOKEN) غير مضبوط' };
  }
  try {
    const res = await fetch(`${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: `ردّ غير مقروء من تليجرام (${res.status})` };
    if (!data.ok) return { ok: false, error: data.description || `HTTP ${res.status}` };
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** بيانات البوت — يثبت أن الرمز صالح. */
export function getMe(env) {
  return tgCall(env, 'getMe');
}

/** حالة الويبهوك كما يراها تليجرام. */
export function getWebhookInfo(env) {
  return tgCall(env, 'getWebhookInfo');
}

/**
 * الرابط الذي **يجب** أن يكون مسجّلاً عند تليجرام.
 *
 * يُقرأ من الإعداد ولا يُخمَّن: تخمينُه من نطاق الطلب يجعل أي مضيف يصل
 * إلى الـWorker قادراً على أن يُعيد توجيه البوت إليه.
 * @returns {string|null} null إن لم يُضبط الإعداد — فيُبلَّغ ولا يُصلَح شيء.
 */
export function expectedWebhookUrl(env) {
  const explicit = String(env.TELEGRAM_WEBHOOK_URL || '').trim();
  if (explicit) return explicit;
  const origin = String(env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  return origin ? `${origin}/api/telegram-webhook` : null;
}

/** تسجيل الويبهوك على الرابط المطلوب بالسرّ المضبوط حالياً. */
export function setWebhook(env, url) {
  const secret = String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const payload = {
    url,
    // ما يعالجه `processTelegramUpdate` وحده — وما عداه يزحم الطابور بلا فائدة.
    allowed_updates: ['message', 'edited_message'],
  };
  // السرّ يُرسل حين يكون مضبوطاً هنا فقط، فيبقى الطرفان متطابقين دائماً:
  // إرسالُه وهو غير مضبوط يجعل المسار يرفض كل تحديث وارد.
  if (secret) payload.secret_token = secret;
  return tgCall(env, 'setWebhook', payload);
}

/**
 * تقرير حالة القناة الواردة: هل يصل تليجرام إلى هذه المنصة أصلاً؟
 *
 * @returns {Promise<object>} تقرير مقروء — `healthy` يلخّصه، و`problems`
 *   قائمة أسباب عربية تُعرض كما هي.
 */
export async function diagnoseWebhook(env) {
  const expected = expectedWebhookUrl(env);
  const secretSet = !!String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const problems = [];

  const me = await getMe(env);
  if (!me.ok) problems.push(`رمز البوت لا يعمل: ${me.error}`);

  const info = await getWebhookInfo(env);
  if (!info.ok) {
    problems.push(`تعذّرت قراءة حالة الويبهوك: ${info.error}`);
    return {
      healthy: false,
      problems,
      expectedUrl: expected,
      secretSet,
      bot: me.ok ? me.result.username : null,
      webhook: null,
    };
  }

  const w = info.result || {};
  const registered = String(w.url || '');

  if (!registered) {
    problems.push('لا ويبهوك مسجّلاً عند تليجرام — لا يصل إلى المنصة شيء.');
  } else if (expected && registered !== expected) {
    problems.push(`الويبهوك مسجّل على ${registered} بينما المنصة على ${expected}.`);
  }

  /* السرّ لا يُقرأ من تليجرام — `getWebhookInfo` لا يعيده. وطرفاه إن
     اختلفا رُدَّ كل تحديثٍ بـ٤٠١، فيظهر ذلك هنا في `last_error_message`
     («Wrong response from the webhook: 401 Unauthorized»). وهذا أكثر
     أسباب الصمت التامّ شيوعاً وأقلّها ظهوراً في سجلّات المنصة، لأن الطلب
     يُردّ عند الباب فلا يبلغ أي سطر تسجيل. */
  if (w.last_error_message) {
    problems.push(`آخر خطأ تسليم من تليجرام: ${w.last_error_message}`);
    if (/401|unauthorized/i.test(w.last_error_message)) {
      problems.push(
        secretSet
          ? 'يرفض المسار التحديثات: السرّ المسجّل عند تليجرام لا يطابق TELEGRAM_WEBHOOK_SECRET. أعِد تسجيل الويبهوك.'
          : 'يردّ المسار بـ٤٠١ بلا سرٍّ مضبوط — راجع الإعداد.'
      );
    }
  }
  /* المعلّق القليل عابر — رسالةٌ في الطريق لحظةَ الفحص. والمتراكم دليلُ
     انقطاع، فحدُّه خمسة كي لا يصير التنبيه ضجيجاً يُتجاهل. */
  if (Number(w.pending_update_count) >= 5) {
    problems.push(`${w.pending_update_count} تحديثاً معلّقاً لم يُسلَّم — التسليم متوقف.`);
  }
  if (!expected) {
    problems.push('لم يُضبط PUBLIC_ORIGIN ولا TELEGRAM_WEBHOOK_URL، فلا مرجع تُقارن به.');
  }

  return {
    healthy: problems.length === 0,
    problems,
    expectedUrl: expected,
    secretSet,
    bot: me.ok ? me.result.username : null,
    webhook: {
      url: registered,
      pendingUpdateCount: Number(w.pending_update_count || 0),
      lastErrorDate: w.last_error_date || null,
      lastErrorMessage: w.last_error_message || null,
      maxConnections: w.max_connections || null,
      allowedUpdates: w.allowed_updates || null,
      ipAddress: w.ip_address || null,
    },
  };
}

/**
 * إصلاح الرابط إن اختلف عن المطلوب.
 *
 * لا يُخمّن رابطاً: بلا إعدادٍ صريح يُبلِّغ ولا يفعل. والتسجيل لا يُسقط
 * التحديثات المعلّقة — رسائل المستخدم التي لم تُسلَّم بعد تصل بعد الإصلاح.
 *
 * @returns {Promise<{changed:boolean, reason:string, report:object}>}
 */
export async function repairWebhook(env) {
  const report = await diagnoseWebhook(env);
  const expected = report.expectedUrl;

  if (!expected) {
    return { changed: false, reason: 'لا رابط مرجعي مضبوط (PUBLIC_ORIGIN).', report };
  }
  if (report.webhook && report.webhook.url === expected) {
    return { changed: false, reason: 'الرابط مطابق أصلاً.', report };
  }

  const res = await setWebhook(env, expected);
  if (!res.ok) {
    return { changed: false, reason: `تعذّر تسجيل الويبهوك: ${res.error}`, report };
  }
  return { changed: true, reason: `سُجّل الويبهوك على ${expected}.`, report };
}

/**
 * الحارس الليلي — المنصة تلاحظ صممها بنفسها.
 *
 * لا شيء في المنصة كان يسأل تليجرام: «هل ما زلتَ تُسلّم إليّ؟». فانقطاعُ
 * الوارد كان يُكتشف حين يشتكي مستخدم — بعد يوم أو أسبوع. والاتجاه الصادر
 * سليمٌ في هذه الحال، فالتنبيه يصل عبر تليجرام نفسه وإن كان الوارد مقطوعاً.
 *
 * والإصلاح التلقائي مقصورٌ على رابطٍ **مضبوطٍ في الإعداد**: بلا
 * `PUBLIC_ORIGIN` يُبلَّغ ولا يُخمَّن رابط.
 */
export async function runWebhookWatchdog(env) {
  let report = await diagnoseWebhook(env);

  const expected = report.expectedUrl;
  const registered = report.webhook ? report.webhook.url : '';
  const urlWrong = !!expected && registered !== expected;

  let repaired = null;
  if (urlWrong) {
    const res = await setWebhook(env, expected);
    repaired = res.ok;
    if (res.ok) {
      report = await diagnoseWebhook(env);
    } else {
      report.problems.push(`تعذّر تصحيح الرابط تلقائياً: ${res.error}`);
    }
  }

  await writeLog(env.DB, {
    action: 'telegram_webhook',
    status: report.healthy ? 'success' : 'error',
    errorDetails: report.healthy
      ? `فحص ليلي: القناة سليمة${repaired ? ' (صُحّح الرابط تلقائياً)' : ''}`
      : `فحص ليلي: ${report.problems.join(' | ')}`,
  });

  if (repaired) {
    await notifyAdmins(
      env,
      `🔧 <b>صُحّح رابط الويبهوك تلقائياً</b>\n\n` +
        `كان: <code>${registered || 'غير مسجّل'}</code>\n` +
        `صار: <code>${expected}</code>\n\n` +
        `الرسائل التي لم تصل خلال الانقطاع تُسلَّم الآن.`
    );
  } else if (!report.healthy) {
    await notifyAdmins(
      env,
      `🚨 <b>قناة تليجرام الواردة معطّلة</b>\n\n` +
        report.problems.map((p) => `• ${p}`).join('\n') +
        `\n\nالمنصة لا تستقبل رسائل. راجع «حالة تليجرام» في اللوحة.`
    );
  }

  return { healthy: report.healthy, repaired, problems: report.problems };
}

/**
 * إرسال تنبيه إلى محادثات المسؤولين (فشل مهمة مجدولة مثلاً).
 * لا يرمي أخطاء — التنبيه لا يجب أن يُفشل العملية الأصلية.
 */
export async function notifyAdmins(env, text) {
  let chats = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT chat_id FROM telegram_chats WHERE is_active = 1 AND is_admin = 1`
    ).all();
    chats = (results || []).map((r) => r.chat_id);
  } catch (_) {
    /* الجدول غير موجود أو القاعدة متعثّرة → الاحتياطي أدناه. */
  }

  // احتياطي: أول معرّف في قائمة الأسرار.
  if (chats.length === 0) {
    chats = (env.AUTHORIZED_CHAT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 1);
  }

  /* ولا تنبيهَ بلا وجهة: قناةُ إنذارٍ لا مستقبل لها أسوأ من غيابها، لأنها
     تُطمئن من ظنّها تعمل. فيُكتب ذلك سطراً يُقرأ من اللوحة. */
  if (chats.length === 0) {
    await writeLog(env.DB, {
      action: 'telegram_notify',
      status: 'error',
      errorDetails: 'تنبيه لم يُرسَل: لا محادثة مسؤول نشطة ولا AUTHORIZED_CHAT_IDS',
    });
    return;
  }

  for (const chatId of chats) {
    try {
      await sendTelegramMessage(env, chatId, text);
    } catch (e) {
      // فشلُ التنبيه نفسه لا يُفشل ما استدعاه، لكنه لا يُبتلع: رمزُ بوتٍ
      // بُدّل يجعل كل إنذارٍ يضيع، فيبقى العطل بلا صوت في كل قناة.
      await writeLog(env.DB, {
        action: 'telegram_notify',
        status: 'error',
        errorDetails: `تعذّر تنبيه ${chatId}: ${e.message || String(e)}`,
      });
    }
  }
}

// ============================================================================
// الخروج من جلسة المنصة.
//
// ليس في وثيقة الربط، وأُضيف لأن زرّ «تسجيل الخروج» قائم في اللوحة: بلا هذا
// المسار يمسح الزرّ رمزاً لم يعد يُستعمل ويبقى كوكي الجلسة صالحاً — وهو
// انحدار في وظيفة قائمة.
//
// يمسح الجلسة من KV أولاً ثم الكوكي: الكوكي وحده لا يكفي، فمعرّف الجلسة
// يبقى صالحاً لو أُعيد إرساله.
//
// وهذا خروج من هذه المنصة وحدها، لا من المركز — والدخول التالي يمرّ به.
// ============================================================================

import { clearCookie, readCookie } from 'naf-auth';
import { authConfig } from './config.js';

export const ssoLogout = async (c) => {
  const config = authConfig(c.env);
  const sid = readCookie(c.req.raw, config.cookieName);
  if (sid) await config.kv(c.env).delete(`sess:${sid}`);

  return new Response(null, {
    status: 302,
    headers: { location: '/', 'set-cookie': clearCookie(config.cookieName) },
  });
};

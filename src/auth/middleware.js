// ============================================================================
// وسيط الدخول الموحّد — يستورد وسيط الحزمة ولا يعيد بناء شيء منه.
//
// يحوّل غير المسجَّل إلى المركز، ويرفض الموقوف محلياً، ويحقن
// `{ id, role, perms }` في سياق الطلب. والمسارات تقرأه من `c.get('user')`.
// ============================================================================

import { honoMiddleware, timingSafeEqual } from 'naf-auth';
import { authConfig } from './config.js';

/**
 * المفتاح الآلي يمرّ قبل الوسيط.
 *
 * `DASHBOARD_API_KEY` استعمال آليّ قائم — مزامنة و curl وأتمتة — لا متصفّح
 * فيه ولا كوكي، فلا معنى لتحويله إلى المركز. وبلا هذا الاستثناء تنكسر كل
 * أتمتة تعتمده، وهو انحدار في وظيفة قائمة.
 *
 * والمقارنة زمنية ثابتة، والمفتاح من الأسرار لا من الكود.
 * وما بعده يُعامَل في `authenticate` كما كان: مسؤولاً آلياً.
 */
function isMachineKey(c) {
  const key = c.env.DASHBOARD_API_KEY;
  if (!key) return false;
  const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return !!token && timingSafeEqual(token, key);
}

export const ssoMiddleware = (c, next) => {
  if (isMachineKey(c)) return next();
  return honoMiddleware(authConfig(c.env))(c, next);
};

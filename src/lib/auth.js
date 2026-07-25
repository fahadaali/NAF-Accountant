// ============================================================================
// مساعدات المصادقة (Authentication) — تشفير كلمة المرور والجلسات.
// تعمل على Web Crypto المتوفّرة في Cloudflare Workers.
// ============================================================================

const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_DAYS = 7;

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * اشتقاق تجزئة كلمة المرور عبر PBKDF2-SHA256.
 * @param {string} password
 * @param {string} [saltHex] - عند التحقق، مرّر الملح المخزّن.
 * @returns {Promise<{salt: string, hash: string}>}
 */
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(bits) };
}

/** مقارنة زمنية ثابتة لتجنّب هجمات التوقيت. */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** التحقق من كلمة المرور مقابل التجزئة المخزّنة. */
export async function verifyPassword(password, saltHex, expectedHashHex) {
  const { hash } = await hashPassword(password, saltHex);
  return safeEqual(hash, expectedHashHex);
}

/** إنشاء جلسة جديدة وإرجاع رمزها. */
export async function createSession(db, userId) {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString();
  await db
    .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(token, userId, expires)
    .run();
  return token;
}

/**
 * التحقق من رمز الجلسة وإرجاع المستخدم (أو null).
 */
export async function getUserBySession(db, token) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.is_active = 1`
    )
    .bind(token)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    // جلسة منتهية — نظّفها.
    await db.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    return null;
  }
  return { id: row.id, email: row.email, role: row.role };
}

/** حذف جلسة (تسجيل خروج). */
export async function deleteSession(db, token) {
  if (!token) return;
  await db.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
}

/** عدد المستخدمين الحاليين (لتحديد ما إذا كان الإعداد الأول مطلوباً). */
export async function countUsers(db) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM users`).first();
  return row ? row.n : 0;
}

/**
 * تحقّق موحّد لطلبات الـ API: يقبل جلسة مستخدم صالحة أو DASHBOARD_API_KEY.
 * يُرجع كائن المستخدم، أو { apiKey: true } للمفتاح الآلي، أو null.
 */
export async function authenticate(c) {
  const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  if (c.env.DASHBOARD_API_KEY && token === c.env.DASHBOARD_API_KEY) return { apiKey: true };
  return getUserBySession(c.env.DB, token);
}

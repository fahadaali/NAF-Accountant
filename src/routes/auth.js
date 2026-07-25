// ============================================================================
// مسارات المصادقة (Auth) — /api/auth/*
// - status   : هل يوجد مستخدمون؟ (لعرض شاشة إنشاء المسؤول الأول)
// - bootstrap: إنشاء حساب المسؤول الأول (يعمل فقط عند عدم وجود مستخدمين)
// - login    : تسجيل الدخول → رمز جلسة
// - me        : بيانات المستخدم الحالي من الرمز
// - logout   : إنهاء الجلسة
// ============================================================================

import { Hono } from 'hono';
import {
  hashPassword,
  verifyPassword,
  createSession,
  getUserBySession,
  deleteSession,
  countUsers,
} from '../lib/auth.js';

const auth = new Hono();

function bearer(c) {
  const h = c.req.header('Authorization') || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// حالة الإعداد: هل تم إنشاء مستخدم؟
auth.get('/auth/status', async (c) => {
  const n = await countUsers(c.env.DB);
  return c.json({ ok: true, hasUsers: n > 0 });
});

// إنشاء المسؤول الأول — متاح فقط عند عدم وجود أي مستخدم.
auth.post('/auth/bootstrap', async (c) => {
  const n = await countUsers(c.env.DB);
  if (n > 0) {
    return c.json({ ok: false, error: 'تم إنشاء حساب المسؤول مسبقاً.' }, 409);
  }

  // حماية اختيارية: إن ضُبط ADMIN_BOOTSTRAP_TOKEN فيجب مطابقته.
  if (c.env.ADMIN_BOOTSTRAP_TOKEN) {
    if (bearer(c) !== c.env.ADMIN_BOOTSTRAP_TOKEN) {
      return c.json({ ok: false, error: 'رمز التهيئة غير صحيح.' }, 401);
    }
  }

  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !emailRe.test(email)) {
    return c.json({ ok: false, error: 'بريد إلكتروني غير صالح.' }, 400);
  }
  if (!password || password.length < 8) {
    return c.json({ ok: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' }, 400);
  }

  const { salt, hash } = await hashPassword(password);
  const res = await c.env.DB.prepare(
    `INSERT INTO users (email, password_hash, password_salt, role)
     VALUES (?, ?, ?, 'admin')`
  )
    .bind(email.toLowerCase(), hash, salt)
    .run();

  const token = await createSession(c.env.DB, res.meta.last_row_id);
  return c.json({ ok: true, token, user: { email: email.toLowerCase(), role: 'admin' } });
});

// تسجيل الدخول.
auth.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !password) {
    return c.json({ ok: false, error: 'البريد وكلمة المرور مطلوبان.' }, 400);
  }
  const user = await c.env.DB.prepare(
    `SELECT id, email, password_hash, password_salt, role, is_active
     FROM users WHERE email = ?`
  )
    .bind(String(email).toLowerCase())
    .first();

  const genericErr = () =>
    c.json({ ok: false, error: 'البريد أو كلمة المرور غير صحيحة.' }, 401);

  if (!user || !user.is_active) return genericErr();
  const valid = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!valid) return genericErr();

  const token = await createSession(c.env.DB, user.id);
  return c.json({ ok: true, token, user: { email: user.email, role: user.role } });
});

// المستخدم الحالي.
auth.get('/auth/me', async (c) => {
  const user = await getUserBySession(c.env.DB, bearer(c));
  if (!user) return c.json({ ok: false, error: 'unauthorized' }, 401);
  return c.json({ ok: true, user });
});

// تسجيل الخروج.
auth.post('/auth/logout', async (c) => {
  await deleteSession(c.env.DB, bearer(c));
  return c.json({ ok: true });
});

export default auth;

// ============================================================================
// مسارات الإدارة (Admin) — المستخدمون، محادثات تليجرام، العمليات المتكرّرة
// جميعها تتطلب صلاحية "مسؤول" (admin).
// ============================================================================

import { Hono } from 'hono';
import { authenticate, hashPassword } from '../lib/auth.js';

const admin = new Hono();

// ---- الحماية: مسؤول فقط ----
admin.use('*', async (c, next) => {
  const who = await authenticate(c);
  if (!who) return c.json({ ok: false, error: 'unauthorized' }, 401);
  // مفتاح الـ API الآلي يُعامل كمسؤول؛ المستخدم يجب أن يكون admin.
  if (!who.apiKey && who.role !== 'admin') {
    return c.json({ ok: false, error: 'هذه العملية تتطلب صلاحية مسؤول.' }, 403);
  }
  await next();
});

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================ المستخدمون ============================

admin.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, role, is_active, created_at FROM users ORDER BY id ASC`
  ).all();
  return c.json({ ok: true, users: results || [] });
});

admin.post('/users', async (c) => {
  const { email, password, role = 'user' } = await c.req.json().catch(() => ({}));
  if (!email || !emailRe.test(email)) {
    return c.json({ ok: false, error: 'بريد إلكتروني غير صالح.' }, 400);
  }
  if (!password || password.length < 8) {
    return c.json({ ok: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' }, 400);
  }
  const r = ['admin', 'user'].includes(role) ? role : 'user';
  const { salt, hash } = await hashPassword(password);
  try {
    await c.env.DB.prepare(
      `INSERT INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, ?)`
    )
      .bind(email.toLowerCase(), hash, salt, r)
      .run();
  } catch (_) {
    return c.json({ ok: false, error: 'البريد مسجّل مسبقاً.' }, 409);
  }
  return c.json({ ok: true });
});

admin.post('/users/update', async (c) => {
  const { id, role, is_active, password } = await c.req.json().catch(() => ({}));
  if (!id) return c.json({ ok: false, error: 'معرّف المستخدم مطلوب.' }, 400);

  if (role && ['admin', 'user'].includes(role)) {
    await c.env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, id).run();
  }
  if (is_active !== undefined) {
    await c.env.DB.prepare(`UPDATE users SET is_active = ? WHERE id = ?`)
      .bind(is_active ? 1 : 0, id)
      .run();
    // تعطيل المستخدم يُنهي جلساته.
    if (!is_active) {
      await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id).run();
    }
  }
  if (password) {
    if (password.length < 8) {
      return c.json({ ok: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' }, 400);
    }
    const { salt, hash } = await hashPassword(password);
    await c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`)
      .bind(hash, salt, id)
      .run();
  }
  return c.json({ ok: true });
});

// ==================== محادثات تليجرام المصرّح لها ====================

admin.get('/chats', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT chat_id, label, is_admin, is_active, created_at FROM telegram_chats ORDER BY created_at ASC`
  ).all();
  return c.json({ ok: true, chats: results || [] });
});

admin.post('/chats', async (c) => {
  const { chat_id, label, is_admin = 0, is_active = 1 } = await c.req.json().catch(() => ({}));
  if (!chat_id || !/^-?\d+$/.test(String(chat_id).trim())) {
    return c.json({ ok: false, error: 'معرّف المحادثة يجب أن يكون رقماً.' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO telegram_chats (chat_id, label, is_admin, is_active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
        label = excluded.label,
        is_admin = excluded.is_admin,
        is_active = excluded.is_active`
  )
    .bind(String(chat_id).trim(), label || '', is_admin ? 1 : 0, is_active ? 1 : 0)
    .run();
  return c.json({ ok: true });
});

admin.post('/chats/delete', async (c) => {
  const { chat_id } = await c.req.json().catch(() => ({}));
  if (!chat_id) return c.json({ ok: false, error: 'معرّف المحادثة مطلوب.' }, 400);
  await c.env.DB.prepare(`DELETE FROM telegram_chats WHERE chat_id = ?`)
    .bind(String(chat_id))
    .run();
  return c.json({ ok: true });
});

// ==================== العمليات المتكرّرة ====================

admin.get('/recurring', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, label, day_of_month, template_json, notify_chat_id, is_active, last_run_ym, created_at
     FROM recurring_transactions ORDER BY id DESC`
  ).all();
  return c.json({ ok: true, recurring: results || [] });
});

/** إنشاء قالب متكرّر من عملية موجودة (نستنسخ processed_json). */
admin.post('/recurring/from-transaction', async (c) => {
  const { transaction_id, label, day_of_month } = await c.req.json().catch(() => ({}));
  const day = Math.min(Math.max(Number(day_of_month) || 1, 1), 28);
  if (!transaction_id) return c.json({ ok: false, error: 'معرّف العملية مطلوب.' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT processed_json, telegram_chat_id FROM transactions WHERE id = ?`
  )
    .bind(transaction_id)
    .first();
  if (!row || !row.processed_json) {
    return c.json({ ok: false, error: 'لم أجد العملية أو لا تحتوي بيانات صالحة.' }, 404);
  }

  await c.env.DB.prepare(
    `INSERT INTO recurring_transactions (label, day_of_month, template_json, notify_chat_id)
     VALUES (?, ?, ?, ?)`
  )
    .bind(label || 'عملية متكرّرة', day, row.processed_json, row.telegram_chat_id)
    .run();
  return c.json({ ok: true });
});

admin.post('/recurring/update', async (c) => {
  const { id, is_active, day_of_month, label } = await c.req.json().catch(() => ({}));
  if (!id) return c.json({ ok: false, error: 'المعرّف مطلوب.' }, 400);
  if (is_active !== undefined) {
    await c.env.DB.prepare(`UPDATE recurring_transactions SET is_active = ? WHERE id = ?`)
      .bind(is_active ? 1 : 0, id)
      .run();
  }
  if (day_of_month) {
    const day = Math.min(Math.max(Number(day_of_month), 1), 28);
    await c.env.DB.prepare(`UPDATE recurring_transactions SET day_of_month = ? WHERE id = ?`)
      .bind(day, id)
      .run();
  }
  if (label) {
    await c.env.DB.prepare(`UPDATE recurring_transactions SET label = ? WHERE id = ?`)
      .bind(label, id)
      .run();
  }
  return c.json({ ok: true });
});

admin.post('/recurring/delete', async (c) => {
  const { id } = await c.req.json().catch(() => ({}));
  if (!id) return c.json({ ok: false, error: 'المعرّف مطلوب.' }, 400);
  await c.env.DB.prepare(`DELETE FROM recurring_transactions WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

export default admin;

// ============================================================================
// مسارات لوحة التحكم (Dashboard API)
// محمية بمفتاح DASHBOARD_API_KEY عبر ترويسة Authorization: Bearer <key>.
// ============================================================================

import { Hono } from 'hono';
import { syncChartOfAccounts } from '../services/sync.js';
import { getUserBySession } from '../lib/auth.js';

const dashboard = new Hono();

// ---- وسيط الحماية ----
// يقبل: (1) رمز جلسة مستخدم صالح (تسجيل الدخول)، أو
//        (2) DASHBOARD_API_KEY (للاستخدام الآلي مثل curl والمزامنة).
dashboard.use('*', async (c, next) => {
  const auth = c.req.header('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return c.json({ ok: false, error: 'unauthorized' }, 401);

  // مفتاح آلي
  if (c.env.DASHBOARD_API_KEY && token === c.env.DASHBOARD_API_KEY) {
    return next();
  }
  // جلسة مستخدم
  const user = await getUserBySession(c.env.DB, token);
  if (user) {
    c.set('user', user);
    return next();
  }
  return c.json({ ok: false, error: 'unauthorized' }, 401);
});

// ---- العمليات الأخيرة ----
dashboard.get('/transactions', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, telegram_message_id, telegram_chat_id, source_type,
            raw_text, processed_json, wafeq_draft_id, status,
            error_message, created_at, updated_at
     FROM transactions
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();
  return c.json({ ok: true, transactions: results || [] });
});

// ---- إحصائيات موجزة ----
dashboard.get('/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM transactions GROUP BY status`
  ).all();
  const total = (results || []).reduce((s, r) => s + r.count, 0);
  return c.json({ ok: true, total, byStatus: results || [] });
});

// ---- شجرة الحسابات ----
dashboard.get('/accounts', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, account_code, account_name, account_type,
            wafeq_account_id, is_active, updated_at
     FROM chart_of_accounts
     ORDER BY account_code ASC`
  ).all();
  return c.json({ ok: true, accounts: results || [] });
});

// ---- إضافة / تحديث حساب ----
dashboard.post('/accounts', async (c) => {
  const body = await c.req.json();
  const { account_code, account_name, account_type, wafeq_account_id = null, is_active = 1 } = body;
  if (!account_code || !account_name || !account_type) {
    return c.json({ ok: false, error: 'missing fields' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO chart_of_accounts (account_code, account_name, account_type, wafeq_account_id, is_active)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_code) DO UPDATE SET
        account_name = excluded.account_name,
        account_type = excluded.account_type,
        wafeq_account_id = excluded.wafeq_account_id,
        is_active = excluded.is_active,
        updated_at = datetime('now')`
  )
    .bind(account_code, account_name, account_type, wafeq_account_id, is_active ? 1 : 0)
    .run();
  return c.json({ ok: true });
});

// ---- مزامنة شجرة الحسابات من وافق (يدوياً) ----
dashboard.post('/accounts/sync', async (c) => {
  try {
    const { synced } = await syncChartOfAccounts(c.env);
    return c.json({ ok: true, synced });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ---- سجل العمليات ----
dashboard.get('/logs', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 300);
  const { results } = await c.env.DB.prepare(
    `SELECT id, transaction_id, action, status, error_details, timestamp
     FROM logs ORDER BY timestamp DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return c.json({ ok: true, logs: results || [] });
});

// ---- الإعدادات غير الحساسة (حالة اتصال المفاتيح فقط، دون كشف قيمها) ----
dashboard.get('/settings/status', async (c) => {
  const env = c.env;
  const mask = (v) => (v ? true : false);
  return c.json({
    ok: true,
    keys: {
      TELEGRAM_BOT_TOKEN: mask(env.TELEGRAM_BOT_TOKEN),
      CLAUDE_API_KEY: mask(env.CLAUDE_API_KEY),
      WAFEQ_API_KEY: mask(env.WAFEQ_API_KEY),
      BASECAMP_TOKEN: mask(env.BASECAMP_TOKEN),
      AUTHORIZED_CHAT_IDS: mask(env.AUTHORIZED_CHAT_IDS),
    },
  });
});

export default dashboard;

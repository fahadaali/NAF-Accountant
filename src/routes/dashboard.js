// ============================================================================
// مسارات لوحة التحكم (Dashboard API)
// محمية بمفتاح DASHBOARD_API_KEY عبر ترويسة Authorization: Bearer <key>.
// ============================================================================

import { Hono } from 'hono';
import { syncChartOfAccounts } from '../services/sync.js';
import { pickProvider } from '../services/transcription.js';
import { authenticate } from '../lib/auth.js';

const dashboard = new Hono();

// ---- وسيط الحماية ----
// يقبل: (1) رمز جلسة مستخدم صالح (تسجيل الدخول)، أو
//        (2) DASHBOARD_API_KEY (للاستخدام الآلي مثل curl والمزامنة).
dashboard.use('*', async (c, next) => {
  const who = await authenticate(c);
  if (!who) return c.json({ ok: false, error: 'unauthorized' }, 401);
  if (who.email) c.set('user', who);
  c.set('isAdmin', !!who.apiKey || who.role === 'admin');
  await next();
});

/** إجراءات تُعدّل البيانات تتطلب صلاحية مسؤول. */
function requireAdmin(c) {
  return c.get('isAdmin')
    ? null
    : c.json({ ok: false, error: 'هذه العملية تتطلب صلاحية مسؤول.' }, 403);
}

// ---- العمليات مع فلاتر وفرز ----
// مرشّحات: status, source_type, q (بحث في النص)، from/to (تاريخ YYYY-MM-DD)
// فرز: sort (created_at|id|status|source_type)، order (asc|desc)
dashboard.get('/transactions', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500);

  const where = [];
  const binds = [];

  const status = c.req.query('status');
  if (status) { where.push('status = ?'); binds.push(status); }

  const sourceType = c.req.query('source_type');
  if (sourceType) { where.push('source_type = ?'); binds.push(sourceType); }

  const q = (c.req.query('q') || '').trim();
  if (q) { where.push('(raw_text LIKE ? OR wafeq_draft_id LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }

  const from = c.req.query('from');
  if (from) { where.push('created_at >= ?'); binds.push(from); }

  const to = c.req.query('to');
  if (to) { where.push('created_at <= ?'); binds.push(to + ' 23:59:59'); }

  // فرز آمن عبر قائمة بيضاء.
  const sortMap = { created_at: 'created_at', id: 'id', status: 'status', source_type: 'source_type' };
  const sortCol = sortMap[c.req.query('sort')] || 'created_at';
  const order = (c.req.query('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  binds.push(limit);

  const { results } = await c.env.DB.prepare(
    `SELECT id, telegram_message_id, telegram_chat_id, source_type,
            raw_text, media_r2_key, processed_json, wafeq_draft_id, status,
            error_message, created_at, updated_at
     FROM transactions
     ${whereSql}
     ORDER BY ${sortCol} ${order}
     LIMIT ?`
  )
    .bind(...binds)
    .all();
  return c.json({ ok: true, transactions: results || [] });
});

// ---- تصدير العمليات CSV (يحترم نفس المرشّحات) ----
dashboard.get('/transactions/export', async (c) => {
  const where = [];
  const binds = [];
  const q = (c.req.query('q') || '').trim();
  const status = c.req.query('status');
  const sourceType = c.req.query('source_type');
  const from = c.req.query('from');
  const to = c.req.query('to');

  if (status) { where.push('status = ?'); binds.push(status); }
  if (sourceType) { where.push('source_type = ?'); binds.push(sourceType); }
  if (q) { where.push('(raw_text LIKE ? OR wafeq_draft_id LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }
  if (from) { where.push('created_at >= ?'); binds.push(from); }
  if (to) { where.push('created_at <= ?'); binds.push(to + ' 23:59:59'); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, source_type, status, raw_text, processed_json, wafeq_draft_id, error_message
     FROM transactions ${whereSql} ORDER BY created_at DESC LIMIT 5000`
  )
    .bind(...binds)
    .all();

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  // المصطلحات من naf-terms.md § المصطلحات المحاسبية
  const typeAr = { manual_journal: 'قيد محاسبي', purchase_bill: 'فاتورة مشتريات', sales_invoice: 'فاتورة مبيعات' };

  const rows = [
    ['الرقم', 'التاريخ', 'المصدر', 'الحالة', 'النوع', 'الوصف', 'جهة الاتصال', 'الإجمالي', 'معرّف وافق', 'النص الأصلي', 'الخطأ'],
  ];

  for (const t of results || []) {
    let r = null;
    try { r = t.processed_json ? JSON.parse(t.processed_json) : null; } catch (_) { r = null; }
    let total = '';
    if (r) {
      const items =
        r.type === 'manual_journal'
          ? (r.manual_journal?.entries || []).map((e) => Number(e.debit || 0))
          : r.type === 'purchase_bill'
            ? (r.bill?.line_items || []).map((li) => Number(li.amount || 0))
            : (r.invoice?.line_items || []).map((li) => Number(li.amount || 0));
      total = items.reduce((s, n) => s + n, 0);
    }
    rows.push([
      t.id,
      t.created_at,
      t.source_type,
      t.status,
      r ? typeAr[r.type] || r.type : '',
      r?.summary || '',
      r?.contact_name || '',
      total,
      t.wafeq_draft_id || '',
      t.raw_text || '',
      t.error_message || '',
    ]);
  }

  // BOM لضمان قراءة العربية بشكل صحيح في Excel.
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="naf-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// ---- عرض ملف مرفق (صوت/صورة) من R2 ----
dashboard.get('/media', async (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ ok: false, error: 'المفتاح مطلوب.' }, 400);
  // لا نسمح إلا بمفاتيح العمليات المخزّنة (منع الوصول العشوائي).
  const row = await c.env.DB.prepare(
    `SELECT media_r2_key FROM transactions WHERE media_r2_key = ? LIMIT 1`
  )
    .bind(key)
    .first();
  if (!row) return c.json({ ok: false, error: 'الملف غير موجود.' }, 404);

  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ ok: false, error: 'الملف غير موجود في التخزين.' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// ---- تحليلات للرسوم البيانية ----
dashboard.get('/analytics', async (c) => {
  const months = Math.min(Math.max(parseInt(c.req.query('months') || '6', 10), 1), 24);
  const { results } = await c.env.DB.prepare(
    `SELECT created_at, processed_json FROM transactions
     WHERE status = 'posted' AND processed_json IS NOT NULL
       AND created_at >= date('now', ?)
     ORDER BY created_at ASC`
  )
    .bind(`-${months} months`)
    .all();

  const byCategory = {};   // المصروفات بالتصنيف (اسم الحساب)
  const byMonth = {};      // الاتجاه الشهري { expenses, revenue }
  const byVendor = {};     // أكبر الموردين

  // كل المبالغ تُجمع بعملة الدفاتر الأساسية. عملية بالدولار تدخل الرسم
  // بمقابلها بالريال — جمع 500 دولار إلى 500 ريال في عمود واحد رقمٌ لا يعني
  // شيئاً، والرسم لا يحمل عمودَ عملة يفرّق بينهما.
  for (const row of results || []) {
    let r;
    try { r = JSON.parse(row.processed_json); } catch (_) { continue; }
    const ym = String(row.created_at).slice(0, 7);
    byMonth[ym] = byMonth[ym] || { month: ym, expenses: 0, revenue: 0 };

    const rate = Number(r.exchange_rate) > 0 ? Number(r.exchange_rate) : 1;
    const toBase = (v) => +(Number(v || 0) * rate).toFixed(2);

    if (r.type === 'sales_invoice') {
      const total = (r.invoice?.line_items || []).reduce((s, li) => s + toBase(li.amount), 0);
      byMonth[ym].revenue += total;
    } else {
      const items =
        r.type === 'purchase_bill'
          ? r.bill?.line_items || []
          : (r.manual_journal?.entries || [])
              .filter((e) => Number(e.debit || 0) > 0)
              .map((e) => ({ account_name: e.account_name, amount: e.debit }));
      for (const li of items) {
        const amt = toBase(li.amount);
        if (!amt) continue;
        const name = li.account_name || 'غير مصنّف';
        byCategory[name] = (byCategory[name] || 0) + amt;
        byMonth[ym].expenses += amt;
      }
      if (r.type === 'purchase_bill' && r.contact_name) {
        const total = (r.bill?.line_items || []).reduce((s, li) => s + toBase(li.amount), 0);
        byVendor[r.contact_name] = (byVendor[r.contact_name] || 0) + total;
      }
    }
  }

  const top = (obj, n) =>
    Object.entries(obj)
      .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);

  return c.json({
    ok: true,
    byCategory: top(byCategory, 8),
    byVendor: top(byVendor, 8),
    monthly: Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ ...m, expenses: +m.expenses.toFixed(2), revenue: +m.revenue.toFixed(2) })),
  });
});

// ---- حذف عمليات محدّدة ----
dashboard.post('/transactions/delete', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const { ids } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ ok: false, error: 'لم تُحدّد أي عملية.' }, 400);
  }
  const clean = ids.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)).slice(0, 500);
  if (clean.length === 0) return c.json({ ok: false, error: 'معرّفات غير صالحة.' }, 400);

  const placeholders = clean.map(() => '?').join(',');
  // حذف السجلّات المرتبطة أولاً ثم العمليات.
  await c.env.DB.prepare(`DELETE FROM logs WHERE transaction_id IN (${placeholders})`)
    .bind(...clean)
    .run();
  const res = await c.env.DB.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`)
    .bind(...clean)
    .run();

  return c.json({ ok: true, deleted: res.meta.changes ?? clean.length });
});

// ---- إحصائيات موجزة ----
dashboard.get('/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM transactions GROUP BY status`
  ).all();
  const total = (results || []).reduce((s, r) => s + r.count, 0);

  /* «مُرحّلة إلى وافق» = ما له مستند في وافق فعلاً، لا كل ما حالته `posted`.
     ردود التحكّم («تأكيد»، رقم اختيار) كانت تُوسم `posted` فتُحتسب هنا —
     وقد صارت تُوسم `received`، لكن صفوفها القديمة باقية في القاعدة. والعدّ
     بوجود المستند يصدق على القديم والجديد معاً. */
  const postedRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM transactions
     WHERE status = 'posted' AND wafeq_draft_id IS NOT NULL AND wafeq_draft_id != ''`
  ).first();

  return c.json({ ok: true, total, byStatus: results || [], postedToWafeq: postedRow?.n ?? 0 });
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
  const denied = requireAdmin(c);
  if (denied) return denied;
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
  const denied = requireAdmin(c);
  if (denied) return denied;
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
    asrProvider: pickProvider(env), // مزوّد تحويل الصوت النشط
    keys: {
      TELEGRAM_BOT_TOKEN: mask(env.TELEGRAM_BOT_TOKEN),
      CLAUDE_API_KEY: mask(env.CLAUDE_API_KEY),
      WAFEQ_API_KEY: mask(env.WAFEQ_API_KEY),
      AUTHORIZED_CHAT_IDS: mask(env.AUTHORIZED_CHAT_IDS),
      DEFAULT_BANK_ACCOUNT_CODE: mask(env.DEFAULT_BANK_ACCOUNT_CODE),
      VAT_TAX_RATE_ID: mask(env.VAT_TAX_RATE_ID),
      // بيسكامب — التجديد التلقائي:
      BASECAMP_CLIENT_ID: mask(env.BASECAMP_CLIENT_ID),
      BASECAMP_CLIENT_SECRET: mask(env.BASECAMP_CLIENT_SECRET),
      BASECAMP_REFRESH_TOKEN: mask(env.BASECAMP_REFRESH_TOKEN),
      // تحويل الصوت إلى نص (اختياري — لرفع الدقة):
      ELEVENLABS_API_KEY: mask(env.ELEVENLABS_API_KEY),
      OPENAI_API_KEY: mask(env.OPENAI_API_KEY),
      // بيسكامب — التوكن الثابت (بديل اختباري):
      BASECAMP_TOKEN: mask(env.BASECAMP_TOKEN),
      BASECAMP_ACCOUNT_ID: mask(env.BASECAMP_ACCOUNT_ID),
      BASECAMP_PROJECT_ID: mask(env.BASECAMP_PROJECT_ID),
      BASECAMP_MESSAGE_BOARD_ID: mask(env.BASECAMP_MESSAGE_BOARD_ID),
    },
  });
});

export default dashboard;

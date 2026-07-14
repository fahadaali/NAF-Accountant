// ============================================================================
// مزامنة شجرة الحسابات من وافق (مشتركة بين المسار اليدوي و Cron الليلي)
// ============================================================================
//
// نقطة النهاية: GET /v1/accounts/ — الاستجابة { count, next, results: [...] }
// حقول الحساب: id (acc_xxx), account_code, account_type, name_ar, name_en
// ============================================================================

import { writeLog } from '../lib/db.js';

/**
 * يسحب كل حسابات وافق (مع ترقيم الصفحات) ويحدّث جدول chart_of_accounts.
 * آمن للتكرار: يُحدّث الموجود ويُضيف الجديد، ولا يحذف شيئاً.
 * @returns {Promise<{synced: number}>}
 */
export async function syncChartOfAccounts(env) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  let url = `${base}/accounts/?page_size=100`;
  let synced = 0;
  let guard = 0; // حماية من حلقة لا نهائية

  while (url && guard < 50) {
    guard++;
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${env.WAFEQ_API_KEY}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Wafeq accounts fetch failed: ${res.status} ${body}`);
    }
    const data = await res.json();
    const list = data.results || data.data || [];

    for (const acc of list) {
      const code = acc.account_code || acc.account_number || String(acc.id);
      const name = acc.name_ar || acc.name_en || acc.name || '';
      const type = (acc.account_type || acc.type || 'expense').toLowerCase();
      const wid = String(acc.id || acc.uuid || '');
      if (!code || !name) continue;
      await env.DB.prepare(
        `INSERT INTO chart_of_accounts (account_code, account_name, account_type, wafeq_account_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_code) DO UPDATE SET
            account_name = excluded.account_name,
            account_type = excluded.account_type,
            wafeq_account_id = excluded.wafeq_account_id,
            updated_at = datetime('now')`
      )
        .bind(code, name, type, wid)
        .run();
      synced++;
    }

    url = data.next || null; // الصفحة التالية إن وُجدت
  }

  await writeLog(env.DB, {
    action: 'accounts_sync',
    status: 'success',
    errorDetails: `synced=${synced}`,
  });

  return { synced };
}

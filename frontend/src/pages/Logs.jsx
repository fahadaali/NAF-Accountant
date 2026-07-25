import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';

const STATUS_STYLE = {
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  info: 'bg-slate-100 text-slate-600',
};

const ACTION_AR = {
  transcribe: 'تفريغ صوتي',
  claude_analyze: 'تحليل ذكي',
  wafeq_post: 'ترحيل إلى وافق',
  wafeq_delete: 'حذف من وافق',
  wafeq_bulk_delete: 'حذف جماعي',
  wafeq_delete_on_edit: 'حذف عند التعديل',
  wafeq_attachment: 'رفع مرفق',
  apply_edit: 'تطبيق تعديل',
  accounts_sync: 'مزامنة الحسابات',
  cron_accounts_sync: 'مزامنة مجدولة',
  cron_recurring: 'عمليات متكرّرة',
  recurring_post: 'ترحيل عملية متكرّرة',
  basecamp_report: 'تقرير بيسكامب',
  financial_report: 'تقرير مالي',
  process_error: 'خطأ معالجة',
  image_saved_r2: 'حفظ صورة',
  telegram_webhook: 'ويبهوك تليجرام',
  duplicate_webhook_skipped: 'تجاهل رسالة مكرّرة',
};

export default function Logs() {
  const [rows, setRows] = useState([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.logs(200);
      setRows(r.logs);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = onlyErrors ? rows.filter((r) => r.status === 'error') : rows;
  const errorCount = rows.filter((r) => r.status === 'error').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-800">سجلّ النظام</h2>
          <p className="text-slate-500 mt-1">تتبّع العمليات والأخطاء لتشخيص المشاكل</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={onlyErrors ? 'btn bg-red-600 text-white' : 'btn-ghost'}
            onClick={() => setOnlyErrors((v) => !v)}
          >
            ⚠️ الأخطاء فقط ({errorCount})
          </button>
          <button className="btn-ghost" onClick={load}>🔄 تحديث</button>
        </div>
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="text-slate-400 text-center py-8">جارٍ التحميل…</p>
        ) : shown.length === 0 ? (
          <p className="text-slate-400 text-center py-8">لا توجد سجلّات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="text-slate-400 text-sm border-b border-slate-100">
                  <th className="py-3 font-semibold">الوقت</th>
                  <th className="py-3 font-semibold">الإجراء</th>
                  <th className="py-3 font-semibold">الحالة</th>
                  <th className="py-3 font-semibold">العملية</th>
                  <th className="py-3 font-semibold">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 align-top hover:bg-slate-50">
                    <td className="py-3 text-slate-400 text-sm whitespace-nowrap">
                      {new Date(l.timestamp + 'Z').toLocaleString('ar')}
                    </td>
                    <td className="py-3 text-slate-700">{ACTION_AR[l.action] || l.action}</td>
                    <td className="py-3">
                      <span className={`badge ${STATUS_STYLE[l.status] || STATUS_STYLE.info}`}>
                        {l.status === 'success' ? 'نجح' : l.status === 'error' ? 'خطأ' : 'معلومة'}
                      </span>
                    </td>
                    <td className="py-3 text-slate-500 text-sm">{l.transaction_id || '—'}</td>
                    <td className="py-3 text-slate-600 text-sm max-w-md break-words">
                      {l.error_details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

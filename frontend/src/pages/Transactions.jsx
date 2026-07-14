import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

function JsonPreview({ json }) {
  const [open, setOpen] = useState(false);
  if (!json) return <span className="text-slate-300">—</span>;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = null;
  }
  return (
    <div>
      <button className="text-naf-600 text-sm hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'إخفاء' : 'عرض القيد'}
      </button>
      {open && (
        <pre className="mt-2 bg-slate-900 text-green-300 text-xs p-3 rounded-lg overflow-x-auto max-w-md" dir="ltr">
          {JSON.stringify(parsed || json, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function Transactions() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const t = await api.transactions(100);
      setRows(t.transactions);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-800">العمليات الأخيرة</h2>
          <p className="text-slate-500 mt-1">جميع العمليات المستلمة عبر بوت تليجرام</p>
        </div>
        <button className="btn-ghost" onClick={load}>🔄 تحديث</button>
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="text-slate-400 text-center py-8">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-400 text-center py-8">لا توجد عمليات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="text-slate-400 text-sm border-b border-slate-100">
                  <th className="py-3 font-semibold">#</th>
                  <th className="py-3 font-semibold">رسالة تليجرام</th>
                  <th className="py-3 font-semibold">المصدر</th>
                  <th className="py-3 font-semibold">النص الأصلي</th>
                  <th className="py-3 font-semibold">مخرجات الذكاء الاصطناعي</th>
                  <th className="py-3 font-semibold">وافق</th>
                  <th className="py-3 font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 align-top hover:bg-slate-50">
                    <td className="py-3 text-slate-600">{t.id}</td>
                    <td className="py-3 text-slate-500 text-sm">{t.telegram_message_id || '—'}</td>
                    <td className="py-3 whitespace-nowrap">
                      {t.source_type === 'voice' ? '🎙️ صوت' : t.source_type === 'image' ? '🖼️ صورة' : '💬 نص'}
                    </td>
                    <td className="py-3 text-slate-700 max-w-xs">
                      <div className="max-w-xs truncate" title={t.raw_text || ''}>{t.raw_text || '—'}</div>
                      {t.error_message && (
                        <div className="text-red-500 text-xs mt-1">⚠️ {t.error_message}</div>
                      )}
                    </td>
                    <td className="py-3"><JsonPreview json={t.processed_json} /></td>
                    <td className="py-3 text-slate-500 text-sm">
                      {t.wafeq_draft_id ? `#${t.wafeq_draft_id}` : '—'}
                    </td>
                    <td className="py-3"><StatusBadge status={t.status} /></td>
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

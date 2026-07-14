import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const STAT_CARDS = [
  { key: 'total', label: 'إجمالي العمليات', icon: '📥', color: 'bg-naf-50 text-naf-700' },
  { key: 'posted', label: 'مسودات في وافق', icon: '✅', color: 'bg-green-50 text-green-700' },
  { key: 'analyzed', label: 'قيد التحليل', icon: '🤖', color: 'bg-amber-50 text-amber-700' },
  { key: 'failed', label: 'عمليات فاشلة', icon: '⚠️', color: 'bg-red-50 text-red-700' },
];

export default function Dashboard() {
  const [stats, setStats] = useState({ total: 0, byStatus: [] });
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([api.stats(), api.transactions(8)]);
        setStats(s);
        setRecent(t.transactions);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const countFor = (status) =>
    status === 'total'
      ? stats.total
      : stats.byStatus?.find((r) => r.status === status)?.count || 0;

  if (loading) return <p className="text-slate-400">جارٍ التحميل…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black text-slate-800">لوحة التحكم</h2>
        <p className="text-slate-500 mt-1">نظرة عامة على العمليات المحاسبية الآلية</p>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 text-red-700">
          تعذّر تحميل البيانات: {error} — تأكد من ضبط مفتاح لوحة التحكم في الإعدادات.
        </div>
      )}

      {/* البطاقات الإحصائية */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {STAT_CARDS.map((c) => (
          <div key={c.key} className="card flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${c.color}`}>
              {c.icon}
            </div>
            <div>
              <div className="text-3xl font-black text-slate-800">{countFor(c.key)}</div>
              <div className="text-slate-500 text-sm">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* أحدث العمليات */}
      <div className="card">
        <h3 className="text-lg font-bold text-slate-800 mb-4">أحدث العمليات</h3>
        {recent.length === 0 ? (
          <p className="text-slate-400 text-center py-8">لا توجد عمليات بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="text-slate-400 text-sm border-b border-slate-100">
                  <th className="py-3 font-semibold">#</th>
                  <th className="py-3 font-semibold">المصدر</th>
                  <th className="py-3 font-semibold">النص</th>
                  <th className="py-3 font-semibold">الحالة</th>
                  <th className="py-3 font-semibold">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-3 text-slate-600">{t.id}</td>
                    <td className="py-3">
                      {t.source_type === 'voice' ? '🎙️ صوت' : t.source_type === 'image' ? '🖼️ صورة' : '💬 نص'}
                    </td>
                    <td className="py-3 text-slate-700 max-w-xs truncate">{t.raw_text || '—'}</td>
                    <td className="py-3"><StatusBadge status={t.status} /></td>
                    <td className="py-3 text-slate-400 text-sm">
                      {new Date(t.created_at + 'Z').toLocaleString('ar')}
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

import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const STATUS_OPTIONS = [
  { v: '', label: 'كل الحالات' },
  { v: 'posted', label: 'مُرحّلة/مسودة' },
  { v: 'awaiting_info', label: 'بانتظار معلومات' },
  { v: 'analyzed', label: 'مُحلّلة' },
  { v: 'failed', label: 'فشلت' },
  { v: 'received', label: 'مستلمة' },
];

const SOURCE_OPTIONS = [
  { v: '', label: 'كل المصادر' },
  { v: 'text', label: '💬 نص' },
  { v: 'voice', label: '🎙️ صوت' },
  { v: 'image', label: '🖼️ صورة' },
];

const SORT_OPTIONS = [
  { v: 'created_at', label: 'التاريخ' },
  { v: 'id', label: 'الرقم' },
  { v: 'status', label: 'الحالة' },
  { v: 'source_type', label: 'المصدر' },
];

function JsonPreview({ json }) {
  const [open, setOpen] = useState(false);
  if (!json) return <span className="text-slate-300">—</span>;
  let parsed;
  try { parsed = JSON.parse(json); } catch { parsed = null; }
  return (
    <div>
      <button className="text-naf-600 text-sm hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'إخفاء' : 'عرض'}
      </button>
      {open && (
        <pre className="mt-2 bg-slate-900 text-green-300 text-xs p-3 rounded-lg overflow-x-auto max-w-md" dir="ltr">
          {JSON.stringify(parsed || json, null, 2)}
        </pre>
      )}
    </div>
  );
}

const DEFAULT_FILTERS = { status: '', source_type: '', q: '', from: '', to: '', sort: 'created_at', order: 'desc' };

export default function Transactions() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.transactions({ ...filters, limit: 200 });
      setRows(t.transactions);
      setSelected(new Set());
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleOrder = () => setF('order', filters.order === 'desc' ? 'asc' : 'desc');
  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  const toggleRow = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`حذف ${selected.size} عملية نهائياً؟ لا يمكن التراجع.`)) return;
    setDeleting(true);
    setMsg('');
    try {
      const r = await api.deleteTransactions([...selected]);
      setMsg(`تم حذف ${r.deleted} عملية.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-800">العمليات</h2>
          <p className="text-slate-500 mt-1">فرز، تصفية، وحذف العمليات</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={deleteSelected} disabled={deleting}>
              🗑️ حذف المحدّد ({selected.size})
            </button>
          )}
          <button className="btn-ghost" onClick={load}>🔄 تحديث</button>
        </div>
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>}
      {msg && <div className="card border-green-200 bg-green-50 text-green-700">{msg}</div>}

      {/* المرشّحات */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            placeholder="🔎 بحث في النص أو رقم وافق"
            value={filters.q}
            onChange={(e) => setF('q', e.target.value)}
          />
          <select className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            value={filters.status} onChange={(e) => setF('status', e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <select className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            value={filters.source_type} onChange={(e) => setF('source_type', e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <select className="flex-1 border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
              value={filters.sort} onChange={(e) => setF('sort', e.target.value)}>
              {SORT_OPTIONS.map((o) => <option key={o.v} value={o.v}>فرز: {o.label}</option>)}
            </select>
            <button className="btn-ghost px-3" onClick={toggleOrder} title="عكس الترتيب">
              {filters.order === 'desc' ? '⬇️' : '⬆️'}
            </button>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">من تاريخ</label>
            <input type="date" className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
              value={filters.from} onChange={(e) => setF('from', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">إلى تاريخ</label>
            <input type="date" className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
              value={filters.to} onChange={(e) => setF('to', e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-ghost w-full justify-center" onClick={resetFilters}>مسح المرشّحات</button>
          </div>
        </div>
      </div>

      {/* الجدول */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 text-sm text-slate-500">
          <span>النتائج: {rows.length}</span>
          {selected.size > 0 && <span>محدّد: {selected.size}</span>}
        </div>
        {loading ? (
          <p className="text-slate-400 text-center py-8">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-400 text-center py-8">لا توجد عمليات مطابقة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="text-slate-400 text-sm border-b border-slate-100">
                  <th className="py-3 w-8">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  </th>
                  <th className="py-3 font-semibold">#</th>
                  <th className="py-3 font-semibold">المصدر</th>
                  <th className="py-3 font-semibold">النص الأصلي</th>
                  <th className="py-3 font-semibold">القيد</th>
                  <th className="py-3 font-semibold">وافق</th>
                  <th className="py-3 font-semibold">الحالة</th>
                  <th className="py-3 font-semibold">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className={`border-b border-slate-50 align-top hover:bg-slate-50 ${selected.has(t.id) ? 'bg-naf-50' : ''}`}>
                    <td className="py-3">
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleRow(t.id)} />
                    </td>
                    <td className="py-3 text-slate-600">{t.id}</td>
                    <td className="py-3 whitespace-nowrap">
                      {t.source_type === 'voice' ? '🎙️' : t.source_type === 'image' ? '🖼️' : '💬'}
                    </td>
                    <td className="py-3 text-slate-700">
                      <div className="max-w-xs truncate" title={t.raw_text || ''}>{t.raw_text || '—'}</div>
                      {t.error_message && <div className="text-red-500 text-xs mt-1">⚠️ {t.error_message}</div>}
                    </td>
                    <td className="py-3"><JsonPreview json={t.processed_json} /></td>
                    <td className="py-3 text-slate-500 text-sm">{t.wafeq_draft_id ? `#${t.wafeq_draft_id}` : '—'}</td>
                    <td className="py-3"><StatusBadge status={t.status} /></td>
                    <td className="py-3 text-slate-400 text-sm whitespace-nowrap">
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

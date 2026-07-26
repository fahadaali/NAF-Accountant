import { useEffect, useState, useCallback } from 'react';
import { api, downloadTransactionsCsv } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { Trash2, FileOutput, RefreshCw, Search, CircleAlert, ArrowUpNarrowWide, ArrowDownWideNarrow, CircleCheck } from 'lucide-react';
import MediaViewer from '../components/MediaViewer.jsx';
import SourceIcon from '../components/SourceIcon.jsx';
import { fmtDateTime } from '../lib/format.js';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';

const STATUS_OPTIONS = [
  { v: '', label: 'كل الحالات' },
  { v: 'posted', label: 'مُرحّلة' },
  { v: 'awaiting_info', label: 'بانتظار معلومات' },
  { v: 'analyzed', label: 'قيد التحليل' },
  { v: 'deleted', label: 'محذوفة' },
  { v: 'failed', label: 'فشلت' },
  { v: 'received', label: 'مستلمة' },
];

// القوائم المنسدلة لا تقبل عناصر React، فالتسمية نصّية هنا
// والأيقونة تظهر في خلية الجدول.
const SOURCE_OPTIONS = [
  { v: '', label: 'كل المصادر' },
  { v: 'text', label: 'نص' },
  { v: 'voice', label: 'صوت' },
  { v: 'image', label: 'صورة' },
];

const SORT_OPTIONS = [
  { v: 'created_at', label: 'التاريخ' },
  { v: 'id', label: 'الرقم' },
  { v: 'status', label: 'الحالة' },
  { v: 'source_type', label: 'المصدر' },
];

function JsonPreview({ json }) {
  const [open, setOpen] = useState(false);
  if (!json) return <span className="text-muted-foreground/60">—</span>;
  let parsed;
  try { parsed = JSON.parse(json); } catch { parsed = null; }
  return (
    <div>
      <button className="text-primary text-sm hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'إخفاء' : 'عرض'}
      </button>
      {open && (
        <pre className="mt-2 bg-muted text-foreground text-xs p-3 rounded-lg overflow-x-auto max-w-md" dir="ltr">
          {JSON.stringify(parsed || json, null, 2)}
        </pre>
      )}
    </div>
  );
}

const DEFAULT_FILTERS = { status: '', source_type: '', q: '', from: '', to: '', sort: 'created_at', order: 'desc' };

export default function Transactions({ isAdmin }) {
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
          <h2 className="text-2xl font-bold text-foreground">العمليات</h2>
          <p className="text-muted-foreground mt-1">فرز، تصفية، وحذف العمليات</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && selected.size > 0 && (
            <button className="btn bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteSelected} disabled={deleting}>
              <Trash2 size={20} /> حذف المحدّد ({selected.size})
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={() =>
              downloadTransactionsCsv(filters).catch((e) => setError(e.message))
            }
          >
            <FileOutput size={20} /> تصدير CSV
          </button>
          <button className="btn-ghost" onClick={load}><RefreshCw size={20} /> تحديث</button>
        </div>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      {/* المرشّحات */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* أيقونة البحث داخل الحقل — الإيموجي لا تصلح داخل placeholder */}
          <div className="relative">
            <Search
              size={20}
              aria-hidden="true"
              className="pointer-events-none absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              style={{ insetInlineStart: '0.75rem' }}
            />
            <input
              className="w-full border border-border rounded-lg ps-10 pe-3 py-2 focus:ring-2 focus:ring-ring outline-none"
              placeholder="بحث في النص أو رقم وافق"
              value={filters.q}
              onChange={(e) => setF('q', e.target.value)}
            />
          </div>
          <select className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            value={filters.status} onChange={(e) => setF('status', e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <select className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            value={filters.source_type} onChange={(e) => setF('source_type', e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <select className="flex-1 border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
              value={filters.sort} onChange={(e) => setF('sort', e.target.value)}>
              {SORT_OPTIONS.map((o) => <option key={o.v} value={o.v}>فرز: {o.label}</option>)}
            </select>
            {/* سهم الفرز رأسي — لا يُقلب في RTL (naf-icons.md) */}
            <button
              className="btn-ghost px-3"
              onClick={toggleOrder}
              title={filters.order === 'desc' ? 'فرز تنازلي' : 'فرز تصاعدي'}
              aria-label={filters.order === 'desc' ? 'فرز تنازلي' : 'فرز تصاعدي'}
            >
              {filters.order === 'desc'
                ? <ArrowDownWideNarrow size={20} aria-hidden="true" />
                : <ArrowUpNarrowWide size={20} aria-hidden="true" />}
            </button>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">من تاريخ</label>
            <input type="date" className="w-full border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
              value={filters.from} onChange={(e) => setF('from', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">إلى تاريخ</label>
            <input type="date" className="w-full border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
              value={filters.to} onChange={(e) => setF('to', e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-ghost w-full justify-center" onClick={resetFilters}>مسح المرشّحات</button>
          </div>
        </div>
      </div>

      {/* الجدول */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 text-sm text-muted-foreground">
          <span>النتائج: {rows.length}</span>
          {selected.size > 0 && <span>محدّد: {selected.size}</span>}
        </div>
        {loading ? (
          <p className="text-muted-foreground text-center py-8">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">لا عمليات تطابق المرشّحات. وسّع المدى أو امسح المرشّحات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-end">
              <thead>
                <tr className="text-muted-foreground text-sm border-b border-border">
                  {isAdmin && (
                    <th className="py-3 w-8">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    </th>
                  )}
                  <th className="py-3 font-semibold">#</th>
                  <th className="py-3 font-semibold">المصدر</th>
                  <th className="py-3 font-semibold">النص الأصلي</th>
                  <th className="py-3 font-semibold">المرفق</th>
                  <th className="py-3 font-semibold">القيد</th>
                  <th className="py-3 font-semibold">وافق</th>
                  <th className="py-3 font-semibold">الحالة</th>
                  <th className="py-3 font-semibold">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className={`border-b border-border align-top hover:bg-background ${selected.has(t.id) ? 'bg-accent' : ''}`}>
                    {isAdmin && (
                      <td className="py-3">
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleRow(t.id)} />
                      </td>
                    )}
                    <td className="py-3 text-foreground">{t.id}</td>
                    <td className="py-3 whitespace-nowrap">
                      <SourceIcon type={t.source_type} />
                    </td>
                    <td className="py-3 text-foreground">
                      <div className="max-w-xs truncate" title={t.raw_text || ''}>{t.raw_text || '—'}</div>
                      {t.error_message && <div className="text-destructive text-xs mt-1"><CircleAlert size={16} className="inline" aria-hidden="true" /> {t.error_message}</div>}
                    </td>
                    <td className="py-3"><MediaViewer mediaKey={t.media_r2_key} /></td>
                    <td className="py-3"><JsonPreview json={t.processed_json} /></td>
                    <td className="py-3 text-muted-foreground text-sm">
                      {t.wafeq_draft_id ? <span dir="ltr">#{t.wafeq_draft_id}</span> : '—'}
                    </td>
                    <td className="py-3"><StatusBadge status={t.status} /></td>
                    <td className="py-3 text-muted-foreground text-sm whitespace-nowrap">
                      {fmtDateTime(t.created_at)}
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

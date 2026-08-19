import { useEffect, useState, useCallback } from 'react';
import { api, downloadTransactionsCsv } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { Trash2, FileOutput, RefreshCw, Search, CircleAlert, ArrowUpNarrowWide, ArrowDownWideNarrow, CircleCheck } from 'lucide-react';
import MediaViewer from '../components/MediaViewer.jsx';
import SourceIcon from '../components/SourceIcon.jsx';
import { fmtDateTime } from '../lib/format.js';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Input } from '../naf/ui/input.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const STATUS_OPTIONS = [
  { v: '', label: 'كل الحالات' },
  { v: 'posted', label: 'مُرحّلة' },
  { v: 'awaiting_info', label: 'بانتظار معلومات' },
  { v: 'analyzed', label: 'قيد التحليل' },
  { v: 'transcribed', label: 'مُفرّغة' },
  { v: 'duplicate', label: 'مكرّرة' },
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
      <Button variant="link" size="sm" className="px-0" onClick={() => setOpen((o) => !o)}>
        {open ? 'إخفاء' : 'عرض'}
      </Button>
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
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="حذف العمليات المحدّدة"
        description={`ستُحذف ${selected.size} عملية من سجلّ المنصة. لا يمكن التراجع عن هذا. القيود المرحّلة في وافق لا تتأثر.`}
        actionLabel="حذف"
        onConfirm={deleteSelected}
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">العمليات</h2>
          <p className="text-muted-foreground mt-1">فرز، تصفية، وحذف العمليات</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && selected.size > 0 && (
            <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={deleting}>
              <Trash2 size={20} /> حذف المحدّد ({selected.size})
            </Button>
          )}
          <Button variant="ghost"
            onClick={() =>
              downloadTransactionsCsv(filters).catch((e) => setError(e.message))
            }
          >
            <FileOutput size={20} /> تصدير CSV
          </Button>
          <Button variant="ghost" onClick={load}><RefreshCw size={20} /> تحديث</Button>
        </div>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      {/* المرشّحات */}
      <Card className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* أيقونة البحث داخل الحقل — الإيموجي لا تصلح داخل placeholder */}
          <div className="relative">
            <Search
              size={20}
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="w-full ps-10"
              placeholder="بحث في النص أو رقم وافق"
              value={filters.q}
              onChange={(e) => setF('q', e.target.value)}
            />
          </div>
          <select aria-label="تصفية بالحالة"
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            value={filters.status} onChange={(e) => setF('status', e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <select aria-label="تصفية بالمصدر"
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            value={filters.source_type} onChange={(e) => setF('source_type', e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <select aria-label="حقل الفرز"
              className="flex-1 border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
              value={filters.sort} onChange={(e) => setF('sort', e.target.value)}>
              {SORT_OPTIONS.map((o) => <option key={o.v} value={o.v}>فرز: {o.label}</option>)}
            </select>
            {/* سهم الفرز رأسي — لا يُقلب في RTL (naf-icons.md) */}
            <Button variant="ghost"
              className="px-3"
              onClick={toggleOrder}
              title={filters.order === 'desc' ? 'فرز تنازلي' : 'فرز تصاعدي'}
              aria-label={filters.order === 'desc' ? 'فرز تنازلي' : 'فرز تصاعدي'}
            >
              {filters.order === 'desc'
                ? <ArrowDownWideNarrow size={20} aria-hidden="true" />
                : <ArrowUpNarrowWide size={20} aria-hidden="true" />}
            </Button>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">من تاريخ</label>
            <Input type="date" className="w-full"
              value={filters.from} onChange={(e) => setF('from', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">إلى تاريخ</label>
            <Input type="date" className="w-full"
              value={filters.to} onChange={(e) => setF('to', e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="ghost" className="w-full justify-center" onClick={resetFilters}>مسح المرشّحات</Button>
          </div>
        </div>
      </Card>

      {/* الجدول */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-3 text-sm text-muted-foreground">
          <span>النتائج: {rows.length}</span>
          {selected.size > 0 && <span>محدّد: {selected.size}</span>}
        </div>
        {loading ? (
          <p className="text-muted-foreground text-center py-8">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">لا عمليات تطابق المرشّحات. وسّع المدى أو امسح المرشّحات.</p>
        ) : (
                      <Table>
              <TableHeader>
                <TableRow>
                  {isAdmin && (
                    <TableHead className="w-8">
                      <input type="checkbox" aria-label="تحديد الكل" checked={allChecked} onChange={toggleAll} />
                    </TableHead>
                  )}
                  <TableHead>#</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>النص الأصلي</TableHead>
                  <TableHead>المرفق</TableHead>
                  <TableHead>القيد</TableHead>
                  <TableHead>وافق</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow
                    key={t.id}
                    className="align-top"
                    data-state={selected.has(t.id) ? 'selected' : undefined}
                  >
                    {isAdmin && (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`تحديد العملية ${t.id}`}
                          checked={selected.has(t.id)}
                          onChange={() => toggleRow(t.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-foreground">{t.id}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <SourceIcon type={t.source_type} />
                    </TableCell>
                    <TableCell className="text-foreground">
                      <div className="max-w-xs truncate" title={t.raw_text || ''}>{t.raw_text || '—'}</div>
                      {t.error_message && <div className="text-destructive text-xs mt-1"><CircleAlert size={16} className="inline" aria-hidden="true" /> {t.error_message}</div>}
                    </TableCell>
                    <TableCell><MediaViewer mediaKey={t.media_r2_key} /></TableCell>
                    <TableCell><JsonPreview json={t.processed_json} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {t.wafeq_draft_id ? <span dir="ltr">#{t.wafeq_draft_id}</span> : '—'}
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {fmtDateTime(t.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        )}
      </Card>
    </div>
  );
}

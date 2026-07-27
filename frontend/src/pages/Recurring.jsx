import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Money from '../components/Money.jsx';
import { fmtNumber } from '../lib/format.js';
import { Select } from '../naf/ui/select.jsx';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import { Button } from '../naf/ui/button.jsx';
import { Input } from '../naf/ui/input.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { Badge } from '../naf/ui/badge.jsx';

// المصطلحات من naf-terms.md § المصطلحات المحاسبية:
// «قيد محاسبي» لا «قيد يومية»، و«فاتورة مبيعات» لا «فاتورة بيع» —
// كلتا الممنوعتين مذكورة بالاسم في عمود الممنوع.
const TYPE_AR = {
  manual_journal: 'قيد محاسبي',
  purchase_bill: 'فاتورة مشتريات',
  sales_invoice: 'فاتورة مبيعات',
};

/** ملخّص القالب — المبلغ عبر Money لا نصّاً، فالرمز U+20C1 لا «ر.س». */
function TemplateSummary({ json }) {
  let r;
  try {
    r = JSON.parse(json);
  } catch {
    return <span className="text-muted-foreground/60">—</span>;
  }
  const items =
    r.type === 'manual_journal'
      ? (r.manual_journal?.entries || []).map((e) => Number(e.debit || 0))
      : r.type === 'purchase_bill'
        ? (r.bill?.line_items || []).map((li) => Number(li.amount || 0))
        : (r.invoice?.line_items || []).map((li) => Number(li.amount || 0));
  const total = items.reduce((s, n) => s + n, 0);
  return (
    <span>
      {TYPE_AR[r.type] || r.type} — <Money value={total} />
      {r.contact_name ? <> — {r.contact_name}</> : null}
    </span>
  );
}

export default function Recurring() {
  const [rows, setRows] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ transaction_id: '', label: '', day_of_month: 1 });
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [r, t] = await Promise.all([api.recurring(), api.transactions({ status: 'posted', limit: 50 })]);
      setRows(r.recurring);
      setTransactions(t.transactions);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const run = async (fn, okMsg) => {
    setMsg('');
    setError('');
    try {
      await fn();
      setMsg(okMsg);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      {pending && (
        <ConfirmDialog
          open={!!pending}
          onOpenChange={(v) => !v && setPending(null)}
          title="حذف القالب"
          description={<>سيتوقّف إنشاء العملية المتكرّرة «<bdi>{pending.label}</bdi>» شهرياً. العمليات التي أُنشئت من قبل تبقى كما هي.</>}
          actionLabel="حذف"
          onConfirm={() => run(() => api.deleteRecurring(pending.id), 'تم الحذف.')}
        />
      )}
      <div>
        <h2 className="text-2xl font-bold text-foreground">العمليات المتكرّرة</h2>
        <p className="text-muted-foreground mt-1">
          عمليات تُنشأ تلقائياً كل شهر (الإيجار، الرواتب…) في اليوم المحدّد
        </p>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">إنشاء قالب متكرّر</h3>
        <p className="text-muted-foreground text-sm mb-4">
          اختر عملية سابقة لتُستنسخ شهرياً — يُستخدم نفس الحسابات والمبالغ والمورّد، ويتغيّر التاريخ فقط.
        </p>
        <form
          className="grid grid-cols-1 sm:grid-cols-4 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.addRecurring(form);
              setForm({ transaction_id: '', label: '', day_of_month: 1 });
            }, 'تم إنشاء القالب المتكرّر.');
          }}
        >
          <Select
            required
            wrapperClassName="sm:col-span-2"
            value={form.transaction_id}
            onChange={(e) => setForm({ ...form, transaction_id: e.target.value })}
          >
            <option value="">— اختر عملية —</option>
            {transactions.map((t) => (
              <option key={t.id} value={t.id}>
                {`#${fmtNumber(t.id)} — ${(t.raw_text || '').slice(0, 45)}`}
              </option>
            ))}
          </Select>
          <Input
            required placeholder="الاسم (مثال: إيجار المكتب)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <div className="flex gap-2">
            <Input
              type="number" min="1" max="28" required title="يوم التنفيذ من الشهر"
              className="w-20"
              value={form.day_of_month}
              onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
            />
            <Button className="flex-1 justify-center" type="submit">إضافة</Button>
          </div>
        </form>
        {/* أرقام غربية — naf-terms.md §٥ */}
        <p className="text-xs text-muted-foreground mt-2">
          يوم التنفيذ من <bdi>1</bdi> إلى <bdi>28</bdi> (لضمان وجوده في كل الشهور).
        </p>
      </Card>

      <Card className="p-6">
                  <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>التفاصيل</TableHead>
                <TableHead>يوم التنفيذ</TableHead>
                <TableHead>آخر تنفيذ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    لم تُضِف أي عملية متكرّرة بعد. ابدأ بإضافة أول عملية.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold text-foreground"><bdi>{r.label}</bdi></TableCell>
                    <TableCell className="text-foreground text-sm"><TemplateSummary json={r.template_json} /></TableCell>
                    <TableCell className="text-foreground tabular-nums"><bdi>{fmtNumber(r.day_of_month)}</bdi></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.last_run_ym ? <bdi>{r.last_run_ym}</bdi> : 'لم يُنفّذ بعد'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.is_active ? 'success' : 'default'}>
                        {r.is_active
                          ? <><CircleCheck size={16} aria-hidden="true" /> نشط</>
                          : <><CircleSlash size={16} aria-hidden="true" /> معطّل</>}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-3">
                      <Button variant="link" size="sm"
                        className="px-0"
                        onClick={() =>
                          run(
                            () => api.updateRecurring({ id: r.id, is_active: !r.is_active }),
                            'تم التحديث.'
                          )
                        }
                      >
                        {r.is_active ? 'تعطيل' : 'تفعيل'}
                      </Button>
                      <Button variant="link" size="sm"
                        className="px-0 text-destructive"
                        onClick={() => setPending(r)}
                      >
                        حذف
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </Card>
    </div>
  );
}

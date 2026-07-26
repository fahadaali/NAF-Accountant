import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtAmount, CURRENCY } from '../lib/format.js';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { CircleAlert, CircleCheck } from 'lucide-react';

const TYPE_AR = {
  manual_journal: 'قيد يومية',
  purchase_bill: 'فاتورة مشتريات',
  sales_invoice: 'فاتورة بيع',
};

function templateSummary(json) {
  try {
    const r = JSON.parse(json);
    const items =
      r.type === 'manual_journal'
        ? (r.manual_journal?.entries || []).map((e) => Number(e.debit || 0))
        : r.type === 'purchase_bill'
          ? (r.bill?.line_items || []).map((li) => Number(li.amount || 0))
          : (r.invoice?.line_items || []).map((li) => Number(li.amount || 0));
    const total = items.reduce((s, n) => s + n, 0);
    return `${TYPE_AR[r.type] || r.type} — ${fmtAmount(total)} ${CURRENCY}${r.contact_name ? ` — ${r.contact_name}` : ''}`;
  } catch {
    return '—';
  }
}

export default function Recurring() {
  const [rows, setRows] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ transaction_id: '', label: '', day_of_month: 1 });
  const [msg, setMsg] = useState('');
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
      <div>
        <h2 className="text-2xl font-bold text-foreground">العمليات المتكرّرة</h2>
        <p className="text-muted-foreground mt-1">
          عمليات تُنشأ تلقائياً كل شهر (الإيجار، الرواتب…) في اليوم المحدّد
        </p>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      <div className="card">
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
          <select
            required
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none sm:col-span-2"
            value={form.transaction_id}
            onChange={(e) => setForm({ ...form, transaction_id: e.target.value })}
          >
            <option value="">— اختر عملية —</option>
            {transactions.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.id} — {(t.raw_text || '').slice(0, 45)}
              </option>
            ))}
          </select>
          <input
            required placeholder="الاسم (مثال: إيجار المكتب)"
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <div className="flex gap-2">
            <input
              type="number" min="1" max="28" required title="يوم التنفيذ من الشهر"
              className="w-20 border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
              value={form.day_of_month}
              onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
            />
            <button className="btn-primary flex-1 justify-center" type="submit">إضافة</button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground mt-2">يوم التنفيذ من ١ إلى ٢٨ (لضمان وجوده في كل الشهور).</p>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-end">
            <thead>
              <tr className="text-muted-foreground text-sm border-b border-border">
                <th className="py-2 font-semibold">الاسم</th>
                <th className="py-2 font-semibold">التفاصيل</th>
                <th className="py-2 font-semibold">يوم التنفيذ</th>
                <th className="py-2 font-semibold">آخر تنفيذ</th>
                <th className="py-2 font-semibold">الحالة</th>
                <th className="py-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-muted-foreground">
                    لم تُضِف أي عملية متكرّرة بعد. ابدأ بإضافة أول عملية.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border hover:bg-background">
                    <td className="py-3 font-semibold text-foreground">{r.label}</td>
                    <td className="py-3 text-foreground text-sm">{templateSummary(r.template_json)}</td>
                    <td className="py-3 text-foreground">{r.day_of_month}</td>
                    <td className="py-3 text-muted-foreground text-sm">{r.last_run_ym || 'لم يُنفّذ بعد'}</td>
                    <td className="py-3">
                      <span className={`badge ${r.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                        {r.is_active ? 'مفعّل' : 'موقوف'}
                      </span>
                    </td>
                    <td className="py-3 flex gap-3">
                      <button
                        className="text-sm text-primary hover:underline"
                        onClick={() =>
                          run(
                            () => api.updateRecurring({ id: r.id, is_active: !r.is_active }),
                            'تم التحديث.'
                          )
                        }
                      >
                        {r.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button
                        className="text-sm text-destructive hover:underline"
                        onClick={() => {
                          if (confirm(`حذف القالب «${r.label}»؟`))
                            run(() => api.deleteRecurring(r.id), 'تم الحذف.');
                        }}
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { RefreshCw, LoaderCircle, CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';

// نوع الحساب تصنيف لا حالة، فيأخذ رموز الرسوم (chart-*) المخصّصة
// للفئات، لا رموز الحالة. والخلفية مخفّفة من الرمز نفسه (CLAUDE.md §6).
const TYPE_LABELS = {
  asset: { label: 'أصل', cls: 'bg-chart-2/10 text-chart-2' },
  liability: { label: 'خصم', cls: 'bg-chart-4/10 text-chart-4' },
  equity: { label: 'حقوق ملكية', cls: 'bg-chart-5/10 text-chart-5' },
  revenue: { label: 'إيراد', cls: 'bg-chart-3/10 text-chart-3' },
  expense: { label: 'مصروف', cls: 'bg-chart-1/10 text-chart-1' },
};

const EMPTY = { account_code: '', account_name: '', account_type: 'expense' };

export default function Accounts({ isAdmin }) {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    try {
      const r = await api.accounts();
      setAccounts(r.accounts);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.addAccount(form);
      setForm(EMPTY);
      setMsg('تم حفظ الحساب بنجاح.');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setMsg('');
    try {
      const r = await api.syncAccounts();
      setMsg(`تمت مزامنة ${r.synced} حساباً من وافق.`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">شجرة الحسابات</h2>
          <p className="text-muted-foreground mt-1">دليل الحسابات المستخدم في توجيه القيود</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={sync} disabled={syncing}>
            {syncing
              ? <><LoaderCircle size={20} className="animate-spin" aria-hidden="true" /> جارٍ المزامنة</>
              : <><RefreshCw size={20} aria-hidden="true" /> مزامنة من وافق</>}
          </button>
        )}
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      {/* نموذج إضافة حساب — للمسؤول فقط */}
      <div className="card" style={{ display: isAdmin ? undefined : 'none' }}>
        <h3 className="font-bold text-foreground mb-4">إضافة / تعديل حساب</h3>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            placeholder="رمز الحساب"
            value={form.account_code}
            onChange={(e) => setForm({ ...form, account_code: e.target.value })}
            required
          />
          <input
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            placeholder="اسم الحساب"
            value={form.account_name}
            onChange={(e) => setForm({ ...form, account_name: e.target.value })}
            required
          />
          <select
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            value={form.account_type}
            onChange={(e) => setForm({ ...form, account_type: e.target.value })}
          >
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button className="btn-primary justify-center" type="submit">حفظ</button>
        </form>
      </div>

      {/* جدول الحسابات */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-end">
            <thead>
              <tr className="text-muted-foreground text-sm border-b border-border">
                <th className="py-3 font-semibold">الرمز</th>
                <th className="py-3 font-semibold">اسم الحساب</th>
                <th className="py-3 font-semibold">النوع</th>
                <th className="py-3 font-semibold">معرّف وافق</th>
                <th className="py-3 font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const t = TYPE_LABELS[a.account_type] || { label: a.account_type, cls: 'bg-muted text-muted-foreground' };
                return (
                  <tr key={a.id} className="border-b border-border hover:bg-background">
                    <td className="py-3 font-mono text-foreground">{a.account_code}</td>
                    <td className="py-3 text-foreground font-semibold">{a.account_name}</td>
                    <td className="py-3"><span className={`badge ${t.cls}`}>{t.label}</span></td>
                    <td className="py-3 text-muted-foreground text-sm">{a.wafeq_account_id || '— غير مزامن'}</td>
                    <td className="py-3">
                      {a.is_active ? (
                        <span className="badge bg-success/10 text-success">نشط</span>
                      ) : (
                        <span className="badge bg-muted text-muted-foreground">معطّل</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

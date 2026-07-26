import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const TYPE_LABELS = {
  asset: { label: 'أصل', cls: 'bg-sky-100 text-sky-700' },
  liability: { label: 'خصم', cls: 'bg-orange-100 text-orange-700' },
  equity: { label: 'حقوق ملكية', cls: 'bg-purple-100 text-purple-700' },
  revenue: { label: 'إيراد', cls: 'bg-green-100 text-green-700' },
  expense: { label: 'مصروف', cls: 'bg-red-100 text-red-700' },
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
            {syncing ? '⏳ جارٍ المزامنة…' : '🔄 مزامنة من وافق'}
          </button>
        )}
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>}
      {msg && <div className="card border-green-200 bg-green-50 text-green-700">{msg}</div>}

      {/* نموذج إضافة حساب — للمسؤول فقط */}
      <div className="card" style={{ display: isAdmin ? undefined : 'none' }}>
        <h3 className="font-bold text-foreground mb-4">إضافة / تعديل حساب</h3>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            className="border border-border rounded-xl px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            placeholder="رمز الحساب"
            value={form.account_code}
            onChange={(e) => setForm({ ...form, account_code: e.target.value })}
            required
          />
          <input
            className="border border-border rounded-xl px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            placeholder="اسم الحساب"
            value={form.account_name}
            onChange={(e) => setForm({ ...form, account_name: e.target.value })}
            required
          />
          <select
            className="border border-border rounded-xl px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
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
          <table className="w-full text-right">
            <thead>
              <tr className="text-slate-400 text-sm border-b border-slate-100">
                <th className="py-3 font-semibold">الرمز</th>
                <th className="py-3 font-semibold">اسم الحساب</th>
                <th className="py-3 font-semibold">النوع</th>
                <th className="py-3 font-semibold">معرّف وافق</th>
                <th className="py-3 font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const t = TYPE_LABELS[a.account_type] || { label: a.account_type, cls: 'bg-slate-100 text-slate-600' };
                return (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-background">
                    <td className="py-3 font-mono text-slate-600">{a.account_code}</td>
                    <td className="py-3 text-foreground font-semibold">{a.account_name}</td>
                    <td className="py-3"><span className={`badge ${t.cls}`}>{t.label}</span></td>
                    <td className="py-3 text-slate-400 text-sm">{a.wafeq_account_id || '— غير مزامن'}</td>
                    <td className="py-3">
                      {a.is_active ? (
                        <span className="badge bg-green-100 text-green-700">نشط</span>
                      ) : (
                        <span className="badge bg-slate-100 text-muted-foreground">معطّل</span>
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

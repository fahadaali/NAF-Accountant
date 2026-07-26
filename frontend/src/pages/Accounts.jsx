import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { RefreshCw, LoaderCircle, CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Input } from '../naf/ui/input.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';

// نوع الحساب تصنيف لا حالة، فيأخذ رموز الرسوم (chart-*) لا رموز الحالة،
// والخلفية مخفّفة من الرمز نفسه (CLAUDE.md §6).
//
// لكن chart-4 و chart-5 لا يُفتّحان في الوضع الداكن كما يفعل 1 و2 و3،
// فيصيران داكنين على سطح داكن — رأيتُ «حقوق ملكية» غير مقروءة بالفعل.
// لذلك الفئتان الباقيتان على warning و muted، والمعنى محمول بالتسمية
// لا باللون أصلاً. الأصل أن تُعالَج في الثيم — مُدرَج في audit/report.md.
const TYPE_LABELS = {
  asset: { label: 'أصل', cls: 'bg-chart-2/10 text-chart-2' },
  liability: { label: 'خصم', cls: 'bg-warning/10 text-warning' },
  equity: { label: 'حقوق ملكية', cls: 'bg-muted text-muted-foreground' },
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
          <Button onClick={sync} disabled={syncing}>
            {syncing
              ? <><LoaderCircle size={20} className="animate-spin" aria-hidden="true" /> جارٍ المزامنة</>
              : <><RefreshCw size={20} aria-hidden="true" /> مزامنة من وافق</>}
          </Button>
        )}
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      {/* نموذج إضافة حساب — للمسؤول فقط */}
      <Card className="p-6" style={{ display: isAdmin ? undefined : 'none' }}>
        <h3 className="font-bold text-foreground mb-4">إضافة / تعديل حساب</h3>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input
            placeholder="رمز الحساب"
            value={form.account_code}
            onChange={(e) => setForm({ ...form, account_code: e.target.value })}
            required
          />
          <Input
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
          <Button className="justify-center" type="submit">حفظ</Button>
        </form>
      </Card>

      {/* جدول الحسابات */}
      <Card className="p-6">
                  <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>اسم الحساب</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>معرّف وافق</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const t = TYPE_LABELS[a.account_type] || { label: a.account_type, cls: 'bg-muted text-muted-foreground' };
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-foreground">{a.account_code}</TableCell>
                    <TableCell className="text-foreground font-semibold">{a.account_name}</TableCell>
                    <TableCell><span className={`badge ${t.cls}`}>{t.label}</span></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{a.wafeq_account_id || '— غير مزامن'}</TableCell>
                    <TableCell>
                      {a.is_active ? (
                        <span className="badge bg-success/10 text-success">نشط</span>
                      ) : (
                        <span className="badge bg-muted text-muted-foreground">معطّل</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { RefreshCw, LoaderCircle, CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Input } from '../naf/ui/input.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';
import { Badge } from '../naf/ui/badge.jsx';

// نوع الحساب تصنيف لا حالة، فيأخذ رموز الرسوم (chart-*) لا رموز الحالة.
// الخمسة صالحة في الوضعين بعد إصلاح لوحة الرسوم في الثيم؛ كان chart-4
// و chart-5 يبقيان داكنَين على سطح داكن فتُقرأ الشارة بالكاد.
// الأصناف مكتوبة كاملة لا مركّبة: Tailwind يمسح النصّ ولا يرى
// `bg-${x}` فلا يولّد الصنف أصلاً.
const TYPE_LABELS = {
  asset: { label: 'أصل', cls: 'bg-chart-2/10 text-chart-2' },
  liability: { label: 'خصم', cls: 'bg-chart-5/10 text-chart-5' },
  equity: { label: 'حقوق ملكية', cls: 'bg-chart-4/10 text-chart-4' },
  revenue: { label: 'إيراد', cls: 'bg-chart-3/10 text-chart-3' },
  expense: { label: 'مصروف', cls: 'bg-chart-1/10 text-chart-1' },
};

const EMPTY = { account_code: '', account_name: '', account_type: 'expense', wafeq_account_id: '' };

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
      await api.addAccount({
        ...form,
        wafeq_account_id: form.wafeq_account_id.trim() || null,
      });
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
      {isAdmin && (
        <Card className="p-6">
          <h3 className="font-bold text-foreground mb-1">إضافة / تعديل حساب</h3>
          <p className="text-muted-foreground text-sm mb-4">
            معرّف وافق شرط لاستعمال الحساب: البوت يستبعد كل حساب بلا معرّف، فلا يختاره في أي قيد.
            المزامنة تملأه تلقائياً، وهذا الحقل للحالات التي تضيفها يدوياً.
          </p>
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
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
              aria-label="نوع الحساب"
              className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
              value={form.account_type}
              onChange={(e) => setForm({ ...form, account_type: e.target.value })}
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <Input
              placeholder="معرّف وافق (acc_…)"
              dir="ltr"
              className="text-start"
              value={form.wafeq_account_id}
              onChange={(e) => setForm({ ...form, wafeq_account_id: e.target.value })}
            />
            <Button className="justify-center" type="submit">حفظ</Button>
          </form>
        </Card>
      )}

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
                const t = TYPE_LABELS[a.account_type] || { label: a.account_type, cls: '' };
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-foreground">{a.account_code}</TableCell>
                    <TableCell className="text-foreground font-semibold">{a.account_name}</TableCell>
                    <TableCell>
                      <Badge className={t.cls}>{t.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{a.wafeq_account_id || '— غير مزامن'}</TableCell>
                    <TableCell>
                      {a.is_active ? (
                        <Badge variant="success"><CircleCheck size={16} aria-hidden="true" /> نشط</Badge>
                      ) : (
                        <Badge><CircleSlash size={16} aria-hidden="true" /> معطّل</Badge>
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

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtNumber } from '../lib/format.js';
import { RefreshCw, LoaderCircle, CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Input } from '../naf/ui/input.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';
import { Badge } from '../naf/ui/badge.jsx';
import { Select } from '../naf/ui/select.jsx';

// نوع الحساب تصنيف لا حالة. كان يأخذ رموز الرسوم: bg-chart-N/10 مع
// text-chart-N. وهي رموز زينة لا رموز نصّ واجهة (§6)، ونصّها يسقط تحت
// AA — قياساً: 3.91 و4.27 و4.33 في الفاتح، و3.02 إلى 3.80 في الداكن،
// أي الخمسة كلها تحت الحدّ في الوضع الداكن.
//
// المتغيّر `outline` من السجلّ حتى تُسجَّل معالجة لونية للتصنيف: حدّ
// ونصّ text-foreground، يتجاوز الحدّ في الوضعين ولا يخترع تخفيفاً.
// معالجة التصنيف بلون مُقترحة في جدول المطابقة المعلّق.
const TYPE_LABELS = {
  asset: { label: 'أصل' },
  liability: { label: 'خصم' },
  equity: { label: 'حقوق ملكية' },
  revenue: { label: 'إيراد' },
  expense: { label: 'مصروف' },
};

const EMPTY = { account_code: '', account_name: '', account_type: 'expense', wafeq_account_id: '' };

export default function Accounts({ isAdmin }) {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState(null);
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
        // فارغ = بلا معرّف، لا سلسلة فارغة: العمود يُفحص بـIS NOT NULL.
        wafeq_account_id: form.wafeq_account_id.trim() || null,
      });
      setForm(EMPTY);
      setMsg('تم الحفظ.');  // naf-terms.md §٤: «تم + المصدر»، و«بنجاح» من النبرة الممنوعة
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
      // العدد داخل bdi ومن formatNumber — لا رقم خام في جملة عربية
      setMsg(<>تمت مزامنة <bdi>{fmtNumber(r.synced)}</bdi> حساباً من وافق.</>);
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
          {/* «دليل الحسابات» ممنوعة في naf-terms.md — المعتمد «شجرة الحسابات» */}
          <p className="text-muted-foreground mt-1">الحسابات المعتمدة في توجيه القيود المحاسبية</p>
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

      {/* نموذج إضافة حساب — للمسؤول فقط.
          شرطُ عرضٍ لا `display:none`: الأخير يُبقي النموذج في الشجرة فيبلغه
          قارئ الشاشة ومفتاح Tab، وبقيّة المنصة تُخفي بالشرط. */}
      {isAdmin && (
        <Card className="p-6">
          <h3 className="font-bold text-foreground mb-1">إضافة / تعديل حساب</h3>
          {/* معرّف وافق ليس حقلاً اختيارياً في الأثر: `getActiveAccounts`
              يستبعد كل حساب بلا معرّف، و`postJournalEntryDraft` يرفض ما لا
              يبدأ بـ`acc_`. فحسابٌ يُضاف بدونه يظهر في هذا الجدول ولا
              يستعمله البوت في أي قيد — بلا ما يقول ذلك. */}
          <p className="text-muted-foreground text-sm mb-4">
            معرّف وافق شرطٌ لاستعمال الحساب: ما لا معرّف له يُستبعد من توجيه القيود.
            المزامنة تملؤه تلقائياً، وهذا الحقل لما يُضاف يدوياً.
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
            <Select
              aria-label="نوع الحساب"
              value={form.account_type}
              onChange={(e) => setForm({ ...form, account_type: e.target.value })}
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
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
                const t = TYPE_LABELS[a.account_type] || { label: a.account_type };
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-foreground tabular-nums"><bdi>{a.account_code}</bdi></TableCell>
                    <TableCell className="text-foreground font-semibold">{a.account_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {a.wafeq_account_id ? <bdi>{a.wafeq_account_id}</bdi> : '— غير مزامن'}
                    </TableCell>
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

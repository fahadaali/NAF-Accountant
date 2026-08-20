import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDate } from '../naf/lib/format.js';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Badge } from '../naf/ui/badge.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Input } from '../naf/ui/input.jsx';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '../naf/ui/dialog.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';

/* أعضاء المنصة تحت الدخول الموحّد.
   المصادقة مركزية والصلاحيات موزّعة: العضوية تأتي من المركز، والدور يُقرّر
   هنا. وإيقاف عضو يُبلَّغ للمركز فيظهر السبب له في شبكته. */

const ROLES = [
  { value: 'admin', label: 'مسؤول' },
  { value: 'editor', label: 'محرّر' },
  { value: 'viewer', label: 'مستخدم (اطّلاع)' },
];

/** الطوابع الزمنية بالثواني في هذا الجدول — التنسيق من naf-format وحده. */
function stampDate(seconds) {
  return seconds ? formatDate(Number(seconds) * 1000) : null;
}

export default function Members() {
  const [members, setMembers] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState('');

  const load = async () => {
    try {
      const res = await api.members();
      setMembers(res.members);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  /* `unreportedMsg` نصُّ تعذّر التبليغ لهذا الفعل بعينه.

     كان واحداً لكل الأفعال: «تعذّر الاتصال. تحقق من الشبكة وأعد المحاولة» —
     وهي مسجَّلة في §٧ لطلبٍ **لم يصل**، والحال هنا أن الفعل وصل ونُفِّذ ولم
     يُبلَّغ به المركز. فيقرؤها المسؤول فشلاً فيعيد فعلاً قائماً.

     والثلاثة مسجَّلة في `naf-terms.md` §١٠ · رسائل الصلاحية، وكلٌّ منها تخبر
     بما تمّ أوّلاً ثم بما لم يبلغ. */
  const run = async (fn, successMsg, unreportedMsg) => {
    setMsg('');
    setError('');
    setWarning('');
    try {
      const res = await fn();
      setMsg(successMsg);
      // التغيير المحلي وقع، وتبليغ المركز وحده هو ما تعذّر.
      if (res && res.reported === false) {
        setWarning(unreportedMsg);
      }
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const revoke = () => {
    const member = pending;
    setPending(null);
    run(
      () => api.updateMember({ user_id: member.user_id, is_active: 0, reason: reason.trim() }),
      'تم السحب',
      'سُحب الوصول في هذه المنصة، ولم يبلغ السحبُ المركزَ. أعد المحاولة',
    );
    setReason('');
  };

  return (
    <div className="space-y-6">
      <Dialog open={!!pending} onOpenChange={(v) => { if (!v) { setPending(null); setReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>سحب الوصول</DialogTitle>
            <DialogDescription>
              اكتب سبب التعطيل — يُعرض للمستخدمين على البطاقة
            </DialogDescription>
          </DialogHeader>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="السبب"
            aria-label="السبب"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">إلغاء</Button>
            </DialogClose>
            <Button variant="destructive" disabled={!reason.trim()} onClick={revoke}>
              سحب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <h2 className="text-2xl font-bold text-foreground">المستخدمون والصلاحيات</h2>
        <p className="text-muted-foreground mt-1">
          العضوية تأتي من نظام الدخول الموحّد، والصلاحية تُقرّر هنا
        </p>
      </div>

      {error && (
        <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>
      )}
      {msg && (
        <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>
      )}
      {warning && (
        <Alert variant="warning"><CircleAlert /><AlertDescription>{warning}</AlertDescription></Alert>
      )}

      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">أعضاء المنصة</h3>
        <p className="text-muted-foreground text-sm mb-4">
          «مسؤول» يملك كل الصلاحيات · «محرّر» يعمل دون إدارة الأعضاء ·
          «مستخدم (اطّلاع)» يطّلع فقط.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>البريد الإلكتروني</TableHead>
              <TableHead>الصلاحية</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>آخر نشاط</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell className="text-foreground">{m.display_name}</TableCell>
                <TableCell className="text-foreground"><bdi dir="ltr">{m.email}</bdi></TableCell>
                <TableCell>
                  <select
                    className="border border-border rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-ring outline-none"
                    value={m.role}
                    aria-label="الصلاحية"
                    onChange={(e) =>
                      run(
                        () => api.updateMember({ user_id: m.user_id, role: e.target.value }),
                        'تم تحديث الصلاحية',
                        'تغيّرت الصلاحية في هذه المنصة، ولم يبلغ التغيّرُ المركزَ. أعد المحاولة',
                      )
                    }
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <Badge variant={m.is_active ? 'success' : 'default'}>
                    {m.is_active
                      ? <><CircleCheck size={16} aria-hidden="true" /> نشط</>
                      : <><CircleSlash size={16} aria-hidden="true" /> معطّل</>}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {stampDate(m.last_seen_at) ? <bdi>{stampDate(m.last_seen_at)}</bdi> : '—'}
                </TableCell>
                <TableCell>
                  {m.is_active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setReason(''); setPending(m); }}
                    >
                      سحب
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        run(
                          () => api.updateMember({ user_id: m.user_id, is_active: 1 }),
                          'تم المنح',
                          'مُنح الوصول في هذه المنصة، ولم يبلغ المنحُ المركزَ. أعد المحاولة',
                        )
                      }
                    >
                      منح
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

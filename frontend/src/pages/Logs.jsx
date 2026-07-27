import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { RefreshCw, CircleAlert, CircleCheck, Info } from 'lucide-react';
import { fmtDateTime, fmtNumber } from '../lib/format.js';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';
import { Badge } from '../naf/ui/badge.jsx';

// الحالات العامة من naf-terms.md § حالات عامة — بأيقونة ونصّ معاً.
const STATUS_META = {
  success: { label: 'نجح', variant: 'success', Icon: CircleCheck },
  error: { label: 'فشل', variant: 'destructive', Icon: CircleAlert },
  info: { label: 'معلومة', variant: 'info', Icon: Info },
};

const ACTION_AR = {
  transcribe: 'تفريغ صوتي',
  claude_analyze: 'تحليل آلي',
  wafeq_post: 'ترحيل إلى وافق',
  wafeq_delete: 'حذف من وافق',
  wafeq_bulk_delete: 'حذف جماعي',
  wafeq_delete_on_edit: 'حذف عند التعديل',
  wafeq_attachment: 'رفع مرفق',
  apply_edit: 'تطبيق تعديل',
  accounts_sync: 'مزامنة الحسابات',
  cron_accounts_sync: 'مزامنة مجدولة',
  cron_recurring: 'تنفيذ العمليات المتكرّرة',
  recurring_post: 'ترحيل عملية متكرّرة',
  basecamp_report: 'تقرير بيسكامب',
  financial_report: 'تقرير مالي',
  process_error: 'خطأ معالجة',
  image_saved_r2: 'حفظ صورة',
  telegram_webhook: 'ويبهوك تليجرام',
  duplicate_webhook_skipped: 'تجاهل رسالة مكرّرة',
};

export default function Logs() {
  const [rows, setRows] = useState([]);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.logs(200);
      setRows(r.logs);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = onlyErrors ? rows.filter((r) => r.status === 'error') : rows;
  const errorCount = rows.filter((r) => r.status === 'error').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">سجلّ النظام</h2>
          <p className="text-muted-foreground mt-1">تتبّع العمليات والأخطاء لتشخيص المشاكل</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={onlyErrors ? 'destructive' : 'ghost'}
            onClick={() => setOnlyErrors((v) => !v)}
          >
            {/* CircleAlert لا TriangleAlert: naf-icons.md — الفشل حدث وقع
                والتحذير احتمال قائم، وهذه أخطاء وقعت فعلاً. */}
            <CircleAlert size={20} aria-hidden="true" /> الأخطاء فقط (<bdi>{fmtNumber(errorCount)}</bdi>)
          </Button>
          <Button variant="ghost" onClick={load}><RefreshCw size={20} aria-hidden="true" /> تحديث</Button>
        </div>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}

      <Card className="p-6">
        {loading ? (
          <p className="text-muted-foreground text-center py-8">جارٍ التحميل…</p>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">السجلّ فارغ. تظهر هنا أحداث النظام أولاً بأول.</p>
        ) : (
                      <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الوقت</TableHead>
                  <TableHead>الإجراء</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>العملية</TableHead>
                  <TableHead>التفاصيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((l) => (
                  <TableRow key={l.id} className="align-top">
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      <bdi>{fmtDateTime(l.timestamp)}</bdi>
                    </TableCell>
                    <TableCell className="text-foreground">{ACTION_AR[l.action] || l.action}</TableCell>
                    <TableCell>
                      {(() => {
                        const st = STATUS_META[l.status] || STATUS_META.info;
                        return (
                          <Badge variant={st.variant}>
                            <st.Icon size={16} aria-hidden="true" /> {st.label}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {l.transaction_id ? <bdi>{fmtNumber(l.transaction_id)}</bdi> : '—'}
                    </TableCell>
                    <TableCell className="text-foreground text-sm">
                      <bdi className="block max-w-md break-words">{l.error_details || '—'}</bdi>
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

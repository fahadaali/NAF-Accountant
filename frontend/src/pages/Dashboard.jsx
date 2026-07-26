import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import SourceIcon from '../components/SourceIcon.jsx';
import { Inbox, FilePen, Bot, CircleAlert } from 'lucide-react';
import { fmtDateTime } from '../lib/format.js';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';

// الأيقونات والألوان من السجلّ: naf-icons.md — والخلفية مخفّفة من الرمز
// نفسه (CLAUDE.md §6) لا من درجة لوحة.
const STAT_CARDS = [
  { key: 'total', label: 'إجمالي العمليات', Icon: Inbox, color: 'bg-accent text-primary' },
  { key: 'posted', label: 'مسودات في وافق', Icon: FilePen, color: 'bg-success/10 text-success' },
  { key: 'analyzed', label: 'قيد التحليل', Icon: Bot, color: 'bg-warning/10 text-warning' },
  { key: 'failed', label: 'عمليات فاشلة', Icon: CircleAlert, color: 'bg-destructive/10 text-destructive' },
];

export default function Dashboard() {
  const [stats, setStats] = useState({ total: 0, byStatus: [] });
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([api.stats(), api.transactions({ limit: 8 })]);
        setStats(s);
        setRecent(t.transactions);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const countFor = (status) =>
    status === 'total'
      ? stats.total
      : stats.byStatus?.find((r) => r.status === status)?.count || 0;

  if (loading) return <p className="text-muted-foreground">جارٍ التحميل…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">لوحة التحكم</h2>
        <p className="text-muted-foreground mt-1">نظرة عامة على العمليات المحاسبية الآلية</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>
            تعذّر تحميل البيانات: {error} — تأكد من ضبط مفتاح لوحة التحكم في الإعدادات.
          </AlertDescription>
        </Alert>
      )}

      {/* البطاقات الإحصائية */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {STAT_CARDS.map((c) => (
          <Card key={c.key} className="p-6 flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${c.color}`}>
              <c.Icon size={24} aria-hidden="true" />
            </div>
            <div>
              <div className="text-3xl font-bold text-foreground">{countFor(c.key)}</div>
              <div className="text-muted-foreground text-sm">{c.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* أحدث العمليات */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-4">أحدث العمليات</h3>
        {recent.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">لم تصل أي عملية بعد. أرسل أول عملية من بوت تليجرام.</p>
        ) : (
                      <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>النص</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-foreground">{t.id}</TableCell>
                    <TableCell>
                      <SourceIcon type={t.source_type} withLabel />
                    </TableCell>
                    <TableCell className="text-foreground max-w-xs truncate">{t.raw_text || '—'}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
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

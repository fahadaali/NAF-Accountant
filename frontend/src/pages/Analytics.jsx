import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtNumber, fmtAmount, CURRENCY } from '../lib/format.js';
import Money from '../components/Money.jsx';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { CircleAlert } from 'lucide-react';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';

// ألوان الرسوم من رموز الثيم — لا قيم مباشرة (CLAUDE.md §1).
// chart-2 (أزرق) للإيرادات و chart-3 (أخضر) للمصروفات: الزوج اجتاز كل فحوص
// مدقّق dataviz على سطح الثيم — تشبّع وفصل عمى ألوان وتباين. (chart-1
// الذهبي يسقط في فحص التشبّع فيُقرأ رمادياً، لذلك لم يُستخدم للسلاسل.)
// الأصناف مكتوبة كاملة في موضعها: Tailwind يمسح النصّ ولا يرى `bg-${x}`.

const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// الأرقام غربية بفاصل آلاف — من lib/format.js لا داخل الصفحة.
const fmt = (n) => fmtNumber(n);
// نصّ داخل <title> في SVG لا يقبل عنصراً، فيُبنى المبلغ نصّاً بالقواعد نفسها.
const fmtAmountText = (n) => `${fmtAmount(n)} ${CURRENCY}`;

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${AR_MONTHS[Number(m) - 1] || m} ${String(y).slice(2)}`;
}

/** شريط أفقي — مقارنة مقادير بين فئات. */
function BarList({ title, data, empty }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <Card className="p-6">
      <h3 className="font-bold text-foreground mb-4">{title}</h3>
      {data.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">{empty}</p>
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <div key={d.name}>
              <div className="flex items-baseline justify-between text-sm mb-1">
                <span className="text-foreground truncate ms-2">{d.name}</span>
                <Money value={d.value} className="text-muted-foreground" />
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-chart-2"
                  style={{ width: `${(d.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** خط زمني لسلسلتين (إيرادات/مصروفات) — محور واحد، نفس الوحدة. */
function TrendChart({ data }) {
  if (data.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-4">الاتجاه الشهري</h3>
        <p className="text-muted-foreground text-center py-8">تظهر الرسوم بعد أول شهر مكتمل من العمليات.</p>
      </Card>
    );
  }

  const W = 720;
  const H = 240;
  const P = { top: 16, right: 16, bottom: 34, left: 56 };
  const iw = W - P.left - P.right;
  const ih = H - P.top - P.bottom;
  const max = Math.max(...data.flatMap((d) => [d.expenses, d.revenue]), 1);
  const x = (i) => P.left + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => P.top + ih - (v / max) * ih;
  const path = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[key])}`).join(' ');

  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const last = data[data.length - 1];

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="font-bold text-foreground">الاتجاه الشهري</h3>
        {/* الأسطورة: الهوية لا تعتمد على اللون وحده */}
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-2">
            <span className="w-3 h-0.5 rounded-sm bg-chart-2" />
            <span className="text-foreground">الإيرادات</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-0.5 rounded-sm bg-chart-3" />
            <span className="text-foreground">المصروفات</span>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-lg" role="img"
             aria-label="اتجاه الإيرادات والمصروفات شهرياً">
          {/* شبكة خافتة */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={P.left} x2={W - P.right} y1={y(t)} y2={y(t)}
                    className="stroke-border" strokeWidth="1" />
              <text x={P.left - 8} y={y(t) + 4} textAnchor="end"
                    className="fill-muted-foreground text-xs">
                {fmt(t)}
              </text>
            </g>
          ))}

          {/* السلاسل — خطوط 2px */}
          <path d={path('revenue')} fill="none" className="stroke-chart-2" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
          <path d={path('expenses')} fill="none" className="stroke-chart-3" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />

          {/* نقاط مع حلقة بلون السطح لفصل التداخل */}
          {data.map((d, i) => (
            <g key={d.month}>
              <circle cx={x(i)} cy={y(d.revenue)} r="4" className="fill-chart-2 stroke-card" strokeWidth="2">
                <title>{`${monthLabel(d.month)} — إيرادات ${fmtAmountText(d.revenue)}`}</title>
              </circle>
              <circle cx={x(i)} cy={y(d.expenses)} r="4" className="fill-chart-3 stroke-card" strokeWidth="2">
                <title>{`${monthLabel(d.month)} — مصروفات ${fmtAmountText(d.expenses)}`}</title>
              </circle>
              <text x={x(i)} y={H - 12} textAnchor="middle"
                    className="fill-muted-foreground text-xs">
                {monthLabel(d.month)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* تسمية مباشرة للقيمة الأخيرة بدل رقم فوق كل نقطة */}
      <div className="flex gap-6 text-sm mt-2 text-muted-foreground">
        <span>آخر شهر — إيرادات: <Money value={last.revenue} className="text-foreground font-bold" /></span>
        <span>مصروفات: <Money value={last.expenses} className="text-foreground font-bold" /></span>
      </div>
    </Card>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [months, setMonths] = useState(6);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api.analytics(months);
        setData(r);
        setError('');
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [months]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">التحليلات</h2>
          <p className="text-muted-foreground mt-1">نظرة على المصروفات والإيرادات وأكبر الموردين</p>
        </div>
        <select
          aria-label="مدى الفترة"
          className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        >
          <option value={3}>آخر 3 أشهر</option>
          <option value={6}>آخر 6 أشهر</option>
          <option value={12}>آخر 12 شهراً</option>
        </select>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}

      {loading ? (
        <p className="text-muted-foreground">جارٍ التحميل…</p>
      ) : (
        <>
          <TrendChart data={data?.monthly || []} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarList
              title="المصروفات حسب التصنيف"
              data={data?.byCategory || []}
              empty="لا مصروفات في هذه الفترة. جرّب مدى أطول."
            />
            <BarList
              title="أكبر الموردين"
              data={data?.byVendor || []}
              empty="لا فواتير مشتريات في هذه الفترة. جرّب مدى أطول."
            />
          </div>

          {/* عرض جدولي — الهوية والقيم متاحة دون الاعتماد على اللون */}
          {(data?.monthly || []).length > 0 && (
            <Card className="p-6">
              <h3 className="font-bold text-foreground mb-4">البيانات (عرض جدولي)</h3>
                              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الشهر</TableHead>
                      <TableHead>الإيرادات</TableHead>
                      <TableHead>المصروفات</TableHead>
                      <TableHead>الصافي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.monthly.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="text-foreground">{monthLabel(m.month)}</TableCell>
                        <TableCell className="text-foreground"><Money value={m.revenue} /></TableCell>
                        <TableCell className="text-foreground"><Money value={m.expenses} /></TableCell>
                        <TableCell className="font-semibold text-foreground">
                          <Money value={m.revenue - m.expenses} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

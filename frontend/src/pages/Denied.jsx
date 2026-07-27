import { CircleAlert, CircleSlash, ShieldX } from 'lucide-react';
import { Button } from '../naf/ui/button.jsx';
import { Card } from '../naf/ui/card.jsx';

/* صفحة الرفض للدخول الموحّد.
   الحزمة تمرّر رمز سبب لا جملة، وهذه الصفحة تترجمه إلى المصطلح المسجّل في
   naf-terms.md §١٠ «منع الدخول إلى منصة». وما يأتي من المركز نصّاً يُعرض كما
   كُتب. ولا تُعرض تفاصيل تقنية ولا إشارة إلى مستخدمين آخرين. */

const REASONS = {
  inactive: {
    text: 'عضويتك في هذه المنصة معطّلة. راجع مسؤول المنصة.',
    Icon: CircleSlash,
    tone: 'text-muted-foreground',
  },
  not_member: {
    text: 'لا تملك صلاحية الوصول لهذه المنصة',
    Icon: ShieldX,
    tone: 'text-destructive',
  },
  bad_state: {
    text: 'انتهت جلسة دخولك. سجّل الدخول من جديد',
    Icon: CircleAlert,
    tone: 'text-destructive',
  },
  auth_failed: {
    text: 'تعذّر التحقق من دخولك. أعد المحاولة.',
    Icon: CircleAlert,
    tone: 'text-destructive',
  },
};

export default function Denied() {
  const raw = new URLSearchParams(window.location.search).get('r') || '';
  // رمز معروف؟ المصطلح المسجّل. وإلا فالسبب النصّي القادم من المركز كما هو.
  const reason = REASONS[raw] || {
    text: raw || REASONS.not_member.text,
    Icon: ShieldX,
    tone: 'text-destructive',
  };
  const { Icon } = reason;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 text-center space-y-4">
        <Icon className={`size-12 mx-auto ${reason.tone}`} aria-hidden="true" />
        <h1 className="text-2xl font-bold text-foreground">تعذّر الدخول</h1>
        <p className="text-muted-foreground">{reason.text}</p>
        <Button className="w-full justify-center" onClick={() => { window.location.href = '/'; }}>
          تسجيل الدخول
        </Button>
      </Card>
    </div>
  );
}

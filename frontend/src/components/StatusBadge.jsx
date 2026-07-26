import { Inbox, Bot, Clock, CircleCheck, Trash2, CircleAlert, Copy } from 'lucide-react';

// دورة حياة العملية — التسميات والأيقونات والألوان من السجلّ:
// naf-terms.md § حالات العملية المحاسبية.
// الخلفية مخفّفة من رمز الحالة نفسه لا من درجة لوحة (CLAUDE.md §6).
const MAP = {
  received: { label: 'مستلمة', Icon: Inbox, cls: 'bg-muted text-muted-foreground' },
  transcribed: { label: 'مُفرّغة', Icon: Bot, cls: 'bg-info/10 text-info' },
  analyzed: { label: 'قيد التحليل', Icon: Bot, cls: 'bg-warning/10 text-warning' },
  awaiting_info: { label: 'بانتظار معلومات', Icon: Clock, cls: 'bg-warning/10 text-warning' },
  posted: { label: 'مُرحّلة', Icon: CircleCheck, cls: 'bg-success/10 text-success' },
  deleted: { label: 'محذوفة', Icon: Trash2, cls: 'bg-muted text-muted-foreground' },
  failed: { label: 'فشلت', Icon: CircleAlert, cls: 'bg-destructive/10 text-destructive' },
  duplicate: { label: 'مكرّرة', Icon: Copy, cls: 'bg-warning/10 text-warning' },
};

export default function StatusBadge({ status }) {
  const s = MAP[status] || {
    label: status,
    Icon: Inbox,
    cls: 'bg-muted text-muted-foreground',
  };
  // أيقونة ونصّ معاً — لا يجوز الاعتماد على اللون وحده (naf-icons.md).
  return (
    <span className={`badge gap-1.5 ${s.cls}`}>
      <s.Icon size={16} aria-hidden="true" />
      {s.label}
    </span>
  );
}

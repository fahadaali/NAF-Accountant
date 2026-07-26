import { Inbox, Bot, Clock, CircleCheck, Trash2, CircleAlert, Copy } from 'lucide-react';
import { Badge } from '../naf/ui/badge.jsx';

// دورة حياة العملية — التسميات والأيقونات والألوان من السجلّ:
// naf-terms.md § حالات العملية المحاسبية.
// التخفيف والمقاس والفجوة من عنصر Badge في السجلّ، لا من صنف محلي.
const MAP = {
  received: { label: 'مستلمة', Icon: Inbox, variant: 'default' },
  transcribed: { label: 'مُفرّغة', Icon: Bot, variant: 'info' },
  analyzed: { label: 'قيد التحليل', Icon: Bot, variant: 'warning' },
  awaiting_info: { label: 'بانتظار معلومات', Icon: Clock, variant: 'warning' },
  posted: { label: 'مُرحّلة', Icon: CircleCheck, variant: 'success' },
  deleted: { label: 'محذوفة', Icon: Trash2, variant: 'default' },
  failed: { label: 'فشلت', Icon: CircleAlert, variant: 'destructive' },
  duplicate: { label: 'مكرّرة', Icon: Copy, variant: 'warning' },
};

export default function StatusBadge({ status }) {
  const s = MAP[status] || {
    label: status,
    Icon: Inbox,
    variant: 'default',
  };
  // أيقونة ونصّ معاً — لا يجوز الاعتماد على اللون وحده (naf-icons.md).
  return (
    <Badge variant={s.variant}>
      <s.Icon size={16} aria-hidden="true" />
      {s.label}
    </Badge>
  );
}

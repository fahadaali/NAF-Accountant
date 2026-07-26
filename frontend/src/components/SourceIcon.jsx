import { Mic, Image, MessageSquareText } from 'lucide-react';

// مصدر العملية — من خريطة ناف (naf-icons.md § المحاسبة والمالية).
// MessageSquareText لمصدر الإدخال النصّي، لا MessageSquare المخصّصة للاستشارة.
const MAP = {
  voice: { Icon: Mic, label: 'صوت' },
  image: { Icon: Image, label: 'صورة' },
  text: { Icon: MessageSquareText, label: 'نص' },
};

/** أيقونة المصدر مع تسمية اختيارية — الهوية لا تعتمد على الشكل وحده. */
export default function SourceIcon({ type, withLabel = false, size = 20 }) {
  const s = MAP[type] || MAP.text;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <s.Icon size={size} aria-hidden="true" />
      {withLabel ? s.label : <span className="sr-only">{s.label}</span>}
    </span>
  );
}

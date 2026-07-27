import { Mic, Image, MessageSquareText, FileType } from 'lucide-react';

// مصدر العملية — من خريطة ناف (naf-icons.md § المحاسبة والمالية).
// MessageSquareText لمصدر الإدخال النصّي، لا MessageSquare المخصّصة للاستشارة.
// FileType مع اسم الصيغة نصّاً لمصدر الـPDF — لا أيقونة مسجَّلة له في Lucide،
// وهذا ما ينصّ عليه naf-icons.md § الوسائط وأنواع الملفات.
const MAP = {
  voice: { Icon: Mic, label: 'صوت' },
  image: { Icon: Image, label: 'صورة' },
  pdf: { Icon: FileType, label: 'PDF' },
  text: { Icon: MessageSquareText, label: 'نص' },
};

/** أيقونة المصدر مع تسمية اختيارية — الهوية لا تعتمد على الشكل وحده. */
export default function SourceIcon({ type, withLabel = false, size = 20 }) {
  const s = MAP[type] || MAP.text;
  // التسمية قد تكون لاتينية داخل صفحة عربية، فتُعزل اتجاهياً.
  const label = <bdi>{s.label}</bdi>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <s.Icon size={size} aria-hidden="true" />
      {withLabel ? label : <span className="sr-only">{s.label}</span>}
    </span>
  );
}

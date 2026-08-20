import Money from './Money.jsx';
import { formatAmount } from '../naf/lib/format.js';

/**
 * مبلغ بعملته.
 *
 * الريال يمرّ إلى `Money` من السجلّ — رمز U+20C1 وبديله «ر.س» وضبط ارتفاعه،
 * كلّه هناك. والعملات الأخرى لا مكوّن لها في السجلّ: `naf-currency` مخصّص
 * للريال وحده وممنوع تعديله من منصة، فتُعرض بالرمز الدولي نصّاً بعد المبلغ
 * — نفس منطق `FileType` مع صيغة الملف في naf-icons.md.
 *
 * الرمز الدولي لا رمز العملة: `$` يشترك فيه أكثر من عشرين دولاراً، وأغلب
 * العملات بلا رمز أصلاً.
 *
 * التنسيق من formatAmount حصراً — لا تنسّق مبلغاً في مكوّن.
 */
export default function Amount({ value, currency = 'SAR', className, ...props }) {
  if (!currency || currency === 'SAR') {
    return <Money value={value} className={className} {...props} />;
  }
  return (
    <bdi className={['tabular-nums', className].filter(Boolean).join(' ')} {...props}>
      {formatAmount(value)} {currency}
    </bdi>
  );
}

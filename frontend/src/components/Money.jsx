import { fmtAmount, CURRENCY } from '../lib/format.js';

/**
 * عرض مبلغ: أرقام جدولية، معزول اتجاهياً، والرمز بعد المبلغ.
 * بديل مؤقت عن `Money` من `naf-currency` — انظر التعليق في lib/format.js.
 */
export default function Money({ value, className = '' }) {
  return (
    <span dir="ltr" className={`tabular-nums whitespace-nowrap ${className}`}>
      {fmtAmount(value)} {CURRENCY}
    </span>
  );
}

/* من سجلّ ناف: fahadaali/naf-ui — العنصر «utils».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS): حُذفت
   التعليقات النوعية ووسائط forwardRef النوعية وكتل interface،
   وعُدّلت مسارات الاستيراد. لا سطر منطق تغيّر.
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً. */

import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

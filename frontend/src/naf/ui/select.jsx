/* من سجلّ ناف: fahadaali/naf-ui — العنصر «select».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS): حُذفت
   التعليقات النوعية ووسائط forwardRef النوعية وكتل interface،
   وعُدّلت مسارات الاستيراد. لا سطر منطق تغيّر.
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً. */

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cva } from "class-variance-authority"

import { cn } from "../lib/utils.js"

// عنصر select أصلي لا بديل مبني بجافاسكربت: يحتفظ بلوحة المفاتيح
// وقارئ الشاشة وقائمة النظام على الجوال بلا كلفة.
//
// الشيفرون من الخريطة (فتح قائمة منسدلة → ChevronDown) ولا يُقلب،
// وموضعه inset-inline-end فيتبع الاتجاه. والحشو الأمامي يفسح له مكاناً.
const selectVariants = cva(
  cn(
    "flex w-full appearance-none rounded-md border border-border bg-card text-foreground",
    "text-start shadow-xs transition-colors",
    "hover:border-ring",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive"
  ),
  {
    variants: {
      size: {
        sm: "h-8 ps-3 pe-8 text-sm",
        md: "h-10 ps-4 pe-10 text-base",
        lg: "h-12 ps-4 pe-10 text-lg",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

const ICON_SIZE = { sm: "size-4", md: "size-5", lg: "size-5" }

const Select = React.forwardRef(
  ({ className, wrapperClassName, size = "md", children, ...props }, ref) => {
    return (
      <span className={cn("relative block w-full", wrapperClassName)}>
        <select ref={ref} className={cn(selectVariants({ size }), className)} {...props}>
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
            "end-3",
            ICON_SIZE[size ?? "md"]
          )}
        />
      </span>
    )
  }
)
Select.displayName = "Select"

export { Select, selectVariants }

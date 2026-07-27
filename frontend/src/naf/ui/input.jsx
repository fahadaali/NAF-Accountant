/* من سجلّ ناف: fahadaali/naf-ui — العنصر «input».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS): حُذفت
   التعليقات النوعية ووسائط forwardRef النوعية وكتل interface،
   وعُدّلت مسارات الاستيراد. لا سطر منطق تغيّر.
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً. */

import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "../lib/utils.js"

// نفس الارتفاعات الثلاثة المعتمدة للأزرار — الحقل والزر يتحاذيان.
const inputVariants = cva(
  cn(
    "flex w-full rounded-md border border-border bg-card text-foreground",
    "text-start shadow-xs transition-colors",
    "placeholder:text-muted-foreground",
    "hover:border-ring",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive",
    "file:border-0 file:bg-transparent file:font-medium file:text-foreground file:me-3"
  ),
  {
    variants: {
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-base",
        lg: "h-12 px-4 text-lg",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

const Input = React.forwardRef(
  ({ className, size, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(inputVariants({ size }), className)}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }

/* من سجلّ ناف: fahadaali/naf-ui — العنصر «alert».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS): حُذفت
   التعليقات النوعية ووسائط forwardRef النوعية وكتل interface،
   وعُدّلت مسارات الاستيراد. لا سطر منطق تغيّر.
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً. */

import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "../lib/utils.js"

// إلزامي: كل تنبيه أيقونة ونص معاً. اللون وحده لا يكفي.
//
// الخلفية من ‎--*-soft‎ لا من ‎/10‎: التخفيف بالشفافية قيمةٌ منتقاة باليد،
// و§6 تمنعها صراحةً للشارات والتنبيهات الهادئة. والرمز المشتقّ يتبع
// الوضعين بتعريف واحد، والمكتوب باليد ينجو من تغيير اللوحة ثم يصطدم بها.
// النصّ يبقى ‎text-foreground‎: التنبيه سطر كامل لا شارة، فتباينه من السطح.
const alertVariants = cva(
  cn(
    "flex w-full items-start gap-3 rounded-lg border p-4 text-start",
    "[&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:mt-0.5"
  ),
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        info: "border-info/30 bg-info-soft text-foreground [&>svg]:text-info-strong",
        success: "border-success/30 bg-success-soft text-foreground [&>svg]:text-success-strong",
        warning: "border-warning/30 bg-warning-soft text-foreground [&>svg]:text-warning-strong",
        destructive:
          "border-destructive/30 bg-destructive-soft text-foreground [&>svg]:text-destructive-strong",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  )
)
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("font-semibold", className)} {...props} />
  )
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription, alertVariants }

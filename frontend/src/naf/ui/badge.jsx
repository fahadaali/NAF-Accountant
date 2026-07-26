/* من سجلّ ناف: fahadaali/naf-ui — العنصر «badge».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS).
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً. */

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"

import { cn } from "../lib/utils.js"

// الشارة تُبلّغ عن حالة، ولا تُنقَر. ما يُنقَر زرّ.
//
// الخلفية مخفّفة من رمز الحالة عند /10 والنصّ والأيقونة من الرمز نفسه.
// المصمت للأفعال لا للحالات: جدول بعشرين صفاً من الشارات المصمتة يُقرأ
// كعشرين زرّاً. والاستثناء الوحيد `destructive` على صفّ يوشك المستخدم
// أن يفقده، حيث الثقل هو المقصود.
//
// إلزامي: لا تعتمد على اللون وحده — كل شارة حالة أيقونة ونصّ معاً.
const badgeVariants = cva(
  cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap",
    "rounded-full px-3 py-1 text-xs font-semibold",
    "[&_svg]:size-4 [&_svg]:shrink-0"
  ),
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        info: "bg-info/10 text-info",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        destructive: "bg-destructive/10 text-destructive",
        solid: "bg-destructive text-destructive-foreground",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Badge = React.forwardRef(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "span"
    return (
      <Comp ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
    )
  }
)
Badge.displayName = "Badge"

export { Badge, badgeVariants }

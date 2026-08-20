/* من سجلّ ناف: fahadaali/naf-ui — العنصر «naf-theme-toggle».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS): حُذفت
   التعليقات النوعية ووسائط forwardRef النوعية وكتل interface،
   وعُدّلت مسارات الاستيراد. لا سطر منطق تغيّر.
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً. */

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"

import { cn } from "../lib/utils.js"

// مُبدِّل المظهر: ثلاث حالات لا حالتان — يتبع النظام، فاتح، داكن.
//
// حالتان فقط فخّ: قارئٌ نظامه فاتح واختار «فاتح» لا يجد طريقاً للعودة إلى
// «يتبع النظام» عند تغيّره. ولذلك «يتبع النظام» هي الافتراض وتبقى خياراً ظاهراً.
//
// الاختيار يُحفظ، ويُطبَّق بوضع صنف .dark على عنصر الجذر — وهو ما يتوقّعه
// naf-theme.css عبر @custom-variant dark.
//
// المصطلحات من naf-terms.md والأيقونات من naf-icons.md. الأيقونات لا تُقلب.

const STORAGE_KEY = "naf-theme"

const OPTIONS = [
  { value: "system", label: "يتبع النظام", Icon: Monitor },
  { value: "light", label: "الوضع الفاتح", Icon: Sun },
  { value: "dark", label: "الوضع الداكن", Icon: Moon },
]

/** يقرأ الاختيار المحفوظ — «يتبع النظام» إن لم يوجد أو تعذّر التخزين. */
export function readThemeChoice() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

/** يطبّق الاختيار على عنصر الجذر ويحفظه. */
export function applyThemeChoice(choice) {
  const root = document.documentElement
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const dark = choice === "dark" || (choice === "system" && systemDark)
  root.classList.toggle("dark", dark)
  try {
    if (choice === "system") window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    /* التخزين غير متاح — يبقى الاختيار لهذه الجلسة */
  }
}

/**
 * مجموعة أزرار للمظهر. تُعرض كمجموعة واحدة لأن الحالات الثلاث متكافئة،
 * ولأن إخفاء «يتبع النظام» داخل قائمة يجعلها خياراً منسيّاً.
 */
export const ThemeToggle = React.forwardRef(
  ({ iconSize = 20, className, ...props }, ref) => {
    const [choice, setChoice] = React.useState("system")

    // القراءة بعد التركيب: localStorage غير متاح أثناء التصيير على الخادم
    React.useEffect(() => {
      setChoice(readThemeChoice())
    }, [])

    // «يتبع النظام» تتابع تغيّر تفضيل النظام أثناء فتح الصفحة
    React.useEffect(() => {
      applyThemeChoice(choice)
      if (choice !== "system") return
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      const onChange = () => applyThemeChoice("system")
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    }, [choice])

    return (
      <div
        ref={ref}
        role="radiogroup"
        aria-label="المظهر"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border bg-card p-1",
          className
        )}
        {...props}
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = choice === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              title={label}
              onClick={() => setChoice(value)}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon size={iconSize} aria-hidden />
            </button>
          )
        })}
      </div>
    )
  }
)
ThemeToggle.displayName = "ThemeToggle"

/* من سجلّ ناف: fahadaali/naf-ui — العنصر «naf-app-shell».
   حُوّل من TypeScript إلى JavaScript فحسب (المنصة بلا TS): حُذفت
   التعليقات النوعية ووسائط forwardRef النوعية وكتل interface،
   وعُدّلت مسارات الاستيراد. لا سطر منطق تغيّر.
   لا تعدّل هذا الملف — أي تغيير يحدث في السجلّ أولاً.
   أنماطه في ../naf-app-shell.css، وهي مستوردة من index.css. */

import * as React from "react"
import { ChevronDown, ChevronLeft, LogOut, Menu } from "lucide-react"

import { cn } from "../lib/utils"

// هيكل ناف الموحّد: شريط جانبي في جهة البداية، وترويسة تحمل فتات المسار
// وقائمة الحساب، وحاضن محتوى بعرض مسجَّل.
//
// المكوّن لا يحمل أنماطه: كلها في naf-app-shell.css. والسبب أن المنصات
// الخمس ليست على تقنية واحدة — ثلاثٌ منها تكتب CSS خاماً أو HTML ثابتاً
// ولا تستهلك React أصلاً.
//
// المصطلحات من naf-terms.md والأيقونات من naf-icons.md.

const TERMS = {
  menu: "القائمة",
  breadcrumb: "مسار التنقّل",
  account: "الحساب",
  signOut: "تسجيل الخروج",
  appearance: "المظهر",
}

/* ── حالة الدرج ── */

const ShellContext = React.createContext(null)

export function useShell() {
  const ctx = React.useContext(ShellContext)
  if (!ctx) throw new Error("useShell تُستدعى داخل AppShell وحدها")
  return ctx
}

export const AppShell = React.forwardRef(
  ({ fixed = false, className, children, ...props }, ref) => {
    const [open, setOpen] = React.useState(false)

    // Esc يغلق الدرج. الحجاب يُغلقه بالنقر، ولوحة المفاتيح تحتاج مخرجاً
    // مثله — ودرجٌ لا يُغلق إلا بالفأرة يحبس من لا يستعملها.
    React.useEffect(() => {
      if (!open) return
      const onKey = (e) => {
        if (e.key === "Escape") setOpen(false)
      }
      document.addEventListener("keydown", onKey)
      return () => document.removeEventListener("keydown", onKey)
    }, [open])

    // تمرير الخلفية يُوقف والدرج مفتوح: بدونه يمرّر الإصبعُ الصفحةَ تحت
    // الدرج فيبدو أن اللمس أخطأ هدفه.
    React.useEffect(() => {
      if (!open) return
      const previous = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = previous
      }
    }, [open])

    return (
      <ShellContext.Provider value={{ open, setOpen }}>
        <div
          ref={ref}
          className={cn("naf-shell", fixed && "naf-shell--fixed", className)}
          {...props}
        >
          {children}
        </div>
      </ShellContext.Provider>
    )
  }
)
AppShell.displayName = "AppShell"

/* ── الشريط الجانبي ── */

export const Sidebar = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open } = useShell()
  return (
    <aside
      ref={ref}
      id="naf-sidebar"
      className={cn("naf-sidebar", open && "is-open", className)}
      {...props}
    >
      {children}
    </aside>
  )
})
Sidebar.displayName = "Sidebar"

export const SidebarHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("naf-sidebar-header", className)} {...props} />
))
SidebarHeader.displayName = "SidebarHeader"

export const SidebarNav = React.forwardRef(({ className, ...props }, ref) => (
  <nav ref={ref} className={cn("naf-sidebar-nav", className)} {...props} />
))
SidebarNav.displayName = "SidebarNav"

export const SidebarFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("naf-sidebar-footer", className)} {...props} />
))
SidebarFooter.displayName = "SidebarFooter"

/** صنف رابط التنقّل. المنصة تبنيه بموجّهها وتمرّر حالة النشاط. */
export function navLinkClassName(isActive, className) {
  return cn("naf-nav-link", isActive && "is-active", className)
}

/* ── الترويسة ── */

export const AppHeader = React.forwardRef(({ className, ...props }, ref) => (
  <header ref={ref} className={cn("naf-header", className)} {...props} />
))
AppHeader.displayName = "AppHeader"

export const HeaderStart = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("naf-header-start", className)} {...props} />
))
HeaderStart.displayName = "HeaderStart"

export const HeaderEnd = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("naf-header-end", className)} {...props} />
))
HeaderEnd.displayName = "HeaderEnd"

/** زرّ القائمة — لا يظهر إلا دون نقطة الانكسار، والأنماط تتكفّل بذلك. */
export function MenuButton({ className, ...props }) {
  const { open, setOpen } = useShell()
  return (
    <button
      type="button"
      className={cn("naf-icon-btn naf-menu-btn", className)}
      aria-label={TERMS.menu}
      aria-expanded={open}
      aria-controls="naf-sidebar"
      onClick={() => setOpen(!open)}
      {...props}
    >
      <Menu size={20} aria-hidden="true" />
    </button>
  )
}

/** الحجاب. يُركَّب مرّة واحدة داخل AppShell. */
export function ShellBackdrop() {
  const { open, setOpen } = useShell()
  return (
    <div
      className={cn("naf-backdrop", open && "is-open")}
      onClick={() => setOpen(false)}
      aria-hidden="true"
    />
  )
}

/** فتات المسار. الفاصل ChevronLeft من الخريطة، ويُقلب في LTR. */
export function Breadcrumbs({ items, className }) {
  if (items.length === 0) return null
  return (
    <nav className={cn("naf-crumbs", className)} aria-label={TERMS.breadcrumb}>
      {items.map((crumb, index) => {
        const isLast = index === items.length - 1
        return (
          <React.Fragment key={`${crumb.label}-${index}`}>
            <ChevronLeft size={16} className="naf-crumb-sep" aria-hidden="true" />
            {crumb.href && !isLast ? (
              <a href={crumb.href} className="naf-crumb">
                {crumb.label}
              </a>
            ) : (
              <span
                className={cn("naf-crumb", isLast && "is-current")}
                aria-current={isLast ? "page" : undefined}
              >
                {crumb.label}
              </span>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

/* ── قائمة الحساب ── */

/** أول حرف من الاسم، بديلاً عن صورة غائبة. */
function initial(name) {
  return Array.from(name.trim())[0] ?? "؟"
}

/**
 * قائمة الحساب: الهوية والمظهر وبنود المنصة ثم تسجيل الخروج.
 *
 * الخروج داخل القائمة لا زرّاً ظاهراً: زرٌّ منفرد بجوار الإشعارات يُنقر
 * سهواً، وهو إجراء لا رجعة فيه في الجلسة.
 */
export function AccountMenu({
  name,
  email,
  role,
  items = [],
  appearance,
  onLogout,
  className,
}) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef(null)
  const triggerRef = React.useRef(null)

  // النقر خارج القائمة يغلقها، وEsc يغلقها ويعيد التركيز إلى زرّها —
  // وإلا ضاع التركيز في أوّل الصفحة بعد الإغلاق بلوحة المفاتيح.
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key !== "Escape") return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className={cn("naf-account-wrap", className)}>
      <button
        ref={triggerRef}
        type="button"
        className="naf-account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={TERMS.account}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="naf-avatar" aria-hidden="true">
          {initial(name)}
        </span>
        <span className="naf-account-text">
          <span className="naf-account-name">{name}</span>
          {role ? <span className="naf-account-role">{role}</span> : null}
        </span>
        <ChevronDown size={16} className="naf-account-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="naf-account-menu" role="menu">
          <div className="naf-account-menu-header">
            <div className="naf-account-name">{name}</div>
            {/* البريد يخلط لاتينياً بعربية الواجهة، فيُعزل اتجاهه */}
            {email ? <bdi className="naf-account-menu-email">{email}</bdi> : null}
          </div>

          {appearance ? (
            <>
              <hr className="naf-account-menu-sep" />
              <div className="naf-account-menu-appearance">
                <div className="naf-account-menu-email">{TERMS.appearance}</div>
                {appearance}
              </div>
            </>
          ) : null}

          {items.length > 0 ? <hr className="naf-account-menu-sep" /> : null}
          {items.map((item) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                role="menuitem"
                className="naf-account-menu-item"
                onClick={() => setOpen(false)}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="naf-account-menu-item"
                onClick={() => {
                  setOpen(false)
                  item.onSelect?.()
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            )
          )}

          <hr className="naf-account-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="naf-account-menu-item"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
          >
            <LogOut size={20} aria-hidden="true" />
            <span>{TERMS.signOut}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ── المحتوى ── */

export const AppContent = React.forwardRef(({ flush = false, className, ...props }, ref) => (
  <main
    ref={ref}
    className={cn("naf-content", flush && "naf-content--flush", className)}
    {...props}
  />
))
AppContent.displayName = "AppContent"

export const AppMain = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("naf-main", className)} {...props} />
))
AppMain.displayName = "AppMain"

const PAGE_WIDTH_CLASS = {
  narrow: "naf-page--narrow",
  default: "",
  wide: "naf-page--wide",
  full: "naf-page--full",
}

/** حاضن الصفحة. يوسّط المحتوى ويحدّ عرضه بدرجة مسجّلة. */
export const Page = React.forwardRef(({ width = "default", className, ...props }, ref) => (
  <div ref={ref} className={cn("naf-page", PAGE_WIDTH_CLASS[width], className)} {...props} />
))
Page.displayName = "Page"

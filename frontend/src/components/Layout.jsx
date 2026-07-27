import { fmtDate } from '../lib/format.js';
import { Button } from '../naf/ui/button.jsx';
import { NavLink } from 'react-router-dom';
import {
  LogOut, LayoutDashboard, ReceiptText, TrendingUp, ListTree,
  Repeat, Users, ClipboardList, Settings, ShieldCheck,
} from 'lucide-react';

// الأيقونات من خريطة ناف (naf-icons.md) — مقاس ٢٤ للتنقّل.
const links = [
  { to: '/', label: 'لوحة التحكم', Icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'العمليات', Icon: ReceiptText },
  { to: '/analytics', label: 'التحليلات', Icon: TrendingUp },
  { to: '/accounts', label: 'شجرة الحسابات', Icon: ListTree },
  { to: '/recurring', label: 'العمليات المتكرّرة', Icon: Repeat, adminOnly: true },
  { to: '/team', label: 'الفريق والصلاحيات', Icon: Users, adminOnly: true },
  { to: '/members', label: 'المستخدمون والصلاحيات', Icon: ShieldCheck, adminOnly: true },
  { to: '/logs', label: 'سجلّ النظام', Icon: ClipboardList },
  { to: '/settings', label: 'الإعدادات', Icon: Settings },
];

export default function Layout({ children, user, onLogout, isAdmin }) {
  const visibleLinks = links.filter((l) => !l.adminOnly || isAdmin);

  return (
    <div className="min-h-screen flex">
      {/* الشريط الجانبي — يختفي دون md ويحلّ محلّه شريط أفقي في الترويسة،
          فالشريط الثابت بعرض 16rem لا يترك للمحتوى شيئاً على شاشة 375px. */}
      <aside className="hidden md:flex w-64 bg-sidebar text-sidebar-foreground flex-shrink-0 flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="text-2xl font-bold">ناف القانونية</h1>
          <p className="text-sidebar-foreground/70 text-sm mt-1">المحاسب الذكي</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {visibleLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                  isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`
              }
            >
              <l.Icon size={24} aria-hidden="true" />
              <span className="font-semibold">{l.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-xs text-sidebar-foreground/50 border-t border-sidebar-border">
          مدعوم بالذكاء الاصطناعي · Claude & Wafeq
        </div>
      </aside>

      {/* المحتوى */}
      <main className="flex-1 overflow-auto min-w-0">
        <header className="bg-card border-b border-border px-4 md:px-8 py-4 flex items-center justify-between gap-3">
          <div className="text-muted-foreground text-sm">
            <span dir="ltr">{fmtDate(new Date())}</span>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            {user && <span className="text-foreground text-sm truncate hidden sm:inline" dir="ltr">{user.email}</span>}
            <Button variant="ghost" className="text-sm" onClick={onLogout}>
              <LogOut size={20} className="rtl:-scale-x-100" aria-hidden="true" /> خروج
            </Button>
          </div>
        </header>

        {/* تنقّل الشاشات الصغيرة — أيقونات فقط مع تسمية للقارئ الصوتي */}
        <nav className="md:hidden bg-sidebar text-sidebar-foreground border-b border-sidebar-border overflow-x-auto">
          <div className="flex gap-1 p-2 w-max">
            {visibleLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                title={l.label}
                aria-label={l.label}
                className={({ isActive }) =>
                  `p-3 rounded-lg transition ${
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground/80'
                  }`
                }
              >
                <l.Icon size={24} aria-hidden="true" />
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}

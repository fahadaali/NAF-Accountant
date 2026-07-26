import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'لوحة التحكم', icon: '📊', end: true },
  { to: '/transactions', label: 'العمليات', icon: '🧾' },
  { to: '/analytics', label: 'التحليلات', icon: '📈' },
  { to: '/accounts', label: 'شجرة الحسابات', icon: '🌳' },
  { to: '/recurring', label: 'العمليات المتكرّرة', icon: '🔁', adminOnly: true },
  { to: '/team', label: 'الفريق والصلاحيات', icon: '👥', adminOnly: true },
  { to: '/logs', label: 'سجلّ النظام', icon: '📋' },
  { to: '/settings', label: 'الإعدادات', icon: '⚙️' },
];

export default function Layout({ children, user, onLogout, isAdmin }) {

  return (
    <div className="min-h-screen flex">
      {/* الشريط الجانبي */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex-shrink-0 flex flex-col">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-2xl font-bold">ناف القانونية</h1>
          <p className="text-sidebar-foreground/70 text-sm mt-1">المحاسب الذكي</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {links.filter((l) => !l.adminOnly || isAdmin).map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                  isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/80 hover:bg-card/5'
                }`
              }
            >
              <span className="text-lg">{l.icon}</span>
              <span className="font-semibold">{l.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-xs text-sidebar-foreground/50 border-t border-white/10">
          مدعوم بالذكاء الاصطناعي · Claude & Wafeq
        </div>
      </aside>

      {/* المحتوى */}
      <main className="flex-1 overflow-auto">
        <header className="bg-card border-b border-slate-100 px-8 py-4 flex items-center justify-between">
          <div className="text-muted-foreground text-sm">
            {new Date().toLocaleDateString('ar', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
          <div className="flex items-center gap-3">
            {user && <span className="text-slate-600 text-sm" dir="ltr">{user.email}</span>}
            <button className="btn-ghost text-sm" onClick={onLogout}>
              🚪 خروج
            </button>
          </div>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

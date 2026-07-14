import { NavLink, useNavigate } from 'react-router-dom';

const links = [
  { to: '/', label: 'لوحة التحكم', icon: '📊', end: true },
  { to: '/transactions', label: 'العمليات', icon: '🧾' },
  { to: '/accounts', label: 'شجرة الحسابات', icon: '🌳' },
  { to: '/settings', label: 'الإعدادات', icon: '⚙️' },
];

export default function Layout({ children }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex">
      {/* الشريط الجانبي */}
      <aside className="w-64 bg-naf-900 text-white flex-shrink-0 flex flex-col">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-2xl font-black">ناف لو</h1>
          <p className="text-naf-100/70 text-sm mt-1">المحاسب الذكي</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition ${
                  isActive ? 'bg-naf-500 text-white' : 'text-naf-100/80 hover:bg-white/5'
                }`
              }
            >
              <span className="text-lg">{l.icon}</span>
              <span className="font-semibold">{l.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-xs text-naf-100/50 border-t border-white/10">
          مدعوم بالذكاء الاصطناعي · Claude & Wafeq
        </div>
      </aside>

      {/* المحتوى */}
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between">
          <div className="text-slate-500 text-sm">
            {new Date().toLocaleDateString('ar', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
          <button
            className="btn-ghost text-sm"
            onClick={() => navigate('/settings')}
          >
            🔑 مفاتيح الربط
          </button>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

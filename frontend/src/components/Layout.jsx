import { useEffect } from 'react';
import { fmtDate } from '../lib/format.js';
import { ThemeToggle } from '../naf/ui/theme-toggle.jsx';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, TrendingUp, ListTree,
  Repeat, Users, ClipboardList, Settings, ShieldCheck,
} from 'lucide-react';
import {
  AppShell, AppMain, AppHeader, HeaderStart, HeaderEnd, AppContent,
  Sidebar, SidebarHeader, SidebarNav, SidebarFooter,
  ShellBackdrop, MenuButton, AccountMenu, navLinkClassName, useShell,
} from '../naf/ui/app-shell.jsx';

// الأيقونات من خريطة ناف (naf-icons.md) — مقاس ٢٤ للتنقّل.
const links = [
  { to: '/', label: 'لوحة التحكم', Icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'العمليات', Icon: ArrowLeftRight },
  { to: '/analytics', label: 'التحليلات', Icon: TrendingUp },
  { to: '/accounts', label: 'شجرة الحسابات', Icon: ListTree },
  { to: '/recurring', label: 'العمليات المتكرّرة', Icon: Repeat, adminOnly: true },
  { to: '/team', label: 'الفريق والصلاحيات', Icon: Users, adminOnly: true },
  { to: '/members', label: 'المستخدمون والصلاحيات', Icon: ShieldCheck, adminOnly: true },
  { to: '/logs', label: 'سجلّ النظام', Icon: ClipboardList },
  { to: '/settings', label: 'الإعدادات', Icon: Settings },
];

/** يغلق الدرج عند الانتقال — وإلا بقي مفتوحاً فوق الشاشة الجديدة. */
function CloseDrawerOnNavigate() {
  const { setOpen } = useShell();
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  return null;
}

function ShellBody({ children, user, onLogout, isAdmin }) {
  const visibleLinks = links.filter((l) => !l.adminOnly || isAdmin);

  return (
    <>
      <CloseDrawerOnNavigate />
      <ShellBackdrop />

      {/* كان الشريط يختفي دون md ويحلّ محلّه شريطٌ أفقي من الأيقونات وحدها
          في صدر المحتوى: تسع أيقونات بلا نصّ تُمرَّر أفقياً، فلا يُعرف
          القسم إلا بحفظ شكله. صار درجاً يحمل الأسماء كاملةً. */}
      <Sidebar>
        <SidebarHeader>
          <div>
            <div className="naf-sidebar-brand-name">ناف القانونية</div>
            <div className="naf-sidebar-brand-sub">المحاسب الذكي</div>
          </div>
        </SidebarHeader>

        <SidebarNav>
          {visibleLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => navLinkClassName(isActive)}
            >
              <l.Icon size={24} aria-hidden="true" />
              <span>{l.label}</span>
            </NavLink>
          ))}
        </SidebarNav>

        <SidebarFooter>
          مدعوم بالذكاء الاصطناعي · <bdi>Claude &amp; Wafeq</bdi>
        </SidebarFooter>
      </Sidebar>

      <AppMain>
        <AppHeader>
          <HeaderStart>
            <MenuButton />
            <span className="naf-crumb is-current">
              <bdi>{fmtDate(new Date())}</bdi>
            </span>
          </HeaderStart>
          <HeaderEnd>
            {/* الخروج داخل قائمة الحساب لا زرّاً ظاهراً بجوار مُبدِّل
                المظهر: زرّان ومُبدِّل ثلاثيّ في ترويسة 375 بكسل يتزاحمون،
                وإنهاء الجلسة لا رجعة فيه فلا يُترك تحت نقرة سهو. */}
            {/* الاسم كما هو ولو كان فارغاً — البديل في المكوّن المسجَّل.
                كان البريد يحلّ محلّ الاسم الغائب، والبريد معرّف دخول
                لا يُخاطَب به أحد. */}
            <AccountMenu
              name={user?.name}
              email={user?.email}
              appearance={<ThemeToggle />}
              onLogout={onLogout}
            />
          </HeaderEnd>
        </AppHeader>

        <AppContent>{children}</AppContent>
      </AppMain>
    </>
  );
}

export default function Layout({ children, user, onLogout, isAdmin }) {
  return (
    <AppShell>
      <ShellBody user={user} onLogout={onLogout} isAdmin={isAdmin}>
        {children}
      </ShellBody>
    </AppShell>
  );
}

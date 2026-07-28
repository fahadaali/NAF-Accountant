import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Accounts from './pages/Accounts.jsx';
import Settings from './pages/Settings.jsx';
import Logs from './pages/Logs.jsx';
import Team from './pages/Team.jsx';
import Recurring from './pages/Recurring.jsx';
import Analytics from './pages/Analytics.jsx';
import Login from './pages/Login.jsx';
import Members from './pages/Members.jsx';
import Denied from './pages/Denied.jsx';
import { api, auth, getToken, clearToken } from './lib/api.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // عند الإقلاع: الدخول الموحّد أولاً — الجلسة كوكي HttpOnly، والوسيط لا
  // يُحمّل اللوحة أصلاً لغير المسجَّل. وإن لم تكن هناك جلسة موحّدة يُجرَّب
  // الرمز المخزّن من نظام الدخول السابق.
  useEffect(() => {
    (async () => {
      // صفحة الرفض لا تسأل عن العضو.
      //
      // وهي عامة، فتُحمَّل اللوحة عليها بلا جلسة. ولو سألت `‎/api/me` لردّ
      // الوسيط ٤٠١ ومعه عنوان الباب، فيحوّل المتصفّح إلى المركز، فيصدر
      // رمزاً، فيسقط الاستقبال للسبب نفسه، فيعود إلى الرفض — دورة لا تنتهي
      // ولا تُقرأ فيها الرسالة التي جاء المستخدم ليقرأها.
      if (window.location.pathname === '/denied') {
        setReady(true);
        return;
      }

      try {
        const res = await api.me();
        setUser(res.user);
        setReady(true);
        return;
      } catch (_) {
        /* لا جلسة موحّدة — جرّب الرمز المخزّن */
      }
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        const res = await auth.me();
        setUser(res.user);
      } catch (_) {
        clearToken();
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const logout = async () => {
    // رمز نظام الدخول السابق، إن كان لا يزال موجوداً.
    if (getToken()) {
      try {
        await auth.logout();
      } catch (_) {
        /* تجاهل */
      }
      clearToken();
    }
    // جلسة الدخول الموحّد: تُمسح من KV ويُمسح كوكيها، ثم يعيد الجذرُ الطلبَ
    // إلى المركز عبر الوسيط.
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } catch (_) {
      /* تجاهل */
    }
    setUser(null);
    window.location.href = '/';
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        جارٍ التحميل…
      </div>
    );
  }

  // صفحة الرفض تُعرض بلا جلسة — الوسيط يمرّرها عامةً، وإليها يحوّل من مُنع.
  if (window.location.pathname === '/denied') {
    return <Denied />;
  }

  if (!user) {
    return <Login onAuthed={setUser} />;
  }

  const isAdmin = user.role === 'admin';

  return (
    <Layout user={user} onLogout={logout} isAdmin={isAdmin}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions isAdmin={isAdmin} />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/accounts" element={<Accounts isAdmin={isAdmin} />} />
        {isAdmin && <Route path="/recurring" element={<Recurring />} />}
        {isAdmin && <Route path="/team" element={<Team />} />}
        {isAdmin && <Route path="/members" element={<Members />} />}
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings user={user} onLogout={logout} />} />
      </Routes>
    </Layout>
  );
}

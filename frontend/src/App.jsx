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
import { auth, getToken, clearToken } from './lib/api.js';
import { watchSystemTheme } from './lib/theme.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // «حسب النظام» يتبع تبديل المستخدم في نظامه دون إعادة تحميل.
  useEffect(watchSystemTheme, []);

  // عند الإقلاع: تحقّق من صلاحية الرمز المخزّن.
  useEffect(() => {
    (async () => {
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
    try {
      await auth.logout();
    } catch (_) {
      /* تجاهل */
    }
    clearToken();
    setUser(null);
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        جارٍ التحميل…
      </div>
    );
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
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings user={user} onLogout={logout} />} />
      </Routes>
    </Layout>
  );
}

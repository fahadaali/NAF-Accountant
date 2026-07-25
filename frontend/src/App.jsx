import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Accounts from './pages/Accounts.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import { auth, getToken, clearToken } from './lib/api.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">
        جارٍ التحميل…
      </div>
    );
  }

  if (!user) {
    return <Login onAuthed={setUser} />;
  }

  return (
    <Layout user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/settings" element={<Settings user={user} onLogout={logout} />} />
      </Routes>
    </Layout>
  );
}

import { useEffect, useState } from 'react';
import { auth, setToken } from '../lib/api.js';

export default function Login({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'setup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // عند الفتح: هل يوجد مستخدمون؟ إن لا → وضع إنشاء المسؤول الأول.
  useEffect(() => {
    (async () => {
      try {
        const s = await auth.status();
        setMode(s.hasUsers ? 'login' : 'setup');
      } catch (_) {
        setMode('login');
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'setup') {
      if (password.length < 8) return setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      if (password !== confirm) return setError('كلمتا المرور غير متطابقتين.');
    }

    setLoading(true);
    try {
      const res =
        mode === 'setup'
          ? await auth.bootstrap(email, password)
          : await auth.login(email, password);
      setToken(res.token);
      onAuthed(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-naf-900 text-white">
        جارٍ التحميل…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-naf-900 to-naf-700 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 text-white">
          <h1 className="text-4xl font-black">ناف لو</h1>
          <p className="text-naf-100/80 mt-2">المحاسب الذكي · لوحة التحكم</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-1">
            {mode === 'setup' ? 'إنشاء حساب المسؤول الأول' : 'تسجيل الدخول'}
          </h2>
          <p className="text-slate-500 text-sm mb-6">
            {mode === 'setup'
              ? 'لا يوجد حساب بعد — أنشئ حساب المسؤول للبدء.'
              : 'أدخل بريدك وكلمة المرور للدخول.'}
          </p>

          {error && (
            <div className="mb-4 bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-600 mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                dir="ltr"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-naf-500 outline-none text-left"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-600 mb-1">كلمة المرور</label>
              <input
                type="password"
                dir="ltr"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-naf-500 outline-none text-left"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              />
            </div>
            {mode === 'setup' && (
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1">تأكيد كلمة المرور</label>
                <input
                  type="password"
                  dir="ltr"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-naf-500 outline-none text-left"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
              {loading ? '…' : mode === 'setup' ? 'إنشاء الحساب والدخول' : 'دخول'}
            </button>
          </form>
        </div>

        <p className="text-center text-naf-100/50 text-xs mt-6">
          مدعوم بالذكاء الاصطناعي · Claude & Wafeq
        </p>
      </div>
    </div>
  );
}

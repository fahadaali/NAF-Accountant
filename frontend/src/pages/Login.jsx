import { useEffect, useState } from 'react';
import { auth, setToken } from '../lib/api.js';
import { Input } from '../naf/ui/input.jsx';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Card } from '../naf/ui/card.jsx';

export default function Login({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'setup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // عند الفتح: هل يوجد مستخدمون؟ وإلا وضع إنشاء المسؤول الأول.
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
      // النصّ المعتمد في naf-terms.md §٤ (بأرقام غربية كما توجب §٥)
      if (password.length < 8) return setError('كلمة المرور تحتاج 8 أحرف على الأقل.');
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
      <div className="min-h-screen flex items-center justify-center bg-sidebar text-sidebar-foreground">
        جارٍ التحميل…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 text-sidebar-foreground">
          <h1 className="text-4xl font-bold">ناف القانونية</h1>
          <p className="text-sidebar-foreground/80 mt-2">المحاسب الذكي · لوحة التحكم</p>
        </div>

        <Card className="shadow-2xl p-8">
          <h2 className="text-xl font-bold text-foreground mb-1">
            {mode === 'setup' ? 'إنشاء حساب المسؤول الأول' : 'تسجيل الدخول'}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {mode === 'setup'
              ? 'لا حساب بعد. أنشئ حساب المسؤول للبدء.'
              : 'أدخل بريدك وكلمة المرور للدخول.'}
          </p>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-semibold text-foreground mb-1">البريد الإلكتروني</label>
              <Input
                id="login-email"
                type="email"
                dir="ltr"
                className="w-full text-start"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-semibold text-foreground mb-1">كلمة المرور</label>
              <Input
                id="login-password"
                type="password"
                dir="ltr"
                className="w-full text-start"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              />
            </div>
            {mode === 'setup' && (
              <div>
                <label htmlFor="login-confirm" className="block text-sm font-semibold text-foreground mb-1">تأكيد كلمة المرور</label>
                <Input
                  id="login-confirm"
                  type="password"
                  dir="ltr"
                  className="w-full text-start"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
            )}
            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? '…' : mode === 'setup' ? 'إنشاء الحساب والدخول' : 'تسجيل الدخول'}
            </Button>
          </form>
        </Card>

        {/* /70 لا /50 — الخمسون تعطي 3.10 وهذا نصّ xs فحدّه 4.5 */}
        <p className="text-center text-sidebar-foreground/70 text-xs mt-6">
          مدعوم بالذكاء الاصطناعي · <bdi>Claude &amp; Wafeq</bdi>
        </p>
      </div>
    </div>
  );
}

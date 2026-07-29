import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from './naf/ui/button.jsx';
import { Card } from './naf/ui/card.jsx';
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
    // جلسة الدخول الموحّد: تُمسح من KV ويُمسح كوكيها، ثم يخرج المتصفّح إلى
    // المركز — لا إلى جذر هذه المنصة.
    //
    // ═══ تنقّلٌ كامل بـ POST، لا نداء `fetch` ثم قفزة ═══
    //
    // كان: `fetch` يقرأ الوجهة من `next` في الردّ، فإن تعذّر النداء أو لم
    // يُقرأ جسمه بقيت الوجهة الجذر. والجذر محميّ، فيحوّله الوسيط إلى
    // `/go/NAF-Accountant`، وجلسة المركز لم تُمسّ فتُصدر رمزاً جديداً — فيعود
    // الخارجُ إلى الشاشة التي خرج منها. أي أن كل فشلٍ في ذلك النداء، أياً كان
    // سببه، يُخرج بالمستخدم إلى المشهد نفسه بالضبط: «ضغطتُ خروج فبقيتُ مكاني».
    //
    // ومسارُ التنقّل لا يمرّ بشيء من ذلك: الخادم يردّ التنقّل بـ٣٠٢ إلى المركز
    // مباشرةً — لا جسم يُقرأ ولا وجهة تُستنتج ولا احتياطيّ يخطئ. ويعمل ولو لم
    // يصل الردّ أصلاً، لأن المتصفّح هو من يتنقّل لا الشيفرة.
    //
    // و`POST` لا `GET`: رابطٌ يُخرج صاحبَه بمجرّد فتحه تكفي صورةٌ في صفحة
    // لتشغيله.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/auth/logout';
    document.body.appendChild(form);
    form.submit();
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

  /* لا شاشة دخولٍ محلية بعد الدخول الموحّد.
     الوسيط يحرس `‎/`، فلا يبلغ هذه الشيفرةَ مجهولٌ أصلاً: من لا جلسة له
     يُحوَّل إلى المركز قبل أن تُحمَّل الواجهة. فبلوغُ هذا الفرع يعني جلسةً
     قائمة تعذّرت قراءةُ عضوها — عطلٌ عابر لا انعدامُ دخول.
     وعرضُ نموذج بريدٍ وكلمة مرور عليه يدعو صاحبه إلى بابٍ لم يعد يُركَّب.
     و`‎/auth/logout` يُنهي جلسة المنصة ويعيده إلى المركز ليدخل من جديد. */
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">تعذّر الدخول</h1>
          <p className="text-muted-foreground">تعذّر التحقق من دخولك. أعد المحاولة.</p>
          <Button
            className="w-full justify-center"
            onClick={() => {
              const form = document.createElement('form');
              form.method = 'POST';
              form.action = '/auth/logout';
              document.body.appendChild(form);
              form.submit();
            }}
          >
            تسجيل الدخول
          </Button>
        </Card>
      </div>
    );
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
        {/* بلا هذا المسار كانت الشاشة تُترك فارغة.

            مسارات المسؤول الثلاثة أعلاه لا تُسجَّل أصلاً لغيره، فعضوٌ يبلغ
            `‎/members` من مفضّلته أو من رابط قديم لا يطابق مساراً — و
            `Routes` لا يعرض شيئاً حين لا يطابق شيء. فيرى إطار اللوحة
            وقائمتها ومنطقة محتوى خاوية بلا كلمة تقول ما جرى، فيظنّ العطل
            في المنصة.

            والرسالتان اثنتان لا واحدة: من طلب شاشةَ مسؤولٍ وليس مسؤولاً
            يُقال له إنه لا يملكها، ومن طلب مساراً لا وجود له يُقال له إنها
            غير موجودة. وخلطهما يخبر الأول أن الشاشة غير موجودة وهي قائمة
            يفتحها زميله. */}
        <Route path="*" element={<Unmatched isAdmin={isAdmin} />} />
      </Routes>
    </Layout>
  );
}

/** مسارات لا يراها إلا المسؤول — تُقرأ لتمييز «لا صلاحية» من «غير موجودة». */
const ADMIN_PATHS = ['/recurring', '/team', '/members'];

/**
 * شاشة المسار غير المطابق. النصّان من `naf-terms.md` §٧ · الأخطاء:
 * «لا صلاحية» و«غير موجود».
 *
 * والأيقونة `Lock` من `naf-icons.md`: «محتوى مقفل يراه المستخدم ولا يفتحه»
 * — وهي حال هذه الشاشة. ولا تُستعار `ShieldX`: تلك لمن رُدّ على باب منصة
 * فلم يدخلها، واستعارتها هنا تجعل من يقف داخلها يقرأ أنه مُنع منها.
 *
 * وتظهر مع «لا صلاحية» وحدها: المسار غير الموجود ليس حكماً على القارئ،
 * فلا قفل عليه.
 */
function Unmatched({ isAdmin }) {
  const needsAdmin = !isAdmin && ADMIN_PATHS.includes(window.location.pathname);
  return (
    <main className="grid place-items-center p-6">
      <div className="grid justify-items-center gap-4 max-w-prose text-center">
        {needsAdmin && <Lock className="text-muted-foreground" size={40} aria-hidden="true" />}
        <p className="text-base text-muted-foreground" role="status">
          {needsAdmin ? 'لا تملك صلاحية الوصول لهذه الصفحة' : 'الصفحة غير موجودة'}
        </p>
      </div>
    </main>
  );
}

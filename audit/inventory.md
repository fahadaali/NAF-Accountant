# الجرد العام — منصة ناف المحاسبية

> **وثيقة تاريخية.** المرحلة ١ (جرد) قبل الربط بالسجلّ — تصف الحالة في
> ٢٦ يوليو ٢٠٢٦ لا الحالة اليوم: Tailwind كان v3 بلا مكتبة أيقونات ولا ثيم
> ناف، وكل ما دونها من انحراف عولج في الدفعات التالية. أُبقيت للرجوع.
> الحالة الراهنة في `audit/report.md` و`audit/code-audit-2026-08.md`.

> المرحلة ١ (جرد). لم يُعدَّل أي كود.

## ١. الإطار والأدوات

| العنصر | القيمة | الملف |
|---|---|---|
| الإطار | **React 18.3.1** | `frontend/package.json` |
| أداة البناء | **Vite 6.0.5** | `frontend/package.json` |
| التوجيه | `react-router-dom` 6.28.0 | `frontend/package.json` |
| طريقة التنسيق | **Tailwind CSS 3.4.17** (أصناف مباشرة + طبقة `@layer components`) | `frontend/tailwind.config.js`, `frontend/src/index.css` |
| المعالج | PostCSS 8.4.49 + Autoprefixer | `frontend/postcss.config.js` |
| الخلفية | Cloudflare Worker + Hono 4.x — يخدم `frontend/dist` كأصول ثابتة | `wrangler.toml` |
| **مكتبة أيقونات** | 🔴 **لا توجد** — لا `lucide-react` ولا غيرها | — |
| **ثيم ناف من السجلّ** | 🔴 **غير مثبّت** | — |

## ٢. 🔴 النظام الموازي — ثيم محلي في `tailwind.config.js`

**يجب حذفه لا دمجه** (حسب قاعدة المرحلة ٤-١).

```js
// frontend/tailwind.config.js
theme: {
  extend: {
    fontFamily: { sans: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'] },
    colors: {
      naf: {
        50:  '#f0f7f4',   100: '#dcefe6',
        500: '#0f766e',   600: '#0d6157',
        700: '#0a4f47',   900: '#052e2b',
      },
    },
  },
}
```

- **6 درجات لون** تحت الاسم `naf` — تركوازي مخضرّ، **لا علاقة له بسجلّ ناف** (اسم متطابق، مصدر مختلف).
- **40 استخداماً** عبر 8 ملفات. الأكثف: `ring-naf-500` (21×) في كل حقول الإدخال.
- **خطر تسمية:** أي رمز من السجلّ يحمل بادئة `naf-` سيتعارض اسمياً مع هذا الثيم. الحذف يجب أن يسبق التثبيت أو يتزامن معه.

### طبقة مكوّنات موازية — `src/index.css`

```css
@layer components {
  .card       { @apply bg-white rounded-2xl shadow-sm border border-slate-100 p-6; }
  .btn        { @apply inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold transition; }
  .btn-primary{ @apply btn bg-naf-500 text-white hover:bg-naf-600; }
  .btn-ghost  { @apply btn bg-slate-100 text-slate-700 hover:bg-slate-200; }
  .badge      { @apply inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold; }
}
```
**5 أصناف مكوّنات محلية** — نظام مكوّنات مصغّر موازٍ لمكوّنات السجلّ.

## ٣. مكوّنات الواجهة الموجودة (مجمّعة بوظيفتها)

### تخطيط وتنقّل
| المكوّن | الملف | الوصف |
|---|---|---|
| `Layout` | `components/Layout.jsx` | شريط جانبي (8 روابط) + رأس صفحة + منطقة محتوى |
| `App` | `App.jsx` | بوابة المصادقة والتوجيه |

### عرض بيانات
| المكوّن | الملف | الوصف |
|---|---|---|
| `StatusBadge` | `components/StatusBadge.jsx` | شارة حالة بـ 7 حالات ملوّنة |
| `JsonPreview` | داخل `pages/Transactions.jsx` | كتلة JSON قابلة للطيّ |
| `MediaViewer` | `components/MediaViewer.jsx` | مشغّل صوت / معاينة صورة عند الطلب |
| `BarList` | داخل `pages/Analytics.jsx` | قائمة أشرطة أفقية |
| `TrendChart` | داخل `pages/Analytics.jsx` | رسم خطي SVG مبني يدوياً بسلسلتين |

> **ملاحظة:** `JsonPreview` و`BarList` و`TrendChart` مكوّنات محليّة غير مستخرَجة إلى ملفات مستقلة.

### نماذج وإدخال
لا توجد مكوّنات نماذج مجرّدة — كل `input` و`select` و`button` يُنسَّق بأصناف مكرّرة في مكانه.
النمط المتكرّر (23 مرة تقريباً):
```
border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none
```

### الصفحات (9)
`Dashboard` · `Transactions` · `Analytics` · `Accounts` · `Recurring` · `Team` · `Logs` · `Settings` · `Login`

### خارج React
| الملف | الوصف |
|---|---|
| `src/routes/basecamp_oauth.js` | صفحة HTML عربية كاملة (RTL) تُولَّد من الخلفية بـ CSS خام — **خارج Tailwind والثيم تماماً** |

## ٤. حالة الوضع الداكن

🔴 **غير موجود إطلاقاً.**
- لا `darkMode` في `tailwind.config.js`.
- لا صنف `dark:` واحد في المشروع.
- لا `prefers-color-scheme` ولا `data-theme`.
- كل الألوان مضبوطة للوضع الفاتح فقط.

## ٥. الشعار والأصول

🔴 **لا توجد ملفات أصول.** `frontend/public/` فارغ، ولا ملفات `.svg` ولا `.png`.
- الشعار **نص خام**: «ناف القانونية» في `Layout.jsx:17` و`Login.jsx:63`.
- لا `favicon`.

## ٦. 🔴 الأيقونات — 24 إيموجي بديلاً عن مكتبة أيقونات

| الإيموجي | العدد | المواضع | السياق |
|---|---|---|---|
| 📊 | 4 | `Layout.jsx:4`, `Settings.jsx:163,166,169` | رابط «لوحة التحكم» · أزرار التقارير المالية |
| 🎙️ | 4 | `MediaViewer.jsx:42`, `Dashboard.jsx:89`, `Transactions.jsx:19,216` | مصدر «صوت» · زر «استماع» |
| 🖼️ | 4 | `MediaViewer.jsx:42`, `Dashboard.jsx:89`, `Transactions.jsx:20,216` | مصدر «صورة» · زر «عرض» |
| ⏳ | 3 | `Accounts.jsx:70`, `Settings.jsx:160,163` | حالة انتظار أثناء التنفيذ |
| 🔄 | 3 | `Accounts.jsx:70`, `Logs.jsx:71`, `Transactions.jsx:127` | «تحديث» · «مزامنة من وافق» |
| ✅ | 3 | `Dashboard.jsx:7`, `Settings.jsx:22,23` | بطاقة «مسودات في وافق» · وسم جودة مزوّد |
| ⚠️ | 3 | `Dashboard.jsx:9`, `Logs.jsx:69`, `Transactions.jsx:220` | بطاقة «عمليات فاشلة» · مرشّح الأخطاء · رسالة خطأ |
| 💬 | 3 | `Dashboard.jsx:89`, `Transactions.jsx:18,216` | مصدر «نص» |
| 🚪 | 2 | `Layout.jsx:60`, `Settings.jsx:97` | «خروج» |
| ⬇️ | 2 | `Transactions.jsx:125,157` | «تصدير CSV» · **ترتيب تنازلي** |
| 🧾 | 1 | `Layout.jsx:5` | رابط «العمليات» |
| 📈 | 1 | `Layout.jsx:6` | رابط «التحليلات» |
| 🌳 | 1 | `Layout.jsx:7` | رابط «شجرة الحسابات» |
| 🔁 | 1 | `Layout.jsx:8` | رابط «العمليات المتكرّرة» |
| 👥 | 1 | `Layout.jsx:9` | رابط «الفريق والصلاحيات» |
| 📋 | 1 | `Layout.jsx:10` | رابط «سجلّ النظام» |
| ⚙️ | 1 | `Layout.jsx:11` | رابط «الإعدادات» |
| 📥 | 1 | `Dashboard.jsx:6` | بطاقة «إجمالي العمليات» |
| 🤖 | 1 | `Dashboard.jsx:8` | بطاقة «قيد التحليل» |
| 📤 | 1 | `Settings.jsx:160` | زر «ملخص المسودات» |
| 🔔 | 1 | `Team.jsx:210` | عمود «يستقبل التنبيهات» |
| 🗑️ | 1 | `Transactions.jsx:116` | «حذف المحدّد» |
| 🔎 | 1 | `Transactions.jsx:139` | نائب حقل البحث |
| ⬆️ | 1 | `Transactions.jsx:157` | **ترتيب تصاعدي** |

> **تنبيه اتجاهية:** ⬇️ و⬆️ رأسيتان فلا تتأثران بالقلب. لا توجد إيموجي أفقية الاتجاه (→ ←) في المنصة — لكن بدائل Lucide لبعضها قد تكون اتجاهية.

> إيموجي إضافية توجد في **رسائل بوت تليجرام** (`src/lib/processor.js`) — **خارج نطاق واجهة الويب**، وتغييرها يمسّ محتوى الرسائل لا الشكل.

## ٧. 🔴 مخالفات الاتجاه

| النوع | العدد | الملفات |
|---|---|---|
| `text-right` | 7 | `Team.jsx` (2) · `Transactions.jsx` · `Recurring.jsx` · `Logs.jsx` · `Dashboard.jsx` · `Analytics.jsx` · `Accounts.jsx` |
| `text-left` | 3 | `Login.jsx` (3 — حقول البريد وكلمتَي المرور، مقصودة لعزل الإدخال اللاتيني) |
| `ml-2` | 1 | `Analytics.jsx` |
| `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*` | **0** | — |

**المجموع: 11 مخالفة في 9 ملفات.**

**الحالة الجيدة:**
- عنصر الجذر مضبوط أصلاً: `<html lang="ar" dir="rtl">` في `frontend/index.html:2` ✅
- `html { direction: rtl }` في `index.css` ✅
- لا توجد خصائص `left/right` مطلقة ولا هوامش فيزيائية أخرى.

**ملاحظة على `text-left` في `Login.jsx`:** الحقول اللاتينية (بريد/كلمة مرور) داخل صفحة RTL — استخدام `dir="ltr"` معها موجود بالفعل. هذا **عزل نص مختلط الاتجاه مقصود**، وتحويله إلى منطقي (`text-start`) قد يكون انحداراً — يحتاج قرارك.

---

## الملخص الرقمي

| المقياس | العدد |
|---|---|
| الإطار | React 18.3.1 + Vite 6.0.5 |
| ملفات الواجهة | **15** (9 صفحات + 3 مكوّنات + App + api + css) |
| مكوّنات React | **8** (منها 3 محليّة غير مستخرَجة) |
| أصناف مكوّنات CSS محلية | **5** |
| **ثيم محلي موازٍ** | **1** (6 درجات لون + عائلة خط) — 🔴 للحذف |
| **مكتبة أيقونات** | **0** — 🔴 |
| **إيموجي كأيقونات** | **24 فريدة** في **47 موضعاً** عبر **9 ملفات** |
| **مخالفات اتجاه** | **11** في 9 ملفات |
| الوضع الداكن | ❌ غير موجود |
| ملفات الشعار/الأصول | **0** |
| صفحات خارج نظام التنسيق | **1** (`basecamp_oauth.js`) |

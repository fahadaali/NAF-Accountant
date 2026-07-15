# ناف لو — المحاسب الذكي (NAF Accountant)

منصة وسيطة برمجية (Serverless AI Accounting Middleware) تعمل كمحاسب ذكي لشركة **ناف لو**، مبنية بالكامل على **Cloudflare**.

تستقبل العمليات المالية اليومية عبر **بوت تليجرام** (نصوص، صوتيات، أو صور فواتير)، تعالجها بالذكاء الاصطناعي، وتُنشئ قيوداً محاسبية في نظام **وافق (Wafeq)** كـ **مسودات (Drafts)** تتطلب مراجعة يدوية، وترسل تقارير دورية إلى **بيسكامب (Basecamp)**.

الواجهة والمدخلات باللغة العربية بالكامل مع دعم اتجاه **RTL**.

---

## 🧠 محرّك التوجيه المحاسبي

يصنّف Claude كل عملية ويوجّهها للمسار الصحيح في وافق:

| الحالة | المسار في وافق |
|---|---|
| صرف عادي / رواتب / تحويلات صادرة | قيد يومية يدوي (يُرحّل مباشرة) |
| سداد / مشتريات | فاتورة مشتريات (Bill) — مسودة |
| وارد: دفعات / اشتراكات | فاتورة بيع (Invoice) + ضريبة 15% — مسودة، مع تحديد العميل |

قواعد إضافية:
- عند عدم ذكر حساب الدفع/الاستلام → يُفترض **الحساب البنكي الافتراضي**.
- التواريخ النسبية ("أمس"، "الثلاثاء الماضي") تُحلّل تلقائياً؛ وإلا يُعتمد تاريخ الرسالة.
- عند نقص البيانات → البوت **يسأل** لاستكمالها (حوار متعدد الرسائل) ثم يعالج.
- صور الفواتير تُرفق بالمستند في وافق كمرفقات.

> ملاحظة: القيود اليدوية لا تدعم حالة "مسودة" عبر واجهة وافق (تُرحّل مباشرة)، بينما الفواتير (بيع/مشتريات) تُنشأ كمسودات.

### متغيّرات الإعداد الإضافية (تُضاف من لوحة Cloudflare)
| المتغيّر | الوصف | مثال |
|---|---|---|
| `DEFAULT_BANK_ACCOUNT_CODE` | رمز الحساب البنكي الافتراضي (من شجرة الحسابات المزامنة) | `1020` |
| `VAT_TAX_RATE_ID` | معرّف ضريبة القيمة المضافة 15% في وافق | `tax_...` |
| `VAT_PERCENT` | نسبة الضريبة (اختياري، الافتراضي 15) | `15` |
| `WAFEQ_CURRENCY` | العملة (اختياري، الافتراضي SAR) | `SAR` |

---

## 🏗️ المعمارية (Architecture)

```
تليجرام (نص/صوت/صورة)
        │
        ▼
Cloudflare Worker  ── (Hono.js)
  ├─ R2         : حفظ الصوتيات والفواتير
  ├─ Workers AI : تفريغ الصوت (Whisper) → نص عربي
  ├─ Claude API : تحليل النص/الصورة → قيد مزدوج (JSON)
  ├─ Wafeq API  : إنشاء قيد يومية بحالة DRAFT
  ├─ D1 (SQLite): تخزين العمليات والحسابات والسجلات
  └─ Telegram   : رسالة تأكيد عربية للمستخدم
        │
        ▼ (Cron شهري)
Basecamp API   : تقرير المسودات المعلّقة

Frontend (React + Vite + Tailwind RTL) على Cloudflare Pages
```

---

## 📁 هيكل المشروع

```
.
├── wrangler.toml                 # إعدادات Worker + D1 + R2 + AI + Cron
├── package.json
├── migrations/
│   ├── 0001_init.sql             # الجداول
│   └── 0002_seed_chart_of_accounts.sql
├── src/
│   ├── index.js                  # نقطة الدخول (fetch + scheduled)
│   ├── routes/
│   │   ├── telegram.js           # POST /api/telegram-webhook
│   │   ├── reports.js            # GET  /api/reports/basecamp
│   │   └── dashboard.js          # واجهة برمجية للوحة التحكم
│   ├── services/
│   │   ├── telegram.js  whisper.js  claude.js  wafeq.js  basecamp.js
│   └── lib/
│       ├── db.js                 # مساعدات D1
│       └── processor.js          # خط المعالجة الرئيسي
└── frontend/                     # لوحة التحكم React (RTL)
```

---

## 🚀 خطوات النشر (Deployment)

### 1) المتطلبات
```bash
npm install
npm install -g wrangler
wrangler login
```

### 2) إنشاء الموارد على Cloudflare
```bash
# قاعدة البيانات D1
npm run db:create           # انسخ database_id إلى wrangler.toml

# حاوية التخزين R2
npm run r2:create
```

### 3) تهيئة قاعدة البيانات
```bash
npm run db:migrate          # إنشاء الجداول (remote)
npm run db:seed             # تعبئة شجرة حسابات مبدئية
```

### 4) تخزين الأسرار (Secrets)
```bash
wrangler secret put CLAUDE_API_KEY
wrangler secret put WAFEQ_API_KEY
wrangler secret put BASECAMP_TOKEN
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler secret put AUTHORIZED_CHAT_IDS      # مثال: 123456789,987654321
wrangler secret put DASHBOARD_API_KEY
```
> عدّل أيضاً المتغيرات العامة في `[vars]` داخل `wrangler.toml`
> (`BASECAMP_ACCOUNT_ID`, `BASECAMP_PROJECT_ID`, `BASECAMP_MESSAGE_BOARD_ID`).

### 5) نشر الـ Worker
```bash
npm run deploy
```

### 6) ربط ويبهوك تليجرام
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://naf-accountant.<subdomain>.workers.dev/api/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 7) لوحة التحكم (Frontend)
```bash
cd frontend
npm install
cp .env.example .env         # اضبط VITE_API_BASE على عنوان الـ Worker
npm run build                # المخرجات في frontend/dist
```
انشرها على **Cloudflare Pages** (مجلد النشر: `frontend/dist`).
ثم افتح **الإعدادات** في اللوحة وأدخل `DASHBOARD_API_KEY`.

---

## 🔐 الأمان

- ويبهوك تليجرام يتحقق من ترويسة `X-Telegram-Bot-Api-Secret-Token`.
- تُعالَج الرسائل فقط من **معرّفات المحادثات المصرّح لها** (`AUTHORIZED_CHAT_IDS`).
- كل قيود وافق تُنشأ بحالة **DRAFT** وتتطلب اعتماداً يدوياً.
- المفاتيح الحساسة في **Cloudflare Secrets** فقط — لا شيء في الكود.
- واجهة لوحة التحكم محمية بـ `DASHBOARD_API_KEY`.

---

## 🗄️ الجداول (D1)

| الجدول | الغرض |
|--------|-------|
| `chart_of_accounts` | شجرة الحسابات (رمز، اسم، نوع، معرّف وافق) |
| `transactions` | العمليات (رسالة تليجرام، النص، JSON، معرّف المسودة، الحالة) |
| `logs` | سجل الإجراءات والأخطاء |
| `settings` | إعدادات غير حساسة قابلة للتعديل |

---

## ⏰ التقارير المجدولة

مُهيّأة عبر Cron في `wrangler.toml` (`0 6 1 * *` = أول كل شهر 6ص UTC).
يمكن تشغيل التقرير يدوياً من زر **«إرسال تقرير بيسكامب الآن»** في الإعدادات،
أو عبر `GET /api/reports/basecamp`.

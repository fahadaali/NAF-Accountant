// ============================================================================
// عميل الاتصال بالخلفية (API Client) + المصادقة
// ============================================================================

// عنوان الـ Worker. عدّله أو اضبط VITE_API_BASE عند البناء.
const API_BASE = import.meta.env.VITE_API_BASE || '';

const TOKEN_STORAGE = 'naf_session_token';

export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE) || '';
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_STORAGE, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_STORAGE);
}

/**
 * انتهاء الجلسة يعيد المتصفّح إلى باب المركز.
 *
 * رمز المركز يعيش خمس عشرة دقيقة، فلوحةٌ مفتوحة أطول من ذلك تبلغ هذه
 * الحال في مجرى العمل العادي لا عند خطأ. والوسيط يردّ ٤٠١ ومعه عنوان
 * الباب لأن `fetch` لا يستطيع اتّباع تحويلة إلى أصل آخر بلا ترويسات
 * `CORS` — فالتحويل يقع هنا، والمركز يعيد إصدار رمز بلا تدخّل من
 * المستخدم ما دامت جلسته هناك قائمة.
 *
 * ويعيد `true` إن تولّى الردّ، فيتوقّف النداء عن المتابعة.
 */
function handleUnauthorized(res, data) {
  if (res.status !== 401) return false;
  // رمز نظام الدخول السابق، إن كان لا يزال مخزّناً.
  clearToken();
  if (data && data.login) {
    window.location.href = data.login;
    return true;
  }
  return false;
}

/**
 * الرفض — عضو أُوقف ولوحتُه مفتوحة.
 *
 * لا يأتي عند الدخول بل في أول طلب تالٍ، وهو ما يفعله بالضبط التبليغُ
 * العكسي من شاشة الأعضاء. وله صورتان حسب إصدار `naf-auth`:
 *
 * **٤٠٣ وجسم فيه `denied`** — الصورة الصحيحة، من `v2.0.1` فصاعداً.
 *
 * **تحويلة ٣٠٢ إلى `‎/denied`** — صورة `v2.0.0` المثبَّتة اليوم. وهي
 * تحويلة *داخلية*، فيتبعها `fetch` بنجاح ويستقبل صفحة الواجهة نصّاً:
 * فيصير `res.ok` صادقاً و`res.json()` يسقط، فتقرأ اللوحة كائناً فارغاً
 * وتعرض شاشةً خاوية بلا سبب. ولذلك تُقرأ `redirected` و`url` — وهما
 * الأثر الوحيد الباقي من التحويلة بعد اتّباعها.
 *
 * ويعيد `true` إن تولّى الردّ.
 */
function handleDenied(res, data) {
  if (res.status === 403 && data && data.denied) {
    window.location.href = data.denied;
    return true;
  }
  if (res.redirected) {
    const target = new URL(res.url, window.location.origin);
    if (target.pathname === '/denied') {
      window.location.href = target.pathname + target.search;
      return true;
    }
  }
  return false;
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));

  if (handleUnauthorized(res, data) || handleDenied(res, data)) {
    // التحويل جارٍ — لا تُكمل، ولا تُظهر خطأً لجلسة انتهت أو عضوية أُوقفت.
    return new Promise(() => {});
  }

  if (!res.ok) {
    throw new Error(data.error || `فشل الطلب (${res.status})`);
  }
  return data;
}

/** كما `request` لكن للردود الثنائية: المرفقات والتصدير. */
async function requestBlob(path, failure) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
  });

  if (res.status === 401 || res.status === 403 || res.redirected) {
    const data = await res.clone().json().catch(() => ({}));
    if (handleUnauthorized(res, data) || handleDenied(res, data)) return new Promise(() => {});
  }

  if (!res.ok) throw new Error(failure);
  return res.blob();
}

// ---- المصادقة ----
export const auth = {
  status: () => request('/auth/status'),
  bootstrap: (email, password) =>
    request('/auth/bootstrap', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
};

// ---- لوحة التحكم ----
export const api = {
  stats: () => request('/stats'),
  transactions: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    });
    const s = qs.toString();
    return request(`/transactions${s ? `?${s}` : ''}`);
  },
  deleteTransactions: (ids) =>
    request('/transactions/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  accounts: () => request('/accounts'),
  addAccount: (body) => request('/accounts', { method: 'POST', body: JSON.stringify(body) }),
  syncAccounts: () => request('/accounts/sync', { method: 'POST' }),
  logs: (limit = 100) => request(`/logs?limit=${limit}`),
  settingsStatus: () => request('/settings/status'),
  sendReport: () => request('/reports/basecamp'),
  sendFinancialReport: (period) => request(`/reports/financial?period=${period}`),
  analytics: (months = 6) => request(`/analytics?months=${months}`),

  // ---- المستخدمون ----
  users: () => request('/users'),
  addUser: (body) => request('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (body) => request('/users/update', { method: 'POST', body: JSON.stringify(body) }),

  // ---- أعضاء المنصة تحت الدخول الموحّد ----
  // الجلسة كوكي HttpOnly، فلا رمز يُرسَل في الترويسة.
  me: () => request('/me'),
  members: () => request('/members'),
  updateMember: (body) =>
    request('/members/update', { method: 'POST', body: JSON.stringify(body) }),

  // ---- محادثات تليجرام ----
  chats: () => request('/chats'),
  saveChat: (body) => request('/chats', { method: 'POST', body: JSON.stringify(body) }),
  deleteChat: (chat_id) =>
    request('/chats/delete', { method: 'POST', body: JSON.stringify({ chat_id }) }),

  // ---- العمليات المتكرّرة ----
  recurring: () => request('/recurring'),
  addRecurring: (body) =>
    request('/recurring/from-transaction', { method: 'POST', body: JSON.stringify(body) }),
  updateRecurring: (body) =>
    request('/recurring/update', { method: 'POST', body: JSON.stringify(body) }),
  deleteRecurring: (id) =>
    request('/recurring/delete', { method: 'POST', body: JSON.stringify({ id }) }),
};

/**
 * جلب ملف مرفق (صوت/صورة) من R2 كـ Object URL.
 * نستخدم fetch لأن الوسم <img>/<audio> لا يستطيع إرسال ترويسة المصادقة.
 */
export async function fetchMediaUrl(key) {
  const blob = await requestBlob(
    `/media?key=${encodeURIComponent(key)}`,
    'تعذّر فتح المرفق. أعد المحاولة بعد قليل',
  );
  return { url: URL.createObjectURL(blob), type: blob.type };
}

/** تنزيل تصدير CSV مع المرشّحات الحالية (يمرّر الرمز عبر fetch ثم blob). */
export async function downloadTransactionsCsv(filters = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  const blob = await requestBlob(`/transactions/export?${qs.toString()}`, 'تعذّر التصدير');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `naf-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

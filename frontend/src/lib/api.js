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
  if (res.status === 401) {
    // رمز غير صالح/منتهٍ — أزله.
    clearToken();
  }
  if (!res.ok) {
    throw new Error(data.error || `فشل الطلب (${res.status})`);
  }
  return data;
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
  const res = await fetch(`${API_BASE}/api/media?key=${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('تعذّر تحميل الملف');
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

/** تنزيل تصدير CSV مع المرشّحات الحالية (يمرّر الرمز عبر fetch ثم blob). */
export async function downloadTransactionsCsv(filters = {}) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  const res = await fetch(`${API_BASE}/api/transactions/export?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('تعذّر التصدير');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `naf-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

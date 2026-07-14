// ============================================================================
// عميل الاتصال بالخلفية (API Client)
// ============================================================================

// عنوان الـ Worker. عدّله أو اضبط VITE_API_BASE عند البناء.
const API_BASE = import.meta.env.VITE_API_BASE || '';

const KEY_STORAGE = 'naf_dashboard_key';

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}
export function setApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key);
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `فشل الطلب (${res.status})`);
  }
  return data;
}

export const api = {
  stats: () => request('/stats'),
  transactions: (limit = 50) => request(`/transactions?limit=${limit}`),
  accounts: () => request('/accounts'),
  addAccount: (body) => request('/accounts', { method: 'POST', body: JSON.stringify(body) }),
  syncAccounts: () => request('/accounts/sync', { method: 'POST' }),
  logs: (limit = 100) => request(`/logs?limit=${limit}`),
  settingsStatus: () => request('/settings/status'),
  sendReport: () => request('/reports/basecamp'),
};

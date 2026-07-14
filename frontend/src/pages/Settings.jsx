import { useEffect, useState } from 'react';
import { api, getApiKey, setApiKey } from '../lib/api.js';

const KEY_META = [
  { key: 'TELEGRAM_BOT_TOKEN', label: 'مفتاح بوت تليجرام', hint: 'TELEGRAM_BOT_TOKEN' },
  { key: 'CLAUDE_API_KEY', label: 'مفتاح كلاود (Anthropic)', hint: 'CLAUDE_API_KEY' },
  { key: 'WAFEQ_API_KEY', label: 'مفتاح وافق', hint: 'WAFEQ_API_KEY' },
  { key: 'BASECAMP_TOKEN', label: 'رمز بيسكامب', hint: 'BASECAMP_TOKEN' },
  { key: 'AUTHORIZED_CHAT_IDS', label: 'معرّفات المحادثات المصرّح لها', hint: 'AUTHORIZED_CHAT_IDS' },
];

export default function Settings() {
  const [localKey, setLocalKey] = useState(getApiKey());
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [reporting, setReporting] = useState(false);

  const loadStatus = async () => {
    try {
      const r = await api.settingsStatus();
      setStatus(r.keys);
      setError('');
    } catch (e) {
      setError(e.message);
      setStatus(null);
    }
  };

  useEffect(() => {
    if (getApiKey()) loadStatus();
  }, []);

  const saveKey = () => {
    setApiKey(localKey);
    setMsg('تم حفظ مفتاح لوحة التحكم.');
    loadStatus();
  };

  const runReport = async () => {
    setReporting(true);
    setMsg('');
    try {
      const r = await api.sendReport();
      setMsg(`تم إرسال التقرير إلى بيسكامب (${r.count} مسودة).`);
    } catch (e) {
      setError(e.message);
    } finally {
      setReporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-black text-slate-800">الإعدادات</h2>
        <p className="text-slate-500 mt-1">إدارة الاتصال ومفاتيح الربط</p>
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>}
      {msg && <div className="card border-green-200 bg-green-50 text-green-700">{msg}</div>}

      {/* مفتاح لوحة التحكم */}
      <div className="card">
        <h3 className="font-bold text-slate-800 mb-1">مفتاح لوحة التحكم</h3>
        <p className="text-slate-500 text-sm mb-4">
          يُستخدم للمصادقة مع الخلفية (DASHBOARD_API_KEY). يُحفظ محلياً في متصفحك فقط.
        </p>
        <div className="flex gap-3">
          <input
            type="password"
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            placeholder="أدخل مفتاح لوحة التحكم"
            value={localKey}
            onChange={(e) => setLocalKey(e.target.value)}
            dir="ltr"
          />
          <button className="btn-primary" onClick={saveKey}>حفظ</button>
        </div>
      </div>

      {/* حالة مفاتيح الربط */}
      <div className="card">
        <h3 className="font-bold text-slate-800 mb-1">حالة مفاتيح الربط</h3>
        <p className="text-slate-500 text-sm mb-4">
          المفاتيح الحساسة تُخزَّن بشكل مشفّر في Cloudflare Secrets ولا تظهر قيمها هنا — فقط حالة توفرها.
          لتحديثها استخدم الأمر: <code className="bg-slate-100 px-2 py-0.5 rounded" dir="ltr">wrangler secret put &lt;NAME&gt;</code>
        </p>
        <div className="space-y-2">
          {KEY_META.map((k) => {
            const ok = status?.[k.key];
            return (
              <div key={k.key} className="flex items-center justify-between py-2 border-b border-slate-50">
                <div>
                  <div className="font-semibold text-slate-700">{k.label}</div>
                  <code className="text-xs text-slate-400" dir="ltr">{k.hint}</code>
                </div>
                {status == null ? (
                  <span className="badge bg-slate-100 text-slate-500">غير معروف</span>
                ) : ok ? (
                  <span className="badge bg-green-100 text-green-700">✓ مضبوط</span>
                ) : (
                  <span className="badge bg-red-100 text-red-700">✗ غير مضبوط</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* إجراءات */}
      <div className="card">
        <h3 className="font-bold text-slate-800 mb-4">إجراءات</h3>
        <button className="btn-primary" onClick={runReport} disabled={reporting}>
          {reporting ? '⏳ جارٍ الإرسال…' : '📤 إرسال تقرير بيسكامب الآن'}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const KEY_META = [
  { key: 'TELEGRAM_BOT_TOKEN', label: 'مفتاح بوت تليجرام', hint: 'TELEGRAM_BOT_TOKEN' },
  { key: 'CLAUDE_API_KEY', label: 'مفتاح كلاود (Anthropic)', hint: 'CLAUDE_API_KEY' },
  { key: 'WAFEQ_API_KEY', label: 'مفتاح وافق', hint: 'WAFEQ_API_KEY' },
  { key: 'AUTHORIZED_CHAT_IDS', label: 'معرّفات المحادثات المصرّح لها', hint: 'AUTHORIZED_CHAT_IDS' },
  { key: 'DEFAULT_BANK_ACCOUNT_CODE', label: 'رمز الحساب البنكي الافتراضي', hint: 'DEFAULT_BANK_ACCOUNT_CODE' },
  { key: 'VAT_TAX_RATE_ID', label: 'معرّف ضريبة القيمة المضافة', hint: 'VAT_TAX_RATE_ID' },
  { key: 'BASECAMP_CLIENT_ID', label: 'بيسكامب — Client ID', hint: 'BASECAMP_CLIENT_ID' },
  { key: 'BASECAMP_CLIENT_SECRET', label: 'بيسكامب — Client Secret', hint: 'BASECAMP_CLIENT_SECRET' },
  { key: 'BASECAMP_REFRESH_TOKEN', label: 'بيسكامب — Refresh Token', hint: 'BASECAMP_REFRESH_TOKEN' },
  { key: 'BASECAMP_ACCOUNT_ID', label: 'بيسكامب — Account ID', hint: 'BASECAMP_ACCOUNT_ID' },
  { key: 'BASECAMP_PROJECT_ID', label: 'بيسكامب — Project ID', hint: 'BASECAMP_PROJECT_ID' },
  { key: 'BASECAMP_MESSAGE_BOARD_ID', label: 'بيسكامب — Message Board ID', hint: 'BASECAMP_MESSAGE_BOARD_ID' },
  { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs (تفريغ صوتي عالي الدقة)', hint: 'ELEVENLABS_API_KEY' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI (تفريغ صوتي بديل)', hint: 'OPENAI_API_KEY' },
];

const ASR_LABELS = {
  elevenlabs: { name: 'ElevenLabs Scribe', note: 'أعلى دقة للعربية ✅', cls: 'bg-green-100 text-green-700' },
  openai: { name: 'OpenAI', note: 'دقة عالية ✅', cls: 'bg-green-100 text-green-700' },
  cloudflare: { name: 'Cloudflare Whisper', note: 'دقة محدودة للعربية — أضِف مفتاح ElevenLabs لرفعها', cls: 'bg-amber-100 text-amber-700' },
};

export default function Settings({ user, onLogout }) {
  const [status, setStatus] = useState(null);
  const [asr, setAsr] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [reporting, setReporting] = useState(false);

  const loadStatus = async () => {
    try {
      const r = await api.settingsStatus();
      setStatus(r.keys);
      setAsr(r.asrProvider || null);
      setError('');
    } catch (e) {
      setError(e.message);
      setStatus(null);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

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

  const runFinancial = async (period) => {
    setReporting(true);
    setMsg('');
    setError('');
    try {
      const r = await api.sendFinancialReport(period);
      setMsg(`تم إرسال التقرير المالي إلى بيسكامب — ${r.label}.`);
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

      {/* الحساب */}
      <div className="card">
        <h3 className="font-bold text-slate-800 mb-1">الحساب</h3>
        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="font-semibold text-slate-700" dir="ltr">{user?.email}</div>
            <div className="text-xs text-slate-400">
              الصلاحية: {user?.role === 'admin' ? 'مسؤول' : 'مستخدم'}
            </div>
          </div>
          <button className="btn-ghost" onClick={onLogout}>🚪 تسجيل الخروج</button>
        </div>
      </div>

      {/* مزوّد تحويل الصوت */}
      {asr && (
        <div className="card">
          <h3 className="font-bold text-slate-800 mb-1">تحويل الصوت إلى نص</h3>
          <div className="flex items-center justify-between mt-3">
            <div>
              <div className="font-semibold text-slate-700">
                {ASR_LABELS[asr]?.name || asr}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{ASR_LABELS[asr]?.note || ''}</div>
            </div>
            <span className={`badge ${ASR_LABELS[asr]?.cls || 'bg-slate-100 text-slate-600'}`}>
              نشط
            </span>
          </div>
          {asr === 'cloudflare' && (
            <p className="text-xs text-slate-500 mt-3 leading-relaxed">
              لرفع الدقة لأعلى مستوى: أضِف <code className="bg-slate-100 px-1 rounded" dir="ltr">ELEVENLABS_API_KEY</code> كـ
              Secret في Cloudflare، وسينتقل النظام إليه تلقائياً.
            </p>
          )}
        </div>
      )}

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
        <h3 className="font-bold text-slate-800 mb-1">إجراءات</h3>
        <p className="text-slate-500 text-sm mb-4">إرسال التقارير يدوياً إلى بيسكامب.</p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-ghost" onClick={runReport} disabled={reporting}>
            {reporting ? '⏳…' : '📤 ملخص المسودات'}
          </button>
          <button className="btn-primary" onClick={() => runFinancial('monthly')} disabled={reporting}>
            {reporting ? '⏳…' : '📊 التقرير المالي الشهري'}
          </button>
          <button className="btn-ghost" onClick={() => runFinancial('quarterly')} disabled={reporting}>
            📊 الربعي
          </button>
          <button className="btn-ghost" onClick={() => runFinancial('annual')} disabled={reporting}>
            📊 السنوي
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          آلياً: الشهري أول كل شهر، الربعي أول كل ربع، السنوي أول السنة.
        </p>
      </div>
    </div>
  );
}

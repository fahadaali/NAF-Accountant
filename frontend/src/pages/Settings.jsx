import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { getThemeMode, setThemeMode } from '../lib/theme.js';
import { LogOut, LoaderCircle, CircleCheck, CircleSlash, Send, ChartColumn, CircleAlert, CircleHelp } from 'lucide-react';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Badge } from '../naf/ui/badge.jsx';

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
  elevenlabs: { name: 'ElevenLabs Scribe', note: 'أعلى دقة للعربية', variant: 'success' },
  openai: { name: 'OpenAI', note: 'دقة عالية', variant: 'success' },
  cloudflare: { name: 'Cloudflare Whisper', note: 'دقة محدودة للعربية — أضِف مفتاح ElevenLabs لرفعها', variant: 'warning' },
};

// المصطلحات من naf-terms.md §٩ (المظهر والاتجاه).
const THEME_OPTIONS = [
  { v: 'light', label: 'الوضع الفاتح' },
  { v: 'dark', label: 'الوضع الداكن' },
  { v: 'system', label: 'حسب النظام' },
];

export default function Settings({ user, onLogout }) {
  const [status, setStatus] = useState(null);
  const [asr, setAsr] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [reporting, setReporting] = useState(false);
  const [theme, setTheme] = useState(getThemeMode);

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
        <h2 className="text-2xl font-bold text-foreground">الإعدادات</h2>
        <p className="text-muted-foreground mt-1">إدارة الاتصال ومفاتيح الربط</p>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      {/* الحساب */}
      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">الحساب</h3>
        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="font-semibold text-foreground" dir="ltr">{user?.email}</div>
            <div className="text-xs text-muted-foreground">
              الصلاحية: {user?.role === 'admin' ? 'مسؤول' : 'مستخدم'}
            </div>
          </div>
          <Button variant="ghost" onClick={onLogout}><LogOut size={20} className="rtl:-scale-x-100" /> تسجيل الخروج</Button>
        </div>
      </Card>

      {/* المظهر */}
      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">المظهر</h3>
        <p className="text-muted-foreground text-sm mb-4">
          «حسب النظام» يتبع إعداد جهازك ويتغيّر معه.
        </p>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map((o) => (
            <Button
              key={o.v}
              variant={theme === o.v ? 'default' : 'outline'}
              aria-pressed={theme === o.v}
              onClick={() => {
                setThemeMode(o.v);
                setTheme(o.v);
              }}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* مزوّد تحويل الصوت */}
      {asr && (
        <Card className="p-6">
          <h3 className="font-bold text-foreground mb-1">تحويل الصوت إلى نص</h3>
          <div className="flex items-center justify-between mt-3">
            <div>
              <div className="font-semibold text-foreground">
                {ASR_LABELS[asr]?.name || asr}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{ASR_LABELS[asr]?.note || ''}</div>
            </div>
            <Badge variant={ASR_LABELS[asr]?.variant || 'default'}>
              <CircleCheck size={16} aria-hidden="true" /> نشط
            </Badge>
          </div>
          {asr === 'cloudflare' && (
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
              لرفع الدقة لأعلى مستوى: أضِف <code className="bg-muted px-1 rounded-sm" dir="ltr">ELEVENLABS_API_KEY</code> كـ
              Secret في Cloudflare، وسينتقل النظام إليه تلقائياً.
            </p>
          )}
        </Card>
      )}

      {/* حالة مفاتيح الربط */}
      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">حالة مفاتيح الربط</h3>
        <p className="text-muted-foreground text-sm mb-4">
          المفاتيح الحساسة تُخزَّن بشكل مشفّر في Cloudflare Secrets ولا تظهر قيمها هنا — فقط حالة توفرها.
          لتحديثها استخدم الأمر: <code className="bg-muted px-2 py-1 rounded-sm" dir="ltr">wrangler secret put &lt;NAME&gt;</code>
        </p>
        <div className="space-y-2">
          {KEY_META.map((k) => {
            const ok = status?.[k.key];
            return (
              <div key={k.key} className="flex items-center justify-between py-2 border-b border-border">
                <div>
                  <div className="font-semibold text-foreground">{k.label}</div>
                  <code className="text-xs text-muted-foreground" dir="ltr">{k.hint}</code>
                </div>
                {status == null ? (
                  <Badge><CircleHelp size={16} aria-hidden="true" /> غير معروف</Badge>
                ) : ok ? (
                  <Badge variant="success"><CircleCheck size={16} aria-hidden="true" /> مُهيّأ</Badge>
                ) : (
                  <Badge variant="destructive"><CircleSlash size={16} aria-hidden="true" /> غير مُهيّأ</Badge>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* إجراءات */}
      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">إجراءات</h3>
        <p className="text-muted-foreground text-sm mb-4">إرسال التقارير يدوياً إلى بيسكامب.</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" onClick={runReport} disabled={reporting}>
            {reporting
              ? <><LoaderCircle size={20} className="animate-spin" aria-hidden="true" /> جارٍ الإرسال</>
              : <><Send size={20} className="rtl:-scale-x-100" aria-hidden="true" /> ملخص المسودات</>}
          </Button>
          <Button onClick={() => runFinancial('monthly')} disabled={reporting}>
            {reporting
              ? <><LoaderCircle size={20} className="animate-spin" aria-hidden="true" /> جارٍ الإرسال</>
              : <><ChartColumn size={20} aria-hidden="true" /> التقرير المالي الشهري</>}
          </Button>
          <Button variant="ghost" onClick={() => runFinancial('quarterly')} disabled={reporting}>
            <ChartColumn size={20} aria-hidden="true" /> الربعي
          </Button>
          <Button variant="ghost" onClick={() => runFinancial('annual')} disabled={reporting}>
            <ChartColumn size={20} aria-hidden="true" /> السنوي
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          آلياً: الشهري أول كل شهر، الربعي أول كل ربع، السنوي أول السنة.
        </p>
      </Card>
    </div>
  );
}

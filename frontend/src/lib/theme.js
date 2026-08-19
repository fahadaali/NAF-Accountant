// ============================================================================
// المظهر — فاتح / داكن / حسب النظام
// ============================================================================
//
// ثيم ناف يعرّف لوحة داكنة كاملة خلف الصنف `dark` (‏naf-theme.css)، ولم يكن
// في المنصة ما يضيف هذا الصنف: لا مبدّل ولا قراءة لتفضيل النظام. فالوضع
// الداكن كان كوداً ميتاً لا يبلغه المستخدم بأي وسيلة.
//
// الصنف يُضاف على <html>. والتطبيق الأولي يقع في سطر داخل index.html قبل
// الرسم الأول، فلا تومض الصفحة بيضاء ثم تسودّ.
// ============================================================================

export const THEME_KEY = 'naf_theme'; // 'light' | 'dark' | 'system'

const media = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** الوضع المختار (الافتراضي: حسب النظام). */
export function getThemeMode() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch (_) {
    return 'system';
  }
}

/** هل النتيجة داكنة فعلاً بعد حلّ «حسب النظام»؟ */
export function isDark(mode = getThemeMode()) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return !!media()?.matches;
}

/** تطبيق الوضع على المستند. */
export function applyTheme(mode = getThemeMode()) {
  document.documentElement.classList.toggle('dark', isDark(mode));
}

/** حفظ الوضع وتطبيقه. */
export function setThemeMode(mode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch (_) {
    /* التخزين محجوب — يبقى الاختيار لهذه الجلسة */
  }
  applyTheme(mode);
}

/**
 * متابعة تغيّر تفضيل النظام ما دام الوضع «حسب النظام».
 * @returns {() => void} دالة إلغاء المتابعة.
 */
export function watchSystemTheme() {
  const m = media();
  if (!m) return () => {};
  const onChange = () => {
    if (getThemeMode() === 'system') applyTheme('system');
  };
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

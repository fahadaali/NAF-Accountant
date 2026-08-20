import { useEffect, useState } from 'react';
import { fetchMediaUrl } from '../lib/api.js';
import { Mic, Image } from 'lucide-react';
import { Button } from '../naf/ui/button.jsx';

/**
 * عرض مرفق العملية (تسجيل صوتي أو صورة فاتورة) المخزّن في R2.
 * يُحمّل عند الطلب فقط (بالضغط) لتوفير النطاق.
 */
export default function MediaViewer({ mediaKey }) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isAudio = /^voice\//.test(mediaKey || '');

  /*
   * ═══ العنوان كان يُبطَل في اللحظة التي يُضبط فيها ═══
   *
   * كانت `media` في قائمة التبعيات، و`setMedia` تغيّرها — فيُعاد تشغيل
   * الأثر، ويجري تنظيفُ سابقه، فيُبطل العنوانَ الذي ضُبط توّاً. ثم يمنع
   * الحارس `if (media) return` أيَّ جلبٍ ثانٍ، فيبقى الوسم على عنوانٍ
   * مُبطَل.
   *
   * ويمرّ ذلك في كروم بالمصادفة: الوسمُ يبدأ التحميل قبل أن يجري
   * التنظيف، فيمسك البايتات. وWebKit يحمّل الوسائط متأخّراً فيجد العنوان
   * ذاهباً — فلا تُسمع نغمةٌ ولا تظهر فاتورة على آيفون، ولا خطأ يقول لِمَ.
   *
   * فالتبعيات الآن ما يقرّر الجلب فعلاً — الفتح والمفتاح — والعنوان يعيش
   * ما دام مفتوحاً ويُبطَل عند الإغلاق. والإغلاق يمسح `media` معه، فلا
   * يُعاد استعمال عنوانٍ مُبطَل عند الفتح الثاني.
   */
  useEffect(() => {
    if (!open) return undefined;

    let url = null;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const m = await fetchMediaUrl(mediaKey);
        if (cancelled) {
          // أُغلق قبل وصول البايتات — لا يُترك عنوانٌ بلا مالك.
          URL.revokeObjectURL(m.url);
          return;
        }
        url = m.url;
        setMedia(m);
        setError('');
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setMedia(null);
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, mediaKey]);

  if (!mediaKey) return <span className="text-muted-foreground/60">—</span>;

  return (
    <div>
      <Button
        variant="link" size="sm" className="px-0"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          'إخفاء'
        ) : isAudio ? (
          <><Mic size={16} aria-hidden="true" /> استماع</>
        ) : (
          <><Image size={16} aria-hidden="true" /> عرض</>
        )}
      </Button>
      {open && (
        <div className="mt-2">
          {loading && <span className="text-muted-foreground text-xs">جارٍ التحميل…</span>}
          {error && <span className="text-destructive text-xs">{error}</span>}
          {media && isAudio && <audio controls src={media.url} className="w-full max-w-xs" />}
          {media && !isAudio && (
            <a href={media.url} target="_blank" rel="noreferrer">
              <img
                src={media.url}
                alt="مرفق"
                className="max-w-xs rounded-lg border border-border"
              />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

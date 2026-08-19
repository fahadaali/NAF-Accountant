import { useEffect, useRef, useState } from 'react';
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

  // الرابط في مرجع لا في حالة: كان `media` ضمن اعتماديات التأثير، فيُعيد
  // setMedia تشغيله، فيُشغّل React تنظيف الجولة السابقة، فيُبطَل رابط blob
  // فور إنشائه — والصورة تنجو بسباق أحياناً، أما «فتح المرفق» فلا يعمل أبداً.
  // الآن: يُنشأ مرة، ويُبطَل عند تفكيك المكوّن أو تغيّر الملف وحده.
  const urlRef = useRef(null);

  useEffect(() => {
    // `media` يُقرأ من إغلاق هذه الجولة ولا يدخل الاعتماديات عمداً: دخوله
    // هو ما كان يُعيد تشغيل التأثير فيُبطل الرابط.
    if (!open || media) return undefined;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const m = await fetchMediaUrl(mediaKey);
        if (!alive) {
          URL.revokeObjectURL(m.url); // أُغلق العرض أو تغيّر الملف أثناء الجلب
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = m.url;
        setMedia(m);
        setError('');
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, mediaKey]);

  // تحرير الرابط عند تغيّر الملف أو تفكيك المكوّن — لا عند كل عرض.
  useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setMedia(null);
    },
    [mediaKey]
  );

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

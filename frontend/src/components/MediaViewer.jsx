import { useEffect, useRef, useState } from 'react';
import { fetchMediaUrl } from '../lib/api.js';
import { Mic, Image, FileType } from 'lucide-react';
import { Button } from '../naf/ui/button.jsx';

/**
 * عرض مرفق العملية (تسجيل صوتي، أو صورة فاتورة، أو ملف PDF) المخزّن في R2.
 * يُحمّل عند الطلب فقط (بالضغط) لتوفير النطاق.
 *
 * لا أيقونة مسجَّلة لملف PDF في Lucide، فالمعتمد `FileType` مع اسم الصيغة
 * نصّاً بجانبها — naf-icons.md § الوسائط وأنواع الملفات.
 */
export default function MediaViewer({ mediaKey }) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isAudio = /^voice\//.test(mediaKey || '');
  const isPdf = /\.pdf$/i.test(mediaKey || '');

  /* ═══ رابط blob في مرجع لا في اعتماديات التأثير ═══

     كان `media` ضمن الاعتماديات، و`setMedia` يغيّره — فيُعيد React تشغيل
     التأثير، فيُشغّل تنظيف الجولة السابقة، و`revoked` صار وقتها هو الرابط
     نفسه. أي أن الرابط يُبطَل بعد إنشائه بلحظة.

     والصورة تنجو بسباق أحياناً (المتصفّح يبدأ تحميلها في الـcommit قبل
     تشغيل التأثيرات الخاملة)، أمّا رابط «فتح في تبويب» فيُنقر بعد الإبطال
     بثوانٍ فلا يفتح شيئاً — وكذلك إعادة طلب المقطع الصوتي أو التنقّل فيه.

     الآن: يُنشأ مرة، ويُبطَل عند تفكيك المكوّن أو تغيّر الملف وحده. */
  const urlRef = useRef(null);

  useEffect(() => {
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
        ) : isPdf ? (
          <><FileType size={16} aria-hidden="true" /> <bdi>عرض PDF</bdi></>
        ) : (
          <><Image size={16} aria-hidden="true" /> عرض</>
        )}
      </Button>
      {open && (
        <div className="mt-2">
          {loading && <span className="text-muted-foreground text-xs">جارٍ التحميل…</span>}
          {error && <span className="text-destructive text-xs">{error}</span>}
          {media && isAudio && <audio controls src={media.url} className="w-full max-w-xs" />}
          {media && isPdf && (
            <div className="space-y-2">
              {/* عارض PDF المدمج في المتصفح — قد لا يتوفّر على الجوال، فيبقى الرابط بديلاً */}
              <iframe
                src={media.url}
                title="مرفق"
                className="w-full max-w-md h-96 rounded-lg border border-border bg-card"
              />
              <Button asChild variant="link" size="sm" className="px-0">
                <a href={media.url} download={mediaKey.split('/').pop()}>تنزيل</a>
              </Button>
            </div>
          )}
          {media && !isAudio && !isPdf && (
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

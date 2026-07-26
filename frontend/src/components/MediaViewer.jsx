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

  useEffect(() => {
    if (!open || media) return;
    let revoked = null;
    (async () => {
      setLoading(true);
      try {
        const m = await fetchMediaUrl(mediaKey);
        revoked = m.url;
        setMedia(m);
        setError('');
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [open, mediaKey, media]);

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

import { useEffect, useState } from 'react';
import { fetchMediaUrl } from '../lib/api.js';

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

  if (!mediaKey) return <span className="text-slate-300">—</span>;

  return (
    <div>
      <button className="text-naf-600 text-sm hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'إخفاء' : isAudio ? '🎙️ استماع' : '🖼️ عرض'}
      </button>
      {open && (
        <div className="mt-2">
          {loading && <span className="text-slate-400 text-xs">جارٍ التحميل…</span>}
          {error && <span className="text-red-500 text-xs">{error}</span>}
          {media && isAudio && <audio controls src={media.url} className="max-w-[240px]" />}
          {media && !isAudio && (
            <a href={media.url} target="_blank" rel="noreferrer">
              <img
                src={media.url}
                alt="مرفق"
                className="max-w-[220px] rounded-lg border border-slate-200"
              />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

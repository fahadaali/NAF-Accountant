const MAP = {
  received: { label: 'مستلمة', cls: 'bg-slate-100 text-slate-600' },
  transcribed: { label: 'مُفرّغة', cls: 'bg-sky-100 text-sky-700' },
  analyzed: { label: 'مُحلّلة', cls: 'bg-amber-100 text-amber-700' },
  posted: { label: 'مُرحّلة (مسودة)', cls: 'bg-green-100 text-green-700' },
  failed: { label: 'فشلت', cls: 'bg-red-100 text-red-700' },
};

export default function StatusBadge({ status }) {
  const s = MAP[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

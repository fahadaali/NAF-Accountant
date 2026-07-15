// ============================================================================
// حلّال جهات الاتصال (Contact Resolver)
// يبحث في وافق، يطابق ذكياً عبر Claude (يتعامل مع الأسماء الجزئية)،
// وعند عدم اليقين يطلب من المستخدم الاختيار.
// ============================================================================

import { searchContacts, createContact } from './wafeq.js';
import { matchContactWithClaude } from './claude.js';

// كلمات عامة لا تصلح وحدها للبحث.
const STOP = new Set(['شركة', 'مؤسسة', 'مكتب', 'مكتبة', 'مجموعة', 'شركه', 'مؤسسه', 'ال', 'و']);

/**
 * حلّ اسم جهة اتصال إلى معرّف وافق.
 * @returns {Promise<
 *   { status:'matched', contactId, contactName } |
 *   { status:'new', contactId } |
 *   { status:'ambiguous', candidates: Array<{id,name}> }
 * >}
 */
export async function resolveContact(env, name) {
  const clean = (name || '').trim();
  if (!clean) return { status: 'new', contactId: null };

  // اجمع مرشّحين: بالاسم الكامل + بأطول كلمة مميّزة (لتوسيع البحث).
  const seen = new Map();
  const queries = [clean];
  const tokens = clean
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .sort((a, b) => b.length - a.length);
  if (tokens[0] && tokens[0] !== clean) queries.push(tokens[0]);

  for (const q of queries) {
    const list = await searchContacts(env, q);
    for (const c of list) if (!seen.has(c.id)) seen.set(c.id, c);
  }
  const candidates = [...seen.values()].slice(0, 40);

  // لا مرشّحين → جديد.
  if (candidates.length === 0) {
    const id = await createContact(env, clean);
    return { status: 'new', contactId: id };
  }

  // مطابقة ذكية عبر Claude.
  const decision = await matchContactWithClaude(env, clean, candidates);

  if (decision.decision === 'match' && decision.index >= 1 && candidates[decision.index - 1]) {
    const c = candidates[decision.index - 1];
    return { status: 'matched', contactId: c.id, contactName: c.name };
  }

  if (decision.decision === 'ambiguous') {
    const amb = (decision.candidates || [])
      .map((i) => candidates[i - 1])
      .filter(Boolean);
    if (amb.length > 1) return { status: 'ambiguous', candidates: amb };
    if (amb.length === 1) {
      return { status: 'matched', contactId: amb[0].id, contactName: amb[0].name };
    }
  }

  // جديد.
  const id = await createContact(env, clean);
  return { status: 'new', contactId: id };
}

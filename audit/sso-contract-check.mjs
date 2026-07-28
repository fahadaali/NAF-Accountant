// فحص عقد: يشغّل إعداد NAF-Accountant الحقيقي مقابل محاكاة للمركز مكتوبة
// من functions/api/token.js و functions/go/[id].js و functions/api/internal/access.js
// حرفياً — بمنطق التحقق نفسه، لا بما نتوقّعه منه.

import assert from 'node:assert/strict';
import { authConfig } from '../src/auth/config.js';
import { authenticate } from 'naf-auth';
import { handleCallback, reportAccessChange } from 'naf-auth';

const ISSUER = 'https://naf-id.pages.dev';
const PLATFORM = 'NAF-Accountant';
const SECRET = 'the-platform-secret';
const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

const b64 = (b) => Buffer.from(b).toString('base64url');
const enc = (v) => b64(new TextEncoder().encode(JSON.stringify(v)));

const pair = await crypto.subtle.generateKey(
  { ...ALGO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'],
);
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
const JWK = { kty: pub.kty, n: pub.n, e: pub.e, alg: 'RS256', kid: 'cur' };

// === محاكاة المركز ===
const centerKV = new Map();          // code -> record
const accessRows = [];               // ما يكتبه /api/internal/access
const failures = [];

async function signToken(claims) {
  const input = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'cur' })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign(ALGO, pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64(new Uint8Array(sig))}`;
}

// functions/go/[id].js — يتجاهل أي state يصله ويولّد واحدة من عنده
function centerGo(url) {
  const u = new URL(url);
  const next = u.searchParams.get('next') || '/';
  const code = 'CODE-' + Math.random().toString(16).slice(2);
  const state = 'STATE-' + Math.random().toString(16).slice(2);
  centerKV.set(`code:${code}`, { userId: 'user-1', platformId: PLATFORM, state, next });
  return { code, state, next };
}

// functions/api/token.js — منطق التحقق كما هو مكتوب هناك
async function centerToken(body) {
  const { platformId, secret, code, state } = body ?? {};
  if (typeof platformId !== 'string' || typeof secret !== 'string'
      || typeof code !== 'string' || typeof state !== 'string') {
    failures.push('invalid_body');
    return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 });
  }
  if (platformId !== PLATFORM || secret !== SECRET) {
    failures.push('invalid_client');
    return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
  }
  const raw = centerKV.get(`code:${code}`);
  centerKV.delete(`code:${code}`);                      // يُستهلك مرة واحدة
  if (!raw) { failures.push('invalid_code'); return new Response('{}', { status: 400 }); }
  if (raw.platformId !== platformId) { failures.push('invalid_code'); return new Response('{}', { status: 400 }); }
  if (raw.state !== state) { failures.push('invalid_state'); return new Response('{}', { status: 400 }); }

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({
    sub: 'user-1', name: 'فهد', email: 'f@naflaw.sa',
    iss: ISSUER, aud: PLATFORM, iat: now, exp: now + 900,
  });
  return Response.json({ token, tokenType: 'Bearer', expiresIn: 900, next: raw.next ?? '/' });
}

// functions/api/internal/access.js
function centerAccess(body) {
  const { platformId, secret } = body ?? {};
  if (typeof platformId !== 'string' || typeof secret !== 'string') {
    failures.push('access:invalid_body'); return new Response('{}', { status: 400 });
  }
  if (platformId !== PLATFORM || secret !== SECRET) {
    failures.push('access:invalid_client'); return new Response('{}', { status: 401 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) { failures.push('access:invalid_body'); return new Response('{}', { status: 400 }); }
  if (!['granted', 'revoked'].includes(body.state)) {
    failures.push('access:invalid_state'); return new Response('{}', { status: 400 });
  }
  accessRows.push({ email, state: body.state, reason: body.reason ?? null });
  return Response.json({ ok: true });
}

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  if (href.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [JWK] });
  if (href.endsWith('/api/token')) return centerToken(body);
  if (href.endsWith('/api/internal/access')) return centerAccess(body);
  return new Response('nf', { status: 404 });
};

// === بيئة المنصة ===
const kvStore = new Map();
const kv = {
  async get(k, t) { const v = kvStore.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); },
  async put(k, v, o) { kvStore.set(k, v); kvStore.set(`__ttl:${k}`, o?.expirationTtl); },
  async delete(k) { kvStore.delete(k); },
};
const memberRow = { id: 'user-1', role: 'admin', is_active: 1, perms: null };
const DB = { prepare() { return { bind() { return this; }, async first() { return memberRow; }, async run() { return {}; } }; } };
const env = {
  AUTH_ISSUER: ISSUER, PLATFORM_ID: PLATFORM, AUTH_CLIENT_SECRET: SECRET,
  AUTH_KV: kv, DB,
};
const config = authConfig(env);

const R = (p, cookie) => new Request(`https://naf-accountant.naflaw-sa.workers.dev${p}`,
  cookie ? { headers: { cookie } } : undefined);

let pass = 0;
const ok = (label) => { console.log(`  [ok] ${label}`); pass++; };

// -- ١: زائر بلا جلسة على الجذر يُردّ إلى المركز --
{
  const { response, user } = await authenticate(R('/'), env, config);
  assert.equal(user, undefined);
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), new RegExp(`^${ISSUER}/go/${PLATFORM}`));
  ok('الجذر محمي — زائر بلا جلسة يُردّ إلى المركز');
}

// -- ٢: المعرّف يمرّ بحالة أحرفه --
{
  const { response } = await authenticate(R('/transactions'), env, config);
  const loc = response.headers.get('location');
  assert.ok(loc.includes('/go/NAF-Accountant'), loc);
  assert.ok(!loc.includes('naf-accountant'), 'لا يُطبَّع إلى حروف صغيرة');
  ok('معرّف المنصة يمرّ بحالة أحرفه');
}

// -- ٣: التدفّق الكامل عبر المركز --
let sessionCookie;
{
  const { response } = await authenticate(R('/transactions?status=pending'), env, config);
  const goUrl = response.headers.get('location');
  const { code, state } = centerGo(goUrl);            // المركز يولّد الاثنين

  const cb = await handleCallback(R(`/auth/callback?code=${code}&state=${state}`), env, config);
  assert.equal(failures.length, 0, `المركز رفض: ${failures.join()}`);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/transactions?status=pending');

  sessionCookie = cb.headers.get('set-cookie').split(';')[0];
  assert.match(sessionCookie, /^naf_sid=/);
  ok('التدفّق الكامل يمرّ ويعود إلى الوجهة المطلوبة');
}

// -- ٤: عمر الجلسة لا يتجاوز عمر الرمز --
{
  const sid = [...kvStore.keys()].find((k) => k.startsWith('sess:'));
  const ttl = kvStore.get(`__ttl:${sid}`);
  assert.ok(ttl <= 900 && ttl > 800, `ttl=${ttl}`);
  ok(`عمر الجلسة ${ttl}s — لا يتجاوز عمر الرمز`);
}

// -- ٥: الجلسة تعمل على مسار محمي --
{
  const { user, response } = await authenticate(R('/api/stats', sessionCookie), env, config);
  assert.equal(response, undefined);
  assert.equal(user.id, 'user-1');
  ok('الجلسة تفتح المسارات المحمية');
}

// -- ٦: رمز العبور لا يُستهلك مرتين --
{
  const { response } = await authenticate(R('/'), env, config);
  const { code, state } = centerGo(response.headers.get('location'));
  await handleCallback(R(`/auth/callback?code=${code}&state=${state}`), env, config);
  failures.length = 0;
  const replay = await handleCallback(R(`/auth/callback?code=${code}&state=${state}`), env, config);
  assert.equal(replay.headers.get('location'), '/denied?r=auth_failed');
  assert.deepEqual(failures, ['invalid_code']);
  ok('إعادة استعمال رمز العبور تفشل عند المركز');
}

// -- ٧: حالة غير حالة المركز تُرفض --
{
  failures.length = 0;
  const { response } = await authenticate(R('/'), env, config);
  const { code } = centerGo(response.headers.get('location'));
  const cb = await handleCallback(R(`/auth/callback?code=${code}&state=WRONG`), env, config);
  assert.equal(cb.headers.get('location'), '/denied?r=auth_failed');
  assert.deepEqual(failures, ['invalid_state']);
  ok('حالة لا تطابق ما خزّنه المركز تُرفض');
}

// -- ٨: طلب واجهة برمجية بلا جلسة يردّ ٤٠١ ومعه الباب --
{
  const { response } = await authenticate(R('/api/transactions'), env, config);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.match(body.login, new RegExp(`^${ISSUER}/go/${PLATFORM}`));
  ok('‎/api يردّ ٤٠١ ومعه عنوان الباب لا تحويلة');
}

// -- ٩: رمز منتهٍ يُبطل الجلسة رغم أن العضو نشط --
{
  const now = Math.floor(Date.now() / 1000);
  const stale = await signToken({ sub: 'user-1', iss: ISSUER, aud: PLATFORM, iat: now - 1200, exp: now - 600 });
  kvStore.set('sess:stale', JSON.stringify({ sub: 'user-1', token: stale, exp: now - 600 }));
  const { user, response } = await authenticate(R('/api/stats', 'naf_sid=stale'), env, config);
  assert.equal(user, undefined, 'رمز منتهٍ لا يمرّ');
  assert.equal(response.status, 401);
  assert.equal(kvStore.has('sess:stale'), false, 'الجلسة تُمسح');
  ok('رمز منتهٍ يُبطل الجلسة في كل طلب محمي');
}

// -- ١٠: رمز منصة أخرى يُرفض --
{
  const now = Math.floor(Date.now() / 1000);
  const other = await signToken({ sub: 'user-1', iss: ISSUER, aud: 'NAF-Forms', iat: now, exp: now + 900 });
  kvStore.set('sess:other', JSON.stringify({ sub: 'user-1', token: other, exp: now + 900 }));
  const { user } = await authenticate(R('/api/stats', 'naf_sid=other'), env, config);
  assert.equal(user, undefined);
  ok('رمز صادر لمنصة أخرى يُرفض بـ aud');
}

// -- ١١: المسارات العامة تمرّ، وما عداها محمي --
{
  for (const p of ['/auth/callback', '/denied', '/api/health', '/api/telegram-webhook',
                   '/api/basecamp/callback', '/assets/index.js']) {
    const r = await authenticate(R(p), env, config);
    assert.equal(r.public, true, `${p} يجب أن يكون عاماً`);
  }
  for (const p of ['/', '/index.html', '/api/auth/login', '/api/auth/bootstrap',
                   '/api/transactions', '/members', '/api/media']) {
    const r = await authenticate(R(p), env, config);
    assert.ok(r.response, `${p} يجب أن يكون محمياً`);
  }
  ok('قائمة المسارات العامة مضبوطة — ودخول كلمة المرور خلف الحارس');
}

// -- ١١ب: شكل الردّ يتبع طبيعة الطلب لا بادئة المسار --
{
  const H = (p, headers) =>
    new Request(`https://naf-accountant.naflaw-sa.workers.dev${p}`, { headers });

  // تنقّلٌ إلى مسار برمجي — رابط تنزيل يفتحه المستخدم. تحويلة لا JSON،
  // وإلا عُرض عليه نصّ خام مكان أن يعود إلى الدخول.
  const nav = await authenticate(H('/api/transactions/export', { 'sec-fetch-mode': 'navigate' }), env, config);
  assert.equal(nav.response.status, 302, 'رابط تنزيل يجب أن يُحوَّل');

  // ونداءُ fetch إلى المسار نفسه — رمز حالة وجسم يُقرأ.
  const call = await authenticate(H('/api/transactions/export', { 'sec-fetch-mode': 'cors' }), env, config);
  assert.equal(call.response.status, 401);

  // ورفضُ عضوٍ موقوف على نداء برمجي: ٤٠٣ بجسم، لا تحويلة داخلية يتبعها
  // fetch بنجاح فيستقبل صفحة الواجهة نصّاً.
  const now = Math.floor(Date.now() / 1000);
  memberRow.is_active = 0;
  kvStore.set('sess:off', JSON.stringify({
    sub: 'user-1',
    token: await signToken({ sub: 'user-1', iss: ISSUER, aud: PLATFORM, iat: now, exp: now + 900 }),
    exp: now + 900,
  }));

  const denied = await authenticate(
    H('/api/stats', { cookie: 'naf_sid=off', 'sec-fetch-mode': 'cors' }),
    env, config,
  );
  assert.equal(denied.response.status, 403);
  assert.equal(denied.response.headers.get('location'), null);
  const body = await denied.response.json();
  assert.equal(body.reason, 'inactive');
  assert.equal(body.denied, '/denied?r=inactive');
  memberRow.is_active = 1;

  ok('شكل الردّ يتبع طبيعة الطلب — والرفض البرمجي ٤٠٣ بجسم يُقرأ');
}

// -- ١٢: التبليغ العكسي يصل ويُقبل --
{
  failures.length = 0;
  await reportAccessChange(env, config, { email: 'F@NafLaw.sa', state: 'revoked', reason: 'انتهى التعاقد' });
  assert.deepEqual(failures, []);
  assert.deepEqual(accessRows.at(-1), { email: 'f@naflaw.sa', state: 'revoked', reason: 'انتهى التعاقد' });
  ok('التبليغ العكسي يُقبل ويكتب صفّ الوصول');
}

// -- ١٣: next عدائي لا يخرج بالمستخدم --
{
  for (const hostile of ['//evil.sa', '/%2f%2fevil.sa', '/\\evil.sa', 'https://evil.sa']) {
    const { response } = await authenticate(R('/'), env, config);
    const { code, state } = centerGo(response.headers.get('location'));
    centerKV.get(`code:${code}`).next = hostile;      // مركزٌ مخترَق يعيد وجهة عدائية
    const cb = await handleCallback(R(`/auth/callback?code=${code}&state=${state}`), env, config);
    assert.equal(cb.headers.get('location'), '/', `${hostile} خرج بالمستخدم`);
  }
  ok('وجهة عدائية من ردّ المبادلة تُنقّى إلى الجذر');
}

console.log(`\n${pass}/14 فحصاً مرّت.`);

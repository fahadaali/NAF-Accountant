// فحص عقد: يشغّل إعداد NAF-Accountant الحقيقي مقابل محاكاة للمركز مكتوبة
// من functions/api/token.js و functions/go/[id].js و functions/api/internal/access.js
// حرفياً — بمنطق التحقق نفسه، لا بما نتوقّعه منه.

import assert from 'node:assert/strict';
import { authConfig } from '../src/auth/config.js';
import { authenticate } from 'naf-auth';
import { handleBackchannelLogout, handleCallback, isPublicPath, reportAccessChange } from 'naf-auth';
/* أسماء مفاتيح KV واسم كوكي الربط تُستوردان من الحزمة لا تُكتبان هنا:
   المحاكاة تزرع جلساتٍ في KV مباشرةً، فلو كتبت الاسم بيدها ثم غيّرته
   الحزمة لمضت الفحوص تزرع في مكانٍ لا يقرؤه أحد — وتمرّ كلُّها. */
import { sessionKeyFor, userIndexKeyFor } from 'naf-auth/safe';
import { bindCookieName } from 'naf-auth/middleware';

const ISSUER = 'https://naf-id.pages.dev';
const PLATFORM = 'NAF-Accountant';
const ORIGIN = 'https://naf-accountant.naflaw-sa.workers.dev';
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

// functions/go/[id].js — يتجاهل أي state يصله ويولّد واحدة من عنده،
// ويحفظ `bind` كما وصله ليعيده `/api/token` عند المبادلة.
function centerGo(url) {
  const u = new URL(url);
  const next = u.searchParams.get('next') || '/';
  const bind = u.searchParams.get('bind');
  if (bind !== null) assert.match(bind, /^[a-f0-9]{64}$/, `bind ليس تجزئة: ${bind}`);
  const code = 'CODE-' + Math.random().toString(16).slice(2);
  const state = 'STATE-' + Math.random().toString(16).slice(2);
  centerKV.set(`code:${code}`, { userId: 'user-1', platformId: PLATFORM, state, next, bind });
  return { code, state, next, bind };
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
  /* `bind` يعود كما وصل — والمركز الأقدم لا يعرف الحقل أصلاً، وتلك حالة
     `legacy_center` التي تُفحص أدناه بمحاكاةٍ تُسقطه. */
  return Response.json({
    token, tokenType: 'Bearer', expiresIn: 900, next: raw.next ?? '/',
    ...(centerOmitsBind ? {} : { bind: raw.bind ?? null }),
  });
}

/** مقلبٌ يجعل المحاكاة مركزاً أقدم من الحزمة: لا يعرف `bind` ولا يعيده. */
let centerOmitsBind = false;

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

  /* الحالة اختيارية منذ أن صار المركز يقبل تبليغ الصلاحية وحدها — والدخول
     يبلّغ بها في كل مرة. وإلزامُها هنا يجعل المحاكاة تخالف المركز الحيّ،
     فيسقط الفحص على تدفّق يعمل في الإنتاج. */
  const hasState = body.state !== undefined && body.state !== null;
  if (hasState && !['granted', 'revoked'].includes(body.state)) {
    failures.push('access:invalid_state'); return new Response('{}', { status: 400 });
  }
  const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : null;
  if (!hasState && !role) {
    failures.push('access:invalid_body'); return new Response('{}', { status: 400 });
  }

  accessRows.push({
    email,
    state: hasState ? body.state : null,
    reason: body.reason ?? null,
    role,
  });
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
  /* `list` بصفحاتٍ صغيرة عمداً: KV الحقيقي يردّ صفحة محدودة ومعها مؤشّر،
     ومن قرأ الصفحة الأولى وحدها ظنّ أنه استوفى. */
  async list({ prefix = '', cursor, limit = 2 } = {}) {
    const all = [...kvStore.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = all.slice(start, start + limit);
    const end = start + slice.length;
    const complete = end >= all.length;
    return {
      keys: slice.map((name) => ({ name })),
      list_complete: complete,
      cursor: complete ? undefined : String(end),
    };
  },
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

/* المتصفّح يحمل ما كُتب له. و`startLogin` يكتب كوكي ربطٍ في ردّ التحويل،
   ويجب أن يعود مع الاستقبال — فبدونه يقرأ الحارسُ الطلبَ دخولاً لم يبدأ من
   هنا. وحارسٌ لا يُختبر إلا بلا كوكي يُختبر في فرعه الاحتياطي وحده. */
const setCookies = (response) =>
  (typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean));

const cookieJar = (response) =>
  setCookies(response).map((c) => c.split(';')[0])
    .filter((c) => !/=;?$/.test(c) && !c.endsWith('='))   // ما مُحي لا يُحمل
    .join('; ');

/* عنوانُ الاستقبال كما يبنيه المركز: `functions/go/[id].js` يضيف `code`
   و`state`، ويضيف `next` إن لم يكن الجذر (السطر ١٢٧ هناك). وحذفُه من
   المحاكاة يُخفي أن لفّة الربط تقرأ الوجهة من عنوان الطلب لا من ردّ
   المبادلة — فتُقرأ اللفّة سليمةً وهي تُسقط وجهةَ صاحبها. */
const callbackUrl = ({ code, state, next }) => {
  const q = new URLSearchParams({ code, state });
  if (next && next !== '/') q.set('next', next);
  return `/auth/callback?${q}`;
};

/** رحلةُ دخولٍ كاملة كما يمشيها متصفّح: الحارس ← المركز ← الاستقبال. */
async function browserLogin(path, { tamper } = {}) {
  const { response: gate } = await authenticate(R(path), env, config);
  const goUrl = gate.headers.get('location');
  const jar = cookieJar(gate);
  const { code, state, next } = centerGo(goUrl);
  if (tamper) tamper(centerKV.get(`code:${code}`));
  const cb = await handleCallback(R(callbackUrl({ code, state, next }), jar), env, config);
  return { gate, goUrl, code, state, next, cb, jar };
}

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
  const { gate, goUrl, cb } = await browserLogin('/transactions?status=pending');

  // الحارس يرسل تجزئةً إلى المركز، وسرَّها في كوكي لا يخرج من المتصفّح.
  assert.match(new URL(goUrl).searchParams.get('bind') ?? '', /^[a-f0-9]{64}$/,
    'الحارس لم يُرسل تجزئة الربط');
  assert.ok(cookieJar(gate).includes(`${bindCookieName(config)}=`), 'لم يُكتب كوكي الربط');

  assert.equal(failures.length, 0, `المركز رفض: ${failures.join()}`);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/transactions?status=pending');

  sessionCookie = setCookies(cb).map((c) => c.split(';')[0]).find((c) => c.startsWith('naf_sid='));
  assert.ok(sessionCookie, 'لم يُكتب كوكي الجلسة');

  // وكوكي الربط يُمحى بعد استعماله — لا يُترك حتى ينتهي عمره.
  assert.ok(
    setCookies(cb).some((c) => c.startsWith(`${bindCookieName(config)}=;`) && /Max-Age=0/.test(c)),
    'كوكي الربط لم يُمحَ بعد الاستعمال',
  );
  ok('التدفّق الكامل يمرّ مربوطاً بالمتصفّح ويعود إلى الوجهة المطلوبة');
}

// -- ٤: عمر الجلسة لا يتجاوز عمر الرمز --
{
  const sid = [...kvStore.keys()].find((k) => k.startsWith('sess:'));
  assert.ok(sid, 'لم تُكتب جلسة');
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
  const { code, state, jar } = await browserLogin('/');
  failures.length = 0;
  const replay = await handleCallback(R(`/auth/callback?code=${code}&state=${state}`, jar), env, config);
  assert.equal(replay.headers.get('location'), '/denied?r=auth_failed');
  assert.deepEqual(failures, ['invalid_code']);
  ok('إعادة استعمال رمز العبور تفشل عند المركز');
}

// -- ٧: حالة غير حالة المركز تُرفض --
{
  failures.length = 0;
  const { response } = await authenticate(R('/'), env, config);
  const jar = cookieJar(response);
  const { code } = centerGo(response.headers.get('location'));
  const cb = await handleCallback(R(`/auth/callback?code=${code}&state=WRONG`, jar), env, config);
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
  const staleKey = await sessionKeyFor('stale');
  kvStore.set(staleKey, JSON.stringify({ sub: 'user-1', token: stale, exp: now - 600 }));
  const { user, response } = await authenticate(R('/api/stats', 'naf_sid=stale'), env, config);
  assert.equal(user, undefined, 'رمز منتهٍ لا يمرّ');
  assert.equal(response.status, 401);
  assert.equal(kvStore.has(staleKey), false, 'الجلسة تُمسح');
  ok('رمز منتهٍ يُبطل الجلسة في كل طلب محمي');
}

// -- ١٠: رمز منصة أخرى يُرفض --
{
  const now = Math.floor(Date.now() / 1000);
  const other = await signToken({ sub: 'user-1', iss: ISSUER, aud: 'NAF-Forms', iat: now, exp: now + 900 });
  kvStore.set(await sessionKeyFor('other'), JSON.stringify({ sub: 'user-1', token: other, exp: now + 900 }));
  const { user } = await authenticate(R('/api/stats', 'naf_sid=other'), env, config);
  assert.equal(user, undefined);
  ok('رمز صادر لمنصة أخرى يُرفض بـ aud');
}

// -- ١١: المسارات العامة تمرّ، وما عداها محمي --
{
  for (const p of ['/auth/callback', '/denied', '/api/health', '/api/telegram-webhook',
                   '/assets/index.js']) {
    const r = await authenticate(R(p), env, config);
    assert.equal(r.public, true, `${p} يجب أن يكون عاماً`);
  }
  /* و`‎/api/basecamp/callback` في المحميّة لا العامّة: رجوعُ OAuth تحويلةٌ
     يتبعها متصفّحُ المستخدم وكوكيُّه يصل معها، والصفحة تعرض `refresh_token`.
     كان عامّاً بحجّة أن بيسكامب يستدعيه خادماً لخادم — وليس كذلك. */
  for (const p of ['/', '/index.html', '/api/auth/login', '/api/auth/bootstrap',
                   '/api/transactions', '/members', '/api/media',
                   '/api/basecamp/callback']) {
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
  kvStore.set(await sessionKeyFor('off'), JSON.stringify({
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
  assert.deepEqual(accessRows.at(-1), {
    email: 'f@naflaw.sa', state: 'revoked', reason: 'انتهى التعاقد', role: null,
  });
  ok('التبليغ العكسي يُقبل ويكتب صفّ الوصول');
}

// -- ١٣: الدخول يبلّغ المركز بالصلاحية، بلا حالة --
//
// بدونه يبقى عمود الصلاحية في لوحة المركز فارغاً إلى الأبد: التبليغ اليدوي
// في مسارات إدارة الأعضاء وحدها، وكلها أفعال مسؤول لا أفعال عضو.
{
  failures.length = 0;
  const before = accessRows.length;

  const { cb: res } = await browserLogin('/transactions');
  assert.equal(res.status, 302, 'الدخول يجب أن ينجح');

  const reported = accessRows.slice(before);
  assert.equal(reported.length, 1, 'الدخول يبلّغ مرة واحدة');
  assert.equal(reported[0].email, 'f@naflaw.sa');
  assert.equal(reported[0].role, memberRow.role);
  // بلا حالة: الدخول لا يغيّر منحاً ولا سحباً، وكتابتها تمحو سحباً مركزياً.
  assert.equal(reported[0].state, null);
  assert.deepEqual(failures, []);

  ok('الدخول يبلّغ المركز بالصلاحية بلا حالة');
}

// -- ١٣: next عدائي لا يخرج بالمستخدم --
{
  for (const hostile of ['//evil.sa', '/%2f%2fevil.sa', '/\\evil.sa', 'https://evil.sa']) {
    // مركزٌ مخترَق يعيد وجهة عدائية
    const { cb } = await browserLogin('/', { tamper: (rec) => { rec.next = hostile; } });
    assert.equal(cb.headers.get('location'), '/', `${hostile} خرج بالمستخدم`);
  }
  ok('وجهة عدائية من ردّ المبادلة تُنقّى إلى الجذر');
}

// -- إشعار الخروج الخلفي: الخروج من المركز يُنهي الجلسة هنا --
{
  const now = Math.floor(Date.now() / 1000);
  const sid = 'sid-backchannel';
  const sessKey = await sessionKeyFor(sid);
  await kv.put(
    sessKey,
    JSON.stringify({
      sub: 'user-1',
      token: await signToken({ sub: 'user-1', iss: ISSUER, aud: PLATFORM, iat: now, exp: now + 900 }),
      exp: now + 900,
    }),
  );
  await kv.put(await userIndexKeyFor('user-1', sid), '1');

  /* الرمز يُوقَّع هنا كما يوقّعه المركز حرفياً — و`purpose` مكتوبة نصّاً لا
     مستوردة: تغييرها في أحد الطرفين دون الآخر يُبطل كل إشعار بلا رسالة
     تدلّ عليه، وهذا السطر هو ما يمسك ذلك. */
  const notice = (extra) =>
    new Request(`${ORIGIN}/auth/backchannel-logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(extra),
    });

  const res = await handleBackchannelLogout(
    notice({
      logoutToken: await signToken({
        sub: 'user-1', iss: ISSUER, aud: PLATFORM,
        purpose: 'backchannel-logout', iat: now, exp: now + 60,
      }),
    }),
    env,
    config,
  );
  assert.equal(res.status, 200, 'المركز رُدّ إشعارُه');
  const { ended } = await res.json();
  assert.ok(ended >= 1, `لم يُنهَ شيء (${ended})`);
  assert.equal(kvStore.has(sessKey), false, 'بقيت الجلسة بعد الإشعار');
  assert.deepEqual(
    [...kvStore.keys()].filter((k) => k.startsWith('usr:user-1:')),
    [],
    'بقي دليلُ جلسةٍ بعد الإشعار',
  );

  // ورمز الدخول لا يصلح إشعاراً — وهو يصل إلى مسار عامّ لا حراسة عليه.
  const asSession = await handleBackchannelLogout(
    notice({
      logoutToken: await signToken({
        sub: 'user-1', iss: ISSUER, aud: PLATFORM, iat: now, exp: now + 900,
      }),
    }),
    env,
    config,
  );
  assert.equal(asSession.status, 401, 'رمز جلسة قُبل إشعارَ خروج');

  // والمسار عامّ: المنادي هو المركز خادماً لخادم، ولا جلسة له هنا يُحرَس بها.
  assert.equal(isPublicPath('/auth/backchannel-logout', config), true, 'المسار محروس');

  ok('إشعار الخروج الخلفي يُنهي الجلسة، ومساره عامّ، ورمز الدخول لا يصلح إشعاراً');
}

// -- ١٤: ربط الدخول بالمتصفّح — الحالات الأربع كلُّها --
//
// هجمةُ التثبيت: المهاجم يبدأ دخولاً بنفسه فيحصل على رمز عبورٍ صالح، ثم
// يدفع الضحيّة إلى `‎/auth/callback` به. فتُفتح في متصفّح الضحيّة جلسةٌ
// باسم المهاجم، وكلُّ ما تكتبه الضحيّة بعدها يقع في حساب المهاجم.
// والرمز صحيح والحالة صحيحة — فلا شيء قبل الربط يميّز الحالتين.
{
  // (أ) كوكي لا يطابق التجزئة العائدة: ردٌّ. هذا متصفّح الضحيّة.
  {
    failures.length = 0;
    const { response } = await authenticate(R('/'), env, config);
    const { code, state } = centerGo(response.headers.get('location'));   // تجزئةُ المهاجم
    const victim = `${bindCookieName(config)}=` + 'f'.repeat(64);         // سرُّ متصفّحٍ آخر
    const cb = await handleCallback(R(`/auth/callback?code=${code}&state=${state}`, victim), env, config);
    /* `bad_state` لا `auth_failed`: أكثرُ ما يقع هذا في لسان صاحبه لا في
       هجمة — بابان مفتوحان، فالثاني يكتب كوكياً فوق الأول ثم يعود الأول
       فلا يطابق. ونصُّها «انتهت جلسة دخولك. سجّل الدخول من جديد» ومعها
       زرُّ محاولةٍ تُجدي، وهو الصواب في الحالين. */
    assert.equal(cb.headers.get('location'), '/denied?r=bad_state', 'كوكي مخالف مرّ');
    assert.equal(
      setCookies(cb).some((c) => c.startsWith('naf_sid=') && !/Max-Age=0/.test(c)), false,
      'فُتحت جلسة رغم اختلاف الربط',
    );
  }

  // (ب) رمزٌ مربوط بلا كوكي أصلاً: ردٌّ كذلك — لا يكفي ألّا يملك المهاجم سرّاً.
  {
    const { response } = await authenticate(R('/'), env, config);
    const { code, state } = centerGo(response.headers.get('location'));
    const cb = await handleCallback(R(`/auth/callback?code=${code}&state=${state}`), env, config);
    assert.equal(cb.headers.get('location'), '/denied?r=bad_state', 'رمز مربوط بلا كوكي مرّ');
  }

  // (ج) مركزٌ أقدم لا يعرف `bind`: يُقبل الدخول كما كان — منصةٌ سبقت المركزَ
  //     في الترقية لا تنكسر. وهذا هو الفرع الذي يجعل هذا النشر آمناً بأي ترتيب.
  {
    centerOmitsBind = true;
    failures.length = 0;
    const { cb } = await browserLogin('/transactions');
    centerOmitsBind = false;
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/transactions', 'مركزٌ أقدم كسر الدخول');
    assert.deepEqual(failures, []);
  }

  // (د) دخولٌ بدأ من شبكة المركز — بطاقةٌ تقصد `‎/go/:id` مباشرةً، فلا كوكي
  //     ولا تجزئة. يُعاد البدء لفّةً واحدة إلى الوجهة المقصودة، لا إلى مسار
  //     الاستقبال ومعه رمزٌ استُهلك — وتلك تدور بلا نهاية.
  {
    const { code, state, next } = centerGo(`${ISSUER}/go/${PLATFORM}?next=/transactions`);
    const cb = await handleCallback(R(callbackUrl({ code, state, next })), env, config);
    assert.equal(cb.status, 302);
    const loc = new URL(cb.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, `${ISSUER}/go/${PLATFORM}`, 'لم يُعَد البدء من المركز');
    assert.match(loc.searchParams.get('bind') ?? '', /^[a-f0-9]{64}$/, 'العودة بلا تجزئة');
    assert.equal(loc.searchParams.get('next'), '/transactions', 'ضاعت الوجهة في لفّة الربط');
    assert.ok(cookieJar(cb).includes(`${bindCookieName(config)}=`), 'اللفّة لم تكتب الكوكي');
  }

  ok('الربط بالمتصفّح: مخالفٌ يُردّ، وغائبٌ يُردّ، ومركزٌ أقدم يمرّ، وبدءٌ من المركز يلتفّ لفّةً');
}

/* العدد يُتحقَّق منه لا يُطبع وحده: فحصٌ يسقط من الملف بحذفٍ أو بخطأ في دمج
   يبقى العدّاد معه أقلّ، وسطرٌ يقول «١٥/١٦» يُقرأ نجاحاً بلمحة عين. */
const EXPECTED = 17;
assert.equal(pass, EXPECTED, `عدد الفحوص ${pass} لا ${EXPECTED}`);
console.log(`\n${pass}/${EXPECTED} فحصاً مرّت.`);

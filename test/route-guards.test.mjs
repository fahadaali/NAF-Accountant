// ============================================================================
// عقد حماية المسارات — بلا شبكة وبلا تبعيات: مُشغّل الاختبارات المدمج.
//   npm run check:routes
//
// ═══ لماذا هذا الملف ═══
//
// التطبيقات الفرعية كلها تُركَّب على `/api`، فوسيط `use('*')` في أحدها يصير
// وسيطاً على `/api/*` كلّه ويحرس مسارات غيره بحسب ترتيب التسجيل وحده.
// وحارس الإدارة كان مسجّلاً قبل اللوحة والأعضاء، فكان يردّ ٤٠٣ على كل نداء
// من عضوٍ ليس مسؤولاً، وعلى كل نداء بالمفتاح الآلي — أي أن دورَي `editor`
// و`viewer` وسطحَ الأتمتة المُعلن لا يعمل منها شيء.
//
// العطل لا يظهر في قراءة ملف واحد: كل ملف صحيح وحده، والخلل في التركيب.
// فيُفحص التركيب نفسه.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

import adminRoute from '../src/routes/admin.js';
import dashboardRoute from '../src/routes/dashboard.js';

// ---------------------------------------------------------------------------
// بديل مصغّر لـ D1 — يكفي المسارات التي تُنادى هنا.
// ---------------------------------------------------------------------------
function fakeDb() {
  const stmt = {
    bind: () => stmt,
    first: async () => ({ n: 0 }),
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { last_row_id: 1, changes: 0 } }),
  };
  return { prepare: () => stmt };
}

const ENV = { DB: fakeDb(), DASHBOARD_API_KEY: 'machine-key' };

/**
 * نفس ترتيب التركيب في `src/index.js`. ووسيط الحقن يقوم مقام
 * `ssoMiddleware`: يحقن العضو كما يحقنه بعد تحقّقه من رمز المركز.
 */
function buildApp(injectedUser) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (injectedUser) c.set('user', injectedUser);
    await next();
  });
  app.route('/api', adminRoute);
  app.route('/api', dashboardRoute);
  app.all('/api/*', (c) => c.json({ ok: false, error: 'not found' }, 404));
  return app;
}

function call(user, path, { method = 'GET', key } = {}) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  return buildApp(user).fetch(new Request(`https://naf.test${path}`, { method, headers }), ENV, {
    waitUntil() {},
    passThroughOnException() {},
  });
}

const ADMIN = { id: 'm1', role: 'admin' };
const EDITOR = { id: 'm2', role: 'editor' };
const VIEWER = { id: 'm3', role: 'viewer' };

// مسارات اللوحة التي يقرؤها كل عضو مُصادَق.
const DASHBOARD_READS = [
  '/api/stats',
  '/api/transactions',
  '/api/accounts',
  '/api/logs',
  '/api/analytics',
  '/api/settings/status',
];

// مسارات الإدارة — للمسؤول وحده.
const ADMIN_ONLY = ['/api/users', '/api/chats', '/api/recurring'];

// ---------------------------------------------------------------------------

test('المحرّر يقرأ اللوحة كلها', async () => {
  for (const path of DASHBOARD_READS) {
    const res = await call(EDITOR, path);
    assert.equal(res.status, 200, `${path} محجوبة عن دور editor`);
  }
});

test('القارئ يقرأ اللوحة كلها', async () => {
  for (const path of DASHBOARD_READS) {
    const res = await call(VIEWER, path);
    assert.equal(res.status, 200, `${path} محجوبة عن دور viewer`);
  }
});

test('المفتاح الآلي يقرأ سطحه المُعلن', async () => {
  for (const path of DASHBOARD_READS) {
    const res = await call(null, path, { key: 'machine-key' });
    assert.equal(res.status, 200, `${path} محجوبة عن المفتاح الآلي`);
  }
});

test('مسارات الإدارة للمسؤول وحده', async () => {
  for (const path of ADMIN_ONLY) {
    assert.equal((await call(ADMIN, path)).status, 200, `${path} محجوبة عن المسؤول`);
    assert.equal((await call(EDITOR, path)).status, 403, `${path} مفتوحة لدور editor`);
    assert.equal((await call(VIEWER, path)).status, 403, `${path} مفتوحة لدور viewer`);
  }
});

test('المفتاح الآلي لا يبلغ الإدارة', async () => {
  for (const path of ADMIN_ONLY) {
    assert.equal((await call(null, path, { key: 'machine-key' })).status, 403, path);
  }
});

test('بلا عضو ولا مفتاح: 401', async () => {
  assert.equal((await call(null, '/api/stats')).status, 401);
  assert.equal((await call(null, '/api/users')).status, 401);
});

test('التعديل في اللوحة للمسؤول وحده', async () => {
  assert.equal((await call(EDITOR, '/api/accounts/sync', { method: 'POST' })).status, 403);
  // المسؤول يعبر الحارس. والمزامنة نفسها تفشل هنا (لا شبكة ولا مفتاح وافق)
  // فتردّ ٥٠٠ — والمقصود أنها لم تُردّ ٤٠٣.
  assert.notEqual((await call(ADMIN, '/api/accounts/sync', { method: 'POST' })).status, 403);
});

test('لا حارس يحرس مسارات غيره — جرد آلي', async () => {
  // كل مسار في تطبيق الإدارة يجب أن يرد ٤٠٣ للمحرّر، وكل مسار في اللوحة
  // يجب ألّا يردّ ٤٠٣ له على القراءة. الجرد يشمل ما يُضاف لاحقاً.
  // بالطريقة المسجّلة لكل مسار: نداءٌ بطريقة أخرى يردّ ٤٠٤ فلا يفحص حارساً.
  const routesOf = (app) =>
    app.routes.filter((r) => !r.path.includes('*') && r.method !== 'ALL');

  for (const r of routesOf(adminRoute)) {
    const res = await call(EDITOR, `/api${r.path}`, { method: r.method });
    assert.equal(res.status, 403, `مسار إدارة بلا حارس: ${r.method} ${r.path}`);
  }

  for (const r of routesOf(dashboardRoute)) {
    if (r.method !== 'GET') continue; // القراءة وحدها حقّ القارئ
    const res = await call(VIEWER, `/api${r.path}`);
    assert.notEqual(res.status, 403, `مسار لوحة يحجب القارئ عن القراءة: ${r.path}`);
  }
});

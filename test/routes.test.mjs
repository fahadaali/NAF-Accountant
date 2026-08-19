// ============================================================================
// اختبارات حماية المسارات — بلا تبعيات: مُشغّل الاختبارات المدمج في Node.
//   npm test
//
// سبب وجود هذا الملف: وسيط `use('*')` داخل تطبيق فرعي مركّب على /api كان
// يحرس مسارات التطبيقات الفرعية الأخرى، فحجب اللوحة كلّها عن صلاحية
// «مستخدم». العطل لا يظهر في قراءة ملف واحد — يظهر في التركيب.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { app } from '../src/index.js';

// ---------------------------------------------------------------------------
// بديل مصغّر لـ D1: يردّ نتائج معلّبة بحسب نصّ الاستعلام.
// ---------------------------------------------------------------------------
const USERS = {
  'tok-admin': { id: 1, email: 'admin@naf.test', role: 'admin', expires_at: '2099-01-01T00:00:00.000Z' },
  'tok-user': { id: 2, email: 'user@naf.test', role: 'user', expires_at: '2099-01-01T00:00:00.000Z' },
};

function fakeDb() {
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (/FROM sessions s JOIN users u/.test(sql)) return USERS[args[0]] || null;
          if (/COUNT\(\*\) AS n FROM users/.test(sql)) return { n: 1 };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { meta: { last_row_id: 1, changes: 0 } }; },
      };
      return stmt;
    },
  };
}

const ENV = { DB: fakeDb(), DASHBOARD_API_KEY: 'key-automation' };

function call(path, token, method = 'GET') {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return app.fetch(new Request(`https://naf.test${path}`, { method, headers }), ENV, {
    waitUntil() {},
    passThroughOnException() {},
  });
}

// ---------------------------------------------------------------------------

test('المستخدم بصلاحية «مستخدم» يقرأ اللوحة', async () => {
  for (const path of ['/api/stats', '/api/transactions', '/api/accounts', '/api/logs', '/api/analytics', '/api/settings/status']) {
    const res = await call(path, 'tok-user');
    assert.equal(res.status, 200, `${path} يجب أن تكون متاحة لصلاحية «مستخدم»`);
  }
});

test('المستخدم بصلاحية «مستخدم» يُمنع من مسارات الإدارة', async () => {
  for (const path of ['/api/users', '/api/chats', '/api/recurring']) {
    const res = await call(path, 'tok-user');
    assert.equal(res.status, 403, `${path} يجب أن تكون للمسؤول وحده`);
  }
});

test('المستخدم بصلاحية «مستخدم» يُمنع من إجراءات التعديل في اللوحة', async () => {
  const res = await call('/api/accounts/sync', 'tok-user', 'POST');
  assert.equal(res.status, 403);
});

test('المسؤول يصل إلى الاثنين', async () => {
  assert.equal((await call('/api/stats', 'tok-admin')).status, 200);
  assert.equal((await call('/api/users', 'tok-admin')).status, 200);
});

test('المفتاح الآلي يُعامل كمسؤول', async () => {
  assert.equal((await call('/api/users', 'key-automation')).status, 200);
});

test('بلا رمز → 401', async () => {
  for (const path of ['/api/stats', '/api/users', '/api/transactions']) {
    assert.equal((await call(path)).status, 401, path);
  }
});

test('المسارات العامة تبقى عامة', async () => {
  assert.equal((await call('/api/health')).status, 200);
  assert.equal((await call('/api/auth/status')).status, 200);
});

test('مسار API مجهول: 401 لغير المُصادَق و404 للمُصادَق', async () => {
  assert.equal((await call('/api/nope')).status, 401);
  assert.equal((await call('/api/nope', 'tok-user')).status, 404);
});

test('لا مسار /api محمي بلا مصادقة — جرد آلي', async () => {
  // المسارات العامة عمداً: لكلٍّ حمايته الخاصة (سرّ الويبهوك، حارس التقارير،
  // إعداد أول مسؤول). ما عداها يجب أن يردّ 401 بلا رمز.
  const PUBLIC = [
    '/api/health',
    '/api/auth/status', '/api/auth/bootstrap', '/api/auth/login', '/api/auth/me', '/api/auth/logout',
    '/api/telegram-webhook',
    '/api/reports/basecamp', '/api/reports/financial',
    '/api/basecamp/start', '/api/basecamp/callback',
  ];

  const paths = [...new Set(app.routes.map((r) => r.path))].filter(
    (p) => p.startsWith('/api/') && !p.includes('*')
  );

  for (const path of paths) {
    if (PUBLIC.includes(path)) continue;
    const res = await call(path, null, 'POST');
    assert.ok(
      res.status === 401,
      `${path} غير محمي — أضِفه إلى القائمة العامة عن قصد أو ضعه بعد وسيط المصادقة`
    );
  }
});

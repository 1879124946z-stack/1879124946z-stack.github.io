// Run only against the dedicated .data/prod-smoke instance, not a live study.
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3002';
for (const path of [
  '/',
  '/admin',
  '/api/health',
  ...['flanker', 'dccs', 'mot', 'corsi', 'tol'].map(
    (t) => `/tasks/${t}/index.html`,
  ),
]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200, path);
  await r.arrayBuffer();
}
assert.equal((await fetch(base + '/api/admin/dashboard')).status, 401);
assert.equal(
  (await fetch(base + '/api/admin/export?task=flanker&kind=summary')).status,
  401,
);
assert.equal(
  (
    await fetch(base + '/api/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://other.example',
      },
      body: '{}',
    })
  ).status,
  403,
);
const headers = { 'content-type': 'application/json', origin: base };
const registration = await fetch(base + '/api/register', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    studentId: 'PRODUCTION_SMOKE_ONLY',
    age: 9,
    sex: '男',
    grade: '三年级',
  }),
});
assert.equal(registration.status, 200, await registration.clone().text());
const identity = await registration.json();
assert.equal(identity.participant.studentId, 'PRODUCTION_SMOKE_ONLY');
assert.ok(identity.publicKey.n);
const cookie = registration.headers.get('set-cookie').split(';')[0];
const me = await fetch(base + '/api/me', { headers: { cookie } });
assert.equal(me.status, 200);
assert.equal(
  (await fetch(base + '/api/admin/dashboard', { headers: { cookie } })).status,
  401,
);
const start = await fetch(base + '/api/start', {
  method: 'POST',
  headers: { ...headers, cookie },
  body: JSON.stringify({ task: 'dccs' }),
});
assert.equal(start.status, 200);
const run = await start.json();
assert.equal(
  (
    await fetch(base + '/api/start', {
      method: 'POST',
      headers: { ...headers, cookie },
      body: JSON.stringify({ task: 'dccs' }),
    })
  ).status,
  409,
);
assert.equal(
  (
    await fetch(base + '/api/abandon', {
      method: 'POST',
      headers: { ...headers, cookie },
      body: JSON.stringify({ run: run.run, secret: run.secret }),
    })
  ).status,
  200,
);
for (const path of [
  '/.data/lab.sqlite',
  '/.data/runtime.json',
  '/server/store.mjs',
]) {
  const r = await fetch(base + path);
  assert.equal(r.status, 404, path);
}
console.log(
  'Production smoke passed: pages/assets, same-origin API, student sessions, task lock, admin access denial, private file denial.',
);

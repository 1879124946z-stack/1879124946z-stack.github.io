import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { createApi } from '../server/http.mjs';
import { TASKS } from '../server/catalog.mjs';
import { Store, compareId } from '../server/store.mjs';

const p = (id) => ({ studentId: id, age: 9, sex: '男', grade: '三年级' });
const data = (task = 'flanker', marker = 1) => ({
  status: 'complete',
  finishedAt: new Date().toISOString(),
  summary: {
    task_version: TASKS.find((t) => t.id === task).version,
    completion_status: 'complete',
    marker,
  },
  trials: Array.from({ length: 120 }, (_, index) => ({
    correct: 1,
    rt_ms: 123,
    marker,
    index,
    nested: { events: [1, 2, 3] },
  })),
  device: { width: 390 },
});
async function encrypted(jwk, payload) {
  const rsa = await webcrypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey'],
  );
  const aes = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  return {
    iv: Buffer.from(iv).toString('base64'),
    key: Buffer.from(
      await webcrypto.subtle.wrapKey('raw', aes, rsa, { name: 'RSA-OAEP' }),
    ).toString('base64'),
    payload: Buffer.from(
      await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aes,
        Buffer.from(JSON.stringify(payload)),
      ),
    ).toString('base64'),
  };
}
void test('registration, task locking, latest complete only, CSV isolation and edits', () => {
  const store = new Store(':memory:');
  store.register(p('001'));
  assert.equal(store.student('001').studentId, '001');
  assert.throws(() => store.register({ ...p('001'), age: 10 }), /不一致/);
  assert.throws(() => store.register({ ...p('x'), age: 9.5 }), /整数/);
  const first = store.start('001', 'flanker');
  assert.throws(() => store.start('001', 'flanker'), /其他页面/);
  const parallel = store.start('001', 'mot');
  store.abandon('001', parallel.run, parallel.secret);
  assert.equal(store.dashboard().results.length, 0);
  store.complete('001', { ...first, data: data() });
  assert.equal(store.dashboard().results.length, 1);
  const unfinished = store.start('001', 'flanker');
  store.abandon('001', unfinished.run, unfinished.secret);
  assert.equal(
    JSON.parse(store.db.prepare('SELECT payload FROM results').get().payload)
      .summary.marker,
    1,
  );
  assert.throws(
    () => store.complete('001', { ...unfinished, data: data() }),
    /失效/,
  );
  const second = store.start('001', 'flanker');
  assert.throws(
    () =>
      store.complete('001', {
        ...second,
        data: { ...data(), status: 'stopped' },
      }),
    /正式完成/,
  );
  assert.equal(
    JSON.parse(store.db.prepare('SELECT payload FROM results').get().payload)
      .summary.marker,
    1,
  );
  store.complete('001', { ...second, data: data('flanker', 2) });
  store.complete('001', { ...second, data: data('flanker', 2) });
  assert.equal(store.dashboard().results.length, 1);
  assert.throws(
    () => store.complete('001', { ...first, data: data() }),
    /失效/,
  );
  const mot = store.start('001', 'mot');
  store.complete('001', { ...mot, data: data('mot', 3) });
  const raw = store.csv('flanker', 'raw');
  assert.ok(raw.includes('data.nested'));
  assert.ok(!raw.includes('"mot"'));
  assert.throws(() => store.csv('flanker,mot', 'raw'), /必须选择/);
  store.edit('001', { ...p('001'), age: 10, grade: '四年级' });
  assert.ok(store.csv('flanker', 'summary').includes('"10","男","四年级"'));
  store.remove('001', 'flanker');
  assert.equal(store.dashboard().results.length, 1);
  store.remove('001');
  assert.equal(store.dashboard().students.length, 0);
  assert.equal(store.dashboard().results.length, 0);
  store.db.close();
});
void test('natural student ordering and formula injection escaping', () => {
  const store = new Store(':memory:');
  for (const id of ['10', '2', '001', '=1+1', '王同学']) {
    store.register(p(id));
    const r = store.start(id, 'flanker');
    store.complete(id, { ...r, data: data() });
  }
  assert.deepEqual(['10', '2', '001'].sort(compareId), ['001', '2', '10']);
  const csv = store.csv('flanker', 'summary');
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.indexOf('"2"') < csv.indexOf('"10"'));
  store.db.close();
});
void test('all five task completion protocols and invalid completions', () => {
  const store = new Store(':memory:');
  store.register(p('005'));
  for (const t of TASKS) {
    const run = store.start('005', t.id),
      payload = data(t.id);
    if (t.id === 'dccs') {
      delete payload.summary.completion_status;
      payload.summary.status = 'complete';
    }
    assert.throws(
      () => store.complete('005', { ...run, data: { ...payload, trials: [] } }),
      /不完整/,
    );
    assert.throws(
      () =>
        store.complete('005', {
          ...run,
          data: { ...payload, summary: { ...payload.summary, debug_mode: 1 } },
        }),
      /正式完成/,
    );
    store.complete('005', { ...run, data: payload });
    assert.equal(store.csv(t.id, 'raw').split('\r\n').length, 121);
  }
  assert.equal(store.dashboard().results.length, 5);
  const stale = store.start('005', 'dccs');
  store.remove('005', 'dccs', true);
  assert.throws(
    () => store.complete('005', { ...stale, data: data('dccs') }),
    /失效/,
  );
  assert.equal(store.dashboard().results.length, 5);
  store.db.close();
});
void test('80 concurrent encrypted HTTP submissions, admin-only export, restart persistence', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cognitive-lab-'));
  const key = 'private-test-key-with-over-32-characters';
  const { server, store } = createApi({ directory, serviceKey: key });
  store.setAdmin('admin', 'test-only-long-password');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, cookie = '', authorized = true) {
    const r = await fetch(base + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        ...(authorized ? { 'x-lab-service-key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      cookie: r.headers.get('set-cookie')?.split(';')[0],
      text: await r.text(),
    };
  }
  assert.equal((await request('health', undefined, '', false)).status, 403);
  assert.equal(
    (await request('admin/export?task=flanker&kind=raw')).status,
    401,
  );
  const started = performance.now();
  const students = await Promise.all(
    Array.from({ length: 80 }, async (_, i) => {
      const registration = await request(
        'register',
        p(String(i).padStart(3, '0')),
      );
      assert.equal(registration.status, 200);
      const session = JSON.parse(registration.text),
        cookie = registration.cookie;
      const run = await request('start', { task: 'flanker' }, cookie);
      assert.equal(run.status, 200);
      const r = JSON.parse(run.text);
      return {
        cookie,
        r,
        body: await encrypted(session.publicKey, {
          ...r,
          data: data('flanker', i),
        }),
      };
    }),
  );
  // These requests arrive together; completion is one transaction per student/task.
  const results = await Promise.all(
    students.map((s) => request('complete', s.body, s.cookie)),
  );
  assert.ok(
    results.every((r) => r.status === 200),
    JSON.stringify(results.filter((r) => r.status !== 200)),
  );
  const elapsed = Math.round(performance.now() - started);
  assert.equal(store.dashboard().students.length, 80);
  assert.equal(store.dashboard().results.length, 80);
  assert.equal(store.dashboard().locks.length, 0);
  assert.equal(
    (await request('admin/dashboard', undefined, students[0].cookie)).status,
    401,
  );
  assert.equal(
    (await request('admin/login', { username: 'admin', password: 'wrong' }))
      .status,
    401,
  );
  const login = await request('admin/login', {
    username: 'admin',
    password: 'test-only-long-password',
  });
  assert.equal(login.status, 200);
  assert.ok(login.cookie.startsWith('lab_admin='));
  const exportResult = await request(
    'admin/export?task=flanker&kind=summary',
    undefined,
    login.cookie,
  );
  assert.equal(exportResult.status, 200);
  assert.equal(exportResult.text.split('\r\n').length, 81);
  const rawResult = await request(
    'admin/export?task=flanker&kind=raw',
    undefined,
    login.cookie,
  );
  assert.equal(rawResult.text.split('\r\n').length, 9601);
  assert.equal(
    (
      await request(
        'admin/export?task=mot&kind=summary',
        undefined,
        login.cookie,
      )
    ).text.split('\r\n').length,
    1,
  );
  const reopened = new Store(join(directory, 'lab.sqlite'));
  assert.equal(reopened.dashboard().results.length, 80);
  reopened.db.close();

  console.log(
    `LOAD CHECK: 80 registrations + starts + encrypted completions: ${elapsed} ms; 80/80 saved, 0 mixed records.`,
  );
});


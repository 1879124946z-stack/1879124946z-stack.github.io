import { createServer } from 'node:http';
import { webcrypto, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store, Failure } from './store.mjs';

export function createApi({ directory, serviceKey, secure = false }) {
  if (!serviceKey || serviceKey.length < 32)
    throw new Error('LAB_SERVICE_KEY must be configured.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const store = new Store(join(directory, 'lab.sqlite'));
  const keyPath = join(directory, 'encryption-key.json');
  if (!existsSync(keyPath)) {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(
      keyPath,
      JSON.stringify({
        public: keys.publicKey.export({ format: 'jwk' }),
        private: keys.privateKey.export({ format: 'jwk' }),
      }),
      { mode: 0o600 },
    );
  }
  const keys = JSON.parse(readFileSync(keyPath, 'utf8'));
  const privateKey = webcrypto.subtle.importKey(
    'jwk',
    keys.private,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['unwrapKey'],
  );
  const cookie = (role, value, age) =>
    `${role === 'admin' ? 'lab_admin' : 'lab_student'}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  async function decrypt(envelope) {
    try {
      const aes = await webcrypto.subtle.unwrapKey(
        'raw',
        Buffer.from(envelope.key, 'base64'),
        await privateKey,
        { name: 'RSA-OAEP' },
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      );
      return JSON.parse(
        Buffer.from(
          await webcrypto.subtle.decrypt(
            { name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64') },
            aes,
            Buffer.from(envelope.payload, 'base64'),
          ),
        ).toString('utf8'),
      );
    } catch {
      throw new Failure(400, '提交的数据无法解密，请联系老师。');
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.headers['x-lab-service-key'] !== serviceKey)
        throw new Failure(403, '禁止访问。');
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const cookies = Object.fromEntries(
        (req.headers.cookie || '').split(';').map((s) => s.trim().split('=')),
      );
      const admin = () => store.authenticate(cookies.lab_admin, 'admin');
      const student = () =>
        store.authenticate(cookies.lab_student, 'student').student;
      let body = {};
      if (!['GET', 'HEAD'].includes(req.method)) {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024)
            throw new Failure(413, '数据超过单次提交上限。');
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        } catch {
          throw new Failure(400, '请求格式错误。');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new Failure(400, '请求格式错误。');
      }
      let output;
      if (path === '/api/health' && req.method === 'GET') output = { ok: true };
      else if (path === '/api/register' && req.method === 'POST') {
        store.limit('registration', 3000, 60e3);
        const result = store.register(body);
        res.setHeader(
          'Set-Cookie',
          cookie('student', result.session, 30 * 86400),
        );
        output = { participant: result.participant, publicKey: keys.public };
      } else if (path === '/api/me' && req.method === 'GET')
        output = {
          participant: store.student(student()),
          publicKey: keys.public,
        };
      else if (path === '/api/start' && req.method === 'POST')
        output = store.start(student(), body.task);
      else if (path === '/api/abandon' && req.method === 'POST')
        output = store.abandon(student(), body.run, body.secret);
      else if (path === '/api/complete' && req.method === 'POST')
        output = store.complete(student(), await decrypt(body));
      else if (path === '/api/admin/login' && req.method === 'POST') {
        const value = store.login(
          body.username,
          body.password,
          req.headers['x-lab-client-ip'] || 'shared',
        );
        res.setHeader('Set-Cookie', cookie('admin', value, 8 * 3600));
        output = { ok: true };
      } else if (path === '/api/admin/logout' && req.method === 'POST') {
        const session = admin();
        store.db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
        res.setHeader('Set-Cookie', cookie('admin', '', 0));
        output = { ok: true };
      } else if (path === '/api/admin/dashboard' && req.method === 'GET') {
        admin();
        output = store.dashboard();
      } else if (path === '/api/admin/edit' && req.method === 'POST') {
        admin();
        output = store.edit(body.studentId, body);
      } else if (path === '/api/admin/delete' && req.method === 'POST') {
        admin();
        output = store.remove(
          body.studentId,
          body.task,
          body.lockOnly === true,
        );
      } else if (path === '/api/admin/export' && req.method === 'GET') {
        admin();
        const task = url.searchParams.get('task'),
          kind = url.searchParams.get('kind');
        const csv = store.csv(task, kind);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${task}_${kind}.csv"`,
        );
        res.end(csv);
        return;
      } else throw new Failure(404, '接口不存在。');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(output));
    } catch (error) {
      res.statusCode = error instanceof Failure ? error.status : 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error:
            error instanceof Failure
              ? error.message
              : '服务器暂时无法处理，请稍后重试。',
        }),
      );
      if (!(error instanceof Failure))
        console.error('API failure:', error.name);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, store };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
) {
  createApi({
    directory: resolve(process.env.LAB_DATA_DIR || '.data'),
    serviceKey: process.env.LAB_SERVICE_KEY,
    secure: process.env.LAB_SECURE_COOKIES === '1',
  }).server.listen(Number(process.env.LAB_API_PORT || 8788), '127.0.0.1', () =>
    console.log('Lab API ready on loopback.'),
  );
}

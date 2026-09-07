import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApi } from './http.mjs';

const config = JSON.parse(
  readFileSync(
    resolve(process.env.LAB_DATA_DIR || '.data', 'runtime.json'),
    'utf8',
  ),
);
const env = { ...config, ...process.env, LAB_MAINLAND: '1' };
env.LAB_API_URL ??= `http://127.0.0.1:${env.LAB_API_PORT || 8788}`;
const { server, store } = createApi({
  directory: resolve(env.LAB_DATA_DIR || '.data'),
  serviceKey: env.LAB_SERVICE_KEY,
  secure: env.LAB_SECURE_COOKIES === '1',
});
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(Number(env.LAB_API_PORT || 8788), '127.0.0.1', done);
});
const dev = process.argv.includes('--dev');
const child = spawn(
  process.execPath,
  dev
    ? ['node_modules/vinext/dist/cli.js', 'dev', '--host', '127.0.0.1']
    : ['dist/standalone/server.js'],
  { env, stdio: 'inherit' },
);
function stop() {
  child.kill();
  server.close();
  store.db.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('exit', (code) => {
  server.close();
  process.exit(code || 0);
});

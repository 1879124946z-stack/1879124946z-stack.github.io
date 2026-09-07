import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store, token } from './store.mjs';

const directory = resolve(process.env.LAB_DATA_DIR || '.data');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const configPath = join(directory, 'runtime.json');
if (!existsSync(configPath))
  writeFileSync(configPath, JSON.stringify({ LAB_SERVICE_KEY: token() }), {
    mode: 0o600,
  });
const store = new Store(join(directory, 'lab.sqlite'));
const reset = process.argv.includes('--reset-admin');
if (!store.db.prepare('SELECT id FROM admin WHERE id=1').get() || reset) {
  const password = process.env.LAB_ADMIN_PASSWORD || token();
  const username = process.env.LAB_ADMIN_USERNAME || 'admin';
  store.setAdmin(username, password);
  writeFileSync(
    join(directory, '管理员登录信息.txt'),
    `管理员账号：${username}\n管理员密码：${password}\n后台入口：/admin\n请妥善保管。此文件及整个 .data 目录不得放在公开网站目录中。\n`,
    { mode: 0o600 },
  );
}
if (process.argv.includes('--backup')) {
  const { backup } = await import('node:sqlite');
  const output = join(directory, `backup-${Date.now()}.sqlite`);
  await backup(store.db, output);
  console.log('Database backup created in private data directory.');
}
store.db.close();
console.log(
  'Private data directory initialized. Administrator credentials are in .data/管理员登录信息.txt.',
);

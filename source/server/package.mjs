import JSZip from 'jszip';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
const zip = new JSZip(),
  root = process.cwd();
async function add(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name),
      name = prefix + '/' + entry.name;
    if (entry.isDirectory()) await add(path, name);
    else if (entry.isFile()) zip.file(name, await readFile(path));
    else
      throw new Error(
        'Unexpected symbolic link in deployment output: ' +
          relative(root, path),
      );
  }
}
await add(resolve('dist/standalone'), 'dist/standalone');
for (const name of [
  'catalog.mjs',
  'store.mjs',
  'http.mjs',
  'manage.mjs',
  'run.mjs',
])
  zip.file('server/' + name, await readFile('server/' + name));
zip.file('DEPLOYMENT.md', await readFile('DEPLOYMENT.md'));
zip.file(
  'deploy/nginx.conf.example',
  await readFile('deploy/nginx.conf.example'),
);
await mkdir('../delivery', { recursive: true });
const output = resolve('../delivery/cognitive-lab-mainland-ready.zip');
await writeFile(
  output,
  await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }),
);
console.log('Deployment package saved: ' + output);

import JSZip from 'jszip';
import type { StoredTask, TaskManifest } from './models';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', json: 'application/json',
};

function normalize(path: string) {
  const parts: string[] = [];
  path.replace(/\\/g, '/').split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop(); else parts.push(part);
  });
  return parts.join('/');
}

function resolveFrom(base: string, target: string) {
  if (/^(data:|https?:|blob:|#)/i.test(target)) return target;
  const folder = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  return normalize(`${folder}${target}`);
}

export async function readTaskZip(file: File): Promise<StoredTask> {
  if (file.size > 25 * 1024 * 1024) throw new Error('压缩包不能超过25 MB。请移除无关素材后重试。');
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir && !name.startsWith('__MACOSX/'));
  const rootPrefix = names.every((name) => name.includes('/')) ? names[0].split('/')[0] + '/' : '';
  const logicalNames = names.map((name) => name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);
  const actualName = (logical: string) => names[logicalNames.indexOf(normalize(logical))];
  const manifestName = actualName('manifest.json');
  if (!manifestName) throw new Error('未找到 manifest.json。请把它放在ZIP根目录。');

  let manifest: TaskManifest;
  try { manifest = JSON.parse(await zip.file(manifestName)!.async('string')); }
  catch { throw new Error('manifest.json 不是有效的JSON文件。'); }
  if (!manifest.id || !manifest.name || !manifest.version || !manifest.durationMinutes || !manifest.domain) {
    throw new Error('manifest.json 缺少 id、name、version、durationMinutes 或 domain。');
  }
  const entry = normalize(manifest.entry || 'index.html');
  const entryName = actualName(entry);
  if (!entryName) throw new Error(`未找到入口文件 ${entry}。`);

  const assetCache = new Map<string, string>();
  const dataUrl = async (logicalPath: string) => {
    const clean = normalize(logicalPath);
    if (assetCache.has(clean)) return assetCache.get(clean)!;
    const name = actualName(clean);
    if (!name) return logicalPath;
    const ext = clean.split('.').pop()?.toLowerCase() || '';
    const base64 = await zip.file(name)!.async('base64');
    const url = `data:${MIME[ext] || 'application/octet-stream'};base64,${base64}`;
    assetCache.set(clean, url);
    return url;
  };

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(await zip.file(entryName)!.async('string'), 'text/html');
  for (const script of Array.from(documentNode.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src')!;
    const name = actualName(resolveFrom(entry, src));
    if (name) { script.textContent = await zip.file(name)!.async('string'); script.removeAttribute('src'); }
  }
  for (const link of Array.from(documentNode.querySelectorAll('link[rel="stylesheet"][href]'))) {
    const href = link.getAttribute('href')!;
    const cssPath = resolveFrom(entry, href);
    const name = actualName(cssPath);
    if (!name) continue;
    let css = await zip.file(name)!.async('string');
    const urls = Array.from(css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g));
    for (const match of urls) {
      const resolved = await dataUrl(resolveFrom(cssPath, match[2]));
      css = css.replace(match[0], `url("${resolved}")`);
    }
    const style = documentNode.createElement('style'); style.textContent = css; link.replaceWith(style);
  }
  for (const element of Array.from(documentNode.querySelectorAll('[src]'))) {
    const src = element.getAttribute('src');
    if (src) element.setAttribute('src', await dataUrl(resolveFrom(entry, src)));
  }
  documentNode.querySelector('base')?.remove();
  const html = `<!doctype html>\n${documentNode.documentElement.outerHTML}`;
  return { ...manifest, entry, importedAt: new Date().toISOString(), html };
}

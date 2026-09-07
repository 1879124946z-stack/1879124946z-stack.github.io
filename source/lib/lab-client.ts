export type Student = {
  studentId: string;
  age: number;
  sex: string;
  grade: string;
};
export type Run = {
  run: string;
  secret: string;
  started: string;
  task: string;
  participant: Student;
};
export type Envelope = { key: string; iv: string; payload: string };
export type Pending = {
  id: string;
  student: string;
  task: string;
  envelope: Envelope;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const remoteApi = process.env.NEXT_PUBLIC_LAB_API_ORIGIN || '';
export async function apiFetch(path: string, options: RequestInit = {}) {
  const role=path.startsWith('admin/')?'admin':'student';
  const headers=new Headers(options.headers);
  if(remoteApi){
    const token=sessionStorage.getItem(`lab-api-${role}`);
    if(token)headers.set('authorization',`Bearer ${token}`);
  }
  const response=await fetch(`${remoteApi}/api/${path}`,{...options,headers,cache:'no-store',credentials:remoteApi?'omit':'same-origin'});
  if(remoteApi&&response.status===401)sessionStorage.removeItem(`lab-api-${role}`);
  return response;
}
export async function api<T = { ok: boolean }>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await apiFetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = (await response.json()) as T & { error?: string; sessionToken?: string };
  if (!response.ok)
    throw new ApiError(data.error || '请求失败，请重试。', response.status);
  if(remoteApi&&data.sessionToken){sessionStorage.setItem(`lab-api-${path.startsWith('admin/')?'admin':'student'}`,data.sessionToken);delete data.sessionToken;}
  if(remoteApi&&path==='admin/logout')sessionStorage.removeItem('lab-api-admin');
  return data;
}
const base64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
export async function encrypt(
  publicKey: JsonWebKey,
  data: unknown,
): Promise<Envelope> {
  const rsa = await crypto.subtle.importKey(
    'jwk',
    publicKey,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey'],
  );
  const aes = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aes,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  const key = await crypto.subtle.wrapKey('raw', aes, rsa, {
    name: 'RSA-OAEP',
  });
  return {
    key: base64(new Uint8Array(key)),
    iv: base64(iv),
    payload: base64(new Uint8Array(payload)),
  };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lab-encrypted-outbox', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('pending', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operation<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', mode);
    const request = action(tx.objectStore('pending'));
    tx.oncomplete = () => {
      resolve(request.result);
      db.close();
    };
    tx.onerror = tx.onabort = () => {
      reject(tx.error);
      db.close();
    };
  });
}
export const outbox = {
  all: () => operation('readonly', (s) => s.getAll()) as Promise<Pending[]>,
  put: (p: Pending) => operation('readwrite', (s) => s.put(p)),
  remove: (id: string) => operation('readwrite', (s) => s.delete(id)),
};
export const TASKS = [
  { id: 'flanker', name: 'Flanker', domain: '抑制控制', minutes: 5 },
  { id: 'dccs', name: 'DCCS 高级/混合版', domain: '认知灵活性', minutes: 7 },
  { id: 'mot', name: '多目标追踪 MOT', domain: '动态注意', minutes: 8 },
  { id: 'corsi', name: 'Corsi 方块敲击', domain: '视空间工作记忆', minutes: 8 },
  { id: 'tol', name: '伦敦塔', domain: '计划性问题解决', minutes: 12 },
];

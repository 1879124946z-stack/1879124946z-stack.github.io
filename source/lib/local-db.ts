import type { ExperimentRecord, StoredTask } from './models';

const DB_NAME = 'cognitive-lab-platform';
const DB_VERSION = 1;
const TASK_STORE = 'tasks';
const RECORD_STORE = 'records';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASK_STORE)) db.createObjectStore(TASK_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(RECORD_STORE)) db.createObjectStore(RECORD_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export const localDb = {
  getTasks: () => transact<StoredTask[]>(TASK_STORE, 'readonly', (store) => store.getAll()),
  saveTask: (task: StoredTask) => transact<IDBValidKey>(TASK_STORE, 'readwrite', (store) => store.put(task)),
  getRecords: () => transact<ExperimentRecord[]>(RECORD_STORE, 'readonly', (store) => store.getAll()),
  saveRecord: (record: ExperimentRecord) => transact<IDBValidKey>(RECORD_STORE, 'readwrite', (store) => store.put(record)),
  deleteRecord: (id: string) => transact<undefined>(RECORD_STORE, 'readwrite', (store) => store.delete(id)),
};

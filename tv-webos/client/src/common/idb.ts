/**
 * Minimal promise wrapper over IndexedDB.
 *
 * Stores:
 *   kv       generic key/value (session, installed apps, settings backups)
 *   files    TV-local files: { id, name, type, size, mtime, blob }
 *   appdata  per-mini-app storage: key "<appId>\u0000<key>"
 */
const DB_NAME = 'tvwebos';
const DB_VERSION = 1;
export type StoreName = 'kv' | 'files' | 'appdata';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('appdata')) db.createObjectStore('appdata');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB error'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export const idb = {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  },
  put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
  },
  delete(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<undefined> {
    return run(store, 'readwrite', (s) => s.delete(key));
  },
  getAll<T>(store: StoreName, range?: IDBKeyRange): Promise<T[]> {
    return run<T[]>(store, 'readonly', (s) => s.getAll(range) as IDBRequest<T[]>);
  },
  getAllKeys(store: StoreName, range?: IDBKeyRange): Promise<IDBValidKey[]> {
    return run(store, 'readonly', (s) => s.getAllKeys(range));
  },
  /** Rough usage / quota, when the browser reports it. */
  async estimate(): Promise<{ usage: number; quota: number } | null> {
    const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<StorageEstimate> } };
    if (!nav.storage?.estimate) return null;
    try {
      const e = await nav.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    } catch {
      return null;
    }
  },
};

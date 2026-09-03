/**
 * /admin 的本地草稿库。
 *
 * 用 IndexedDB 而不是 localStorage：草稿可能挺长（整篇 Markdown + 整份 JSON），
 * localStorage 的 5MB 配额和同步写入都不合适。
 *
 * 隐私模式 / Safari 无痕下 indexedDB.open 会失败——这种情况整模块降级到内存 Map，
 * 接口不变，调用方无感，只是草稿不会跨刷新保留。
 */

const DB_NAME = 'homepage-admin';
const STORE = 'drafts';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface Draft<T = unknown> {
  key: string;
  updatedAt: number;
  data: T;
}

const memory = new Map<string, Draft>();
let fallback = false;
let dbPromise: Promise<IDBDatabase> | null = null;

/** 是否降级到内存存储（页面顶部据此提示用户） */
export function isFallback(): boolean {
  return fallback;
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB 被其它标签页占用'));
  });
  return dbPromise;
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const req = run(transaction.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function degrade(): void {
  fallback = true;
  dbPromise = null;
}

export async function saveDraft<T>(key: string, data: T): Promise<void> {
  const draft: Draft<T> = { key, updatedAt: Date.now(), data };
  if (fallback) {
    memory.set(key, draft as Draft);
    return;
  }
  try {
    await tx('readwrite', (store) => store.put(draft) as IDBRequest<IDBValidKey>);
  } catch {
    degrade();
    memory.set(key, draft as Draft);
  }
}

export async function loadDraft<T>(key: string): Promise<Draft<T> | null> {
  if (fallback) return (memory.get(key) as Draft<T> | undefined) ?? null;
  try {
    const found = await tx<Draft<T> | undefined>('readonly', (store) => store.get(key));
    return found ?? null;
  } catch {
    degrade();
    return (memory.get(key) as Draft<T> | undefined) ?? null;
  }
}

export async function clearDraft(key: string): Promise<void> {
  memory.delete(key);
  if (fallback) return;
  try {
    await tx('readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
  } catch {
    degrade();
  }
}

/** 启动时清掉过期草稿（30 天） */
export async function pruneDrafts(): Promise<void> {
  if (fallback) return;
  try {
    const all = await tx<Draft[]>('readonly', (store) => store.getAll() as IDBRequest<Draft[]>);
    const deadline = Date.now() - MAX_AGE_MS;
    for (const draft of all) {
      if (draft.updatedAt < deadline) await clearDraft(draft.key);
    }
  } catch {
    degrade();
  }
}

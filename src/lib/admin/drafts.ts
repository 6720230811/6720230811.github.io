/**
 * /admin 的本地草稿库：IndexedDB 为主，localStorage 为镜像。
 *
 * 用 IndexedDB 而不是只靠 localStorage：草稿可能挺长（整篇 Markdown + 整份 JSON），
 * localStorage 的 5MB 配额和同步写入都不合适。
 * 但 IndexedDB 偶尔会失败（Safari 无痕、被别的标签页 upgrade 阻塞），
 * 所以每次写入都顺手往 localStorage 放一份镜像，读取时 IndexedDB 为空就拿镜像兜底。
 *
 * 两个都不可用时整模块降级到内存 Map，接口不变，调用方无感，
 * 只是草稿不会跨刷新保留。
 */

const DB_NAME = 'homepage-admin';
const STORE = 'drafts';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIRROR_PREFIX = 'admin_draft_';
/** 镜像只放小草稿：localStorage 是同步写入，塞几 MB 进去会卡住输入 */
const MIRROR_MAX_CHARS = 1_500_000;

export interface Draft<T = unknown> {
  key: string;
  updatedAt: number;
  data: T;
}

const memory = new Map<string, Draft>();
let fallback = false;
let dbPromise: Promise<IDBDatabase> | null = null;

/** 是否降级到内存存储（页面据此提示用户） */
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

// ---------------------------------------------------------------- localStorage 镜像
function writeMirror(draft: Draft): void {
  try {
    const json = JSON.stringify(draft);
    if (json.length > MIRROR_MAX_CHARS) return;
    localStorage.setItem(MIRROR_PREFIX + draft.key, json);
  } catch {
    // 配额满 / 隐私模式：镜像只是保险，丢了不影响主存储
  }
}

function readMirror<T>(key: string): Draft<T> | null {
  try {
    const raw = localStorage.getItem(MIRROR_PREFIX + key);
    return raw ? (JSON.parse(raw) as Draft<T>) : null;
  } catch {
    return null;
  }
}

function dropMirror(key: string): void {
  try {
    localStorage.removeItem(MIRROR_PREFIX + key);
  } catch {
    // 同上
  }
}

// ---------------------------------------------------------------- 对外接口
export async function saveDraft<T>(key: string, data: T): Promise<void> {
  const draft: Draft<T> = { key, updatedAt: Date.now(), data };
  if (fallback) {
    memory.set(key, draft as Draft);
    return;
  }
  writeMirror(draft as Draft);
  try {
    await tx('readwrite', (store) => store.put(draft) as IDBRequest<IDBValidKey>);
  } catch {
    degrade();
    memory.set(key, draft as Draft);
  }
}

/** 先查 IndexedDB，没有再查镜像：IndexedDB 被清掉时（比如用户清了站点数据）镜像能救回来 */
export async function loadDraft<T>(key: string): Promise<Draft<T> | null> {
  if (fallback) return (memory.get(key) as Draft<T> | undefined) ?? readMirror<T>(key);
  try {
    const found = await tx<Draft<T> | undefined>('readonly', (store) => store.get(key));
    return found ?? readMirror<T>(key);
  } catch {
    degrade();
    return (memory.get(key) as Draft<T> | undefined) ?? readMirror<T>(key);
  }
}

export async function clearDraft(key: string): Promise<void> {
  memory.delete(key);
  dropMirror(key);
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

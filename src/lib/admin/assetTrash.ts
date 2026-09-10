import { setStatus } from './dom';
import { repo } from '../../data/admin';
import { saveBase64File, GhError, type Repo } from './github';
import { loadDraft, saveDraft } from './drafts';
import { requireToken } from './token';

/**
 * 素材（配图）的「最近删除」。
 *
 * 和文章那份（trash.ts）刻意不同：图片动辄几百 KB，全存进 IndexedDB 不现实，
 * 所以只留小图：
 * - 单张超过 MAX_UNDO_BYTES 的，删除时只进清单、不进副本（界面上会说清「不可撤销」）
 * - 保留 7 天，条目封顶 40 条、总量封顶 30MB，超了从最旧的开始丢
 * 副本存的是原始 base64，还原就是原样 PUT 回去，不做二次压缩。
 */

const KEY = 'trash:assets:v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COUNT = 40;
const MAX_BYTES = 30 * 1024 * 1024;

/** 超过这个体积就不留副本了（可撤销的代价是浏览器里存一份） */
export const MAX_UNDO_BYTES = 2 * 1024 * 1024;

export interface TrashAsset {
  /** 仓库路径，如 public/illustrations/x.webp；同一张反复删只留最新一条 */
  id: string;
  path: string;
  name: string;
  size: number;
  b64: string;
  deletedAt: number;
}

interface AssetStore {
  items: TrashAsset[];
}

function totalBytes(items: TrashAsset[]): number {
  return items.reduce((sum, item) => sum + item.size, 0);
}

/** 过期 / 超量 / 超总量的清理，返回清完的列表 */
function trim(items: TrashAsset[]): TrashAsset[] {
  const deadline = Date.now() - MAX_AGE_MS;
  const kept: TrashAsset[] = [];
  for (const item of items) {
    if (item.deletedAt < deadline) continue;
    kept.push(item);
  }
  while (kept.length > MAX_COUNT || totalBytes(kept) > MAX_BYTES) kept.pop();
  return kept;
}

export async function loadAssetTrash(): Promise<TrashAsset[]> {
  const draft = await loadDraft<AssetStore>(KEY);
  const items = draft?.data?.items;
  return Array.isArray(items) ? items : [];
}

/** 启动 / 打开素材页时清一次过期的 */
export async function pruneAssetTrash(): Promise<TrashAsset[]> {
  const items = await loadAssetTrash();
  const kept = trim(items);
  if (kept.length !== items.length) await saveDraft<AssetStore>(KEY, { items: kept });
  return kept;
}

export async function pushAssetTrash(items: TrashAsset[]): Promise<void> {
  const rest = (await loadAssetTrash()).filter((old) => !items.some((it) => it.id === old.id));
  await saveDraft<AssetStore>(KEY, { items: trim([...items, ...rest]) });
}

export async function dropAssetTrash(id: string): Promise<void> {
  const items = (await loadAssetTrash()).filter((item) => item.id !== id);
  await saveDraft<AssetStore>(KEY, { items });
}

/** 还原：原样写回仓库（同名已存在会被覆盖，这里不再二次确认——是用户刚删的那张） */
export async function restoreAssetTrash(item: TrashAsset): Promise<boolean> {
  const token = requireToken();
  if (!token) return false;
  setStatus(`正在还原 ${item.name}…`, 'busy');
  try {
    await saveBase64File(repo as Repo, item.path, token, item.b64, `restore asset: ${item.name}`);
    await dropAssetTrash(item.id);
    setStatus(`已还原 ${item.name}，Actions 跑完线上就有了。`, 'ok');
    return true;
  } catch (e) {
    setStatus(`还原失败：${e instanceof GhError ? e.hint : String(e)}`, 'error');
    return false;
  }
}

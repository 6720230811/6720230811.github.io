import { $, setStatus } from './dom';
import { repo } from '../../data/admin';
import { saveFile, saveBase64File, statFile, GhError, type Repo } from './github';
import { loadDraft, saveDraft } from './drafts';
import { requireToken } from './token';

/**
 * 「最近删除」：给删除一个后悔药。
 *
 * 删文章在仓库里是一次提交，但 GitHub 上翻历史提交、把文件捞回来太麻烦，
 * 所以删之前先在本地存一份完整副本（IndexedDB，跟草稿同一套存储），
 * 侧栏列出最近 20 条，点「还原」就是重新 PUT 回去（封面也一起）。
 *
 * 只存在这台浏览器里：换台机器、清了站点数据就找不回来了——
 * 仓库本身才是真正的主副本（git 历史里还在）。
 */

const KEY = 'trash:v1';
const MAX = 20;

export interface TrashItem {
  /** `${lang}/${slug}`：同一篇反复删只会留最新一条 */
  id: string;
  lang: string;
  slug: string;
  title: string;
  /** 仓库里的路径，还原时按原路放回去 */
  path: string;
  /** 完整的 .md 原文（含 frontmatter） */
  text: string;
  deletedAt: number;
  /** 一起删掉的封面：存原始 base64，还原时原样写回 */
  cover?: { path: string; b64: string };
}

interface TrashStore {
  items: TrashItem[];
}

export const trashId = (lang: string, slug: string): string => `${lang}/${slug}`;

export async function loadTrash(): Promise<TrashItem[]> {
  const draft = await loadDraft<TrashStore>(KEY);
  const items = draft?.data?.items;
  return Array.isArray(items) ? items : [];
}

export async function pushTrash(item: TrashItem): Promise<void> {
  const rest = (await loadTrash()).filter((x) => x.id !== item.id);
  await saveDraft<TrashStore>(KEY, { items: [item, ...rest].slice(0, MAX) });
}

export async function dropTrash(id: string): Promise<void> {
  const items = (await loadTrash()).filter((x) => x.id !== id);
  await saveDraft<TrashStore>(KEY, { items });
}

/** initTrash 装好之后由它来刷新列表（删除文章后要立刻看到新条目） */
let reload: (() => Promise<void>) | null = null;

export async function refreshTrash(): Promise<void> {
  if (reload) await reload();
}

interface TrashOptions {
  /** 还原成功：调用方刷新列表（并决定是否把这篇重新载入编辑器） */
  onRestored: (item: TrashItem) => void;
}

export function initTrash(opts: TrashOptions): void {
  const box = $<HTMLDetailsElement>('trash-box');
  const listEl = $('trash-items');
  const countEl = $('trash-count');
  const emptyEl = $('trash-empty');

  let items: TrashItem[] = [];
  let busy = false;

  function time(at: number): string {
    const d = new Date(at);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  function render(): void {
    countEl.textContent = String(items.length);
    listEl.textContent = '';
    emptyEl.hidden = items.length > 0;

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'trash__item';

      const main = document.createElement('div');
      main.className = 'trash__main';
      const title = document.createElement('span');
      title.className = 'trash__title';
      title.textContent = item.title || item.slug;
      const sub = document.createElement('span');
      sub.className = 'trash__sub';
      sub.textContent = `${item.lang}/${item.slug} · ${time(item.deletedAt)}`;
      main.append(title, sub);

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'trash__btn';
      restore.dataset.act = 'restore';
      restore.dataset.id = item.id;
      restore.textContent = '还原';
      restore.disabled = busy;

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'trash__btn trash__btn--quiet';
      drop.dataset.act = 'drop';
      drop.dataset.id = item.id;
      drop.textContent = '移除';
      drop.disabled = busy;
      drop.title = '从最近删除里去掉（只是不显示，仓库里的文件不会回来）';

      li.append(main, restore, drop);
      listEl.append(li);
    }
  }

  async function reloadItems(): Promise<void> {
    items = await loadTrash();
    render();
  }
  reload = reloadItems;

  async function restore(item: TrashItem): Promise<void> {
    const token = requireToken();
    if (!token) return;

    // 同名文件可能已经存在（比如手工又建了一篇）：直接 PUT 会替掉它，先问一句
    const exists = await statFile(repo as Repo, item.path, token);
    if (exists && !window.confirm(`${item.path} 已经存在，还原会覆盖现有内容，继续吗？`)) return;

    busy = true;
    render();
    setStatus(`正在还原 ${item.slug}…`, 'busy');
    try {
      await saveFile(repo as Repo, item.path, token, item.text, `restore post: ${item.slug}`);
      if (item.cover) {
        await saveBase64File(
          repo as Repo,
          item.cover.path,
          token,
          item.cover.b64,
          `restore cover: ${item.slug}`
        );
      }
      await dropTrash(item.id);
      items = await loadTrash();
      render();
      setStatus(
        `已还原 ${item.slug}，Actions 跑完线上就回来了。${item.cover ? '封面也一起还原了。' : ''}`,
        'ok'
      );
      opts.onRestored(item);
    } catch (e) {
      const hint = e instanceof GhError ? e.hint : String(e);
      setStatus(`还原失败：${hint}`, 'error');
    } finally {
      busy = false;
      render();
    }
  }

  async function drop(item: TrashItem): Promise<void> {
    await dropTrash(item.id);
    items = await loadTrash();
    render();
  }

  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.trash__btn');
    if (!btn || busy) return;
    const item = items.find((x) => x.id === btn.dataset.id);
    if (!item) return;
    if (btn.dataset.act === 'restore') void restore(item);
    else void drop(item);
  });

  // 打开时才读一次：IndexedDB 的开销没必要在启动路径上付
  box.addEventListener('toggle', () => {
    if (box.open) void reloadItems();
  });

  void reloadItems();
}

/** 删除文章时在调用方的 catch 之外兜底：存不进去也不该影响删除本身 */
export async function rememberDeletion(item: TrashItem): Promise<void> {
  try {
    await pushTrash(item);
    await refreshTrash();
  } catch {
    setStatus('删除成功了，但本地「最近删除」记录没存下来（存储不可用）。', 'info');
  }
}

/** 供批量删除复用：把 .md 原文与封面打包成一条记录 */
export function makeTrashItem(args: {
  lang: string;
  slug: string;
  title: string;
  path: string;
  text: string;
  cover?: { path: string; b64: string };
}): TrashItem {
  return {
    id: trashId(args.lang, args.slug),
    lang: args.lang,
    slug: args.slug,
    title: args.title,
    path: args.path,
    text: args.text,
    deletedAt: Date.now(),
    ...(args.cover ? { cover: args.cover } : {}),
  };
}

import { $, setStatus, activeSection, setTopbarPath, confirmDialog } from './dom';
import { repo, paths, rawUrl } from '../../data/admin';
import { listDir, readFile, readBase64, deletePathsBatch, GhError, type Repo } from './github';
import { uploadImages, humanSize } from './upload';
import {
  loadAssetTrash,
  pruneAssetTrash,
  pushAssetTrash,
  dropAssetTrash,
  restoreAssetTrash,
  MAX_UNDO_BYTES,
  type TrashAsset,
} from './assetTrash';
import { requireToken } from './token';
import { registerShortcut } from './shortcuts';

/**
 * 「素材」分区：public/illustrations 里的配图。
 *
 * 以前这里的图只能靠「上传」写进去，看不见、删不掉、也没人知道哪张还在用。
 * 现在这里是它的目录页：
 * - 网格 + 缩略图（直连 raw.githubusercontent，刚上传的也能看）
 * - 引用扫描：把所有文章（两种语言）、画廊数据、两份 profile 的文本抓出来，
 *   看每一张图的名字有没有出现 —— 名字匹配是启发式，够用且不用建索引
 * - 批量删除走一次提交（见 deletePathsBatch），小于 2MB 的留副本可撤销 7 天
 * - 拖进来就是上传（复用文章配图那套压缩 + 写仓库）
 */

const PAGE = 60;
const CONCURRENCY = 6;

type Mode = 'all' | 'unused' | 'used';
type Sort = 'name' | 'size' | 'time';

interface AssetFile {
  name: string;
  path: string;
  size: number;
  /** null = 还没扫到 */
  refs: number | null;
}

let files: AssetFile[] = [];
const selection = new Set<string>();
/** 引用数按文件名缓存在会话里：上传 / 还原后重列目录不必把文章再读一遍 */
const refsByName = new Map<string, number>();
let mode: Mode = 'all';
let sort: Sort = 'time';
let query = '';
let page = 1;
let loaded = false;
let loading = false;
let scanning = false;
let observer: IntersectionObserver | null = null;

// ---------------------------------------------------------------- 工具
const gridEl = () => $('asset-grid');
const metaEl = () => $('asset-meta');

/** 文件名里的 `-20260910-1309` 就是上传时间（见 upload.ts 的 stamp） */
function stampOf(name: string): number {
  const m = /-(\d{8})-(\d{4})/.exec(name);
  return m ? Number(`${m[1]}${m[2]}`) : 0;
}

function sitePathOf(name: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}illustrations/${name}`;
}

function searchKey(): string {
  return query.trim().toLowerCase();
}

function filtered(): AssetFile[] {
  const key = searchKey();
  const out = files.filter((file) => {
    if (key && !file.name.toLowerCase().includes(key)) return false;
    if (mode === 'unused' && file.refs !== 0) return false;
    if (mode === 'used' && !file.refs) return false;
    return true;
  });

  out.sort((a, b) => {
    if (sort === 'size') return b.size - a.size;
    if (sort === 'name') return a.name.localeCompare(b.name);
    // 按时间倒序：文件名里没有时间戳的排最后
    return stampOf(b.name) - stampOf(a.name) || b.name.localeCompare(a.name);
  });
  return out;
}

function renderMeta(shown: number): void {
  const total = files.length;
  const scanned = files.every((f) => f.refs !== null);
  const unused = files.filter((f) => f.refs === 0).length;
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  const parts = [`共 ${total} 张`, `合计 ${humanSize(bytes)}`];
  if (scanned) parts.push(`未引用 ${unused} 张 · 占用 ${humanSize(files.filter((f) => f.refs === 0).reduce((s, f) => s + f.size, 0))}`);
  else if (scanning) parts.push('正在扫描引用…');
  if (shown !== total) parts.push(`筛出 ${shown} 张`);
  if (selection.size) parts.push(`已选 ${selection.size} 张`);
  metaEl().textContent = parts.join(' · ');
}

function paintSelection(): void {
  const deleteBtn = $<HTMLButtonElement>('asset-delete');
  const count = selection.size;
  deleteBtn.disabled = count === 0;
  deleteBtn.textContent = count ? `删除所选（${count}）` : '删除所选';

  const shown = filtered();
  const picked = shown.filter((f) => selection.has(f.name)).length;
  const all = $<HTMLInputElement>('asset-all');
  all.checked = shown.length > 0 && picked === shown.length;
  all.indeterminate = picked > 0 && picked < shown.length;
}

// ---------------------------------------------------------------- 渲染
function render(): void {
  const shown = filtered();
  const list = gridEl();
  list.textContent = '';
  const slice = shown.slice(0, page * PAGE);

  if (!files.length) {
    const empty = document.createElement('li');
    empty.className = 'assets__empty';
    empty.textContent = '这个目录还是空的：把图拖到上面，或从文章里拖图上传。';
    list.append(empty);
  } else if (!shown.length) {
    const empty = document.createElement('li');
    empty.className = 'assets__empty';
    empty.textContent = '没有符合条件的素材。';
    list.append(empty);
  }

  for (const file of slice) list.append(renderCard(file));

  $('asset-more').hidden = slice.length >= shown.length;
  renderMeta(shown.length);
  paintSelection();
}

function renderCard(file: AssetFile): HTMLElement {
  const li = document.createElement('li');
  li.className = 'asset';
  li.dataset.name = file.name;
  if (selection.has(file.name)) li.classList.add('is-picked');

  const pick = document.createElement('input');
  pick.type = 'checkbox';
  pick.className = 'asset__pick';
  pick.checked = selection.has(file.name);
  pick.dataset.act = 'pick';
  pick.setAttribute('aria-label', `选择 ${file.name}`);

  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'asset__thumb';
  thumb.dataset.act = 'copy';
  thumb.title = '点击复制 Markdown 引用';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = rawUrl(file.path);
  img.addEventListener('error', () => {
    img.remove();
    thumb.classList.add('is-broken');
    thumb.textContent = '读不到';
  });
  thumb.append(img);

  const info = document.createElement('div');
  info.className = 'asset__info';
  const name = document.createElement('span');
  name.className = 'asset__name';
  name.title = file.name;
  name.textContent = file.name;
  const sub = document.createElement('span');
  sub.className = 'asset__sub';
  const refs =
    file.refs === null
      ? '<span class="asset__ref asset__ref--scan">扫描中</span>'
      : file.refs === 0
        ? '<span class="asset__ref asset__ref--unused">未引用</span>'
        : `<span class="asset__ref">引用 ${file.refs}</span>`;
  sub.innerHTML = `<span>${humanSize(file.size)}</span>${refs}`;
  info.append(name, sub);

  const acts = document.createElement('div');
  acts.className = 'asset__acts';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'asset__act';
  copy.dataset.act = 'copy';
  copy.textContent = '复制';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'asset__act asset__act--danger';
  del.dataset.act = 'del';
  del.textContent = '删除';
  acts.append(copy, del);

  li.append(pick, thumb, info, acts);
  return li;
}

// ---------------------------------------------------------------- 载入与扫描
async function load(): Promise<void> {
  const token = requireToken();
  if (!token) return;
  loading = true;
  try {
    files = [];
    selection.clear();
    page = 1;
    metaEl().textContent = '正在读取 public/illustrations…';
    gridEl().textContent = '';

    await pruneAssetTrash();
    const entries = await listDir(repo as Repo, paths.illustrationsDir(), token);
    files = entries
      .filter((e) => e.type === 'file')
      .map((e) => ({
        name: e.name,
        path: e.path,
        size: e.size ?? 0,
        refs: refsByName.get(e.name) ?? null,
      }));

    loaded = true;
    setTopbarPath(paths.illustrationsDir());
    render();
    updateTabCount();
    void renderTrash();
    setStatus(`素材目录：${files.length} 张图。`, 'ok');
    // 只有出现了没扫过的新图才重扫（引用的文本没变，没必要反复读文章）
    if (files.some((f) => f.refs === null)) void scanRefs(token);
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    loading = false;
  }
}

/**
 * 引用扫描：把可能提到配图的文本都抓下来，看每张图的名字有没有出现。
 * 名字匹配不是 AST 级精确，但「删了会不会缺图」这个问题它答得足够好。
 */
async function scanRefs(token: string): Promise<void> {
  if (scanning || !files.length) return;
  scanning = true;
  renderMeta(filtered().length);

  try {
    const texts: string[] = [];

    for (const lang of ['zh', 'en'] as const) {
      const entries = await listDir(repo as Repo, paths.postsDir(lang), token);
      const slugs = entries
        .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
      for (let i = 0; i < slugs.length; i += CONCURRENCY) {
        const batch = slugs.slice(i, i + CONCURRENCY);
        const bodies = await Promise.all(
          batch.map(async (slug) => {
            const file = await readFile(repo as Repo, paths.post(lang, slug), token);
            return file?.text ?? '';
          })
        );
        texts.push(...bodies);
      }
      renderMeta(filtered().length);
    }

    for (const path of [paths.gallery(), paths.profile('zh'), paths.profile('en')]) {
      const file = await readFile(repo as Repo, path, token);
      if (file) texts.push(file.text);
    }

    for (const file of files) {
      let count = 0;
      for (const text of texts) if (text.includes(file.name)) count += 1;
      file.refs = count;
      refsByName.set(file.name, count);
    }

    render();
    const unused = files.filter((f) => f.refs === 0).length;
    setStatus(
      unused
        ? `扫描完成：${unused} 张没有被任何文章 / 画廊 / 资料引用。`
        : '扫描完成：所有素材都在被引用。',
      'ok'
    );
  } catch (e) {
    setStatus(`引用扫描中断：${e instanceof GhError ? e.hint : String(e)}`, 'info');
  } finally {
    scanning = false;
    renderMeta(filtered().length);
  }
}

// ---------------------------------------------------------------- 复制
async function copyMarkdown(name: string): Promise<void> {
  const snippet = `![](${sitePathOf(name)})`;
  try {
    await navigator.clipboard.writeText(snippet);
    setStatus(`已复制：${snippet}`, 'ok');
  } catch {
    setStatus(`浏览器不让写剪贴板，手动复制：${snippet}`, 'info');
  }
}

// ---------------------------------------------------------------- 删除
async function remove(names: string[]): Promise<void> {
  const token = requireToken();
  if (!token || !names.length) return;

  const targets = files.filter((f) => names.includes(f.name));
  if (!targets.length) return;
  const bytes = targets.reduce((sum, f) => sum + f.size, 0);
  const undoable = targets.filter((f) => f.size <= MAX_UNDO_BYTES);
  const tooBig = targets.length - undoable.length;
  const stillUsed = targets.filter((f) => f.refs !== null && f.refs > 0).length;

  const lines = [
    `合计 ${humanSize(bytes)}。这一次会合并成一条提交。`,
    undoable.length
      ? `其中 ${undoable.length} 张会留本地副本，7 天内可撤销。`
      : '没有可撤销的副本（都超过体积上限）。',
    tooBig ? `另外 ${tooBig} 张超过 ${humanSize(MAX_UNDO_BYTES)}，删除后无法撤销。` : '',
    stillUsed ? `注意：有 ${stillUsed} 张仍被引用，删掉后线上会缺图。` : '',
  ].filter(Boolean);
  const ok = await confirmDialog({
    title: `删除 ${targets.length} 张图？`,
    body: lines.join('\n'),
    okLabel: '删除',
  });
  if (!ok) return;

  setStatus(`正在读取 ${targets.length} 张图…`, 'busy');
  try {
    // 先取原始 base64：小图留副本（撤销用），大图只拿体积信息不占内存
    const copies: TrashAsset[] = [];
    for (const file of undoable) {
      const raw = await readBase64(repo as Repo, file.path, token);
      if (!raw) continue;
      copies.push({
        id: file.path,
        path: file.path,
        name: file.name,
        size: file.size || Math.round((raw.b64.length * 3) / 4),
        b64: raw.b64,
        deletedAt: Date.now(),
      });
    }

    setStatus(`正在删除 ${targets.length} 张（一次提交）…`, 'busy');
    await deletePathsBatch(
      repo as Repo,
      targets.map((f) => f.path),
      token,
      `delete assets: ${targets.length} file(s)`
    );
    if (copies.length) await pushAssetTrash(copies);

    for (const file of targets) selection.delete(file.name);
    files = files.filter((f) => !names.includes(f.name));
    render();
    void renderTrash();
    updateTabCount();

    setStatus(
      `已删除 ${targets.length} 张图${copies.length ? `，${copies.length} 张可撤销` : ''}。`,
      'ok',
      copies.length
        ? {
            label: '撤销删除',
            run: () => {
              void (async () => {
                for (const copy of copies) await restoreAssetTrash(copy);
                await refreshTrashAndList();
              })();
            },
          }
        : undefined
    );
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : `删除失败：${(e as Error).message}`, 'error');
  }
}

// ---------------------------------------------------------------- 回收站
async function renderTrash(): Promise<void> {
  const box = $<HTMLDetailsElement>('asset-trash');
  const list = $('asset-trash-list');
  const items = await loadAssetTrash();
  $('asset-trash-count').textContent = String(items.length);
  box.hidden = items.length === 0;
  list.textContent = '';

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'assets__trash-item';
    li.dataset.id = item.id;

    const name = document.createElement('span');
    name.className = 'assets__trash-name';
    name.title = item.name;
    name.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'assets__trash-meta';
    const days = Math.max(0, 7 - Math.floor((Date.now() - item.deletedAt) / 86400000));
    meta.textContent = `${humanSize(item.size)} · 还能还原 ${days} 天`;

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn--xs';
    back.dataset.act = 'restore';
    back.textContent = '还原';

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'btn btn--xs btn--ghost';
    drop.dataset.act = 'drop';
    drop.textContent = '移除';

    li.append(name, meta, back, drop);
    list.append(li);
  }
}

async function refreshTrashAndList(): Promise<void> {
  await renderTrash();
  updateTabCount();
  await load();
}

function updateTabCount(): void {
  const el = document.getElementById('asset-count');
  if (!el) return;
  el.hidden = !files.length;
  el.textContent = String(files.length);
}

// ---------------------------------------------------------------- 入口
export function initAssets(): void {
  $('asset-reload').addEventListener('click', () => void load());

  const fileInput = $<HTMLInputElement>('asset-file');
  const drop = $('asset-drop');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    void uploadAndReload(fileInput.files);
    fileInput.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-dropping');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dropping'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dropping');
    void uploadAndReload(e.dataTransfer?.files ?? null);
  });

  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-asset-mode]'))) {
    btn.addEventListener('click', () => {
      mode = (btn.dataset.assetMode ?? 'all') as Mode;
      for (const other of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-asset-mode]'))) {
        other.setAttribute('aria-pressed', String(other === btn));
      }
      page = 1;
      render();
    });
  }

  $<HTMLInputElement>('asset-filter').addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value;
    page = 1;
    render();
  });

  $<HTMLSelectElement>('asset-sort').addEventListener('change', (e) => {
    sort = (e.target as HTMLSelectElement).value as Sort;
    page = 1;
    render();
  });

  $<HTMLInputElement>('asset-all').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    for (const file of filtered()) {
      if (on) selection.add(file.name);
      else selection.delete(file.name);
    }
    render();
  });

  $('asset-delete').addEventListener('click', () => void remove(Array.from(selection)));

  gridEl().addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]');
    if (act) {
      const name = (act.closest<HTMLElement>('.asset')?.dataset.name ?? '');
      if (!name) return;
      if (act.dataset.act === 'copy') void copyMarkdown(name);
      if (act.dataset.act === 'del') void remove([name]);
      return;
    }
  });

  gridEl().addEventListener('change', (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.dataset.act !== 'pick') return;
    const name = box.closest<HTMLElement>('.asset')?.dataset.name ?? '';
    if (!name) return;
    if (box.checked) selection.add(name);
    else selection.delete(name);
    box.closest('.asset')?.classList.toggle('is-picked', box.checked);
    paintSelection();
  });

  $('asset-trash-list').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    const id = btn?.closest<HTMLElement>('.assets__trash-item')?.dataset.id;
    if (!btn || !id) return;
    void (async () => {
      if (btn.dataset.act === 'restore') {
        const items = await loadAssetTrash();
        const item = items.find((it) => it.id === id);
        if (item) await restoreAssetTrash(item);
      } else {
        await dropAssetTrash(id);
      }
      await refreshTrashAndList();
    })();
  });

  // 触底加载下一批
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (filtered().length <= page * PAGE) return;
    page += 1;
    render();
  });
  observer.observe($('asset-more'));

  registerShortcut({
    keys: 'mod+shift+a',
    label: '打开素材',
    group: '导航',
    allowInInput: true,
    run: () => document.querySelector<HTMLButtonElement>('.sidebar__tab[data-tab="assets"]')?.click(),
  });

  document.addEventListener('admin:section', (e) => {
    if ((e as CustomEvent<string>).detail === 'assets') ensureAssetsLoaded();
  });
  if (activeSection() === 'assets') ensureAssetsLoaded();
}

async function uploadAndReload(list: FileList | null): Promise<void> {
  const images = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    if (list?.length) setStatus('这里只收图片。', 'error');
    return;
  }
  const urls = await uploadImages(images, 'asset');
  if (!urls.length) return;
  // 刚上传的图一定还没被引用：先记上 0，省掉一次全量重扫
  for (const url of urls) refsByName.set(url.split('/').pop() ?? url, 0);
  await refreshTrashAndList();
  setStatus(`已上传 ${urls.length} 张，Actions 跑完线上生效（列表里已经能看到）。`, 'ok');
}

/** 打开分区时按需载入，并把回收站一起刷出来 */
export function ensureAssetsLoaded(): void {
  if (loading) return;
  if (!requireToken()) return;
  if (loaded) {
    void renderTrash();
    return;
  }
  void load();
}

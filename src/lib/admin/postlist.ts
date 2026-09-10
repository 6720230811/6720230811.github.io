import { $, setStatus, confirmDialog } from './dom';
import { repo, paths, rawUrl } from '../../data/admin';
import { readFile, listDir, GhError, type Repo } from './github';
import { site } from '../../data/admin';
import { isDirty } from './unsaved';
import { parsePostFile } from './serialize';
import { exportPosts, type BulkAction } from './bulk';
import { resolveCoverFields } from '../cover';
import { buildZip, downloadBlob } from './zip';
import { requireToken } from './token';

/**
 * 左侧的文章列表。
 *
 * GitHub 列目录只给文件名，标题 / 日期 / 分类 / 草稿要逐篇读文件才知道，
 * 所以并发读一批（6 个一组）。文章多了要控制请求量：
 * 超过 MAX_INDEX 篇或撞上限流就退化成只列文件名，并在列表下方说明。
 *
 * 为了不让列表空着，做了三层兜底：
 *   本地缓存先画（秒开）→ 目录列出来就铺骨架 → 每读完一批就往上填
 */

const CONCURRENCY = 6;
const MAX_INDEX = 60;
const CACHE_VERSION = 1;

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  updated: string;
  category: string;
  tags: string[];
  draft: boolean;
  /** 还没读到的条目（骨架/渐进填充时用），不是「读失败」 */
  pending?: boolean;
  /** 没能读到内容（限流或文章过多）：只有文件名，标题就用 slug */
  metaOnly: boolean;
  /** 封面或正文首图的站内地址，列表里当缩略图用 */
  thumb?: string;
}

/** 缩略图直连仓库原文：不必等 Actions 部署，刚上传的图也能看到 */
function thumbSrc(src: string): string {
  if (/^(?:https?:)?\/\//i.test(src)) return src;
  const base = import.meta.env.BASE_URL || '/';
  const path = src.startsWith(base) ? src.slice(base.length) : src.replace(/^\/+/, '');
  return rawUrl(`public/${path}`);
}

interface IndexCache {
  v: number;
  at: number;
  items: PostMeta[];
}

function readCache(lang: string): PostMeta[] | null {
  try {
    const raw = localStorage.getItem(`post_index:${lang}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IndexCache;
    if (parsed?.v !== CACHE_VERSION || !Array.isArray(parsed.items) || !parsed.items.length) {
      return null;
    }
    return parsed.items;
  } catch {
    return null;
  }
}

function writeCache(lang: string, items: PostMeta[]): void {
  try {
    localStorage.setItem(
      `post_index:${lang}`,
      JSON.stringify({ v: CACHE_VERSION, at: Date.now(), items } satisfies IndexCache)
    );
  } catch {
    // 隐私模式 / 配额满：缓存只是加速，没有也能用
  }
}

export interface PostIndex {
  items: PostMeta[];
  /** 退化成只列文件名 */
  degraded: boolean;
}

export interface IndexHooks {
  /** 目录刚列出来（还不知道每篇写了什么）：列表可以先把骨架铺上 */
  onSlugs?: (slugs: string[]) => void;
  /** 每读完一批：把「已经拿到的」交出去，列表可以边读边填 */
  onProgress?: (items: PostMeta[]) => void;
}

export async function buildIndex(
  lang: string,
  token: string,
  hooks: IndexHooks = {}
): Promise<PostIndex> {
  const entries = await listDir(repo as Repo, paths.postsDir(lang), token);
  const slugs = entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
    .sort();

  const indexed = slugs.slice(0, MAX_INDEX);
  hooks.onSlugs?.(indexed);

  const items: PostMeta[] = [];
  let degraded = slugs.length > indexed.length;

  for (let i = 0; i < indexed.length; i += CONCURRENCY) {
    const batch = indexed.slice(i, i + CONCURRENCY);
    const done = await Promise.all(
      batch.map(async (slug): Promise<PostMeta> => {
        try {
          const file = await readFile(repo as Repo, paths.post(lang, slug), token);
          if (!file) return { slug, title: slug, date: '', updated: '', category: '', tags: [], draft: false, metaOnly: true };
          const parsed = parsePostFile(file.text);
          const cover = resolveCoverFields(parsed.data.cover, parsed.body);
          return {
            slug,
            title: parsed.data.title || slug,
            date: parsed.data.date,
            updated: parsed.data.updated ?? '',
            category: parsed.data.category,
            tags: parsed.data.tags,
            draft: parsed.data.draft,
            metaOnly: false,
            ...(cover ? { thumb: cover.src } : {}),
          };
        } catch (e) {
          // 单篇失败不拖垮整份列表；撞限流就整体退化为只列文件名
          if (e instanceof GhError && (e.status === 403 || e.status === 429)) degraded = true;
          return { slug, title: slug, date: '', updated: '', category: '', tags: [], draft: false, metaOnly: true };
        }
      })
    );
    items.push(...done);
    hooks.onProgress?.([...items]);
  }

  items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
  return { items, degraded };
}

export interface PostList {
  rebuild: (lang: string, token: string) => Promise<void>;
  setActive: (slug: string) => void;
  slugs: () => string[];
  /** 当前勾选的文章（批量操作用） */
  selection: () => string[];
  clearSelection: () => void;
}

/**
 * 列表 + 筛选器 + 多选批量操作。
 * 批量操作只负责「收集选中 + 弹确认」，真正写仓库的活交给外部（post.ts），
 * 那边才有发布面板与列表刷新。
 */
export function initPostList(
  onPick: (slug: string) => void,
  opts: { onBulk?: (slugs: string[], action: BulkAction) => void | Promise<void> } = {}
): PostList {
  const listEl = $('post-items');
  const filterEl = $<HTMLInputElement>('post-filter');
  const metaEl = $('post-list-meta');
  const newBtn = $('post-new');
  const countEl = $('post-count');
  const categoryEl = $<HTMLSelectElement>('filter-category');
  const tagEl = $<HTMLSelectElement>('filter-tag');
  const statusEl = $<HTMLSelectElement>('filter-status');
  const sortEl = $<HTMLSelectElement>('filter-sort');

  // 批量操作条
  const bulkAll = $<HTMLInputElement>('bulk-all');
  const bulkCount = $('bulk-count');
  const bulkClear = $<HTMLButtonElement>('bulk-clear');
  const bulkCategory = $<HTMLInputElement>('bulk-category');
  const setCategory = $<HTMLButtonElement>('bulk-set-category');
  const toDraft = $<HTMLButtonElement>('bulk-draft');
  const toPublished = $<HTMLButtonElement>('bulk-publish');
  const bulkDelete = $<HTMLButtonElement>('bulk-delete');
  const bulkCover = $<HTMLInputElement>('bulk-cover');
  const bulkTag = $<HTMLInputElement>('bulk-tag');
  const tagAdd = $<HTMLButtonElement>('bulk-tag-add');
  const tagRemove = $<HTMLButtonElement>('bulk-tag-remove');
  const bulkTransfer = $<HTMLButtonElement>('bulk-transfer');
  const bulkExport = $<HTMLButtonElement>('bulk-export');
  const bulkBtns = [
    setCategory,
    toDraft,
    toPublished,
    bulkDelete,
    tagAdd,
    tagRemove,
    bulkTransfer,
    bulkExport,
  ];

  let items: PostMeta[] = [];
  let active = '';
  /** 勾选的文章：按 slug 存，筛选/排序/重渲染都不影响 */
  const selected = new Set<string>();
  let bulkBusy = false;
  /** 当前语言：给列表里的「打开线上文章」拼地址用 */
  let lang = 'zh';

  function fillFilters(): void {
    const categories = new Set<string>();
    const tags = new Set<string>();
    for (const item of items) {
      if (item.category) categories.add(item.category);
      for (const tag of item.tags) tags.add(tag);
    }

    const refill = (el: HTMLSelectElement, values: Set<string>, all: string) => {
      const keep = el.value;
      el.textContent = '';
      const first = document.createElement('option');
      first.value = '';
      first.textContent = all;
      el.append(first);
      for (const value of Array.from(values).sort((a, b) => a.localeCompare(b, 'zh'))) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        el.append(opt);
      }
      el.value = values.has(keep) ? keep : '';
    };

    refill(categoryEl, categories, '全部分类');
    refill(tagEl, tags, '全部标签');
  }

  const visible = (): PostMeta[] => {
    const key = filterEl.value.trim().toLowerCase();
    const category = categoryEl.value;
    const tag = tagEl.value;
    const status = statusEl.value;

    const out = items.filter((item) => {
      if (key && !`${item.title} ${item.slug}`.toLowerCase().includes(key)) return false;
      if (category && item.category !== category) return false;
      if (tag && !item.tags.includes(tag)) return false;
      if (status === 'draft' && !item.draft) return false;
      if (status === 'published' && item.draft) return false;
      return true;
    });

    // 排序只影响显示顺序，不动 items 本身（active / 计数都还按原列表）
    const byDate = (a: PostMeta, b: PostMeta) => (b.date || '').localeCompare(a.date || '');
    if (sortEl.value === 'title') out.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    else if (sortEl.value === 'updated')
      out.sort((a, b) => (b.updated || b.date || '').localeCompare(a.updated || a.date || ''));
    else out.sort(byDate);
    return out;
  };

  /** 批量条：数量、按钮可用状态、全选框的三态都跟着选中集合走 */
  function renderSelection(): void {
    const shown = visible();
    const n = selected.size;
    bulkCount.textContent = n ? `已选 ${n} 篇` : '批量操作';
    for (const btn of bulkBtns) btn.disabled = bulkBusy || n === 0;
    bulkClear.hidden = n === 0;
    bulkCategory.disabled = bulkBusy || n === 0;
    bulkTag.disabled = bulkBusy || n === 0;

    const picked = shown.filter((item) => selected.has(item.slug)).length;
    bulkAll.checked = shown.length > 0 && picked === shown.length;
    bulkAll.indeterminate = picked > 0 && picked < shown.length;
  }

  /** 读文件期间的骨架行：让「还没到」看起来是在加载，而不是没有内容 */
  function renderPlaceholders(count: number): void {
    listEl.textContent = '';
    countEl.textContent = '…';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i += 1) {
      const li = document.createElement('li');
      li.className = 'pcard-sk';
      li.style.setProperty('--sk-delay', `${(i % 6) * 90}ms`);
      li.innerHTML =
        '<span class="pcard-sk__thumb"></span><span class="pcard-sk__body"><i></i><i></i><i></i></span>';
      frag.append(li);
    }
    listEl.append(frag);
    renderSelection();
  }

  function render(): void {
    const shown = visible();
    listEl.textContent = '';
    countEl.textContent = String(items.length);

    const frag = document.createDocumentFragment();
    for (const item of shown) {
      const li = document.createElement('li');
      const picked = selected.has(item.slug);
      li.classList.toggle('is-picked', picked);

      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'pcard__pick';
      pick.checked = picked;
      pick.dataset.slug = item.slug;
      pick.setAttribute('aria-label', `选择 ${item.title}`);
      pick.title = '选中后可批量改分类 / 转草稿 / 删除';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pcard';
      btn.dataset.slug = item.slug;
      if (item.slug === active) btn.setAttribute('aria-current', 'true');

      const title = document.createElement('span');
      title.className = 'pcard__title';
      title.textContent = item.title;

      const sub = document.createElement('span');
      sub.className = 'pcard__sub';
      sub.textContent = item.slug;

      const foot = document.createElement('span');
      foot.className = 'pcard__foot';
      const when = document.createElement('time');
      when.textContent = (item.updated || item.date || '').replace(/^\d{4}-/, '').replace(/-/g, '/');
      foot.append(when);
      if (item.category) {
        const cat = document.createElement('span');
        cat.className = 'pcard__cat';
        cat.textContent = item.category;
        foot.append(cat);
      }
      if (item.draft) {
        const tag = document.createElement('span');
        tag.className = 'pcard__draft';
        tag.textContent = '草稿';
        foot.append(tag);
      } else if (!item.metaOnly) {
        const tag = document.createElement('span');
        tag.className = 'pcard__live';
        tag.textContent = '已发布';
        foot.append(tag);
      }

      if (item.thumb) {
        const img = document.createElement('img');
        img.className = 'pcard__thumb';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        img.src = thumbSrc(item.thumb);
        // 仓库私有、外链失效、图还没提交：退化成没有缩略图，不留破图
        img.addEventListener('error', () => img.remove());
        btn.append(img);
      }

      const body = document.createElement('span');
      body.className = 'pcard__body';
      body.append(title, sub, foot);
      btn.append(body);

      // 行内快捷操作：悬停/聚焦才显形，免得平时刷屏
      const acts = document.createElement('span');
      acts.className = 'pcard__acts';
      acts.dataset.slug = item.slug;

      if (!item.draft && !item.metaOnly) {
        const open = document.createElement('a');
        open.className = 'pcard__act';
        open.href = site.post(lang, item.slug);
        open.target = '_blank';
        open.rel = 'noreferrer';
        open.title = '打开线上文章';
        open.textContent = '↗';
        acts.append(open);
      }

      const act = (name: string, label: string, title: string, danger = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `pcard__act${danger ? ' pcard__act--danger' : ''}`;
        button.dataset.act = name;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.textContent = label;
        return button;
      };

      acts.append(
        act('copy', '⧉', '复制线上链接'),
        act('flip', item.draft ? '◑' : '◐', item.draft ? '转为已发布' : '转为草稿'),
        act('kill', '✕', '删除这篇', true)
      );

      li.append(pick, btn, acts);

      frag.append(li);
    }

    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'pcard-empty';
      if (items.length) {
        li.textContent = '没有匹配的文章';
      } else {
        // 首次进来（或文章被清空）时给一张三步上手卡，比「还没有文章」有用
        li.innerHTML = `
          <div class="guide">
            <p class="guide__title">还没有文章</p>
            <ol class="guide__steps">
              <li>左下角配好 GitHub Token（Contents 读写权限）</li>
              <li>点「新建文章」开始写，右侧检查器填分类与封面</li>
              <li>配图直接拖进正文，自动压 WebP 并写进仓库</li>
            </ol>
            <p class="guide__foot">⌘S 发布 · ⌘⇧D 与仓库对比 · ? 看全部快捷键</p>
          </div>
        `;
      }
      frag.append(li);
    }

    listEl.append(frag);
    metaEl.textContent = items.length
      ? `共 ${items.length} 篇${shown.length !== items.length ? `，筛出 ${shown.length} 篇` : ''}`
      : '';
    renderSelection();
  }

  // 勾选框：只更新自己那一行与批量条，不整表重渲染（否则键盘勾选会丢焦点）
  listEl.addEventListener('change', (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || !box.classList.contains('pcard__pick')) return;
    const slug = box.dataset.slug ?? '';
    if (box.checked) selected.add(slug);
    else selected.delete(slug);
    (box.closest('li') as HTMLElement | null)?.classList.toggle('is-picked', box.checked);
    renderSelection();
  });

  bulkAll.addEventListener('change', () => {
    const shown = visible();
    for (const item of shown) {
      if (bulkAll.checked) selected.add(item.slug);
      else selected.delete(item.slug);
    }
    render();
  });

  bulkClear.addEventListener('click', () => {
    selected.clear();
    render();
  });

  const picked = (): string[] => Array.from(selected);

  setCategory.addEventListener('click', () => {
    if (!selected.size) return;
    const value = bulkCategory.value.trim();
    if (!value && !window.confirm('分类留空 = 清空这些文章的分类，继续吗？')) return;
    dispatch(picked(), { kind: 'category', value });
  });
  toDraft.addEventListener('click', () => dispatch(picked(), { kind: 'draft', value: true }));
  toPublished.addEventListener('click', () => dispatch(picked(), { kind: 'draft', value: false }));
  bulkDelete.addEventListener('click', () => {
    const slugs = picked();
    if (!slugs.length) return;
    const withCover = bulkCover.checked;
    const preview = slugs.slice(0, 6).join('\n');
    const more = slugs.length > 6 ? `\n… 等 ${slugs.length} 篇` : '';
    void confirmDialog({
      title: `删除 ${slugs.length} 篇文章？`,
      body: `${preview}${more}\n\n仓库里的这些文件会被删掉${withCover ? '，站内封面也一起删' : ''}。删除记录会留在「最近删除」里 7 天内可还原。`,
      okLabel: '删除',
    }).then((ok) => {
      if (ok) dispatch(slugs, { kind: 'delete', cover: withCover });
    });
  });

  // 改标签：留空即忽略，逗号 / 空格 / 回车都能分隔
  const tagList = () =>
    bulkTag.value
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

  tagAdd.addEventListener('click', () => {
    const add = tagList();
    if (!selected.size || !add.length) return;
    dispatch(picked(), { kind: 'tags', add, remove: [] });
    bulkTag.value = '';
  });

  tagRemove.addEventListener('click', () => {
    const remove = tagList();
    if (!selected.size || !remove.length) return;
    dispatch(picked(), { kind: 'tags', add: [], remove });
    bulkTag.value = '';
  });

  bulkTransfer.addEventListener('click', () => {
    const slugs = picked();
    if (!slugs.length) return;
    const to = lang === 'zh' ? 'en' : 'zh';
    void confirmDialog({
      title: `把 ${slugs.length} 篇复制到${to === 'en' ? '英文' : '中文'}目录？`,
      body: `原文件保留不动，另存一份到 src/content/posts/${to}/。\n目标目录里已有同名的会被跳过（不会覆盖）。\n复制过去的是原文，译文需要你自己改。`,
      okLabel: '复制',
      danger: false,
    }).then((ok) => {
      if (ok) dispatch(slugs, { kind: 'transfer', to });
    });
  });

  bulkExport.addEventListener('click', () => {
    const slugs = picked();
    if (!slugs.length) return;
    const token = requireToken();
    if (!token) return;
    void (async () => {
      setStatus(`正在读取 ${slugs.length} 篇文章…`, 'busy');
      try {
        const files = await exportPosts(lang, slugs, token);
        if (!files.length) {
          setStatus('一篇都没读到，导出取消。', 'error');
          return;
        }
        const stamp = new Date().toISOString().slice(0, 10);
        downloadBlob(buildZip(files), `posts-${lang}-${files.length}-${stamp}.zip`);
        setStatus(`已导出 ${files.length} 篇 Markdown。`, 'ok');
      } catch (e) {
        setStatus(e instanceof GhError ? e.hint : `导出失败：${(e as Error).message}`, 'error');
      }
    })();
  });

  // 行内快捷操作（悬停出现的小按钮）
  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.pcard__act');
    if (!btn || btn.tagName === 'A') return;
    const slug = btn.closest<HTMLElement>('.pcard__acts')?.dataset.slug ?? '';
    if (!slug) return;
    e.stopPropagation();

    if (btn.dataset.act === 'copy') {
      const url = site.post(lang, slug);
      void navigator.clipboard
        ?.writeText(url)
        .then(() => setStatus(`已复制：${url}`, 'ok'))
        .catch(() => setStatus(`浏览器不让写剪贴板：${url}`, 'info'));
      return;
    }

    const item = items.find((it) => it.slug === slug);
    if (btn.dataset.act === 'flip' && item) {
      dispatch([slug], { kind: 'draft', value: !item.draft });
      return;
    }
    if (btn.dataset.act === 'kill') {
      void confirmDialog({
        title: `删除「${item?.title || slug}」？`,
        body: `src/content/posts/${lang}/${slug}.md 会被删掉${bulkCover.checked ? '，站内封面也一起删' : ''}。\n删除记录会留在「最近删除」里，7 天内可还原。`,
        okLabel: '删除',
      }).then((ok) => {
        if (ok) dispatch([slug], { kind: 'delete', cover: bulkCover.checked });
      });
    }
  });

  /** 批量执行期间锁住按钮：连点会排出两批任务 */
  function setBulkBusy(on: boolean): void {
    bulkBusy = on;
    renderSelection();
  }

  function dispatch(slugs: string[], action: BulkAction): void {
    if (!slugs.length || !opts.onBulk) return;
    setBulkBusy(true);
    void Promise.resolve(opts.onBulk(slugs, action)).finally(() => setBulkBusy(false));
  }

  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pcard');
    if (!btn) return;
    // 切换文章等于丢掉当前编辑的内容，先问一句
    if (isDirty() && !window.confirm('有未保存的改动，切换文章会丢掉，继续吗？')) return;
    onPick(btn.dataset.slug ?? '');
  });

  filterEl.addEventListener('input', render);
  categoryEl.addEventListener('change', render);
  tagEl.addEventListener('change', render);
  statusEl.addEventListener('change', render);
  sortEl.addEventListener('change', render);

  newBtn.addEventListener('click', () => {
    if (isDirty() && !window.confirm('有未保存的改动，新建会清空当前编辑的内容，继续吗？')) return;
    filterEl.value = '';
    onPick('');
  });

  return {
    async rebuild(nextLang: string, token: string) {
      // 换语言 = 换一批文件，勾选留着会误伤到另一语言的同名文章
      if (nextLang !== lang) selected.clear();
      lang = nextLang;
      // 「复制到另一语言」的目标跟着当前语言走
      bulkTransfer.textContent = lang === 'zh' ? '复制到 English' : '复制到中文';

      // 先拿上次的结果顶上：换分区、刷新页面都是秒开，随后静默更新
      const cached = readCache(nextLang);
      if (cached) {
        items = cached;
        fillFilters();
        render();
        metaEl.textContent = `共 ${items.length} 篇 · 正在更新…`;
      } else {
        items = [];
        renderPlaceholders(0);
        metaEl.textContent = '正在读取文章…';
      }

      // 没有缓存时才边读边填（有缓存就别让列表中途自己跳一下）
      const progressive = !cached;
      const index = await buildIndex(nextLang, token, {
        onSlugs: (slugs) => {
          if (!progressive) return;
          renderPlaceholders(slugs.length);
          metaEl.textContent = `正在读取 ${slugs.length} 篇…`;
        },
        onProgress: (partial) => {
          if (!progressive) return;
          items = partial;
          render();
        },
      });

      items = index.items;
      // 已经被删掉的文章不该还留在勾选里
      const alive = new Set(items.map((item) => item.slug));
      for (const slug of Array.from(selected)) if (!alive.has(slug)) selected.delete(slug);
      fillFilters();
      render();
      writeCache(nextLang, index.items);
      setStatus(
        index.degraded
          ? '文章较多或撞上限流，列表只显示文件名（标题与日期要逐篇读取）。'
          : `已载入 ${items.length} 篇文章。`,
        index.degraded ? 'info' : 'ok'
      );
    },
    setActive(slug: string) {
      active = slug;
      render();
    },
    slugs: () => items.map((item) => item.slug),
    selection: () => Array.from(selected),
    clearSelection() {
      selected.clear();
      render();
    },
  };
}

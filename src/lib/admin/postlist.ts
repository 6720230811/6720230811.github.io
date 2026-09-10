import { $, setStatus } from './dom';
import { repo, paths } from '../../data/admin';
import { readFile, listDir, GhError, type Repo } from './github';
import { site } from '../../data/admin';
import { isDirty } from './unsaved';
import { parsePostFile } from './serialize';
import type { BulkAction } from './bulk';

/**
 * 左侧的文章列表。
 *
 * GitHub 列目录只给文件名，标题 / 日期 / 分类 / 草稿要逐篇读文件才知道，
 * 所以并发读一批（6 个一组）。文章多了要控制请求量：
 * 超过 MAX_INDEX 篇或撞上限流就退化成只列文件名，并在列表下方说明。
 */

const CONCURRENCY = 6;
const MAX_INDEX = 60;

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  updated: string;
  category: string;
  tags: string[];
  draft: boolean;
  /** 没能读到内容（限流或文章过多）：只有文件名，标题就用 slug */
  metaOnly: boolean;
}

export interface PostIndex {
  items: PostMeta[];
  /** 退化成只列文件名 */
  degraded: boolean;
}

export async function buildIndex(lang: string, token: string): Promise<PostIndex> {
  const entries = await listDir(repo as Repo, paths.postsDir(lang), token);
  const slugs = entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
    .sort();

  const indexed = slugs.slice(0, MAX_INDEX);
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
          return {
            slug,
            title: parsed.data.title || slug,
            date: parsed.data.date,
            updated: parsed.data.updated ?? '',
            category: parsed.data.category,
            tags: parsed.data.tags,
            draft: parsed.data.draft,
            metaOnly: false,
          };
        } catch (e) {
          // 单篇失败不拖垮整份列表；撞限流就整体退化为只列文件名
          if (e instanceof GhError && (e.status === 403 || e.status === 429)) degraded = true;
          return { slug, title: slug, date: '', updated: '', category: '', tags: [], draft: false, metaOnly: true };
        }
      })
    );
    items.push(...done);
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
  const bulkBtns = [setCategory, toDraft, toPublished, bulkDelete];

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

    const picked = shown.filter((item) => selected.has(item.slug)).length;
    bulkAll.checked = shown.length > 0 && picked === shown.length;
    bulkAll.indeterminate = picked > 0 && picked < shown.length;
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

      btn.append(title, sub, foot);
      li.append(pick, btn);

      // 已发布的文章给一个直达线上的入口；草稿没有线上页面，不给
      if (!item.draft && !item.metaOnly) {
        const link = document.createElement('a');
        link.className = 'pcard__link';
        link.href = site.post(lang, item.slug);
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.title = '打开线上文章';
        link.textContent = '↗';
        li.append(link);
      }

      frag.append(li);
    }

    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'pcard-empty';
      li.textContent = items.length ? '没有匹配的文章' : '还没有文章';
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
    const preview = slugs.slice(0, 8).join('、');
    const more = slugs.length > 8 ? ` 等 ${slugs.length} 篇` : '';
    if (
      !window.confirm(
        `删除这 ${slugs.length} 篇文章？\n${preview}${more}\n仓库里的这些文件会被删掉${withCover ? '，站内封面也一起删' : ''}，删除记录会留在「最近删除」里。`
      )
    ) {
      return;
    }
    dispatch(slugs, { kind: 'delete', cover: withCover });
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
      const index = await buildIndex(nextLang, token);
      items = index.items;
      // 已经被删掉的文章不该还留在勾选里
      const alive = new Set(items.map((item) => item.slug));
      for (const slug of Array.from(selected)) if (!alive.has(slug)) selected.delete(slug);
      fillFilters();
      render();
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

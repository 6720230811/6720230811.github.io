import { $, setStatus } from './dom';
import { repo, paths } from '../../data/admin';
import { readFile, listDir, GhError, type Repo } from './github';
import { site } from '../../data/admin';
import { isDirty } from './unsaved';
import { parsePostFile } from './serialize';

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
}

/** 列表 + 三个筛选器（分类 / 标签 / 状态）。选中与载入由 onPick 回调出去 */
export function initPostList(onPick: (slug: string) => void): PostList {
  const listEl = $('post-items');
  const filterEl = $<HTMLInputElement>('post-filter');
  const metaEl = $('post-list-meta');
  const newBtn = $('post-new');
  const countEl = $('post-count');
  const categoryEl = $<HTMLSelectElement>('filter-category');
  const tagEl = $<HTMLSelectElement>('filter-tag');
  const statusEl = $<HTMLSelectElement>('filter-status');
  const sortEl = $<HTMLSelectElement>('filter-sort');

  let items: PostMeta[] = [];
  let active = '';
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

  function render(): void {
    const shown = visible();
    listEl.textContent = '';
    countEl.textContent = String(items.length);

    const frag = document.createDocumentFragment();
    for (const item of shown) {
      const li = document.createElement('li');
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
      li.append(btn);

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
      lang = nextLang;
      const index = await buildIndex(nextLang, token);
      items = index.items;
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
  };
}

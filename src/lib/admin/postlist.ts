import { $, setStatus } from './dom';
import { repo, paths } from '../../data/admin';
import { readFile, listDir, GhError, type Repo } from './github';
import { parsePostFile } from './serialize';

/**
 * 左边的文章列表。
 *
 * GitHub 列目录只给文件名，标题 / 日期 / 草稿要逐篇读文件才知道，
 * 所以并发读一批（6 个一组）。文章多了要控制请求量：
 * 超过 MAX_INDEX 篇或撞上限流就退化成只列文件名，并在列表下方说明。
 */

const CONCURRENCY = 6;
const MAX_INDEX = 60;

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
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
          if (!file) return { slug, title: slug, date: '', draft: false, metaOnly: true };
          const parsed = parsePostFile(file.text);
          return {
            slug,
            title: parsed.data.title || slug,
            date: parsed.data.date,
            draft: parsed.data.draft,
            metaOnly: false,
          };
        } catch (e) {
          // 单篇失败不拖垮整份列表；撞限流就整体退化为只列文件名
          if (e instanceof GhError && (e.status === 403 || e.status === 429)) degraded = true;
          return { slug, title: slug, date: '', draft: false, metaOnly: true };
        }
      })
    );
    items.push(...done);
  }

  items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
  return { items, degraded };
}

/** 侧边列表：渲染 + 过滤 + 选中态。载入文章由 onPick 回调出去 */
export function initPostList(onPick: (slug: string) => void): {
  rebuild: (lang: string, token: string) => Promise<void>;
  setActive: (slug: string) => void;
  slugs: () => string[];
} {
  const listEl = $('post-items');
  const filterEl = $<HTMLInputElement>('post-filter');
  const metaEl = $('post-list-meta');
  const newBtn = $('post-new');

  let items: PostMeta[] = [];
  let active = '';

  const visible = () => {
    const key = filterEl.value.trim().toLowerCase();
    if (!key) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(key) || item.slug.toLowerCase().includes(key)
    );
  };

  function render(): void {
    const shown = visible();
    listEl.textContent = '';

    const frag = document.createDocumentFragment();
    for (const item of shown) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'post-list__item';
      btn.dataset.slug = item.slug;
      if (item.slug === active) btn.setAttribute('aria-current', 'true');

      const title = document.createElement('span');
      title.className = 'post-list__title';
      title.textContent = item.title;

      const sub = document.createElement('span');
      sub.className = 'post-list__sub';
      sub.append(document.createTextNode(item.slug));
      if (item.date) sub.append(document.createTextNode(item.date));
      if (item.draft) {
        const tag = document.createElement('span');
        tag.className = 'post-list__draft';
        tag.textContent = '草稿';
        sub.append(tag);
      }

      btn.append(title, sub);
      li.append(btn);
      frag.append(li);
    }
    listEl.append(frag);

    metaEl.textContent = items.length
      ? `共 ${items.length} 篇${shown.length !== items.length ? `，筛出 ${shown.length} 篇` : ''}`
      : '';
  }

  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.post-list__item');
    if (!btn) return;
    onPick(btn.dataset.slug ?? '');
  });

  filterEl.addEventListener('input', render);

  newBtn.addEventListener('click', () => {
    filterEl.value = '';
    onPick('');
  });

  return {
    async rebuild(lang: string, token: string) {
      const index = await buildIndex(lang, token);
      items = index.items;
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

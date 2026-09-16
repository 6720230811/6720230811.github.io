import { getCollection, type CollectionEntry } from 'astro:content';
import { getRelativeLocaleUrl } from 'astro:i18n';
import { countReading } from './format';
import {
  assertCategory,
  assertTags,
  categoryLabel,
  orderedCategories,
  tagLabel,
} from './taxonomy';
import type { Locale } from '../i18n/ui';

/** 语言目录 + slug 拆分后的文章类型 */
export type Post = CollectionEntry<'posts'> & { slug: string };

/**
 * 取某一语言下的全部文章，按日期倒序。
 * 草稿只在 dev 下出现（生产构建不输出草稿页，列表里也不该出现）。
 *
 * 词表的校验挂在这里 —— 它是所有文章视图的必经之路（列表、归档、分类页、
 * 标签页、文章页都从 postsOf 拿数），挂一处就全覆盖。
 * 草稿被上面那层过滤掉了，所以草稿里的新词不会卡住构建，这是有意的：
 * 写到一半的文章不该阻塞发布。
 */
export async function postsOf(lang: Locale): Promise<Post[]> {
  const all = await getCollection('posts', ({ data }) => (import.meta.env.PROD ? !data.draft : true));
  return all
    .filter((entry) => entry.id.split('/')[0] === lang)
    .map((entry) => {
      const where = `src/content/posts/${entry.id}.md`;
      assertCategory(entry.data.category, where);
      assertTags(entry.data.tags, where);
      return { ...entry, slug: entry.id.slice(lang.length + 1) };
    })
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/**
 * 供页面 getStaticPaths 使用。
 * locale 必须显式塞进 props：prefixDefaultLocale:false 下动态路由里
 * 读 Astro.currentLocale 不可靠。
 */
/** getStaticPaths 的返回单元：alias 有值时这一页是「旧地址跳转页」 */
interface PostPath {
  params: { slug: string };
  props: { entry: Post; locale: Locale; alias?: string };
}

export function postPaths(lang: Locale) {
  return async (): Promise<PostPath[]> => {
    const posts = await postsOf(lang);
    const taken = new Set(posts.map((p) => p.slug));

    const out: PostPath[] = posts.map((entry) => ({
      params: { slug: entry.slug },
      props: { entry, locale: lang },
    }));

    // 别名也各生成一页；撞上真实 slug、自己的、或不是合法 slug 的跳过
    // （真身优先；非法字符会生成奇怪的路由，宁可这条别名不生效）
    for (const entry of posts) {
      for (const alias of entry.data.aliases ?? []) {
        if (!alias || alias === entry.slug || taken.has(alias)) continue;
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(alias)) continue;
        out.push({ params: { slug: alias }, props: { entry, locale: lang, alias } });
      }
    }
    return out;
  };
}

/** 站点内链接：自动带上语言前缀与 base 前缀 */
export function href(locale: Locale, path: string): string {
  return getRelativeLocaleUrl(locale, path);
}

export function postHref(locale: Locale, slug: string): string {
  return href(locale, `blog/${slug}`);
}

/**
 * 词条的地址。
 *
 * 入参一律是**词表的 key**（ASCII），不是显示名 —— 这样中英两版的地址是同一个，
 * 改显示名也不会换地址（迁移前 URL 里是 `技术` / `Tech`，中英各一套）。
 * `encodeURIComponent` 留着只是防御：key 过 SLUG 校验，本来就不会有特殊字符。
 */
export function tagHref(locale: Locale, key: string): string {
  return href(locale, `tags/${encodeURIComponent(key)}`);
}

export function categoryHref(locale: Locale, key: string): string {
  return href(locale, `categories/${encodeURIComponent(key)}`);
}

/** 按年份倒序分组，用于归档页 */
export function groupByYear(posts: readonly Post[]): { year: number; posts: Post[] }[] {
  const buckets = new Map<number, Post[]>();
  for (const post of posts) {
    const year = post.data.date.getFullYear();
    const bucket = buckets.get(year);
    if (bucket) bucket.push(post);
    else buckets.set(year, [post]);
  }
  return [...buckets.entries()]
    .map(([year, items]) => ({ year, posts: items }))
    .sort((a, b) => b.year - a.year);
}

/** 分组列表里的一组：`name` 是按语言取好的显示名，`href` 是它的独立页面 */
export interface PostGroup {
  name: string;
  posts: Post[];
  /** 没有落地页的组不填（归档年份就没有） */
  href?: string;
}

/**
 * 分类分组：**按词表的 order 排，并且含 0 篇的分类**。
 *
 * 为什么空分类也要列出来：分类是信息架构，它先于文章存在 ——
 * 把空的藏起来，「骨架」在页面上就看不见了，读者（和自己）都不知道这个站往哪儿写。
 * 顺序取词表而不是篇数：篇数每写一篇文章就变，导航会跟着跳。
 */
export function categoryGroups(locale: Locale, posts: readonly Post[]): PostGroup[] {
  const buckets = new Map<string, Post[]>();
  for (const post of posts) {
    const bucket = buckets.get(post.data.category);
    if (bucket) bucket.push(post);
    else buckets.set(post.data.category, [post]);
  }
  return Object.keys(orderedCategories()).map((key) => ({
    name: categoryLabel(locale, key),
    posts: buckets.get(key) ?? [],
    href: categoryHref(locale, key),
  }));
}

/** 一批文章里真正用到的标签 key（篇数降序，同数按 key，保证构建结果稳定） */
export function tagKeysIn(posts: readonly Post[]): string[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const key of post.data.tags) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

/**
 * 标签分组：只列**文章里真正用到**的标签。
 * 标签是检索索引，不存在「预置的标签」—— 没人用的词不该在页面上占一行。
 */
export function tagGroups(locale: Locale, posts: readonly Post[]): PostGroup[] {
  const buckets = new Map<string, Post[]>();
  for (const post of posts) {
    for (const key of post.data.tags) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(post);
      else buckets.set(key, [post]);
    }
  }
  return tagKeysIn(posts).map((key) => ({
    name: tagLabel(locale, key),
    posts: buckets.get(key) ?? [],
    href: tagHref(locale, key),
  }));
}

/**
 * 粗略的阅读时长（分钟）：实现在 ../format 里，前后台共用（后台预览要用同一套算法）。
 * 中文按 400 字/分钟、西文按 220 词/分钟估，够用即可，不必精确。
 */
export function readingMinutes(post: Post): number {
  return countReading(post.body ?? '');
}

// 下面三个从 format.ts 转出来，前台其它文件 import 自 posts 的地方不用改
export { countReading, countWords, formatDate, parseIsoDate } from './format';

/** 短日期（归档页按年份分组后，组内只需月日） */
export function formatShortDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: locale === 'zh' ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

import { getCollection, type CollectionEntry } from 'astro:content';
import { getRelativeLocaleUrl } from 'astro:i18n';
import type { Locale } from '../i18n/ui';

/** 语言目录 + slug 拆分后的文章类型 */
export type Post = CollectionEntry<'posts'> & { slug: string };

/**
 * 取某一语言下的全部文章，按日期倒序。
 * 草稿只在 dev 下出现（生产构建不输出草稿页，列表里也不该出现）。
 */
export async function postsOf(lang: Locale): Promise<Post[]> {
  const all = await getCollection('posts', ({ data }) => (import.meta.env.PROD ? !data.draft : true));
  return all
    .filter((entry) => entry.id.split('/')[0] === lang)
    .map((entry) => ({ ...entry, slug: entry.id.slice(lang.length + 1) }))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/**
 * 供页面 getStaticPaths 使用。
 * locale 必须显式塞进 props：prefixDefaultLocale:false 下动态路由里
 * 读 Astro.currentLocale 不可靠。
 */
export function postPaths(lang: Locale) {
  return async () => {
    const posts = await postsOf(lang);
    return posts.map((entry) => ({
      params: { slug: entry.slug },
      props: { entry, locale: lang },
    }));
  };
}

/** 站点内链接：自动带上语言前缀与 base 前缀 */
export function href(locale: Locale, path: string): string {
  return getRelativeLocaleUrl(locale, path);
}

export function postHref(locale: Locale, slug: string): string {
  return href(locale, `blog/${slug}`);
}

export function tagHref(locale: Locale, tag: string): string {
  return href(locale, `tags/${encodeURIComponent(tag)}`);
}

export function categoryHref(locale: Locale, category: string): string {
  return href(locale, `categories/${encodeURIComponent(category)}`);
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

export interface Term {
  name: string;
  count: number;
}

/** 汇总标签（出现次数降序，同次数按名称排序，保证构建结果稳定） */
export function collectTags(posts: readonly Post[]): Term[] {
  return collect(posts.map((p) => p.data.tags).flat());
}

/** 汇总分类 */
export function collectCategories(posts: readonly Post[]): Term[] {
  return collect(posts.map((p) => p.data.category));
}

function collect(names: readonly string[]): Term[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * 粗略的阅读时长（分钟）。
 * 中文按 400 字/分钟、西文按 220 词/分钟估，够用即可，不必精确。
 */
export function readingMinutes(post: Post): number {
  const text = post.body ?? '';
  const cjk = (text.match(/[㐀-鿿぀-ヿ]/g) ?? []).length;
  const words = (text.replace(/[㐀-鿿぀-ヿ]/g, ' ').match(/[A-Za-z0-9']+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

/** 日期格式化：中文 2026年9月1日，英文 Sep 1, 2026 */
export function formatDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: locale === 'zh' ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** 短日期（归档页按年份分组后，组内只需月日） */
export function formatShortDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: locale === 'zh' ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

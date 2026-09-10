import { getCollection, type CollectionEntry } from 'astro:content';
import { getRelativeLocaleUrl } from 'astro:i18n';
import { countReading } from './format';
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

/**
 * 按词条分组（分类 / 标签）：一篇文章只有一个分类，但可以有多个标签，
 * 所以取词函数返回数组。组的顺序跟 collectCategories 一致（篇数降序、同篇数按名称），
 * 保证构建结果稳定。
 */
export interface PostGroup {
  name: string;
  posts: Post[];
  /** 该词条的独立页面（/tags/… 、/categories/…）；归档年份这类没有落地页的组不填 */
  href?: string;
}

export function groupByTerms(
  posts: readonly Post[],
  termsOf: (post: Post) => readonly string[],
  hrefOf?: (name: string) => string
): PostGroup[] {
  const buckets = new Map<string, Post[]>();
  for (const post of posts) {
    for (const name of termsOf(post)) {
      const bucket = buckets.get(name);
      if (bucket) bucket.push(post);
      else buckets.set(name, [post]);
    }
  }
  return [...buckets.entries()]
    .map(([name, items]) => ({ name, posts: items, href: hrefOf?.(name) }))
    .sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name));
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

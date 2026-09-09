import type { Locale } from '../i18n/ui';

/**
 * 前后台共用的几个纯函数。
 *
 * 单独放一个文件是因为 /admin 后台也要用它们（预览里要算出与线上一致的
 * 「x 分钟阅读」和日期），而 src/lib/posts.ts 导入了 astro:content，
 * 一旦被后台的浏览器包引用就会构建失败。
 * 反过来这里也**不能** import posts.ts，否则把 astro:content 又拖回浏览器。
 */

/** 中日文字符（汉字 + 日文假名）：阅读时长按字数算，西文按词数算 */
const CJK = /[㐀-鿿぀-ヿ]/g;

/**
 * 粗略的阅读时长（分钟）。
 * 中文按 400 字/分钟、西文按 220 词/分钟估，够用即可，不必精确。
 */
export function countReading(text: string): number {
  const cjk = (text.match(CJK) ?? []).length;
  const words = (text.replace(CJK, ' ').match(/[A-Za-z0-9']+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

/** 文本里的英文词数（不含中日文），后台统计条会用到 */
export function countWords(text: string): number {
  return (text.replace(CJK, ' ').match(/[A-Za-z0-9']+/g) ?? []).length;
}

/**
 * 解析 frontmatter 里的 YYYY-MM-DD。
 * 必须按 UTC：内容集合用 z.coerce.date() 解析 '2026-09-01'，得到的就是 UTC 零点，
 * 用本地时区构造（new Date(y, m, d)）会在东八区以外差一天。
 */
export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
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

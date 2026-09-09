import type { Post } from './posts';

/**
 * 文章配图：文章页右侧那一栏用它，列表卡片也用它做缩略图。
 *
 * 取值顺序：
 * 1. frontmatter 的 cover（自己指定的最准）
 * 2. 正文里第一张 Markdown 图 / <img>，此时 lifted = true
 * 3. 都没有 → undefined，页面保持单栏
 */
export interface CoverImage {
  /** 可直接在 src 里用的地址 */
  src: string;
  /** 只有从正文取图时才有（Markdown 的 alt），frontmatter 的 cover 视为装饰图，alt 留空 */
  alt: string;
  /** 图是从正文里提出来的：正文里那张要隐掉，否则同一张图会出现两次 */
  lifted: boolean;
  /** 图在正文里的原始写法，隐藏正文图片时用来拼 CSS 选择器 */
  raw?: string;
}

// Markdown 图：![alt](src "title")
const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/;
// 直接写 HTML 的情况：<img src="..." alt="...">
const HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i;
const HTML_ALT = /\balt\s*=\s*["']([^"']*)["']/i;

/** 只接受站点内的绝对路径与外链：相对路径在右侧栏里算不出正确地址 */
const ABSOLUTE = /^(?:https?:\/\/|\/\/|\/)/i;

export function resolveCover(post: Post): CoverImage | undefined {
  const cover = post.data.cover?.trim();
  if (cover) return { src: toUrl(cover), alt: '', lifted: false };

  const body = post.body ?? '';
  const md = MD_IMAGE.exec(body);
  const html = HTML_IMAGE.exec(body);

  // Markdown 与 <img> 混用时，取位置靠前的那张
  if (md && (!html || md.index <= html.index)) {
    return ABSOLUTE.test(md[2]) ? lifted(md[2], md[1]) : undefined;
  }
  if (html && ABSOLUTE.test(html[1])) {
    return lifted(html[1], HTML_ALT.exec(html[0])?.[1] ?? '');
  }
  return undefined;
}

function lifted(src: string, alt: string): CoverImage {
  return { src: toUrl(src), alt: alt.trim(), lifted: true, raw: src };
}

/**
 * 图是从正文提出来的话，正文里那张要藏起来，否则同一张图会出现两次。
 * 返回一段 CSS（选择器用 src 精确匹配），没有需要隐藏的东西时返回空串。
 *
 * 用 `<style>` 而不是在正文里动手脚：渲染走的是 entry.filePath，改 body 不影响输出。
 */
export function liftedImageCss(cover: CoverImage | undefined): string {
  if (!cover?.lifted) return '';
  // 正文里的 img 是原样地址，而 src 可能已经补过部署前缀，两个都写上才不会漏
  const candidates = [...new Set([cover.src, toUrl(cover.raw ?? '')])].filter((src) =>
    ABSOLUTE.test(src)
  );
  if (candidates.length === 0) return '';
  const selectors = candidates
    .map((src) => `.prose img[src="${src.replace(/[\\"]/g, '\\$&')}"]`)
    .join(',');
  return `${selectors}{display:none}`;
}

/** 补上部署前缀：站点挂在子路径时 '/x.png' 要变成 '/homepage/x.png' */
function toUrl(src: string): string {
  if (/^(?:https?:)?\/\//i.test(src)) return src;
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}${src.replace(/^\.?\//, '')}`;
}

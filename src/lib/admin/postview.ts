import { resolveCoverFields, liftedImageCss } from '../cover';
import { countReading, formatDate, parseIsoDate } from '../format';
import type { Locale } from '../../i18n/ui';
import type { PostFrontmatter } from './serialize';

/**
 * 三个预览视图的 HTML 片段。
 *
 * 结构与前台逐字对齐（PostCard.astro / layouts/PostLayout.astro），
 * 样式是同一份 CSS（父页面的样式表会被复制进 iframe），
 * 所以在后台看到的就是文章上线后的样子。
 *
 * 两点刻意的差别：
 * - 卡片外层用 <div> 而不是 <a>：预览里点了也不该跳转
 * - 所有插值过 escapeHtml：标题里写 <img onerror=…> 不会破坏结构
 *   （iframe 没有 allow-scripts，就算漏了也执行不了，但结构会乱）
 */

export type PreviewView = 'body' | 'card' | 'head';

export interface PreviewState {
  view: PreviewView;
  data: PostFrontmatter;
  body: string;
  /** 正文渲染结果（带 data-line 行号，同步滚动用）。由调用方算好传进来 */
  bodyHtml: string;
  locale: Locale;
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML 文本转义：标题、摘要、分类、标签都从这里过一遍 */
function e(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESC[c]);
}

export const EMPTY_BODY = '<p class="admin-preview__empty">正文还是空的。</p>';

function minRead(locale: Locale, minutes: number): string {
  return locale === 'zh' ? `${minutes} 分钟阅读` : `${minutes} min read`;
}

/** 封面地址：刚上传还没部署的图用 blob URL 顶上（见 upload.ts 的 registerLocalImage） */
const localImages = new Map<string, string>();

export function registerLocalImage(path: string, blobUrl: string): void {
  localImages.set(path, blobUrl);
}

function srcOf(src: string): string {
  return localImages.get(src) ?? src;
}

/** 正文：只有渲染结果，跟线上文章页的 .prose 一致 */
export function bodyView(state: PreviewState): string {
  return `<div class="prose">${state.bodyHtml || EMPTY_BODY}</div>`;
}

/** 列表卡片：照抄 PostCard.astro */
export function cardView(state: PreviewState): string {
  const { title, description, date, category, tags } = state.data;
  const cover = resolveCoverFields(state.data.cover, state.body);

  return `<div class="post-card${cover ? ' post-card--with-cover' : ''}">
  ${cover ? `<div class="post-card__thumb"><img src="${e(srcOf(cover.src))}" alt="" /></div>` : ''}
  <div class="post-card__main">
    <div class="post-card__head">
      <h3 class="post-card__title">${e(title) || '（无标题）'}</h3>
      <time class="post-card__date" datetime="${e(date)}">${formatDate(parseIsoDate(date), state.locale)}</time>
    </div>
    ${description ? `<p class="post-card__desc">${e(description)}</p>` : ''}
    <div class="post-card__foot">
      <span class="post-chip post-chip--category">${e(category) || '—'}</span>
      ${
        tags.length
          ? `<span class="post-card__tags">${tags.map((t) => `<span class="post-chip">#${e(t)}</span>`).join('')}</span>`
          : ''
      }
      <span class="post-card__time">${minRead(state.locale, countReading(state.body))}</span>
    </div>
  </div>
</div>`;
}

/** 文章页：照抄 PostLayout.astro 的头部，封面在右侧那一栏 */
export function headView(state: PreviewState): string {
  const { title, date, category, tags } = state.data;
  const cover = resolveCoverFields(state.data.cover, state.body);
  // 封面是从正文里提出来的话，正文那张要藏掉，否则同一张图出现两次
  const hideLifted = cover?.lifted ? `<style>${liftedImageCss(cover)}</style>` : '';

  return `<article class="section post">${hideLifted}
  <header class="post__head">
    <h1 class="post__title">${e(title) || '（无标题）'}</h1>
    <div class="post__meta">
      <time datetime="${e(date)}">${state.locale === 'zh' ? '发布于' : 'Published'} ${formatDate(parseIsoDate(date), state.locale)}</time>
      <a>${e(category) || '—'}</a>
      <span>${minRead(state.locale, countReading(state.body))}</span>
    </div>
    ${
      tags.length
        ? `<div class="tag-list">${tags.map((t) => `<a class="tag">#${e(t)}</a>`).join('')}</div>`
        : ''
    }
  </header>
  <div class="post__body${cover ? ' post__body--split' : ''}">
    <div class="prose">${state.bodyHtml || EMPTY_BODY}</div>
    ${
      cover
        ? `<aside class="post__aside"><figure class="post__figure"><img src="${e(srcOf(cover.src))}" alt="${e(cover.alt)}" /></figure></aside>`
        : ''
    }
  </div>
</article>`;
}

export const VIEWS: Record<PreviewView, (state: PreviewState) => string> = {
  body: bodyView,
  card: cardView,
  head: headView,
};

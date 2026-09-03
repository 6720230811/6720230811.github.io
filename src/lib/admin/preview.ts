import { marked } from 'marked';

/**
 * /admin 里的 Markdown 实时预览。
 *
 * 预览渲染进 iframe，且 sandbox 只给 allow-same-origin（不给 allow-scripts）：
 * - marked 不做 sanitize，粘贴来的 Markdown 里的 <script> / on* 属性不会执行
 * - 留着 allow-same-origin 是为了能量到内容高度、把 iframe 撑开，不然要固定高度滚动
 */

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

/** 父页面（/admin）已经加载了站点样式，预览复用同一份，观感才一致 */
function parentStyles(): string {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((link) => `<link rel="stylesheet" href="${link.href}" />`)
    .join('');
}

export function updatePreview(iframe: HTMLIFrameElement, md: string): void {
  const doc = `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    ${parentStyles()}
    <style>
      html { background: transparent; }
      body { margin: 0; padding: 1.25rem 1.5rem; background: var(--c-bg-soft); }
    </style>
  </head>
  <body><div class="prose">${renderMarkdown(md)}</div></body>
</html>`;

  iframe.srcdoc = doc;
}

/** srcdoc 每次重写都会触发 load，用它同步高度 */
export function autoHeight(iframe: HTMLIFrameElement): void {
  iframe.addEventListener('load', () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      iframe.style.height = `${doc.documentElement.scrollHeight}px`;
    } catch {
      // 拿不到高度就保持 CSS 里的默认高度，不影响使用
    }
  });
}

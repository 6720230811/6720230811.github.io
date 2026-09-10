import { VIEWS, type PreviewState, type PreviewView } from './postview';

/**
 * /admin 里的实时预览。
 *
 * 渲染进 iframe，sandbox 只给 allow-same-origin（**不给 allow-scripts**）：
 * - marked 不做 sanitize，粘进来的 <script> / on* 属性不会执行
 * - 留着 allow-same-origin 是为了能量内容高度、做双向同步滚动
 * - 千万别同时给 allow-scripts：那等于把 sandbox 取消，iframe 里的脚本
 *   能读父页面的 localStorage，GitHub token 直接被盗
 *
 * 父页面的样式表会被整份复制进来（其中那个共享 chunk 含 global.css + prose.css），
 * 所以 .post-card / .post__head / .prose / .tag-list 这些前台类在预览里直接可用，
 * 不用另外抄一份 CSS。注意别改成「只复制某一个文件」——chunk 文件名会随构建变化。
 */

/** 预览自己的补丁样式 */
const EXTRA_CSS = `
/* marked 产出的是 <pre><code class="language-x">，没有 shiki 的 --shiki-* 变量，
   .prose pre 的 color / background 会取不到值（只剩一个边框）。
   这里按 astro.config 里那两套主题补上缺省值，跟线上一个观感。 */
:root {
  --shiki-light: #24292e;
  --shiki-light-bg: #ffffff;
  --shiki-dark: #e6edf3;
  --shiki-dark-bg: #24292e;
}
html { background: transparent; }
/* 预览窗格自己滚动（同步滚动要用到 scrollY），不再靠撑高 iframe */
body { margin: 0; padding: 1.25rem 1.5rem; background: var(--c-bg-soft); min-height: 100%; }
.admin-preview__empty { color: var(--c-text-faint); font-size: 0.9rem; }
`;

function parentStyles(): string {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((link) => `<link rel="stylesheet" href="${link.href}" />`)
    .join('');
}

/** iframe 是独立文档，拿不到父页面的 data-theme，得自己抄一遍 */
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function buildPreviewDoc(state: PreviewState, theme: 'light' | 'dark'): string {
  return `<!doctype html>
<html lang="${state.locale}" data-theme="${theme}">
  <head>
    <meta charset="utf-8" />
    ${parentStyles()}
    <style>${EXTRA_CSS}</style>
  </head>
  <body>${VIEWS[state.view](state)}</body>
</html>`;
}

let lastKey = '';

/**
 * 内容没变就不重写 srcdoc：长文每 250ms 重建一次整文档会明显卡顿。
 * view / locale / theme 也算进 key——它们变了要重渲染。
 */
export function updatePreview(iframe: HTMLIFrameElement, state: PreviewState): void {
  const theme = currentTheme();
  const key = `${state.view}|${state.locale}|${theme}|${state.body}|${JSON.stringify(state.data)}`;
  if (key === lastKey) return;
  lastKey = key;
  iframe.srcdoc = buildPreviewDoc(state, theme);
}

/**
 * srcdoc 每次重写都会触发 load。
 * 需要「新文档就绪」的模块（同步滚动要重新挂滚动监听）在这里登记。
 */
const loadListeners: (() => void)[] = [];

export function onPreviewLoad(cb: () => void): void {
  loadListeners.push(cb);
}

export function initPreviewLoad(iframe: HTMLIFrameElement): void {
  iframe.addEventListener('load', () => {
    for (const cb of loadListeners) cb();
  });
}

/**
 * 主题切换由 ThemeToggle 直接改 <html data-theme>，没有事件可听，
 * 所以盯属性变化而不是去监听按钮点击（否则会漏掉别的入口）。
 */
export function watchTheme(onChange: () => void): void {
  new MutationObserver(onChange).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

export type { PreviewState, PreviewView };

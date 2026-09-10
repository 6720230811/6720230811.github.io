import { Marked } from 'marked';
import type { Mirror } from './mirror';

/**
 * 双向同步滚动。
 *
 * 做法：渲染时给每个顶层块打上它在源码里的起始行号（data-line），
 * 滚动时把「源码行」当作中间坐标 —— 左侧问影子层「第 N 行在哪个像素」，
 * 右侧问 iframe「第 N 行渲染出来在哪个像素」，两边都换算成行号再对齐。
 * 比单纯按 scrollTop 百分比对齐准得多：长文里图片、代码块一多，
 * 百分比对齐会越滚越偏。
 */

const md = new Marked();

/** 把 data-line="N" 塞进渲染结果的第一个标签里（塞不进去就不标，不影响渲染） */
function tag(html: string, line: number): string {
  return html.replace(/^<([a-zA-Z][\w-]*)/, `<$1 data-line="${line}"`);
}

/**
 * 逐块渲染并标行号。
 * 不整体 parse 再猜：token.raw 与源文本逐字对应，累计换行数就是准确行号。
 */
export function renderWithLines(src: string): string {
  if (!src.trim()) return '';
  const tokens = md.lexer(src);
  const out: string[] = [];
  let cursor = 0;
  let line = 0;

  for (const token of tokens) {
    const raw = token.raw ?? '';
    const at = raw ? src.indexOf(raw, cursor) : cursor;
    const start = at >= 0 ? at : cursor;
    // cursor → start 之间跳过的换行（一般是块之间的空行）
    for (let i = cursor; i < start; i += 1) if (src[i] === '\n') line += 1;

    const html = md.parser([token]);
    if (html.trim()) out.push(tag(html, line));

    cursor = start + raw.length;
    for (let i = start; i < cursor; i += 1) if (src[i] === '\n') line += 1;
  }

  return out.join('');
}

interface Block {
  line: number;
  top: number;
}

export interface Sync {
  setEnabled: (on: boolean) => void;
  isEnabled: () => boolean;
  /** iframe 每次重写 srcdoc 之后要重新挂一次滚动监听 */
  attach: () => void;
  /** 内容变了重新对齐一次 */
  align: () => void;
}

/** 程序化滚动落点与随后那次事件的差距在这个范围内，就算我们自己滚的 */
const EPS = 2;

export function createSync(
  ta: HTMLTextAreaElement,
  mirror: Mirror,
  preview: () => Window | null
): Sync {
  let enabled = true;
  /**
   * 两侧各自的「待认领位置」：我们程序化滚到了哪里。
   * 对面滚过来时会触发一次同样位置的事件，认领掉就不再往回推。
   * 比按时间加锁准：iframe 会连着发好几个 scroll 事件，计时锁会被它拖死。
   */
  let pendingEditor: number | null = null;
  let pendingPreview: number | null = null;

  /** 预览里所有打了行号的块，按文档顺序 */
  function blocks(win: Window): Block[] {
    const out: Block[] = [];
    for (const el of Array.from(win.document.querySelectorAll<HTMLElement>('[data-line]'))) {
      const line = Number(el.dataset.line);
      if (!Number.isFinite(line)) continue;
      out.push({ line, top: el.getBoundingClientRect().top + win.scrollY });
    }
    return out;
  }

  /** 行号 → 预览里的像素位置：在前后两个块之间按行号插值 */
  function previewTop(list: Block[], line: number): number {
    if (line <= list[0].line) return 0;
    const last = list[list.length - 1];
    if (line >= last.line) return last.top;

    for (let i = 0; i < list.length - 1; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      if (line >= a.line && line < b.line) {
        const span = b.line - a.line;
        return span > 0 ? a.top + ((b.top - a.top) * (line - a.line)) / span : a.top;
      }
    }
    return last.top;
  }

  /** 预览像素位置 → 行号：同样按块插值 */
  function previewLine(list: Block[], y: number): number {
    if (y <= list[0].top) return list[0].line;
    const last = list[list.length - 1];
    if (y >= last.top) return last.line;

    for (let i = 0; i < list.length - 1; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      if (y >= a.top && y < b.top) {
        const span = b.top - a.top;
        return span > 0 ? a.line + ((b.line - a.line) * (y - a.top)) / span : a.line;
      }
    }
    return last.line;
  }

  function fromEditor(): void {
    if (!enabled) return;
    const win = preview();
    if (!win) return;
    const list = blocks(win);
    if (!list.length) return;

    mirror.sync();
    const line = mirror.lineAt(ta.scrollTop);
    const top = previewTop(list, line);
    pendingPreview = top;
    win.scrollTo({ top, behavior: 'auto' });
  }

  function fromPreview(): void {
    if (!enabled) return;
    const win = preview();
    if (!win) return;
    const list = blocks(win);
    if (!list.length) return;

    const line = previewLine(list, win.scrollY);
    mirror.sync();
    const top = mirror.lineTop(line);
    pendingEditor = top;
    ta.scrollTop = top;
  }

  ta.addEventListener('scroll', () => {
    if (pendingEditor !== null) {
      const mine = Math.abs(ta.scrollTop - pendingEditor) < EPS;
      pendingEditor = null;
      if (mine) return;
    }
    fromEditor();
  });

  const onPreviewScroll = () => {
    const win = preview();
    if (!win) return;
    if (pendingPreview !== null) {
      const mine = Math.abs(win.scrollY - pendingPreview) < EPS;
      pendingPreview = null;
      if (mine) return;
    }
    fromPreview();
  };

  /**
   * iframe 每次重写 srcdoc 都会换一个新 document，
   * 挂在旧 document 上的监听（以及 window 上那一批）会被一起丢掉，
   * 所以按 document 判重：换了文档就重新挂。
   */
  let attachedDoc: Document | null = null;

  function attach(): void {
    const win = preview();
    if (!win?.document) return;
    if (win.document === attachedDoc) return;
    attachedDoc = win.document;
    win.addEventListener('scroll', onPreviewScroll, { passive: true });
  }

  return {
    setEnabled(on: boolean) {
      enabled = on;
      if (on) fromEditor();
    },
    isEnabled: () => enabled,
    attach,
    align: fromEditor,
  };
}

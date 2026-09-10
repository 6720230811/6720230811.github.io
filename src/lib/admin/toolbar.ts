/**
 * 正文编辑框的几个写作辅助：Markdown 工具栏、Tab 缩进、Cmd/Ctrl+S 发布。
 *
 * 所有改动都通过 replace() 完成：它插入文本后会派发 input 事件，
 * 预览、草稿、统计都挂在 input 上，不派发的话改了正文界面却没反应。
 */

interface MdAction {
  /** 包裹选中内容：[前缀, 后缀] */
  wrap?: [string, string];
  /** 给选中行加行首前缀（再点一次取消） */
  line?: string;
  /** 整块包裹，前后各补空行 */
  block?: [string, string];
  /** 没有选中内容时插入的占位词 */
  placeholder: string;
}

export const MD_ACTIONS: Record<string, MdAction> = {
  bold: { wrap: ['**', '**'], placeholder: '粗体' },
  italic: { wrap: ['*', '*'], placeholder: '斜体' },
  h2: { line: '## ', placeholder: '标题' },
  h3: { line: '### ', placeholder: '标题' },
  quote: { line: '> ', placeholder: '引用' },
  ul: { line: '- ', placeholder: '列表项' },
  ol: { line: '1. ', placeholder: '列表项' },
  code: { block: ['```\n', '\n```'], placeholder: '代码' },
  link: { wrap: ['[', '](https://)'], placeholder: '链接文字' },
  image: { wrap: ['![', '](/illustrations/)'], placeholder: 'alt' },
};

/**
 * 统一出口：改完派发 input，让预览/草稿/统计都知道内容变了。
 *
 * 走 execCommand('insertText') 而不是 setRangeText：后者会清空浏览器原生的
 * undo 栈，Ctrl/Cmd+Z 就撤不回上一步了。insertText 虽然已废弃，
 * 但目前所有浏览器都支持，失败时再退回 setRangeText。
 */
function replace(
  ta: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  selStart: number,
  selEnd: number
): void {
  ta.focus();
  ta.setSelectionRange(start, end);

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) ta.setRangeText(text, start, end, 'end');

  ta.setSelectionRange(selStart, selEnd);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrap(ta: HTMLTextAreaElement, [before, after]: [string, string], placeholder: string): void {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const inner = ta.value.slice(start, end) || placeholder;
  replace(ta, start, end, before + inner + after, start + before.length, start + before.length + inner.length);
}

/** 行首前缀：整段都已经有这个前缀时再点一次是取消，写列表/引用很好用 */
export function prefixLines(ta: HTMLTextAreaElement, prefix: string): void {
  const { start, end } = lineRange(ta);
  const lines = ta.value.slice(start, end).split('\n');
  const all = lines.every((line) => line.startsWith(prefix));
  const out = lines.map((line) => (all ? line.slice(prefix.length) : prefix + line)).join('\n');
  replace(ta, start, end, out, start, start + out.length);
}

/** 反缩进：每行最多去掉两个空格 */
export function outdentLines(ta: HTMLTextAreaElement): void {
  const { start, end } = lineRange(ta);
  const out = ta.value
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/^ {1,2}/, ''))
    .join('\n');
  replace(ta, start, end, out, start, start + out.length);
}

/** 选中区域向外扩到整行 */
function lineRange(ta: HTMLTextAreaElement): { start: number; end: number } {
  const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  const found = ta.value.indexOf('\n', ta.selectionEnd);
  return { start, end: found === -1 ? ta.value.length : found };
}

function block(ta: HTMLTextAreaElement, [open, close]: [string, string], placeholder: string): void {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const inner = ta.value.slice(start, end) || placeholder;
  const lead = start === 0 || ta.value[start - 1] === '\n' ? '' : '\n';
  const text = lead + open + inner + close + '\n';
  replace(ta, start, end, text, start + lead.length + open.length, start + lead.length + open.length + inner.length);
}

/** 在光标处插入文本（图片上传后插 Markdown 用） */
export function insertAtCaret(ta: HTMLTextAreaElement, text: string): void {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  replace(ta, start, end, text, start + text.length, start + text.length);
}

/** 把正文里第一次出现的 from 换成 to：图片上传完成后替换占位符用 */
export function replaceOnce(ta: HTMLTextAreaElement, from: string, to: string): boolean {
  const at = ta.value.indexOf(from);
  if (at < 0) return false;
  const keepStart = ta.selectionStart;
  const keepEnd = ta.selectionEnd;
  replace(ta, at, at + from.length, to, keepStart, keepEnd);
  return true;
}

export function initMdToolbar(root: ParentNode, ta: HTMLTextAreaElement): void {
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-md]'))) {
    btn.addEventListener('click', () => {
      const action = MD_ACTIONS[btn.dataset.md ?? ''];
      if (!action) return;
      if (action.wrap) wrap(ta, action.wrap, action.placeholder);
      else if (action.line) prefixLines(ta, action.line);
      else if (action.block) block(ta, action.block, action.placeholder);
    });
  }
}

/**
 * Tab 缩进：写代码块时 Tab 跳焦点很难受。
 * 留一个逃生口：按 Esc 之后的下一个 Tab 仍然跳出输入框，键盘可达性不丢。
 */
export function initTabIndent(ta: HTMLTextAreaElement): void {
  let escapeArmed = false;

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      escapeArmed = true;
      return;
    }
    if (e.key !== 'Tab') {
      escapeArmed = false;
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || escapeArmed) {
      escapeArmed = false;
      return;
    }

    e.preventDefault();
    if (e.shiftKey) {
      outdentLines(ta);
      return;
    }
    // 没选中且光标所在行没有内容时直接插两个空格，不然整行都加上前缀有点意外
    const singleLine = !/\n/.test(ta.value.slice(ta.selectionStart));
    if (ta.selectionStart === ta.selectionEnd && singleLine) {
      const at = ta.selectionStart;
      replace(ta, at, at, '  ', at + 2, at + 2);
      return;
    }
    prefixLines(ta, '  ');
  });
}

/** Cmd/Ctrl+S 发布。isActive 用来限定只在文章栏生效，别在友链栏也拦这个键 */
export function initSaveShortcut(save: () => void, isActive: () => boolean): void {
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== 's') return;
    if (!isActive()) return;
    // 不拦的话浏览器会弹「保存网页」
    e.preventDefault();
    save();
  });
}

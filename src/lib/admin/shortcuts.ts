/**
 * 后台的快捷键层。
 *
 * 以前只有 ⌘S 一个（写在 post.ts 里），Esc 散在 token 抽屉、BibTeX 浮层各自实现。
 * 现在收成一张注册表 + 一处 keydown：谁想加键就 registerShortcut，
 * 「?」帮助浮层直接从注册表渲染，文档不会跟实现走散。
 *
 * 三个刻意的取舍：
 * 1. 用 e.code 而不是 e.key 判定主键 —— macOS 上 Option+1 的 e.key 是 '¡'，
 *    按 key 匹配 Alt+数字 永远匹配不上；按 code 就没这问题。
 * 2. 视图切换用 Alt+1/2/3，不用 ⌘1/2/3：后者是浏览器切标签页，页面拦不住。
 * 3. 光标在输入框里时只放行带 mod 的键和显式标了 allowInInput 的键，
 *    否则打字会被吞（比如「逗号成标签」本来就在输入框里按逗号）。
 */

export interface Shortcut {
  /** 形如 'mod+k' / 'alt+1' / 'shift+/' / 'escape' */
  keys: string;
  label: string;
  group: string;
  /** 条件不满足时按下也没反应（比如「仅文章分区生效」） */
  when?: () => boolean;
  /** 输入框里也生效：默认只有带 mod 的键才放行 */
  allowInInput?: boolean;
  run: () => void;
}

const registry: Shortcut[] = [];

export function registerShortcut(shortcut: Shortcut): void {
  registry.push(shortcut);
}

const CODE_MAP: Record<string, string> = {
  Slash: '/',
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Escape: 'escape',
  Enter: 'enter',
  Space: 'space',
  Backspace: 'backspace',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
};

function mainKey(e: KeyboardEvent): string {
  const code = e.code;
  if (CODE_MAP[code]) return CODE_MAP[code];
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  // 兜底：F1–F12、Insert 这类没有规律可言的
  return (e.key || '').toLowerCase();
}

export function eventToken(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(mainKey(e));
  return parts.join('+');
}

function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function initShortcuts(): void {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      const token = eventToken(e);
      const inField = isTextField(e.target);

      const hit = registry.find((s) => {
        if (s.keys !== token) return false;
        if (inField && !s.allowInInput && !token.includes('mod')) return false;
        return !s.when || s.when();
      });
      if (!hit) return;

      e.preventDefault();
      hit.run();
    },
    true
  );
}

/** 'mod+shift+p' → '⌘ ⇧ P'（按平台换符号） */
export function humanKeys(keys: string): string {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return keys
    .split('+')
    .map((key) => {
      switch (key) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'escape':
          return 'Esc';
        case 'enter':
          return 'Enter';
        case 'space':
          return 'Space';
        default:
          return key.length === 1 ? key.toUpperCase() : key.replace(/^\w/, (c) => c.toUpperCase());
      }
    })
    .join(isMac ? ' ' : ' + ');
}

const GROUP_ORDER = ['通用', '导航', '视图', '编辑', '发布'];

export function openShortcutHelp(): void {
  const dialog = document.getElementById('shortcut-help') as HTMLDialogElement | null;
  const body = document.getElementById('shortcut-help-body');
  if (!dialog || !body) return;

  body.textContent = '';
  const groups = new Map<string, Shortcut[]>();
  for (const s of registry) {
    const list = groups.get(s.group) ?? [];
    list.push(s);
    groups.set(s.group, list);
  }

  const names = [...groups.keys()].sort(
    (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)
  );

  for (const name of names) {
    const section = document.createElement('div');
    section.className = 'help__group';
    const title = document.createElement('p');
    title.className = 'help__group-title';
    title.textContent = name;
    section.append(title);

    for (const s of groups.get(name) ?? []) {
      const row = document.createElement('div');
      row.className = 'help__row';
      const label = document.createElement('span');
      label.textContent = s.label;
      const keys = document.createElement('kbd');
      keys.className = 'help__keys';
      keys.textContent = humanKeys(s.keys);
      row.append(label, keys);
      section.append(row);
    }
    body.append(section);
  }

  if (dialog.open) return;
  dialog.showModal();
}

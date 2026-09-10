/**
 * 标签胶囊输入。
 *
 * 逗号分隔的纯文本框有两个毛病：看不出一个标签从哪到哪，删掉中间那个很容易删错。
 * 胶囊把每个标签变成一个可点的整体，回车 / 逗号 / 空格都成标签，
 * 聚焦时下拉历史标签（写过的标签存在 localStorage 里），点一下就加。
 */

const HISTORY_KEY = 'admin_tag_history';
const HISTORY_MAX = 80;

export interface Chips {
  get: () => string[];
  set: (tags: string[]) => void;
  add: (tag: string) => void;
  /** 发布成功后把用过的标签存进历史 */
  remember: () => void;
}

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function writeHistory(tags: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(tags.slice(0, HISTORY_MAX)));
  } catch {
    // 隐私模式：历史丢了也不影响编辑
  }
}

/** 新标签排前面，重复的不记 */
export function rememberTags(tags: readonly string[]): void {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  if (!clean.length) return;
  const merged = [...clean];
  for (const old of readHistory()) {
    if (!merged.some((t) => t.toLowerCase() === old.toLowerCase())) merged.push(old);
  }
  writeHistory(merged);
}

export function initChips(opts: {
  box: HTMLElement;
  input: HTMLInputElement;
  suggest: HTMLElement;
  onChange: () => void;
}): Chips {
  const { box, input, suggest, onChange } = opts;
  let tags: string[] = [];

  function render(): void {
    box.textContent = '';
    for (const tag of tags) {
      const chip = document.createElement('span');
      chip.className = 'chip';

      const text = document.createElement('span');
      text.textContent = tag;

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip__x';
      x.dataset.tag = tag;
      x.setAttribute('aria-label', `删除标签 ${tag}`);
      x.textContent = '×';

      chip.append(text, x);
      box.append(chip);
    }
    box.hidden = tags.length === 0;
  }

  function commit(raw: string): boolean {
    const value = raw.trim().replace(/[,，;；]+$/, '');
    if (!value) return false;
    // 同名不重复加（忽略大小写），顺手把光标留在输入框里继续输
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return false;
    tags.push(value);
    render();
    onChange();
    return true;
  }

  function remove(tag: string): void {
    tags = tags.filter((t) => t !== tag);
    render();
    onChange();
  }

  box.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip__x');
    if (btn?.dataset.tag) remove(btn.dataset.tag);
  });

  // ---------- 候选下拉 ----------
  function candidates(): string[] {
    const key = input.value.trim().toLowerCase();
    const used = new Set(tags.map((t) => t.toLowerCase()));
    return readHistory()
      .filter((t) => !used.has(t.toLowerCase()))
      .filter((t) => !key || t.toLowerCase().includes(key))
      .slice(0, 10);
  }

  function showSuggest(): void {
    const list = candidates();
    if (!list.length) {
      suggest.hidden = true;
      return;
    }
    suggest.textContent = '';
    for (const tag of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggest__item';
      btn.textContent = tag;
      // mousedown 时先吃掉默认行为，否则输入框失焦、下拉先关掉了
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = '';
        commit(tag);
        showSuggest();
      });
      suggest.append(btn);
    }
    suggest.hidden = false;
  }

  const hideSoon = () => window.setTimeout(() => {
    suggest.hidden = true;
  }, 120);

  input.addEventListener('focus', showSuggest);
  input.addEventListener('input', showSuggest);
  input.addEventListener('blur', hideSoon);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ' ') {
      // 候选开着的时候回车是「选中候选」，交给 mousedown 那条路径，这里只管自己输入的
      if (commit(input.value)) {
        input.value = '';
        e.preventDefault();
        showSuggest();
      }
      return;
    }
    if (e.key === 'Backspace' && !input.value && tags.length) {
      remove(tags[tags.length - 1]);
      e.preventDefault();
    }
  });

  return {
    get: () => [...tags],
    set(next: string[]) {
      tags = [...next];
      render();
    },
    add: commit,
    remember() {
      rememberTags(tags);
    },
  };
}

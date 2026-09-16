/**
 * 标签胶囊输入。
 *
 * 逗号分隔的纯文本框有两个毛病：看不出一个标签从哪到哪，删掉中间那个很容易删错。
 * 胶囊把每个标签变成一个可点的整体，回车 / 逗号 / 空格都成标签，点一下就加。
 *
 * 候选来自两处，**词表在前**（`opts.vocab`），localStorage 里的历史在后 ——
 * 历史记的是「你打过什么」，词表记的是「什么是合法的」。
 * 输入还会过一层归一化（`opts.normalize`）：写「前端」也能存成登记的 `frontend`。
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

function readHistory(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function writeHistory(key: string, tags: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(tags.slice(0, HISTORY_MAX)));
  } catch {
    // 隐私模式：历史丢了也不影响编辑
  }
}

/** 新标签排前面，重复的不记 */
export function rememberTags(tags: readonly string[]): void {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  if (!clean.length) return;
  const merged = [...clean];
  for (const old of readHistory(HISTORY_KEY)) {
    if (!merged.some((t) => t.toLowerCase() === old.toLowerCase())) merged.push(old);
  }
  writeHistory(HISTORY_KEY, merged);
}

export function initChips(opts: {
  box: HTMLElement;
  input: HTMLInputElement;
  /** 历史候选下拉；不给就不做「记住历史 / 联想」这一套（别名之类的一次性输入） */
  suggest?: HTMLElement | null;
  /** 历史记录的 localStorage key；传 null 表示不记历史 */
  historyKey?: string | null;
  /**
   * 合法词表（如标签的词表 key）。候选**优先从这里来**：
   * 历史记的是「你打过什么」，词表记的是「什么是对的」——
   * 换台机器历史就没了，而历史里可能存着拼错的词，照着点会把错词再抄一遍。
   */
  vocab?: readonly string[];
  /** 输入归一化：把旧名 / 异名换成登记的 key（「前端」→ frontend）。返回原值表示不认识 */
  normalize?: (raw: string) => string;
  onChange: () => void;
}): Chips {
  const { box, input, suggest, onChange } = opts;
  const historyKey = opts.historyKey === undefined ? HISTORY_KEY : opts.historyKey;
  const vocab = opts.vocab ?? [];
  const normalize = opts.normalize ?? ((raw: string) => raw);
  let tags: string[] = [];

  const read = () => (historyKey ? readHistory(historyKey) : []);
  const write = (list: string[]) => {
    if (historyKey) writeHistory(historyKey, list);
  };

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
    // 先归一化再落袋：写「前端」也能存成登记的 `frontend`，
    // 否则手写的旧名会一路进到 frontmatter，构建时被拦下来
    const value = normalize(raw.trim().replace(/[,，;；]+$/, ''));
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
    // 词表在前、历史在后：历史里可能有拼错的，垫在后面不占前排
    const pool = [...vocab, ...read()];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of pool) {
      const lower = item.toLowerCase();
      if (used.has(lower) || seen.has(lower)) continue;
      if (key && !lower.includes(key)) continue;
      seen.add(lower);
      out.push(item);
      if (out.length >= 10) break;
    }
    return out;
  }

  function showSuggest(): void {
    if (!suggest) return;
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
    if (suggest) suggest.hidden = true;
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
      if (!historyKey) return;
      const clean = tags.map((t) => t.trim()).filter(Boolean);
      if (!clean.length) return;
      const merged = [...clean];
      for (const old of read()) {
        if (!merged.some((t) => t.toLowerCase() === old.toLowerCase())) merged.push(old);
      }
      write(merged);
    },
  };
}

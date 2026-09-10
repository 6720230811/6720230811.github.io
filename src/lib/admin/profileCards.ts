import { setStatus } from './dom';
import {
  NewsItemSchema,
  PublicationSchema,
  TimelineEntrySchema,
  SkillGroupSchema,
  ProjectSchema,
  AwardSchema,
  type Publication,
} from '../../data/profile.schema';
import { getProfile, getStateVersion, mutate, subscribe } from './profileState';
import { parsePublications } from './bibtex';

/**
 * 「个人信息」的可视化卡片编辑器。
 *
 * 八个模块（动态 / 论文 / 科研 / 技能 / 项目 / 实习 / 教育 / 奖项）全部由
 * 同一套 spec 驱动：折叠卡片 + 展开表单 + 拖拽排序 + 胶囊输入，
 * 结构化的活不再让用户手写 JSON。
 *
 * 状态是唯一真源：字段输入直接写进 state，然后 emit。
 * emit 的订阅方（预览 / 校验 / 计数）各自做防抖，卡片不重渲染 ——
 * 重渲染只在「条目数量变化 / 拖拽换序 / 切回卡片模式」这些结构性时刻发生，
 * 不然每敲一个字焦点就飞了。
 */

type ArrayKey = 'news' | 'publications' | 'research' | 'skills' | 'projects' | 'internships' | 'education' | 'awards';

type FieldType = 'text' | 'textarea' | 'number' | 'chips' | 'lines';

interface FieldSpec {
  /** 对象里的键；支持一层嵌套（如 links.pdf） */
  path: string;
  label: string;
  type: FieldType;
  hint?: string;
  placeholder?: string;
  /** 可选字段：留空就把键从对象里删掉，JSON 里不出现空串 */
  optional?: boolean;
  rows?: number;
  /** 放半行（两列布局） */
  half?: boolean;
}

interface ModuleSpec {
  key: ArrayKey;
  title: string;
  icon: string;
  blank: () => Record<string, unknown>;
  /** 折叠态的摘要行 */
  summary: (item: Record<string, unknown>) => { badge?: string; text: string };
  fields: FieldSpec[];
  bibtex?: boolean;
}

const clip = (value: unknown, max: number): string => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const dateToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- 模块定义
const TIMELINE_FIELDS: FieldSpec[] = [
  { path: 'period', label: '时间段', type: 'text', half: true, placeholder: '2023.09 — 2026.06' },
  { path: 'org', label: '机构', type: 'text', half: true, placeholder: '学校 / 公司 / 实验室' },
  { path: 'orgLink', label: '机构链接', type: 'text', optional: true, half: true, placeholder: 'https://…' },
  { path: 'role', label: '身份 / 学位 / 岗位', type: 'text', half: true },
  { path: 'extra', label: '补充', type: 'text', optional: true, hint: '导师、部门等' },
  { path: 'details', label: '要点', type: 'lines', optional: true, hint: '一行一条' },
];

const timelineSummary = (item: Record<string, unknown>) => ({
  badge: clip(item.period, 24) || undefined,
  text: clip(item.org, 30) || clip(item.role, 30) || '（未填写）',
});

const MODULES: ModuleSpec[] = [
  {
    key: 'news',
    title: '最新动态',
    icon: '📰',
    blank: () => ({ date: dateToday(), text: '' }),
    summary: (item) => ({ badge: clip(item.date, 12) || undefined, text: clip(item.text, 60) || '（未填写）' }),
    fields: [
      { path: 'date', label: '时间', type: 'text', half: true, placeholder: '2025.06' },
      { path: 'text', label: '动态', type: 'textarea', rows: 3, hint: '支持 <b>、<a href> 等行内 HTML，保存时过滤白名单' },
    ],
  },
  {
    key: 'publications',
    title: '论文发表',
    icon: '📝',
    bibtex: true,
    blank: () => ({ title: '', authors: [], selfIndex: 0, venue: '', year: new Date().getFullYear() }),
    summary: (item) => ({ badge: [item.venue, item.year].filter(Boolean).join(' ') || undefined, text: clip(item.title, 60) || '（未填写）' }),
    fields: [
      { path: 'title', label: '论文标题', type: 'text' },
      { path: 'authors', label: '作者列表', type: 'chips', hint: '回车添加；点作者名把它标为自己（渲染时加粗），不用再数下标' },
      { path: 'venue', label: '会议 / 期刊', type: 'text', half: true, placeholder: 'MLSys 2025' },
      { path: 'year', label: '年份', type: 'number', half: true },
      { path: 'note', label: '备注', type: 'text', optional: true, half: true, hint: 'Oral / Spotlight…' },
      { path: 'citations', label: '引用数', type: 'number', optional: true, half: true },
      { path: 'links.pdf', label: 'PDF', type: 'text', optional: true, half: true, placeholder: 'https://arxiv.org/abs/…' },
      { path: 'links.code', label: '代码', type: 'text', optional: true, half: true, placeholder: 'https://github.com/…' },
      { path: 'links.project', label: '项目主页', type: 'text', optional: true, half: true },
      { path: 'links.slides', label: '幻灯片', type: 'text', optional: true, half: true },
      { path: 'links.video', label: '视频', type: 'text', optional: true, half: true },
    ],
  },
  {
    key: 'research',
    title: '科研经历',
    icon: '🔬',
    blank: () => ({ period: '', org: '', role: '' }),
    summary: timelineSummary,
    fields: TIMELINE_FIELDS,
  },
  {
    key: 'skills',
    title: '技术栈',
    icon: '🛠',
    blank: () => ({ category: '', items: [] }),
    summary: (item) => ({
      badge: `${(item.items as string[] | undefined)?.length ?? 0} 项`,
      text: clip(item.category, 30) || '（未命名分组）',
    }),
    fields: [
      { path: 'category', label: '分组名', type: 'text', half: true, placeholder: '编程语言' },
      { path: 'items', label: '技能', type: 'chips', hint: '输入后回车成胶囊' },
    ],
  },
  {
    key: 'projects',
    title: '项目经历',
    icon: '🚀',
    blank: () => ({ name: '', description: '', stack: [] }),
    summary: (item) => ({ badge: clip(item.period, 20) || undefined, text: clip(item.name, 40) || '（未填写）' }),
    fields: [
      { path: 'name', label: '项目名', type: 'text', half: true },
      { path: 'period', label: '时间', type: 'text', optional: true, half: true, placeholder: '2024.03 — 至今' },
      { path: 'link', label: '链接', type: 'text', optional: true, hint: 'GitHub / 演示地址' },
      { path: 'description', label: '描述', type: 'textarea', rows: 3 },
      { path: 'stack', label: '技术栈', type: 'chips' },
      { path: 'highlights', label: '亮点', type: 'lines', optional: true, hint: '一行一条' },
    ],
  },
  {
    key: 'internships',
    title: '实习经历',
    icon: '💼',
    blank: () => ({ period: '', org: '', role: '' }),
    summary: timelineSummary,
    fields: TIMELINE_FIELDS,
  },
  {
    key: 'education',
    title: '教育背景',
    icon: '🎓',
    blank: () => ({ period: '', org: '', role: '' }),
    summary: timelineSummary,
    fields: TIMELINE_FIELDS,
  },
  {
    key: 'awards',
    title: '荣誉奖项',
    icon: '🏅',
    blank: () => ({ date: dateToday(), text: '' }),
    summary: (item) => ({ badge: clip(item.date, 12) || undefined, text: clip(item.text, 60) || '（未填写）' }),
    fields: [
      { path: 'date', label: '时间', type: 'text', half: true, placeholder: '2024.10' },
      { path: 'text', label: '奖项', type: 'textarea', rows: 2, hint: '纯文本，不解析 HTML' },
    ],
  },
];

/** JSON 源码模式的逐模块校验 schema */
const MODULE_SCHEMAS = {
  news: NewsItemSchema.array(),
  publications: PublicationSchema.array(),
  research: TimelineEntrySchema.array(),
  skills: SkillGroupSchema.array(),
  projects: ProjectSchema.array(),
  internships: TimelineEntrySchema.array(),
  education: TimelineEntrySchema.array(),
  awards: AwardSchema.array(),
} as const;

// ---------------------------------------------------------------- 小工具
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getPath(item: Record<string, unknown>, path: string): unknown {
  const [head, sub] = path.split('.');
  if (!sub) return item[head];
  const cur = item[head] as Record<string, unknown> | undefined;
  return cur?.[sub];
}

function setPath(item: Record<string, unknown>, path: string, value: unknown, optional: boolean): void {
  const [head, sub] = path.split('.');
  if (!sub) {
    if (optional && (value === '' || value === undefined)) delete item[head];
    else item[head] = value;
    return;
  }
  if (optional && (value === '' || value === undefined)) {
    const cur = item[head] as Record<string, unknown> | undefined;
    if (cur) {
      delete cur[sub];
      if (!Object.keys(cur).length) delete item[head];
    }
    return;
  }
  const cur = (item[head] ??= {}) as Record<string, unknown>;
  cur[sub] = value;
}

/** 数组整体替换：原地清空再填，引用不变，别处的闭包不会指向旧数组 */
function replaceArray(key: ArrayKey, next: unknown[]): void {
  mutate((p) => {
    const arr = p[key] as unknown[];
    arr.length = 0;
    for (const item of next) arr.push(item);
  });
}

/** 条目是否完全没填东西：没填的删除不用确认 */
function isBlank(item: Record<string, unknown>): boolean {
  for (const value of Object.values(item)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.some((v) => String(v ?? '').trim())) return false;
      continue;
    }
    if (typeof value === 'object') {
      if (Object.values(value).some((v) => String(v ?? '').trim())) return false;
      continue;
    }
    if (String(value).trim()) return false;
  }
  return true;
}

// ---------------------------------------------------------------- 胶囊输入
interface ChipsHandle {
  root: HTMLElement;
  repaint: () => void;
}

function chipsEditor(opts: {
  values: string[];
  placeholder?: string;
  /** 当前标为「自己」的下标；传函数是因为它会跟着 state 变，传数字会 stale */
  selfIndex?: number | (() => number);
  onChange: (next: string[]) => void;
  onSelf?: (index: number) => void;
}): ChipsHandle {
  const { onChange } = opts;
  let items = [...opts.values];

  const selfOf = (): number =>
    typeof opts.selfIndex === 'function' ? opts.selfIndex() : (opts.selfIndex ?? -1);

  const root = el('span', 'chipfield');
  const box = el('span', 'chipfield__items');
  const input = el('input', 'chipfield__input') as HTMLInputElement;
  input.type = 'text';
  input.spellcheck = false;
  if (opts.placeholder) input.placeholder = opts.placeholder;

  function repaint(): void {
    const self = selfOf();
    box.textContent = '';
    items.forEach((value, i) => {
      const chip = el('span', `chip2${i === self && self >= 0 ? ' chip2--self' : ''}`);
      chip.dataset.i = String(i);
      const label = el('span', undefined, value);
      const x = el('button', 'chip2__x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', `删除 ${value}`);
      chip.append(label, x);
      if (opts.onSelf) {
        chip.title = '点击标为自己';
        chip.classList.add('chip2--pickable');
      }
      box.append(chip);
    });
  }

  function commit(raw: string): boolean {
    const value = raw.trim().replace(/[,，;；]+$/, '');
    if (!value) return false;
    if (items.some((t) => t.toLowerCase() === value.toLowerCase())) return false;
    items = [...items, value];
    repaint();
    onChange(items);
    return true;
  }

  box.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip2');
    if (!chip) return;
    const index = Number(chip.dataset.i ?? -1);
    if ((e.target as HTMLElement).classList.contains('chip2__x')) {
      items = items.filter((_, i) => i !== index);
      repaint();
      onChange(items);
      return;
    }
    // 点作者名 = 标记自己（仅在提供了 onSelf 的场景）
    if (opts.onSelf) opts.onSelf(index);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ' ') {
      if (commit(input.value)) {
        input.value = '';
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Backspace' && !input.value && items.length) {
      items = items.slice(0, -1);
      repaint();
      onChange(items);
      e.preventDefault();
    }
  });

  input.addEventListener('blur', () => commit(input.value));
  root.append(box, input);
  repaint();

  return { root, repaint };
}

// ---------------------------------------------------------------- 渲染状态
const renderedLen = new Map<ArrayKey, number>();
const openCards = new Map<ArrayKey, Set<number>>();
const jsonMode = new Set<ArrayKey>();
let dragging: HTMLElement | null = null;
let lastVersion = -1;

function itemsOf(key: ArrayKey): Record<string, unknown>[] {
  const p = getProfile();
  if (!p) return [];
  return p[key] as unknown as Record<string, unknown>[];
}

function paintSummary(spec: ModuleSpec, item: Record<string, unknown>, card: HTMLElement): void {
  const { badge, text } = spec.summary(item);
  const badgeEl = card.querySelector<HTMLElement>('.mcard__badge');
  const textEl = card.querySelector<HTMLElement>('.mcard__summary');
  if (badgeEl) {
    badgeEl.textContent = badge ?? '';
    badgeEl.hidden = !badge;
  }
  if (textEl) textEl.textContent = text;
}

function setExpanded(card: HTMLElement, open: boolean): void {
  card.classList.toggle('is-open', open);
  const form = card.querySelector<HTMLElement>('.mcard__form');
  const toggle = card.querySelector<HTMLButtonElement>('.mcard__toggle');
  if (form) form.hidden = !open;
  if (toggle) toggle.textContent = open ? '收起 ▲' : '展开 ▼';
}

// ---------------------------------------------------------------- 单张卡片
function renderCard(spec: ModuleSpec, item: Record<string, unknown>, idx: number): HTMLElement {
  const card = el('article', 'mcard');
  card.dataset.idx = String(idx);

  // ---- 折叠头
  const head = el('header', 'mcard__head');
  const grip = el('span', 'mcard__grip', '⠿');
  grip.draggable = true;
  grip.title = '拖拽调整顺序';
  const badge = el('span', 'mcard__badge');
  const summary = el('span', 'mcard__summary');
  const tools = el('span', 'mcard__tools');
  const del = el('button', 'mcard__act mcard__act--danger', '删除');
  del.type = 'button';
  del.dataset.act = 'del';
  const toggle = el('button', 'mcard__act mcard__toggle', '展开 ▼');
  toggle.type = 'button';
  toggle.dataset.act = 'toggle';
  tools.append(del, toggle);
  head.append(grip, badge, summary, tools);
  card.append(head);

  // ---- 展开表单
  const form = el('div', 'mcard__form');
  form.hidden = true;

  for (const field of spec.fields) {
    const wrap = el('label', `mfield${field.half ? ' mfield--half' : ''}`);
    const head2 = el('span', 'mfield__label');
    head2.append(el('b', undefined, field.label));
    if (field.hint) head2.append(el('em', undefined, field.hint));
    wrap.append(head2);

    const current = getPath(item, field.path);

    if (field.type === 'chips') {
      const isAuthors = spec.key === 'publications' && field.path === 'authors';
      const handle = chipsEditor({
        values: Array.isArray(current) ? (current as string[]) : [],
        placeholder: field.placeholder,
        selfIndex: isAuthors ? () => Number(item.selfIndex ?? 0) : undefined,
        onChange: (next) => {
          mutate((p) => {
            const target = (p[spec.key] as Record<string, unknown>[])[idx];
            if (!target) return;
            setPath(target, field.path, next, Boolean(field.optional));
            // 作者变少时下标可能越界：clamp 回 0，别静默地谁都不加粗
            if (isAuthors) {
              const self = Number(target.selfIndex ?? 0);
              target.selfIndex = self < next.length ? self : 0;
            }
          });
          paintSummary(spec, item, card);
        },
        onSelf: isAuthors
          ? (index) => {
              mutate((p) => {
                const target = (p[spec.key] as Record<string, unknown>[])[idx];
                if (target) target.selfIndex = index;
              });
              handle.repaint(); // selfIndex 变了要重画高亮
            }
          : undefined,
      });
      wrap.append(handle.root);
      form.append(wrap);
      continue;
    }

    if (field.type === 'textarea' || field.type === 'lines') {
      const ta = el('textarea', 'mfield__input') as HTMLTextAreaElement;
      ta.rows = field.rows ?? (field.type === 'lines' ? 3 : 3);
      ta.spellcheck = false;
      if (field.placeholder) ta.placeholder = field.placeholder;
      ta.value = field.type === 'lines' && Array.isArray(current) ? (current as string[]).join('\n') : String(current ?? '');
      ta.addEventListener('input', () => {
        mutate((p) => {
          const target = (p[spec.key] as Record<string, unknown>[])[idx];
          if (!target) return;
          if (field.type === 'lines') {
            const next = ta.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            setPath(target, field.path, next, Boolean(field.optional) && next.length === 0);
          } else {
            setPath(target, field.path, ta.value, Boolean(field.optional));
          }
        });
        paintSummary(spec, item, card);
      });
      wrap.append(ta);
      form.append(wrap);
      continue;
    }

    const input = el('input', 'mfield__input') as HTMLInputElement;
    input.type = field.type === 'number' ? 'number' : 'text';
    input.spellcheck = false;
    if (field.placeholder) input.placeholder = field.placeholder;
    input.value = current === undefined || current === null ? '' : String(current);
    input.addEventListener('input', () => {
      mutate((p) => {
        const target = (p[spec.key] as Record<string, unknown>[])[idx];
        if (!target) return;
        if (field.type === 'number') {
          const raw = input.value.trim();
          if (raw === '') {
            setPath(target, field.path, '', Boolean(field.optional));
          } else {
            const num = Number.parseInt(raw, 10);
            setPath(target, field.path, Number.isFinite(num) ? num : 0, false);
          }
        } else {
          setPath(target, field.path, input.value.trim(), Boolean(field.optional));
        }
      });
      paintSummary(spec, item, card);
    });
    wrap.append(input);
    form.append(wrap);
  }

  card.append(form);

  // ---- 交互
  grip.addEventListener('mousedown', () => {
    card.draggable = true;
  });
  card.addEventListener('dragstart', (e) => {
    if (!card.draggable) {
      e.preventDefault();
      return;
    }
    dragging = card;
    card.classList.add('is-dragging');
    e.dataTransfer?.setData('text/plain', String(idx));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => finishDrag(spec));

  head.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.classList.contains('mcard__grip')) return;
    const open = !card.classList.contains('is-open');
    setExpanded(card, open);
    // 手动开合也要记账：重渲染（增删 / 换序）后保持原样
    const set = openCards.get(spec.key) ?? new Set<number>();
    if (open) set.add(idx);
    else set.delete(idx);
    openCards.set(spec.key, set);
  });

  head.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.mcard__act');
    if (!btn) return;
    if (btn.dataset.act === 'toggle') {
      setExpanded(card, !card.classList.contains('is-open'));
      return;
    }
    if (btn.dataset.act === 'del') {
      if (!isBlank(item) && !window.confirm(`删除「${spec.summary(item).text}」？`)) return;
      mutate((p) => {
        (p[spec.key] as unknown[]).splice(idx, 1);
      });
    }
  });

  const openSet = openCards.get(spec.key);
  if (openSet?.has(idx)) setExpanded(card, true);

  paintSummary(spec, item, card);
  return card;
}

// ---------------------------------------------------------------- 拖拽排序
function finishDrag(spec: ModuleSpec): void {
  const container = document.querySelector<HTMLElement>(`[data-cards="${spec.key}"]`);
  if (dragging) {
    dragging.classList.remove('is-dragging');
    dragging.draggable = false;
    dragging = null;
  }
  if (!container) return;

  // DOM 顺序就是新顺序（dragover 时已实时搬动）
  const order = Array.from(container.querySelectorAll<HTMLElement>('.mcard')).map((c) =>
    Number(c.dataset.idx)
  );
  const items = itemsOf(spec.key);
  const reordered = order.map((i) => items[i]).filter(Boolean);
  const same = order.every((v, i) => v === i);
  if (same) return;

  const prevOpen = openCards.get(spec.key);
  openCards.set(
    spec.key,
    new Set(prevOpen ? [...prevOpen].map((old) => order.indexOf(old)).filter((n) => n >= 0) : [])
  );
  replaceArray(spec.key, reordered);
}

function wireDragContainer(container: HTMLElement, spec: ModuleSpec): void {
  container.addEventListener('dragover', (e) => {
    if (!dragging || !container.contains(dragging)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const others = Array.from(container.querySelectorAll<HTMLElement>('.mcard')).filter((c) => c !== dragging);
    const next = others.find((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    if (next) container.insertBefore(dragging, next);
    else container.append(dragging);
  });
  container.addEventListener('drop', (e) => {
    if (!dragging) return;
    e.preventDefault();
    finishDrag(spec);
  });
}

// ---------------------------------------------------------------- 模块渲染
function renderModule(spec: ModuleSpec): void {
  const container = document.querySelector<HTMLElement>(`[data-cards="${spec.key}"]`);
  if (!container) return;
  const items = itemsOf(spec.key);
  renderedLen.set(spec.key, items.length);
  container.textContent = '';

  if (!items.length) {
    container.append(el('p', 'mod__empty', '还没有条目，点上面「＋ 新增」。'));
    return;
  }
  items.forEach((item, idx) => container.append(renderCard(spec, item, idx)));
}

function updateCounts(): void {
  const p = getProfile();
  for (const spec of MODULES) {
    const countEl = document.querySelector<HTMLElement>(`[data-count="${spec.key}"]`);
    if (countEl) countEl.textContent = String(p ? (p[spec.key] as unknown[]).length : 0);
  }
}

/** JSON 源码模式下，别处改了数据（BibTeX 导入 / 切语言）要把文本框同步过来 */
function syncJsonTextarea(spec: ModuleSpec): void {
  if (!jsonMode.has(spec.key)) return;
  const ta = document.querySelector<HTMLTextAreaElement>(`[data-jsonfield="${spec.key}"] textarea`);
  if (!ta || document.activeElement === ta) return;
  ta.value = JSON.stringify(itemsOf(spec.key), null, 2);
}

function setJsonMode(spec: ModuleSpec, on: boolean): void {
  const cards = document.querySelector<HTMLElement>(`[data-cards="${spec.key}"]`);
  const jsonField = document.querySelector<HTMLElement>(`[data-jsonfield="${spec.key}"]`);
  const btn = document.querySelector<HTMLButtonElement>(`[data-jsonbtn="${spec.key}"]`);
  if (!cards || !jsonField || !btn) return;

  if (on) {
    const ta = jsonField.querySelector('textarea');
    if (ta) ta.value = JSON.stringify(itemsOf(spec.key), null, 2);
    cards.hidden = true;
    jsonField.hidden = false;
    btn.textContent = '卡片编辑';
    btn.setAttribute('aria-pressed', 'true');
    jsonMode.add(spec.key);
    return;
  }

  // 回到卡片模式：先解析校验，过了才换
  const ta = jsonField.querySelector('textarea');
  if (ta) {
    try {
      const parsed = MODULE_SCHEMAS[spec.key].parse(JSON.parse(ta.value || '[]'));
      replaceArray(spec.key, parsed as unknown[]);
    } catch (err) {
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      const detail = issues?.length
        ? issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')
        : (err as Error).message;
      setStatus(`${spec.title} 的 JSON 有问题，暂时留在源码模式：${detail}`, 'error');
      return; // 数据不对就不许回去，免得卡片模式下丢字段的假象
    }
  }
  cards.hidden = false;
  jsonField.hidden = true;
  btn.textContent = 'JSON 源码';
  btn.setAttribute('aria-pressed', 'false');
  jsonMode.delete(spec.key);
  renderModule(spec);
}

// ---------------------------------------------------------------- BibTeX 导入
function importBibtex(text: string): void {
  const { pubs, failed } = parsePublications(text);
  if (!pubs.length) {
    setStatus(
      failed
        ? `解析出 ${failed} 条 BibTeX，但没有一条带作者（author 字段），没法导入。`
        : '没有解析出任何 BibTeX 条目：确认是以 @article{…} / @inproceedings{…} 开头的文本。',
      'error'
    );
    return;
  }

  mutate((p) => {
    for (const pub of pubs) {
      const item: Publication = {
        title: pub.title,
        authors: pub.authors,
        // 导入后默认第一个作者是自己，卡片里点一下名字就能改
        selfIndex: 0,
        venue: pub.venue,
        year: pub.year,
        ...(pub.links ? { links: pub.links } : {}),
      };
      (p.publications as Publication[]).push(item);
    }
  });
  openCards.set('publications', new Set([itemsOf('publications').length - 1]));
  renderModule(MODULES.find((m) => m.key === 'publications') as ModuleSpec);
  setStatus(
    `已导入 ${pubs.length} 篇论文${failed ? `，另有 ${failed} 条因缺作者被跳过` : ''}。记得点作者名标记自己。`,
    'ok'
  );
}

// ---------------------------------------------------------------- 入口
export function initProfileCards(): void {
  for (const spec of MODULES) {
    const container = document.querySelector<HTMLElement>(`[data-cards="${spec.key}"]`);
    if (container) wireDragContainer(container, spec);

    // 新增
    document.querySelector<HTMLButtonElement>(`[data-add="${spec.key}"]`)?.addEventListener('click', () => {
      mutate((p) => {
        (p[spec.key] as unknown[]).push(spec.blank());
      });
      openCards.set(spec.key, new Set([itemsOf(spec.key).length - 1]));
      renderModule(spec);
    });

    // JSON 源码模式
    document
      .querySelector<HTMLButtonElement>(`[data-jsonbtn="${spec.key}"]`)
      ?.addEventListener('click', () => setJsonMode(spec, !jsonMode.has(spec.key)));

    // 源码模式下直接编辑：合法就写回 state（预览 / 校验跟着动）
    const jsonField = document.querySelector<HTMLElement>(`[data-jsonfield="${spec.key}"]`);
    const ta = jsonField?.querySelector('textarea');
    ta?.addEventListener('input', () => {
    const errEl = document.getElementById(`e-${spec.key}`);
    try {
      const parsed = MODULE_SCHEMAS[spec.key].parse(JSON.parse(ta.value || '[]'));
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
      }
      replaceArray(spec.key, parsed as unknown[]);
    } catch (err) {
        if (errEl) {
          const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
          errEl.hidden = false;
          errEl.textContent = issues?.length
            ? `${issues[0].path.join('.')}: ${issues[0].message}${issues.length > 1 ? `（共 ${issues.length} 处）` : ''}`
            : (err as Error).message;
        }
      }
    });
  }

  // BibTeX 浮层
  const dialog = document.querySelector<HTMLDialogElement>('#bibtex-dialog');
  document.querySelector<HTMLButtonElement>('[data-bibtex]')?.addEventListener('click', () => {
    const area = dialog?.querySelector('textarea');
    if (area) area.value = '';
    dialog?.showModal();
  });
  dialog?.querySelector<HTMLButtonElement>('[data-bibtex-import]')?.addEventListener('click', () => {
    const area = dialog?.querySelector('textarea');
    if (!area) return;
    importBibtex(area.value);
    if (area.value.trim()) dialog.close();
  });
  dialog?.querySelector<HTMLButtonElement>('[data-bibtex-cancel]')?.addEventListener('click', () => dialog.close());

  subscribe(() => {
    updateCounts();
    const p = getProfile();
    if (!p) return;
    // 整份替换过（载入文件 / 切语言）：不管条数变没变，全部重画
    const full = getStateVersion() !== lastVersion;
    lastVersion = getStateVersion();
    for (const spec of MODULES) {
      const len = (p[spec.key] as unknown[]).length;
      if (jsonMode.has(spec.key)) {
        syncJsonTextarea(spec);
        renderedLen.set(spec.key, len);
      } else if (full || renderedLen.get(spec.key) !== len) {
        renderModule(spec);
      }
    }
  });

  updateCounts();
  for (const spec of MODULES) renderModule(spec);
}

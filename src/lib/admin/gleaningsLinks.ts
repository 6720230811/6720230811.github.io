/**
 * 「收藏夹」分区：编辑 `src/data/gleanings/links.json`。
 *
 * 形态与画廊相反 —— 那是一份目录制数据（一个合集一个目录），
 * 这是一份**单一 JSON 文件**：读进来、在内存里增删改、整份写回去。
 * 所以这里没有分片上传那套，只有「载入 → 编辑 → 保存」。
 *
 * 三条关键约束（都来自 links.json 自己的校验规则，见 lib/gleanings.ts 的 LinkSchema）：
 *
 * ① **主题键必须落在词表里**。词表是 `data/gleanings/topics.ts`（零 import 的手写文件），
 *    这里静态 import 它 —— 后台是客户端 bundle，词表就 9 个对象，值得为「下拉框有选项」
 *    付这点体积；手抄一份才是真的贵（加主题时要记得改两处，早晚忘）。
 * ② **url 必须 https**、**title/note.zh 不许空**、**topics 至少一个**、
 *    **addedAt 是 YYYY-MM-DD**。保存前按这套自己先校验一遍 ——
 *    等 CI 构建红掉再回来改，中间隔了 1 分钟的部署时间，定位成本高得多。
 * ③ **字段顺序固定**（url → title → note → topics → addedAt → featured），
 *    写回时用 `stableLinksJson` 逐字段重建。直接 JSON.stringify 原对象的话，
 *    增删改各条之后 key 顺序会随编辑历史漂移，diff 里全是噪声。
 *
 * 编辑模型：左栏列表选一条，右栏编辑**当前选中的那一条**。
 * 左侧的改动先只落在内存里（`rows`），按「保存到仓库」才整份写回 ——
 * 跟文章分区一个节奏，避免每敲一个字就发一次 PUT。
 */
import { $, setStatus, run, activeSection, setTopbarPath, confirmDialog } from './dom';
import { repo, paths } from '../../data/admin';
import { readFile, saveFile, GhError, type Repo } from './github';
import { requireToken } from './token';
import { TOPICS } from '../../data/gleanings/topics';
import { stableLinksJson, today, type LinkRow } from './serialize';

/** 左栏一条 = 收藏的一条链接 */
interface Row extends LinkRow {
  /** 本地唯一键：新增的条目还没有「身份」，只能靠它定位 DOM 与选中项 */
  key: string;
}

let rows: Row[] = [];
/** 当前选中的那条（key）。空表示没选中 —— 右栏显示占位提示 */
let current: string | null = null;
let loaded = false;
let loading = false;
let dirty = false;
let seq = 0;

const nextKey = (): string => `r${++seq}`;

// ---------------------------------------------------------------- 载入

async function loadLinks(): Promise<void> {
  const token = requireToken();
  if (!token) return;
  setTopbarPath(paths.gleaningsLinks());
  loading = true;
  setStatus('正在读取收藏夹…', 'busy');
  try {
    const file = await readFile(repo as Repo, paths.gleaningsLinks(), token);
    const parsed = file ? (JSON.parse(file.text) as { links?: unknown[] }) : {};
    rows = (Array.isArray(parsed.links) ? parsed.links : []).map((item) => {
      const l = item as Record<string, unknown>;
      const note = (l.note ?? {}) as Record<string, unknown>;
      return {
        key: nextKey(),
        url: String(l.url ?? ''),
        title: String(l.title ?? ''),
        note: { zh: String(note.zh ?? ''), en: note.en ? String(note.en) : undefined },
        topics: Array.isArray(l.topics) ? l.topics.map(String) : [],
        addedAt: String(l.addedAt ?? today()),
        featured: Boolean(l.featured),
      };
    });
    current = rows[0]?.key ?? null;
    dirty = false;
    loaded = true;
    renderList();
    renderEditor();
    setStatus(`已载入 links.json（${rows.length} 条）`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    loading = false;
  }
}

/** 打开分区时按需载入（与友链同一套节奏） */
export function ensureLinksLoaded(): void {
  if (loaded || loading) return;
  if (!requireToken()) return;
  void loadLinks();
}

// ---------------------------------------------------------------- 渲染：左栏

function visibleRows(): Row[] {
  const q = $<HTMLInputElement>('lnk-filter').value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q)
  );
}

function renderList(): void {
  const host = $<HTMLUListElement>('lnk-items');
  const list = visibleRows();
  host.textContent = '';
  for (const row of list) {
    const li = document.createElement('li');
    li.dataset.key = row.key;

    /* 复用文章列表那套 .pcard（含 is-picked 高亮）—— 后台左栏的列表项
       长什么样已经有定规，另起一套只会让两个分区的列表看着不是同一个后台 */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pcard';
    btn.setAttribute('aria-current', String(row.key === current));
    if (row.key === current) li.classList.add('is-picked');

    const body = document.createElement('span');
    body.className = 'pcard__body';

    const title = document.createElement('span');
    title.className = 'pcard__title';
    title.textContent = row.title || '(未填标题)';
    body.append(title);

    const meta = document.createElement('span');
    meta.className = 'pcard__sub';
    // 主题键给人看的是显示名，不是裸 key（页面上不许出现裸 key 是同一条规矩）
    const topicNames = row.topics.map((k) => TOPICS[k]?.zh ?? k).join(' / ');
    meta.textContent = [topicNames, row.addedAt, row.featured ? '精选' : '']
      .filter(Boolean)
      .join(' · ');
    body.append(meta);

    btn.append(body);

    btn.addEventListener('click', () => {
      current = row.key;
      renderList();
      renderEditor();
    });

    li.append(btn);
    host.append(li);
  }

  const count = $('links-count');
  count.hidden = loaded === false;
  count.textContent = String(rows.length);

  $('lnk-list-meta').textContent = list.length === rows.length
    ? `共 ${rows.length} 条`
    : `${list.length} / ${rows.length} 条`;
}

// ---------------------------------------------------------------- 渲染：右栏

/** 正在编辑的那条；没选中返回 null */
function editing(): Row | null {
  return rows.find((r) => r.key === current) ?? null;
}

function renderEditor(): void {
  const row = editing();
  $('lnk-placeholder').hidden = Boolean(row);
  const box = $('lnk-editor');
  box.hidden = !row;
  if (!row) return;

  $<HTMLInputElement>('lnk-url').value = row.url;
  $<HTMLInputElement>('lnk-title').value = row.title;
  $<HTMLTextAreaElement>('lnk-note-zh').value = row.note.zh;
  $<HTMLTextAreaElement>('lnk-note-en').value = row.note.en ?? '';
  $<HTMLInputElement>('lnk-added').value = row.addedAt;
  $<HTMLInputElement>('lnk-featured').checked = row.featured;
  $('lnk-crumb').textContent = row.title || '(未命名)';
  renderTopics(row);
}

/** 主题是**多选**：9 个词表项画成勾选芯片，勾中的写进 topics */
function renderTopics(row: Row): void {
  const host = $('lnk-topics');
  host.textContent = '';
  const keys = Object.keys(TOPICS).sort((a, b) => TOPICS[a].order - TOPICS[b].order);
  for (const key of keys) {
    const label = document.createElement('label');
    label.className = 'lnk-topic';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = key;
    box.checked = row.topics.includes(key);
    box.addEventListener('change', () => {
      row.topics = box.checked
        ? [...row.topics, key]
        : row.topics.filter((k) => k !== key);
      markDirty();
      renderList();
    });
    const text = document.createElement('span');
    text.textContent = TOPICS[key].zh;
    label.append(box, text);
    host.append(label);
  }
}

function markDirty(): void {
  dirty = true;
  $('lnk-save').classList.add('btn--primary');
}

/** 把右栏的输入回写进内存（输入事件上调用；不碰仓库） */
function pullEditor(): void {
  const row = editing();
  if (!row) return;
  row.url = $<HTMLInputElement>('lnk-url').value.trim();
  row.title = $<HTMLInputElement>('lnk-title').value.trim();
  row.note.zh = $<HTMLTextAreaElement>('lnk-note-zh').value;
  const en = $<HTMLTextAreaElement>('lnk-note-en').value;
  row.note.en = en.trim() ? en : undefined;
  row.addedAt = $<HTMLInputElement>('lnk-added').value;
  row.featured = $<HTMLInputElement>('lnk-featured').checked;
  markDirty();
  renderList();
}

// ---------------------------------------------------------------- 校验

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 保存前的自检。返回第一条错误的中文说明，全部通过回 null。
 *
 * 这里刻意**不引 zod**：后台首包为了省 23KB 已经把 schema 做成动态载入了
 * （见 lib/admin/schemas.ts），为三条规则再拖一份 zod 进来不划算。
 * 规则与 lib/gleanings.ts 里的 LinkSchema 一一对应，改了那边要回来对一眼。
 */
function validate(): string | null {
  if (rows.length === 0) return '至少留一条（页面按空列表会渲染成空壳）';
  const seen = new Set<string>();
  for (const row of rows) {
    const at = row.title || row.url || '(未命名)';
    if (!row.title) return `「${at}」缺标题`;
    if (!row.url) return `「${at}」缺网址`;
    if (!row.url.startsWith('https://')) return `「${at}」的网址必须以 https:// 开头`;
    if (seen.has(row.url)) return `网址重复：${row.url}`;
    seen.add(row.url);
    if (!row.note.zh.trim()) return `「${at}」缺中文说明（note.zh 必填）`;
    if (row.topics.length === 0) return `「${at}」至少要选一个主题`;
    const stray = row.topics.filter((k) => !TOPICS[k]);
    if (stray.length) return `「${at}」有词表外的主题：${stray.join(', ')}`;
    if (!DATE_RE.test(row.addedAt)) return `「${at}」的收录日期要写成 YYYY-MM-DD`;
  }
  return null;
}

// ---------------------------------------------------------------- 增删

function addRow(): void {
  const row: Row = {
    key: nextKey(),
    url: '',
    title: '',
    note: { zh: '' },
    topics: [],
    addedAt: today(),
    featured: false,
  };
  rows = [row, ...rows];
  current = row.key;
  markDirty();
  renderList();
  renderEditor();
  $<HTMLInputElement>('lnk-url').focus();
}

async function removeRow(): Promise<void> {
  const row = editing();
  if (!row) return;
  const ok = await confirmDialog({
    title: '删除这条收藏',
    body: row.title || row.url || '(未命名)',
    okLabel: '删除',
  });
  if (!ok) return;
  const index = rows.findIndex((r) => r.key === row.key);
  rows = rows.filter((r) => r.key !== row.key);
  // 选中项挪到相邻那条，删完不至于右栏突然空掉
  current = rows[Math.min(index, rows.length - 1)]?.key ?? null;
  markDirty();
  renderList();
  renderEditor();
  setStatus('已从列表移除，点「保存到仓库」才写进仓库', 'info');
}

/** 上移 / 下移：文件里的顺序就是渲染权重相同时的次序，动它比手改 JSON 稳 */
function move(step: number): void {
  const row = editing();
  if (!row) return;
  const from = rows.findIndex((r) => r.key === row.key);
  const to = from + step;
  if (to < 0 || to >= rows.length) return;
  const copy = [...rows];
  [copy[from], copy[to]] = [copy[to], copy[from]];
  rows = copy;
  markDirty();
  renderList();
}

// ---------------------------------------------------------------- 保存

async function saveLinks(): Promise<void> {
  const token = requireToken();
  if (!token) return;
  pullEditor();

  const problem = validate();
  if (problem) {
    setStatus(`还不能保存：${problem}`, 'error');
    return;
  }

  const text = stableLinksJson(rows);
  setStatus('正在写入仓库…', 'busy');
  try {
    await saveFile(
      repo as Repo,
      paths.gleaningsLinks(),
      token,
      text,
      `update gleanings: links.json（${rows.length} 条）`
    );
    dirty = false;
    $('lnk-save').classList.remove('btn--primary');
    setStatus('已保存 links.json，Actions 大约 1 分钟后上线。', 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : (e as Error).message || String(e), 'error');
  }
}

// ---------------------------------------------------------------- 装配

export function initGleaningsLinks(): void {
  $('lnk-new').addEventListener('click', addRow);
  $('lnk-reload').addEventListener('click', () => run(loadLinks));
  $('lnk-save').addEventListener('click', () => run(saveLinks));
  $('lnk-delete').addEventListener('click', () => run(removeRow));
  $('lnk-up').addEventListener('click', () => move(-1));
  $('lnk-down').addEventListener('click', () => move(1));
  $('lnk-filter').addEventListener('input', () => renderList());

  for (const id of ['lnk-url', 'lnk-title', 'lnk-note-zh', 'lnk-note-en', 'lnk-added']) {
    $(id).addEventListener('input', pullEditor);
  }
  $('lnk-featured').addEventListener('change', pullEditor);

  if (activeSection() === 'links') ensureLinksLoaded();
  document.addEventListener('admin:section', (e) => {
    if ((e as CustomEvent<string>).detail === 'links') ensureLinksLoaded();
  });

  // 切走时提醒一次：内存里的改动还没进仓库（与文章分区的未保存提示同义）
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

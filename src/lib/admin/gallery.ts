import { repo, paths, rawUrl } from '../../data/admin';
import {
  deleteFile,
  listDir,
  readBase64,
  readFile,
  saveBase64File,
  saveBinaryFile,
  saveFile,
  GhError,
  type Repo,
} from './github';
import { HALL_STYLE_IDS } from '../gallery/styles';
import { compressToWebp, humanSize } from './upload';
import { requireToken } from './token';
import { waitForBuild } from './actions';
import { $, confirmDialog, run, setStatus, setTopbarPath } from './dom';

/**
 * 「画廊」分区（2026-09-15 合集制）。
 *
 * 这一块管的东西和别的分区不一样：**没有一份「画廊数据文件」**。
 * 一个合集 = `public/gallery/<合集 id>/` 一个目录
 *   · 目录里的图片文件  = 这个合集的照片（构建期扫目录，见 src/data/gallery.ts）
 *   · 目录里的 meta.json = 文案与编排（schema 见 src/data/gallery.schema.ts）
 *   · 目录里的 thumbs/   = 可选缩略图，按同名 stem 匹配
 * 所以后台做的是「目录的增删改查」+「一份 meta.json 的表单」，而不是改一份中心清单。
 *
 * 三条贯穿全篇的约定：
 *
 * ① **meta.json 的 key 顺序按 schema 声明顺序写**（title / subtitle / note / mode /
 *    style / theme / year / cover / order / tags / gear / photos）。顺序稳定，
 *    每次保存才只有真正改过的那几行 diff；随手拼对象会让整份文件看起来全变了。
 *
 * ② **照片的存在与否由目录里的文件决定，不由 meta.json 决定**。所以「加图」= 传文件，
 *    「删图」= 删文件，meta.json 里对应地补/摘一条 order 与 photos。反过来做
 *    （只改 JSON）会得到一个指向不存在文件的条目，构建期直接抛错。
 *
 * ③ **每次写都是真写仓库**（和后台其他分区一致）。写完给 commit sha 交给
 *    actions.ts 轮询构建，失败就把失败步骤列出来，不用去 GitHub 页面翻。
 */

/** 认图的扩展名：与 src/data/gallery.schema.ts 的 IMAGE_EXT 保持一致 */
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;

/** 上传时压缩的最长边。画廊是「看大图」的地方，比正文配图（1600）留得宽一些 */
const MAX_EDGE = 2400;
/** 缩略图最长边（thumbs/ 里那份） */
const THUMB_EDGE = 720;
/** 单张上限（压缩之后） */
const MAX_BYTES = 8 * 1024 * 1024;

interface PhotoMetaDoc {
  title?: { zh: string; en: string };
  desc?: { zh: string; en: string };
  year?: number;
  camera?: string;
  gear?: string;
  tags?: string[];
}

interface MetaDoc {
  title: { zh: string; en: string };
  subtitle?: { zh: string; en: string };
  note?: { zh: string; en: string };
  mode: 'flat' | '3d';
  style: string;
  theme: string;
  year: number;
  cover?: string;
  order: string[];
  tags: string[];
  gear: string[];
  photos: Record<string, PhotoMetaDoc>;
}

interface AdminPhoto {
  file: string;
  /** 仓库相对路径 */
  path: string;
  size: number;
  hasThumb: boolean;
}

interface AdminCollection {
  id: string;
  /** meta.json 缺失时是 null：目录里只有图，构建会红，后台要能替它补一份 */
  meta: MetaDoc | null;
  photos: AdminPhoto[];
}

let collections: AdminCollection[] = [];
let current: AdminCollection | null = null;
let loaded = false;
let loading = false;
let busy = false;
/** 刚上传、还没部署的图：用本地 blob 顶上，免得缩略图是一个裂图 */
const localBlobs = new Map<string, string>();

// ---------------------------------------------------------------- 工具

const IMG_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/** 文件名 slug：压成 ASCII；中文名压没了就返回空串，由调用方兜底 */
function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** '夜景, 街拍' → ['夜景','街拍'] */
function splitList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 值是不是「两份都空」：空的 subtitle / note 不该写成 {"zh":"","en":""} */
function blankPair(pair: { zh: string; en: string }): boolean {
  return !pair.zh.trim() && !pair.en.trim();
}

function thumbUrl(collectionId: string, photo: AdminPhoto): string {
  const local = localBlobs.get(photo.path);
  if (local) return local;
  return rawUrl(photo.hasThumb ? paths.galleryThumb(collectionId, `${photo.file.replace(/\.[^.]+$/, '')}.webp`) : photo.path);
}

// ---------------------------------------------------------------- 读取

async function readCollection(id: string, token: string): Promise<AdminCollection> {
  const dir = paths.galleryDir() + '/' + id;
  const entries = await listDir(repo as Repo, dir, token);

  const thumbNames = new Set<string>();
  const photos: AdminPhoto[] = [];

  for (const entry of entries) {
    if (entry.type === 'file' && IMAGE_RE.test(entry.name)) {
      photos.push({ file: entry.name, path: entry.path, size: entry.size ?? 0, hasThumb: false });
    }
  }

  // thumbs/ 单独列一次：目录列表是浅的，不会带出子目录里的文件
  const thumbs = await listDir(repo as Repo, paths.galleryDir() + `/${id}/thumbs`, token);
  for (const entry of thumbs) {
    if (entry.type === 'file' && IMAGE_RE.test(entry.name)) {
      thumbNames.add(entry.name.replace(/\.[^.]+$/, ''));
    }
  }
  for (const photo of photos) {
    photo.hasThumb = thumbNames.has(photo.file.replace(/\.[^.]+$/, ''));
  }

  const metaFile = await readFile(repo as Repo, paths.galleryMeta(id), token);
  let meta: MetaDoc | null = null;
  if (metaFile) {
    try {
      meta = JSON.parse(metaFile.text) as MetaDoc;
    } catch {
      // 坏的 JSON 不吞掉：让使用者知道要去修，而不是被一份空表单盖掉
      setStatus(`${paths.galleryMeta(id)} 不是合法 JSON，已按空表单展示。`, 'error');
    }
  }

  // 排序按 meta.order，没列到的（新丢进去的文件）按文件名自然序接在后面 ——
  // 与构建期 src/data/gallery.ts 里那套顺序规则保持一致，否则后台看到的顺序和线上不一样
  const byName = new Map(photos.map((photo) => [photo.file, photo]));
  const ordered: AdminPhoto[] = [];
  const taken = new Set<string>();
  for (const file of meta?.order ?? []) {
    const photo = byName.get(file);
    if (photo && !taken.has(file)) {
      taken.add(file);
      ordered.push(photo);
    }
  }
  for (const photo of [...photos].sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }))) {
    if (!taken.has(photo.file)) {
      taken.add(photo.file);
      ordered.push(photo);
    }
  }

  return { id, meta, photos: ordered };
}

async function load(token: string, { keep = null }: { keep?: string | null } = {}): Promise<void> {
  if (loading) return;
  loading = true;
  setStatus('正在读取 public/gallery…', 'busy');
  setTopbarPath(paths.galleryDir());
  try {
    const entries = await listDir(repo as Repo, paths.galleryDir(), token);
    const ids = entries
      .filter((entry) => entry.type === 'dir' && entry.name !== 'thumbs' && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    const next: AdminCollection[] = [];
    for (const id of ids) {
      next.push(await readCollection(id, token));
      setStatus(`正在读取 public/gallery…（${next.length}/${ids.length}）`, 'busy');
    }

    collections = next;
    loaded = true;
    const wanted = keep ?? current?.id ?? ids[0] ?? null;
    current = collections.find((item) => item.id === wanted) ?? collections[0] ?? null;
    render();
    setStatus(`已读取 ${collections.length} 个合集。`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    loading = false;
  }
}

// ---------------------------------------------------------------- 渲染

function render(): void {
  renderList();
  renderEditor();
}

function renderList(): void {
  const list = $<HTMLUListElement>('gal-items');
  const meta = $('gal-list-meta');
  const filter = $<HTMLInputElement>('gal-filter').value.trim().toLowerCase();

  const visible = collections.filter(
    (item) => !filter || item.id.toLowerCase().includes(filter) || (item.meta?.title.zh ?? '').includes(filter)
  );

  list.textContent = '';
  for (const item of visible) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pcard galp-card';
    btn.dataset.galId = item.id;
    if (current?.id === item.id) btn.classList.add('is-active');
    if (!item.meta) btn.classList.add('is-broken');

    const name = document.createElement('span');
    name.className = 'pcard__title';
    name.textContent = item.meta?.title.zh || item.id;

    const sub = document.createElement('span');
    sub.className = 'pcard__meta';
    const bits = [item.id, `${item.photos.length} 张`];
    if (item.meta?.mode === '3d') bits.push('3D');
    if (!item.meta) bits.push('缺 meta.json');
    sub.textContent = bits.join(' · ');

    btn.append(name, sub);
    li.append(btn);
    list.append(li);
  }

  if (!visible.length) {
    const li = document.createElement('li');
    li.className = 'galp-list-empty';
    li.textContent = collections.length ? '没有匹配的合集。' : '还没有合集。点上面的「新建合集」开一个。';
    list.append(li);
  }

  meta.textContent = collections.length ? `${visible.length} / ${collections.length} 个合集` : '';
}

/** 表单里那批固定 id 的输入框 */
function field(id: string): HTMLInputElement & HTMLTextAreaElement {
  return $<HTMLInputElement>(id);
}

function renderEditor(): void {
  const placeholder = $('gal-placeholder');
  const editor = $('gal-editor');

  if (!current) {
    placeholder.hidden = false;
    editor.hidden = true;
    return;
  }
  placeholder.hidden = true;
  editor.hidden = false;

  const meta = current.meta;
  $('gal-crumb').textContent = paths.galleryDir() + '/' + current.id;
  $('gal-detected').textContent = meta
    ? ''
    : '这个目录没有 meta.json —— 构建会因此失败。填好下面的字段并保存就会补上。';

  field('gal-title-zh').value = meta?.title.zh ?? current.id;
  field('gal-title-en').value = meta?.title.en ?? current.id;
  field('gal-subtitle-zh').value = meta?.subtitle?.zh ?? '';
  field('gal-subtitle-en').value = meta?.subtitle?.en ?? '';
  field('gal-note-zh').value = meta?.note?.zh ?? '';
  field('gal-note-en').value = meta?.note?.en ?? '';
  $<HTMLSelectElement>('gal-mode').value = meta?.mode ?? 'flat';
  $<HTMLSelectElement>('gal-style').value = meta?.style ?? 'whitecube';
  field('gal-theme').value = meta?.theme ?? 'misc';
  field('gal-year').value = String(meta?.year ?? new Date().getFullYear());
  field('gal-tags').value = (meta?.tags ?? []).join(', ');
  field('gal-gear').value = (meta?.gear ?? []).join(', ');

  syncStyleRow();
  renderCoverSelect();
  renderPhotos();
}

/** 形制只对 3D 有意义：flat 时整行藏掉，免得填了也不生效 */
function syncStyleRow(): void {
  const is3d = $<HTMLSelectElement>('gal-mode').value === '3d';
  $('gal-style-row').hidden = !is3d;
  $('gal-style-hint').hidden = !is3d;
}

function renderCoverSelect(): void {
  const select = $<HTMLSelectElement>('gal-cover');
  select.textContent = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = '（自动：排序后的第一张）';
  select.append(auto);

  for (const photo of current?.photos ?? []) {
    const option = document.createElement('option');
    option.value = photo.file;
    option.textContent = photo.file;
    select.append(option);
  }
  select.value = current?.meta?.cover ?? '';
  // cover 指向的文件不在了（比如刚被删）：保留它的值，保存时会写回一个坏路径，
  // 所以这里直接落回「自动」，并且告诉使用者一声
  if (select.value !== (current?.meta?.cover ?? '')) {
    select.value = '';
    setStatus('原封面文件不在目录里了，已改成「自动」。', 'info');
  }
}

function renderPhotos(): void {
  const list = $<HTMLUListElement>('gal-photos');
  list.textContent = '';
  const id = current?.id ?? '';
  const cover = $<HTMLSelectElement>('gal-cover').value;
  $('gal-photo-count').textContent = `${current?.photos.length ?? 0} 张图`;

  if (!current?.photos.length) {
    const li = document.createElement('li');
    li.className = 'galp-empty';
    li.textContent = '这个目录里还没有图片。拖图片到上面的框里就会传进 public/gallery/' + id + '/。';
    list.append(li);
    return;
  }

  current.photos.forEach((photo, index) => {
    const own = current?.meta?.photos?.[photo.file] ?? {};
    const li = document.createElement('li');
    li.className = 'galp-item';
    li.dataset.file = photo.file;

    // ── 缩略图 + 文件名 + 位置
    const head = document.createElement('div');
    head.className = 'galp-item__head';

    const img = document.createElement('img');
    img.className = 'galp-item__thumb';
    img.src = thumbUrl(id, photo);
    img.alt = photo.file;
    img.loading = 'lazy';
    img.decoding = 'async';
    // 私有仓库或还没部署时 rawUrl 会 404：给个占位，不要让裂图图标占着位置
    img.addEventListener('error', () => {
      img.classList.add('is-broken');
      img.removeAttribute('src');
    });

    const info = document.createElement('div');
    info.className = 'galp-item__info';

    const name = document.createElement('code');
    name.className = 'galp-item__name';
    name.textContent = photo.file;

    const bits = document.createElement('span');
    bits.className = 'galp-item__bits';
    bits.textContent = [
      `${index + 1} / ${current?.photos.length ?? 0}`,
      photo.size ? humanSize(photo.size) : '',
      photo.hasThumb ? '有缩略图' : '无缩略图',
      cover === photo.file ? '封面' : '',
    ]
      .filter(Boolean)
      .join(' · ');

    info.append(name, bits);

    const tools = document.createElement('div');
    tools.className = 'galp-item__tools';
    tools.append(
      toolBtn('↑', '上移', () => void movePhoto(photo.file, -1), index === 0),
      toolBtn('↓', '下移', () => void movePhoto(photo.file, 1), index === (current?.photos.length ?? 0) - 1),
      toolBtn('封面', '设为封面', () => {
        $<HTMLSelectElement>('gal-cover').value = photo.file;
        renderPhotos();
      }, cover === photo.file),
      toolBtn('删除', '从仓库删掉这张图', () => void removePhoto(photo.file))
    );

    head.append(img, info, tools);

    // ── 单张元数据：默认折起来。几百张图的合集若把输入框全铺开，
    //    浏览器要背几百组受控输入，滚动和输入都会卡
    const details = document.createElement('details');
    details.className = 'galp-item__more';
    const summary = document.createElement('summary');
    summary.textContent = '单张信息（标题 / 说明 / 器材 / 关键词）';
    details.append(summary);

    const grid = document.createElement('div');
    grid.className = 'galp-fields';
    grid.dataset.for = photo.file;

    grid.append(
      labelled('标题 zh', textInput(`${photo.file}:title.zh`, own.title?.zh ?? '')),
      labelled('标题 en', textInput(`${photo.file}:title.en`, own.title?.en ?? '')),
      labelled('年份', textInput(`${photo.file}:year`, own.year ? String(own.year) : '', 'text', '留空=继承合集')),
      labelled('器材', textInput(`${photo.file}:camera`, own.camera ?? '', 'text', '如 Sony A7C · 35mm f/1.8')),
      labelled('关键词', textInput(`${photo.file}:tags`, (own.tags ?? []).join(', '), 'text', '逗号分隔')),
      labelled('说明 zh', textArea(`${photo.file}:desc.zh`, own.desc?.zh ?? '')),
      labelled('说明 en', textArea(`${photo.file}:desc.en`, own.desc?.en ?? ''))
    );

    details.append(grid);
    li.append(head, details);
    list.append(li);
  });
}

function toolBtn(label: string, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--xs btn--ghost galp-tool';
  btn.textContent = label;
  btn.title = title;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function textInput(
  key: string,
  value: string,
  type = 'text',
  placeholder = ''
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.className = 'input input--xs galp-input';
  input.dataset.key = key;
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.spellcheck = false;
  return input;
}

function textArea(key: string, value: string): HTMLTextAreaElement {
  const area = document.createElement('textarea');
  area.className = 'input input--xs galp-input galp-textarea';
  area.dataset.key = key;
  area.value = value;
  area.rows = 2;
  area.spellcheck = false;
  return area;
}

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'galp-field';
  const span = document.createElement('span');
  span.textContent = text;
  wrap.append(span, control);
  return wrap;
}

// ---------------------------------------------------------------- 表单 → meta

/** 从表单拼一份 meta.json（key 顺序 = schema 声明顺序，见文件头注释①） */
function collectMeta(): MetaDoc {
  const id = current?.id ?? '';
  const pair = (prefix: string) => ({
    zh: field(`gal-${prefix}-zh`).value.trim(),
    en: field(`gal-${prefix}-en`).value.trim(),
  });

  const title = pair('title');
  if (!title.zh && !title.en) title.zh = title.en = id;

  const meta: MetaDoc = {
    title,
    mode: $<HTMLSelectElement>('gal-mode').value === '3d' ? '3d' : 'flat',
    style: $<HTMLSelectElement>('gal-style').value,
    theme: field('gal-theme').value.trim() || 'misc',
    year: Number.parseInt(field('gal-year').value, 10) || new Date().getFullYear(),
    order: (current?.photos ?? []).map((photo) => photo.file),
    tags: splitList(field('gal-tags').value),
    gear: splitList(field('gal-gear').value),
    photos: {},
  };

  const subtitle = pair('subtitle');
  if (!blankPair(subtitle)) meta.subtitle = subtitle;
  const note = pair('note');
  if (!blankPair(note)) meta.note = note;

  const cover = $<HTMLSelectElement>('gal-cover').value;
  if (cover) meta.cover = cover;

  // 先把界面上所有单张输入框收成一张 map（data-key 形如 `<文件名>:title.zh`）。
  // 不按 key 现拼选择器：文件名里的点、引号、方括号会直接把选择器写坏，
  // 而 CSS.escape 转义的是标识符，不是属性值里的那串字符串
  const boxes = new Map<string, string>();
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.galp-input')) {
    boxes.set(input.dataset.key ?? '', input.value);
  }

  // 按文件名收每张图的信息：只留真正填过的字段，全空的条目整个不写
  for (const photo of current?.photos ?? []) {
    const read = (suffix: string) => boxes.get(`${photo.file}:${suffix}`) ?? '';

    const entry: PhotoMetaDoc = {};
    const titleZh = read('title.zh').trim();
    const titleEn = read('title.en').trim();
    if (titleZh || titleEn) entry.title = { zh: titleZh, en: titleEn };
    const descZh = read('desc.zh').trim();
    const descEn = read('desc.en').trim();
    if (descZh || descEn) entry.desc = { zh: descZh, en: descEn };
    const year = Number.parseInt(read('year'), 10);
    if (Number.isFinite(year)) entry.year = year;
    const camera = read('camera').trim();
    if (camera) entry.camera = camera;
    const tags = splitList(read('tags'));
    if (tags.length) entry.tags = tags;

    if (Object.keys(entry).length) meta.photos[photo.file] = entry;
  }

  return meta;
}

function serializeMeta(meta: MetaDoc): string {
  return `${JSON.stringify(meta, null, 2)}\n`;
}

// ---------------------------------------------------------------- 写仓库

function setBusy(on: boolean): void {
  busy = on;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-gal-write]')) {
    btn.disabled = on;
  }
}

async function writeMeta(token: string, meta: MetaDoc, message: string): Promise<string | null> {
  const id = current?.id;
  if (!id) return null;
  const sha = await saveFile(repo as Repo, paths.galleryMeta(id), token, serializeMeta(meta), message);
  current.meta = meta;
  return sha;
}

/** 写完之后盯一眼 Actions：失败就把失败步骤列出来，不让构建静默红掉 */
function watchBuild(sha: string | null): void {
  if (!sha) return;
  void (async () => {
    setStatus('已写入仓库，正在等 Actions 构建…', 'busy');
    const result = await waitForBuild(sha);
    if (result.phase === 'success') {
      setStatus(`构建完成（${result.seconds}s），线上已生效。`, 'ok');
    } else if (result.phase === 'failure') {
      setStatus(`构建失败：${result.steps.join('；') || '见 Actions 日志'}`, 'error');
    } else if (result.phase === 'timeout') {
      setStatus('构建还在跑，去 Actions 页面看看。', 'info');
    } else {
      setStatus('已写入仓库（这个 token 读不到 Actions 状态，约 1 分钟后生效）。', 'ok');
    }
  })();
}

async function saveMeta(): Promise<void> {
  const token = requireToken();
  if (!token || busy || !current) return;

  setBusy(true);
  setStatus('正在保存 meta.json…', 'busy');
  try {
    const meta = collectMeta();
    const sha = await writeMeta(token, meta, `gallery: update ${current.id}/meta.json`);
    renderCoverSelect();
    renderList();
    setStatus(`已保存 ${paths.galleryMeta(current.id)}。`, 'ok');
    watchBuild(sha);
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    setBusy(false);
  }
}

/** 上传：压缩 → 定名 → 写仓库 → 补进 order → 存 meta */
async function upload(files: readonly File[]): Promise<void> {
  const token = requireToken();
  if (!token || busy || !current) return;
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (!images.length) {
    setStatus('这些文件里没有图片。', 'error');
    return;
  }

  const collection = current;
  setBusy(true);
  const take = new Set(collection.photos.map((photo) => photo.file));
  let done = 0;

  try {
    for (const file of images) {
      setStatus(`正在上传 ${done + 1}/${images.length}：${file.name}…`, 'busy');
      const { blob, ext } = await compressToWebp(file, MAX_EDGE);
      if (blob.size > MAX_BYTES) {
        setStatus(`${file.name} 压完还有 ${humanSize(blob.size)}，超过 8MB，先自己压一下。`, 'error');
        continue;
      }

      // 定名：优先用原文件名的 slug，中文名压没了就用时间戳。
      // 撞名只在同一目录里加序号，不做「跳过」，否则批量上传时会静默少几张
      const stem = slugify(file.name) || `photo-${stamp()}`;
      let name = `${stem}.${ext}`;
      for (let n = 2; take.has(name); n += 1) name = `${stem}-${n}.${ext}`;
      take.add(name);

      const bytes = new Uint8Array(await blob.arrayBuffer());
      await saveBinaryFile(repo as Repo, paths.galleryPhoto(collection.id, name), token, bytes, `gallery: add ${collection.id}/${name}`);
      localBlobs.set(paths.galleryPhoto(collection.id, name), URL.createObjectURL(blob));

      // 顺带配一张 720px 缩略图：集合页与照片流都要缩略图，
      // 让浏览器现场压一次比构建期再引一个图像库便宜得多
      if ($<HTMLInputElement>('gal-thumbs').checked && file.type !== 'image/gif') {
        const small = await compressToWebp(file, THUMB_EDGE);
        if (small.blob.size) {
          await saveBinaryFile(
            repo as Repo,
            paths.galleryThumb(collection.id, `${name.replace(/\.[^.]+$/, '')}.webp`),
            token,
            new Uint8Array(await small.blob.arrayBuffer()),
            `gallery: add ${collection.id}/thumbs/${name}`
          );
        }
      }

      collection.photos.push({
        file: name,
        path: paths.galleryPhoto(collection.id, name),
        size: blob.size,
        hasThumb: $<HTMLInputElement>('gal-thumbs').checked && file.type !== 'image/gif',
      });
      done += 1;
    }

    if (!done) return;

    // order 跟着目录走：新加的排在最后，已有顺序不动
    const meta = collectMeta();
    const sha = await writeMeta(token, meta, `gallery: order ${collection.id} (+${done})`);
    render();
    setStatus(`已上传 ${done} 张到 ${collection.id}/。`, 'ok');
    watchBuild(sha);
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    setBusy(false);
  }
}

async function removePhoto(file: string): Promise<void> {
  const token = requireToken();
  if (!token || busy || !current) return;
  const ok = await confirmDialog({
    title: '删除这张图？',
    body: `${current.id}/${file}\n\n文件会从仓库里删掉，同时从 meta.json 的 order 与 photos 里摘掉。\n构建完成后线上就不再有这张图了。`,
    okLabel: '删除',
  });
  if (!ok) return;

  const collection = current;
  setBusy(true);
  try {
    await deleteFile(repo as Repo, paths.galleryPhoto(collection.id, file), token, `gallery: delete ${collection.id}/${file}`);

    // 缩略图按 stem 匹配，扩展名可能是 webp 也可能是原样：
    // 列一次目录去对，比猜几个扩展名可靠
    const stem = file.replace(/\.[^.]+$/, '');
    const thumbs = await listDir(repo as Repo, `${paths.galleryDir()}/${collection.id}/thumbs`, token);
    for (const entry of thumbs) {
      if (entry.type !== 'file' || entry.name.replace(/\.[^.]+$/, '') !== stem) continue;
      await deleteFile(repo as Repo, entry.path, token, `gallery: delete ${collection.id}/thumbs/${entry.name}`);
    }

    collection.photos = collection.photos.filter((photo) => photo.file !== file);
    const meta = collectMeta();
    if (meta.cover === file) delete meta.cover;
    const sha = await writeMeta(token, meta, `gallery: delete ${collection.id}/${file}`);
    render();
    setStatus(`已删除 ${file}。`, 'ok');
    watchBuild(sha);
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    setBusy(false);
  }
}

/**
 * 调序：只改 meta.order，不动文件。
 * 因为「顺序」是元数据，不是文件名 —— 靠重命名来排序会把 URL 改掉，
 * 外部引用（比如某篇文章里贴的图）就断了。
 */
async function movePhoto(file: string, delta: number): Promise<void> {
  const token = requireToken();
  if (!token || busy || !current) return;
  const list = current.photos;
  const index = list.findIndex((photo) => photo.file === file);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return;

  const [moved] = list.splice(index, 1);
  list.splice(target, 0, moved);

  setBusy(true);
  try {
    const sha = await writeMeta(token, collectMeta(), `gallery: reorder ${current.id}`);
    renderPhotos();
    setStatus(`已调整 ${file} 的位置（记得等构建完成）。`, 'ok');
    watchBuild(sha);
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- 合集的增删改名

/** 新建：只写一份 meta.json —— 目录里没图时构建会报「一张图都没有」，所以文案里提醒了 */
async function createCollection(): Promise<void> {
  const token = requireToken();
  if (!token || busy) return;

  const raw = window.prompt(
    '新合集的目录名（= URL 段，只能用小写字母、数字、连字符）：\n例如 autumn-rain',
    ''
  );
  if (raw === null) return;
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    setStatus('目录名只能用 a-z、0-9 和连字符，且不能以连字符开头或结尾。', 'error');
    return;
  }
  if (collections.some((item) => item.id === id)) {
    setStatus(`${id} 已经存在了。`, 'error');
    return;
  }

  setBusy(true);
  try {
    const meta: MetaDoc = {
      title: { zh: id, en: id },
      mode: 'flat',
      style: 'whitecube',
      theme: 'misc',
      year: new Date().getFullYear(),
      order: [],
      tags: [],
      gear: [],
      photos: {},
    };
    await saveFile(repo as Repo, paths.galleryMeta(id), token, serializeMeta(meta), `gallery: create ${id}`);
    await load(token, { keep: id });
    setStatus(`已创建合集 ${id}，接下来往里传图并填写文案。`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    setBusy(false);
  }
}

/**
 * 改名（换目录）：新建目录 → 逐张搬图 → 删旧目录里的文件 → 登记旧地址。
 *
 * 「登记旧地址」这一步不能省：目录名就是 URL 段，改名等于换地址，
 * 而旧地址是推上线过的，不登记就会 404。登记表由构建期读
 * （src/data/gallery.ts 的 registeredRedirects）。
 */
async function renameCollection(): Promise<void> {
  const token = requireToken();
  if (!token || busy || !current) return;
  const from = current.id;

  const raw = window.prompt(
    `把 ${from} 改成新的目录名（旧地址会登记成 301 跳转）：`,
    from
  );
  if (raw === null) return;
  const to = raw.trim().toLowerCase();
  if (to === from) return;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(to)) {
    setStatus('目录名只能用 a-z、0-9 和连字符。', 'error');
    return;
  }
  if (collections.some((item) => item.id === to)) {
    setStatus(`${to} 已经存在了。`, 'error');
    return;
  }

  const ok = await confirmDialog({
    title: `把 ${from} 改成 ${to}？`,
    body:
      `会新建 public/gallery/${to}/，把 ${current.photos.length} 张图逐张搬过去（每张一次读+写+删请求），再删掉旧目录。\n\n` +
      `目录名就是 URL：线上会变成 /gallery/${to}/。旧的 /gallery/${from}/ 会被登记成 301 跳转。\n\n` +
      `图多的时候会慢一些，中途别关页面。`,
    okLabel: '开始改名',
  });
  if (!ok) return;

  const collection = current;
  setBusy(true);
  try {
    const meta = collectMeta();
    await saveFile(repo as Repo, paths.galleryMeta(to), token, serializeMeta(meta), `gallery: rename ${from} → ${to}`);

    // 图片必须走 base64 直通：readFile 会按 UTF-8 解码，图片当场坏掉
    const move = async (fromPath: string, toPath: string, label: string) => {
      const bin = await readBase64(repo as Repo, fromPath, token);
      if (!bin) return;
      await saveBase64File(repo as Repo, toPath, token, bin.b64, `gallery: move ${label}`);
      await deleteFile(repo as Repo, fromPath, token, `gallery: drop old ${label}`);
    };

    for (let i = 0; i < collection.photos.length; i += 1) {
      const photo = collection.photos[i];
      setStatus(`正在搬图 ${i + 1}/${collection.photos.length}：${photo.file}…`, 'busy');
      await move(photo.path, paths.galleryPhoto(to, photo.file), `${to}/${photo.file}`);
    }

    // 缩略图同样搬一遍（它是可选的，缺了也不影响构建）
    const thumbs = await listDir(repo as Repo, `${paths.galleryDir()}/${from}/thumbs`, token);
    for (const entry of thumbs) {
      if (entry.type !== 'file') continue;
      await move(entry.path, paths.galleryThumb(to, entry.name), `thumbs/${entry.name}`);
    }

    await deleteFile(repo as Repo, paths.galleryMeta(from), token, `gallery: drop old ${from}/meta.json`);
    await registerRedirect(token, from, to);
    await load(token, { keep: to });
    setStatus(`已改名为 ${to}，旧地址 ${from} 会 301 过去。`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    setBusy(false);
  }
}

/** 旧地址登记表：读 → 去重 → 写回 */
async function registerRedirect(token: string, from: string, to: string): Promise<void> {
  const file = await readFile(repo as Repo, paths.galleryRedirects(), token);
  let list: { from: string; to: string }[] = [];
  if (file) {
    try {
      const parsed = JSON.parse(file.text) as unknown;
      if (Array.isArray(parsed)) list = parsed as { from: string; to: string }[];
    } catch {
      setStatus('gallery-redirects.json 不是合法 JSON，已重建（旧登记会丢）。', 'error');
    }
  }

  // 同一目标只留最新的一条；顺带把「链式跳转」压平（a→b、b→c 时把 a 直接指到 c）
  list = list.filter((entry) => entry.from !== from && entry.to !== from);
  list.push({ from, to });
  const flat = new Map(list.map((entry) => [entry.from, entry.to]));
  const resolved = list.map((entry) => {
    let target = entry.to;
    for (let hops = 0; hops < 8 && flat.has(target) && flat.get(target) !== target; hops += 1) {
      target = flat.get(target) as string;
    }
    return { from: entry.from, to: target };
  });

  await saveFile(repo as Repo, paths.galleryRedirects(), token, `${JSON.stringify(resolved, null, 2)}\n`, `gallery: redirect ${from} → ${to}`);
}

/** 删合集：连目录里的图和 meta.json 一起删 */
async function deleteCollection(): Promise<void> {
  const token = requireToken();
  if (!token || busy || !current) return;
  const collection = current;

  const ok = await confirmDialog({
    title: `删掉整个合集 ${collection.id}？`,
    body:
      `会删除 public/gallery/${collection.id}/ 下的 ${collection.photos.length} 张图、缩略图与 meta.json。\n\n` +
      `线上这一页和它的所有照片都会消失，且没有回收站。\n` +
      `如果只是暂时不想展出，更稳的做法是把 note 清空、或者先改名（那样至少还有一份 301 跳转）。`,
    okLabel: '删除整个合集',
  });
  if (!ok) return;

  setBusy(true);
  try {
    const thumbs = await listDir(repo as Repo, `${paths.galleryDir()}/${collection.id}/thumbs`, token);
    const targets = [
      ...collection.photos.map((photo) => photo.path),
      ...thumbs.filter((entry) => entry.type === 'file').map((entry) => entry.path),
      paths.galleryMeta(collection.id),
    ];

    for (let i = 0; i < targets.length; i += 1) {
      setStatus(`正在删除 ${i + 1}/${targets.length}…`, 'busy');
      await deleteFile(repo as Repo, targets[i], token, `gallery: delete collection ${collection.id}`);
    }

    // 指向它的旧地址登记也一并撤掉，免得留在表里 301 到一个 404
    await pruneRedirects(token, collection.id);

    await load(token, { keep: null });
    setStatus(`已删除合集 ${collection.id}（${targets.length} 个文件，各自一次提交）。`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    setBusy(false);
  }
}

/** 合集没了，指向它的登记条目也就没意义了 */
async function pruneRedirects(token: string, goneId: string): Promise<void> {
  const file = await readFile(repo as Repo, paths.galleryRedirects(), token);
  if (!file) return;
  let list: { from: string; to: string }[] = [];
  try {
    const parsed = JSON.parse(file.text) as unknown;
    if (Array.isArray(parsed)) list = parsed as { from: string; to: string }[];
  } catch {
    return;
  }
  const kept = list.filter((entry) => entry.to !== goneId && entry.from !== goneId);
  if (kept.length === list.length) return;
  await saveFile(repo as Repo, paths.galleryRedirects(), token, `${JSON.stringify(kept, null, 2)}\n`, `gallery: drop redirects to ${goneId}`);
}

// ---------------------------------------------------------------- 装配

export function initGallery(): void {
  $('gal-reload').addEventListener('click', () => run(async () => {
    const token = requireToken();
    if (token) await load(token);
  }));
  $('gal-new').addEventListener('click', () => run(createCollection));

  $<HTMLInputElement>('gal-filter').addEventListener('input', () => renderList());
  $<HTMLUListElement>('gal-items').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-gal-id]');
    if (!btn) return;
    current = collections.find((item) => item.id === btn.dataset.galId) ?? null;
    render();
  });

  $('gal-mode').addEventListener('change', syncStyleRow);
  $<HTMLSelectElement>('gal-cover').addEventListener('change', () => renderPhotos());
  $('gal-save').addEventListener('click', () => run(saveMeta));
  $('gal-rename').addEventListener('click', () => run(renameCollection));
  $('gal-delete-all').addEventListener('click', () => run(deleteCollection));

  // 拖入 / 点选上传
  const drop = $('gal-drop');
  const input = $<HTMLInputElement>('gal-file');
  const pick = () => input.click();
  drop.addEventListener('click', pick);
  drop.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      pick();
    }
  });
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) run(() => upload(files));
  });

  for (const type of ['dragover', 'dragenter']) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('is-dropping');
    });
  }
  for (const type of ['dragleave', 'dragend']) {
    drop.addEventListener(type, () => drop.classList.remove('is-dropping'));
  }
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dropping');
    const files = Array.from((e as DragEvent).dataTransfer?.files ?? []);
    if (files.length) run(() => upload(files));
  });

  // 分区第一次打开时才读仓库（和「个人信息 / 友链」一致：不放在启动路径上）
  document.addEventListener('admin:section', (event) => {
    const name = (event as CustomEvent<string>).detail;
    if (name !== 'gallery') return;
    if (loaded) {
      render();
      return;
    }
    run(async () => {
      const token = requireToken();
      if (token) await load(token);
    });
  });

  $<HTMLSelectElement>('gal-style').innerHTML = HALL_STYLE_IDS.map(
    (id) => `<option value="${id}">${id}</option>`
  ).join('');
  render();
}

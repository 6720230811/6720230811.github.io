import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CollectionMetaSchema } from './gallery.schema';
// 报错的格式化复用 profile.schema 里那一份：两处各写一遍迟早会漂移
import { formatIssues } from './profile.schema';
import { sizeOf } from '../lib/gallery/imageSize';
import type { CollectionMeta, LocaleText } from './gallery.schema';
import type { HallStyleId } from '../lib/gallery/styles';

export type { CollectionMeta, LocaleText };

/**
 * 画廊数据层（2026-09-15 起：合集制）。
 *
 * 一个合集 = `public/gallery/<合集 id>/` 一个目录：
 *   · 目录里的图片文件    → 这个合集的照片（构建期扫目录，不列清单）
 *   · 目录里的 meta.json  → 文案与编排（schema 见 gallery.schema.ts）
 *   · 目录里的 thumbs/    → 可选缩略图，按同名 stem 匹配
 *
 * 三件事在这里一次做完：
 *   ① 扫目录拿「有哪些合集、每个合集有哪些图」；
 *   ② 读图片文件头拿真实宽高（lib/gallery/imageSize.ts）——画框比例、
 *      拼贴的 aspect-ratio、避免 CLS 的 width/height 全依赖它，而几百个
 *      w/h 不可能人手维护；
 *   ③ 把「合集级默认 + 单张覆盖」合并成最终的照片记录。
 *
 * 为什么用 node:fs 而不是 import.meta.glob：
 * glob 拿到的是**模块**，图片会被 Vite 复制进 _astro/ 并改名，而这里要的
 * 只是「文件名 + 尺寸」——URL 自己按 public/ 的规则拼就行（见 mediaUrl），
 * 这样后台写进仓库的路径和页面上的地址保持一致，不会多出一层映射。
 * 本站是纯静态输出，frontmatter 在构建期跑在 Node 里，用 fs 是正当的。
 *
 * 出错一律抛：宁可构建失败，也不要线上少一块内容（与 profile/friends 一致）。
 */

/** 素材前缀：'' 表示用仓库里的 public/gallery/；将来换 CDN 只改这里 */
const MEDIA_BASE = '';

/** 构建期扫描的根（仓库相对路径，报错信息里直接引用它） */
const GALLERY_DIR = 'public/gallery';
const ROOT = resolve(process.cwd(), GALLERY_DIR);

/** 认图的扩展名（与 gallery.schema.ts 的 IMAGE_EXT 保持一致） */
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;

/** 缩略图子目录名与合集目录同级的保留名，不会被当成一个合集 */
const THUMBS = 'thumbs';

export interface Photo {
  /** 站内唯一 id（`<合集>-<文件 stem>`）：灯箱、过渡动画、锚点都用它 */
  id: string;
  /** 所属合集 id：从照片反查合集时用（首页示例、放映厅片单） */
  collectionId: string;
  /** 文件名（含扩展名）：meta.json 里以它为键，后台也按它定位 */
  file: string;
  /** 原图站内地址 */
  src: string;
  /** 缩略图站内地址：没有 thumbs/ 里的对应文件就退回原图 */
  thumb: string;
  /** 真实像素尺寸；读不出来时为 undefined（调用方按 3:2 兜底） */
  w?: number;
  h?: number;
  title: LocaleText;
  desc?: LocaleText;
  year: number;
  camera?: string;
  gear?: string;
  tags: string[];
}

export interface Collection {
  id: string;
  /** 仓库相对目录，后台与报错信息都用它 */
  dir: string;
  title: LocaleText;
  subtitle?: LocaleText;
  /** 展览前言 */
  note?: LocaleText;
  mode: 'flat' | '3d';
  style: HallStyleId;
  theme: string;
  year: number;
  cover: Photo;
  photos: Photo[];
  /** 合计关键词 = 合集自己的 + 照片的 */
  tags: string[];
  /** 合计器材 = 合集自己写的 + 照片上出现过的 */
  gear: string[];
  /** '2024' 或 '2024–2025'，直接可显示 */
  years: string;
}

/** 文件名自然序：'2.jpg' 排在 '10.jpg' 前面 */
const natural = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

const stemOf = (file: string): string => file.replace(/\.[^.]+$/, '');

/**
 * 文件名 → 兜底标题：'02-last-bus.jpg' → 'Last Bus'。
 * 中文名（题库那种）原样留下，只清掉开头的序号和分隔符。
 */
function titleFromFile(file: string): string {
  const words = stemOf(file)
    .replace(/^\d+[-_\s]*/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!words) return stemOf(file);
  return words.replace(/(^|\s)[a-z]/g, (m) => m.toUpperCase());
}

/** 照片 id：文件 stem 压成 slug；压不出东西（纯中文名）时保留原样 */
function photoId(collectionId: string, file: string): string {
  const stem = stemOf(file);
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${collectionId}-${slug || stem}`;
}

/** 读一个合集目录 */
function readCollection(id: string): Collection {
  const dir = join(ROOT, id);
  const metaPath = join(dir, 'meta.json');

  if (!existsSync(metaPath)) {
    throw new Error(
      `合集 ${id} 缺 ${GALLERY_DIR}/${id}/meta.json。` +
        `一个合集 = 一个目录 + 一份 meta.json（目录里只放图片）。` +
        `不想展出就删掉整个 ${GALLERY_DIR}/${id}/ 目录。`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (e) {
    throw new Error(`${GALLERY_DIR}/${id}/meta.json 不是合法 JSON：${(e as Error).message}`);
  }

  const parsed = CollectionMetaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${GALLERY_DIR}/${id}/meta.json 与 gallery.schema.ts 不一致：\n${formatIssues(parsed.error)}`
    );
  }
  const meta: CollectionMeta = parsed.data;

  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name))
    .map((entry) => entry.name);

  if (files.length === 0) {
    throw new Error(
      `合集 ${id} 一张图都没有。往 ${GALLERY_DIR}/${id}/ 里放图片，或删掉这个空目录。`
    );
  }

  // 顺序 = meta.order 里点到的（按它的顺序）→ 其余按文件名自然序接在后面
  const known = new Set(files);
  const ordered: string[] = [];
  const taken = new Set<string>();
  for (const file of meta.order) {
    if (known.has(file) && !taken.has(file)) {
      taken.add(file);
      ordered.push(file);
    }
  }
  for (const file of [...files].sort(natural)) {
    if (!taken.has(file)) {
      taken.add(file);
      ordered.push(file);
    }
  }

  // 缩略图按 stem 匹配：thumbs/02-last-bus.webp 配 02-last-bus.jpg 这种跨格式替换
  const thumbsDir = join(dir, THUMBS);
  const thumbByStem = new Map<string, string>();
  if (existsSync(thumbsDir)) {
    for (const name of readdirSync(thumbsDir)) {
      if (IMAGE_RE.test(name)) thumbByStem.set(stemOf(name), name);
    }
  }

  const photos: Photo[] = ordered.map((file) => {
    const own = meta.photos[file] ?? {};
    const size = sizeOf(join(dir, file));
    const thumbName = thumbByStem.get(stemOf(file));
    const photo: Photo = {
      id: photoId(id, file),
      collectionId: id,
      file,
      src: mediaUrl(`${id}/${file}`),
      thumb: thumbName ? mediaUrl(`${id}/${THUMBS}/${thumbName}`) : mediaUrl(`${id}/${file}`),
      title: own.title ?? { zh: titleFromFile(file), en: titleFromFile(file) },
      year: own.year ?? meta.year,
      tags: own.tags ?? [],
    };
    if (size) {
      photo.w = size.w;
      photo.h = size.h;
    }
    if (own.desc) photo.desc = own.desc;
    if (own.camera) photo.camera = own.camera;
    if (own.gear) photo.gear = own.gear;
    return photo;
  });

  const cover = meta.cover ? photos.find((photo) => photo.file === meta.cover) : photos[0];
  if (!cover) {
    throw new Error(
      `合集 ${id} 的 cover 指向不存在的文件：「${meta.cover}」。` +
        `可选：${ordered.join('、')}`
    );
  }

  const years = photos.map((photo) => photo.year);
  const min = Math.min(...years);
  const max = Math.max(...years);

  const collection: Collection = {
    id,
    dir: `${GALLERY_DIR}/${id}`,
    title: meta.title,
    mode: meta.mode,
    style: meta.style,
    theme: meta.theme,
    year: meta.year,
    cover,
    photos,
    tags: [...new Set([...meta.tags, ...photos.flatMap((photo) => photo.tags)])],
    gear: [
      ...new Set([
        ...meta.gear,
        ...photos.map((photo) => photo.camera).filter((value): value is string => Boolean(value)),
      ]),
    ],
    years: min === max ? String(min) : `${min}–${max}`,
  };
  if (meta.subtitle) collection.subtitle = meta.subtitle;
  if (meta.note) collection.note = meta.note;
  return collection;
}

/**
 * 全部合集，按目录名自然序。
 * 目录名就是 URL 段，所以改名 = 换地址 —— 后台改名时会同时写一条旧地址跳转。
 */
export const collections: readonly Collection[] = (() => {
  if (!existsSync(ROOT)) {
    throw new Error(
      `找不到 ${GALLERY_DIR}/。构建要在仓库根目录跑（当前 cwd：${process.cwd()}）。`
    );
  }
  return readdirSync(ROOT, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== THUMBS
    )
    .map((entry) => entry.name)
    .sort(natural)
    .map(readCollection);
})();

/** 全部照片摊平（首页的几张示例、放映厅的片单都用它） */
export const allPhotos: readonly Photo[] = collections.flatMap((collection) => collection.photos);

/** 3D 展厅里展出的那些合集（门排、连通展厅都按它来） */
export const threeDCollections: readonly Collection[] = collections.filter(
  (collection) => collection.mode === '3d'
);

export function collectionById(id: string): Collection | undefined {
  return collections.find((collection) => collection.id === id);
}

/**
 * 图纸比例：读不出尺寸时按 3:2 兜底（画框与拼贴都靠它定盒子，
 * 宁可比例略差，也不要等到图片载入才撑开、把后面的内容顶走）。
 */
export function photoAR(photo: Photo): string {
  return photo.w && photo.h ? `${photo.w} / ${photo.h}` : '3 / 2';
}

/**
 * 素材地址：原样放行绝对 URL 与站内绝对路径，其余拼前缀。
 * 参数形如 `night-walk/02-last-bus.jpg`。
 */
export function mediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
  const base = MEDIA_BASE || `${import.meta.env.BASE_URL}gallery`;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path}`;
}

/**
 * 合计：封面页右栏的「N 个合集 / M 张照片 / 年份跨度 / 关键词」。
 * 从数据现算，加图不用回来改文案。
 */
export const galleryTotals = (() => {
  const years = allPhotos.map((photo) => photo.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  return {
    collections: collections.length,
    photos: allPhotos.length,
    years: min === max ? String(min) : `${min}–${max}`,
    tags: [...new Set(collections.flatMap((collection) => collection.tags))],
    gear: [...new Set(collections.flatMap((collection) => collection.gear))],
  };
})();

/**
 * 旧地址 → 新地址。
 *
 * 画廊在 2026-09 换过两轮信息架构，旧地址已经推上线过，不能让它们 404：
 *   · `theme-city` 这类按主题派生的房间 → 该主题下第一个合集
 *   · `hall-night-walk` 这类按手挑展厅派生的房间 → 同名合集
 * 页面用 Astro.redirect 301 过去（见 pages/gallery/[collection].astro）。
 */
/** 后台给改名过的合集登记旧地址的文件（不存在就当没有） */
const REDIRECTS = 'src/data/gallery-redirects.json';

/**
 * 登记表读出来一律先过滤：只留 `to` 真的指向一个现存的合集。
 * 后台删了合集却忘了清登记表时，这里宁可少一条 301，也不要 301 到一个 404
 * （301 会被浏览器和搜索引擎长期缓存，跳错一次很难收回）。
 */
function registeredRedirects(): { from: string; to: string }[] {
  const file = resolve(process.cwd(), REDIRECTS);
  if (!existsSync(file)) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${REDIRECTS} 不是合法 JSON：${(e as Error).message}`);
  }
  if (!Array.isArray(raw)) throw new Error(`${REDIRECTS} 顶层要是一个数组`);

  const exists = new Set(collections.map((collection) => collection.id));
  return (raw as { from?: unknown; to?: unknown }[])
    .filter(
      (entry): entry is { from: string; to: string } =>
        typeof entry?.from === 'string' &&
        typeof entry?.to === 'string' &&
        entry.from !== entry.to &&
        exists.has(entry.to)
    )
    .map((entry) => ({ from: entry.from, to: entry.to }));
}

export function legacyRoutes(): { from: string; to: string }[] {
  const routes: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  const themeDone = new Set<string>();

  // 手工登记的先来：它是「改名之后旧地址该去哪」的明确答案，
  // 不该被下面按目录名推出来的规则顶掉
  for (const entry of registeredRedirects()) {
    seen.add(entry.from);
    routes.push(entry);
  }

  for (const collection of collections) {
    if (!seen.has(`hall-${collection.id}`)) {
      seen.add(`hall-${collection.id}`);
      routes.push({ from: `hall-${collection.id}`, to: collection.id });
    }
    if (!themeDone.has(collection.theme)) {
      themeDone.add(collection.theme);
      if (!seen.has(`theme-${collection.theme}`)) {
        seen.add(`theme-${collection.theme}`);
        routes.push({ from: `theme-${collection.theme}`, to: collection.id });
      }
    }
  }
  return routes;
}

/* ─────────────────────────── 3D 展厅的适配层 ─────────────────────────── */

/**
 * 3D 展厅（lib/gallery/）吃的展品形状。
 * 那边是几万行复刻展厅的代码，只认这一组字段——所以这里做一层适配，
 * 而不是让它去理解「合集」这个概念。
 */
export interface GalleryItem {
  id: string;
  type: 'image' | 'video';
  src: string;
  thumb: string;
  poster?: string;
  embed?: string;
  w?: number;
  h?: number;
  theme: string;
  year: number;
  title: LocaleText;
  desc?: LocaleText;
  camera?: string;
  gear?: string;
  tags: string[];
}

export function toGalleryItem(photo: Photo, collection: Collection): GalleryItem {
  const item: GalleryItem = {
    id: photo.id,
    type: 'image',
    // mediaUrl 对 `/` 开头的路径原样放行，所以这里再包一次是安全的
    src: mediaUrl(photo.src),
    thumb: mediaUrl(photo.thumb),
    theme: collection.theme,
    year: photo.year,
    title: photo.title,
    tags: photo.tags,
  };
  if (photo.w && photo.h) {
    item.w = photo.w;
    item.h = photo.h;
  }
  if (photo.desc) item.desc = photo.desc;
  if (photo.camera) item.camera = photo.camera;
  if (photo.gear) item.gear = photo.gear;
  return item;
}

export function collectionItems(collection: Collection): GalleryItem[] {
  return collection.photos.map((photo) => toGalleryItem(photo, collection));
}

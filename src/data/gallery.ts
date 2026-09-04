import galleryJson from './gallery.json';
import { GallerySchema } from './gallery.schema';
// 报错的格式化复用 profile.schema 里那一份：两处各写一遍迟早会漂移
import { formatIssues } from './profile.schema';
import type { Gallery, GalleryItem, GalleryMood, LocaleText } from './gallery.schema';
import type { Locale } from '../i18n/ui';

export type { Gallery, GalleryItem, GalleryMood, LocaleText };

/**
 * 画廊数据：内容在 `src/data/gallery.json`，后台 /admin 也是读写这个文件。
 *
 * 校验失败直接抛错让构建红掉：宁可部署失败，也不要线上少一块内容。
 * （与 profile.ts / friends.ts 同一套做法）
 */
function load(raw: unknown): Gallery {
  const result = GallerySchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`src/data/gallery.json 与 gallery.schema.ts 不一致：\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export const gallery: Gallery = load(galleryJson);

/** 策展视图：按主题分组 / 按年份分组。同一批展品，两种挂法 */
export type GalleryView = 'theme' | 'year';

export interface GalleryRoom {
  /** 路由用的 ASCII id：`theme-city` / `year-2024` */
  id: string;
  view: GalleryView;
  /** 分组键：theme 视图下是 'city'，year 视图下是 '2024' */
  key: string;
  items: readonly GalleryItem[];
}

/** 某个分组键下的展品 */
function groupKey(item: GalleryItem, view: GalleryView): string {
  return view === 'theme' ? item.theme : String(item.year);
}

/** 分组键的显示名：主题查 labels.theme，年份直接用数字 */
export function roomLabel(room: GalleryRoom, locale: Locale): string {
  if (room.view === 'year') return room.key;
  return gallery.labels.theme[room.key]?.[locale] ?? room.key;
}

/**
 * 缺省氛围：按 key 哈希出一个色相，这样新增分组不用先去写 moods 也能看。
 * 想要确定的观感就在 JSON 的 moods 里显式配 `theme:xxx` / `year:xxxx`。
 */
function fallbackMood(key: string): GalleryMood {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 360;
  return {
    wall: `hsl(${h} 10% 82%)`,
    floor: `hsl(${h} 10% 68%)`,
    light: `hsl(${(h + 200) % 360} 55% 88%)`,
  };
}

export function roomMood(room: GalleryRoom): GalleryMood {
  return gallery.moods[`${room.view}:${room.key}`] ?? fallbackMood(room.key);
}

/**
 * 按视图派生房间列表。
 * - theme 视图：按展品在 JSON 里首次出现的顺序（改 JSON 顺序即可调房间顺序）
 * - year 视图：年份倒序，最新在前
 */
export function rooms(view: GalleryView): GalleryRoom[] {
  const order: string[] = [];
  const grouped = new Map<string, GalleryItem[]>();

  for (const item of gallery.items) {
    const key = groupKey(item, view);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else {
      grouped.set(key, [item]);
      order.push(key);
    }
  }

  return order
    .sort((a, b) => (view === 'year' ? Number(b) - Number(a) : 0))
    .map((key) => ({
      id: `${view}-${key}`,
      view,
      key,
      items: grouped.get(key) ?? [],
    }));
}

/** 按 id 找房间；找不到返回 undefined（调用方负责 404） */
export function roomById(view: GalleryView, id: string): GalleryRoom | undefined {
  return rooms(view).find((room) => room.id === id);
}

/**
 * 素材地址：原样放行绝对 URL，其余拼前缀。
 * 前缀优先用 JSON 里的 base —— 将来把图片搬去 CDN，只改这一个字段。
 */
export function mediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
  const base = gallery.base;
  const prefix = base ? (base.endsWith('/') ? base : `${base}/`) : `${import.meta.env.BASE_URL}gallery/`;
  return `${prefix}${path}`;
}

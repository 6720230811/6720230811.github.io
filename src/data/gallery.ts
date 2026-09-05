import galleryJson from './gallery.json';
import { GallerySchema } from './gallery.schema';
// 报错的格式化复用 profile.schema 里那一份：两处各写一遍迟早会漂移
import { formatIssues } from './profile.schema';
import type { Gallery, GalleryItem, LocaleText } from './gallery.schema';
import type { Locale } from '../i18n/ui';
// 形制目录：房间长什么样（尺寸、顶棚、材质、灯光）由它决定
import { styleByRotation, type HallStyleId } from '../lib/gallery/styles';

export type { Gallery, GalleryItem, LocaleText };

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

/**
 * 策展视图：
 * - theme：按主题分组
 * - year：按年份分组
 * - hall：手挑的自由展厅（数据里 halls 那一段，自己取名、自己定形制）
 */
export type GalleryView = 'theme' | 'year' | 'hall';

export interface GalleryRoom {
  /** 路由用的 ASCII id：`theme-city` / `year-2024` / `hall-night-walk` */
  id: string;
  view: GalleryView;
  /** 分组键：theme 视图下是 'city'，year 视图下是 '2024'，hall 视图下是展厅 id */
  key: string;
  items: readonly GalleryItem[];
  /** 形制：九种复刻的艺术厅之一 */
  style: HallStyleId;
  /** 自由展厅的导语；派生房间没有 */
  note?: LocaleText;
}

/** 某个分组键下的展品 */
function groupKey(item: GalleryItem, view: GalleryView): string {
  return view === 'theme' ? item.theme : String(item.year);
}

/** 展品 id → 展品；自由展厅只记 id，挂画时按 id 取回来 */
const byId = new Map(gallery.items.map((item) => [item.id, item]));

/** 分组键的显示名：自由展厅用自己的标题，主题查 labels.theme，年份直接用数字 */
export function roomLabel(room: GalleryRoom, locale: Locale): string {
  if (room.view === 'hall') return gallery.halls.find((h) => h.id === room.key)?.title[locale] ?? room.key;
  if (room.view === 'year') return room.key;
  return gallery.labels.theme[room.key]?.[locale] ?? room.key;
}

/** 门牌上的一行导语；自由展厅才有，派生房间返回空串 */
export function roomNote(room: GalleryRoom, locale: Locale): string {
  return room.note?.[locale] ?? '';
}

/**
 * 按视图派生房间列表。
 * - theme 视图：按展品在 JSON 里首次出现的顺序（改 JSON 顺序即可调房间顺序）
 * - year 视图：年份倒序，最新在前
 * - hall 视图：按 halls 在 JSON 里的顺序（想让哪间在前就把它往上挪）
 *
 * 形制：手挑的展厅用自己写的 style；派生的房间查 styles 表，没写到的就
 * 按顺序轮流分配 —— 挨着的两间不会撞成同一形制。
 */
export function rooms(view: GalleryView): GalleryRoom[] {
  if (view === 'hall') {
    return gallery.halls.map((hall) => ({
      id: `hall-${hall.id}`,
      view,
      key: hall.id,
      items: hall.items.flatMap((id) => (byId.has(id) ? [byId.get(id) as GalleryItem] : [])),
      style: hall.style,
      ...(hall.note ? { note: hall.note } : {}),
    }));
  }

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
    .map((key, index) => {
      const id = `${view}-${key}`;
      return {
        id,
        view,
        key,
        items: grouped.get(key) ?? [],
        style: gallery.styles[id] ?? styleByRotation(index),
      };
    });
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

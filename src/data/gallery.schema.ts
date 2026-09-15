import { z } from 'zod';
import { HALL_STYLE_IDS } from '../lib/gallery/styles';

/**
 * 画廊（/gallery）的数据契约 —— 2026-09-15 起是「合集制」。
 *
 * 与前几版最大的不同：**图不再列在一份中央 JSON 里**，而是
 *   一个合集 = public/gallery/<合集 id>/ 一个目录
 *   目录里的图片文件 = 这个合集的照片（构建期扫描，见 gallery.ts）
 *   目录里的 meta.json = 这个合集的文案与编排（本文件校验）
 *
 * 为什么换：
 * - 「上传大量图片」是主要用法。目录约定下加一张图 = 丢一个文件，
 *   不必去改一份会越来越长的中心清单，也就没有「改漏一处、两边对不上」的机会。
 * - 图片尺寸不再手填：构建期读文件头拿真实宽高（lib/gallery/imageSize.ts）。
 *   画框比例、拼贴的 aspect-ratio、避免 CLS 的 width/height 全靠它，
 *   而人手维护几百个 w/h 迟早会错。
 * - 图片和它的元数据在同一个目录里：删合集就是删目录，不会有孤儿元数据。
 *
 * 校验策略与 profile.json / friends.json 一致：**不一致就让构建红掉**。
 * 宁可部署失败，也不要线上少一块内容。
 */

/** 一条文案的中英两份 */
export const LocaleTextSchema = z.object({
  zh: z.string(),
  en: z.string(),
});

/** ASCII id：合集目录名、主题键都用它 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 图片扩展名（构建期扫描按它认图，改这里要同步改 gallery.ts 的 IMAGE_RE） */
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] as const;

/**
 * 单张照片的元数据，写在合集的 meta.json 里、**以文件名为键**。
 * 整条都可以省略 —— 省略时标题从文件名推、其余留空，所以「丢进去就能看」。
 */
export const PhotoMetaSchema = z.object({
  title: LocaleTextSchema.optional(),
  desc: LocaleTextSchema.optional(),
  /** 覆盖合集的年份（同一合集里跨年时用） */
  year: z.number().int().optional(),
  /** 器材，如 'Sony A7C · 35mm f/1.8'；省略就继承合集默认 */
  camera: z.string().optional(),
  /** 补充说明，如地点、参数 */
  gear: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * 一份合集元数据。字段顺序 = 后台写回 meta.json 时的 key 顺序
 * （zod 按 schema 声明顺序构造对象），别随手调换，否则每次保存都会产生
 * 一大片无意义的 diff。
 */
export const CollectionMetaSchema = z.object({
  title: LocaleTextSchema,
  /** 副标题：目录行、封面上的一行小字（如「城市 · 三条街」） */
  subtitle: LocaleTextSchema.optional(),
  /** 展览前言：合集封面页的右栏、详情页的开篇都读它 */
  note: LocaleTextSchema.optional(),
  /**
   * 有没有可走动的展厅（2026-09-15 起只管这一件事）：
   * - '3d'   —— 有：会出现在 3D 展厅门排上，并且在 /gallery/rooms/<id>/ 有展厅页
   * - 'flat' —— 没有：只有图片平铺
   *
   * **它不再决定 /gallery/<id>/ 渲染成什么** —— 那个地址一律是图片平铺，
   * 要看展厅去 /gallery/rooms/<id>/。「看哪种」由地址决定，不由数据决定；
   * 理由见 lib/gallery/shell.ts 的 collectionHref()。
   */
  mode: z.enum(['flat', '3d']).default('flat'),
  /** 形制：九种复刻的艺术厅之一，只对 mode: '3d' 有意义 */
  style: z.enum(HALL_STYLE_IDS).default('whitecube'),
  /** 归类键（ASCII），显示名在 i18n 的 gallery.theme.<key> 里 */
  theme: z.string().regex(SLUG).default('misc'),
  /** 合集年份：照片没单独写 year 时继承它 */
  year: z.number().int(),
  /** 封面文件名；省略取排序后的第一张 */
  cover: z.string().optional(),
  /** 照片顺序（文件名）。没列到的按文件名自然序排在后面 */
  order: z.array(z.string()).default([]),
  /** 合集级关键词；照片自己的 tags 会并进来 */
  tags: z.array(z.string()).default([]),
  /** 合集级器材；照片没写 camera 时继承 */
  gear: z.array(z.string()).default([]),
  /** 按文件名索引的单张元数据 */
  photos: z.record(z.string(), PhotoMetaSchema).default({}),
});

export type CollectionMeta = z.infer<typeof CollectionMetaSchema>;
export type PhotoMeta = z.infer<typeof PhotoMetaSchema>;
export type LocaleText = z.infer<typeof LocaleTextSchema>;

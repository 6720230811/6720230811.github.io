import { z } from 'zod';

/**
 * 画廊（/gallery）的数据契约。
 *
 * 与 profile.schema.ts 一样：
 * - 构建时用它校验 `gallery.json`，不一致直接构建失败（见 gallery.ts）
 * - 后台 /admin 用它校验编辑结果，类型也由它推断
 * - 字段顺序 = 输出 JSON 的 key 顺序（zod 按 schema 声明顺序构造对象），
 *   不要随意调整，否则每次保存都会产生一大片无意义的 diff
 *
 * 两个与本站其它数据文件不同的取舍：
 * - 双语写成 { zh, en } 内联在一条记录里，而不是 friends.json 那样的
 *   { zh: [...], en: [...] }：图片、尺寸、挂画位置跟语言无关，拆成两份
 *   就让它们有机会对不上
 * - 只存扁平的展品列表，房间在构建时按 theme / year 派生：两种策展视图
 *   共用同一批展品，显式存两份房间会让同一件展品（含位置）重复出现。
 *   halls 是例外：那是手挑的自由展厅，它只记展品 id（顺序即挂画顺序），
 *   同一件展品在同一个视图里仍只能出现一次。
 */
import { HALL_STYLE_IDS } from '../lib/gallery/styles';

/** 一条文案的中英两份 */
export const LocaleTextSchema = z.object({
  zh: z.string(),
  en: z.string(),
});

export const GalleryItemSchema = z.object({
  /** 唯一 id，只能小写字母/数字/连字符；会用在 ?item= 深链里 */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** image 直接显示；video 只显示封面，点击才加载播放器 */
  type: z.enum(['image', 'video']).default('image'),
  /** 原图，相对 base（见 GallerySchema.base）或完整 URL */
  src: z.string(),
  /** 缩略图：网格、门、以及进房间时的第一遍纹理 */
  thumb: z.string(),
  /** video 的封面 */
  poster: z.string().optional(),
  /** video 的外部播放器地址（Bilibili / YouTube），留空则只用封面 */
  embed: z.string().optional(),
  /** 原图像素宽高，用来决定画框比例；省略时按 3:2 挂，纹理载入后校正 */
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  /** 主题分组键（ASCII），显示名在 labels.theme 里 */
  theme: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** 年份，用于「按时间布展」的分组 */
  year: z.number().int(),
  title: LocaleTextSchema,
  desc: LocaleTextSchema.optional(),
  /** 器材，如 'Sony A7C · 35mm f/1.8' */
  camera: z.string().optional(),
  /** 补充说明，如地点、参数 */
  gear: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** 手指定挂画位置；省略则自动布局 */
  place: z
    .object({
      wall: z.enum(['n', 'e', 's', 'w']),
      /** 沿墙位置 0~1 */
      u: z.number().min(0).max(1),
      /** 高度 0~1（1 是天花板），画框中心 */
      v: z.number().min(0).max(1),
      /** 画框长边（米），省略则按墙宽自动算 */
      size: z.number().positive().optional(),
    })
    .optional(),
});

/**
 * 一间手挑的自由展厅：自己取名、自己定形制、自己挑展品。
 * 展品只写 id —— 尺寸、标题、挂画位置都在 items 里，写第二遍迟早会对不上。
 */
export const HallSchema = z.object({
  /** 路由 id：房间页是 /gallery/hall-<id>/ */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** 形制：九种复刻的艺术厅之一，见 lib/gallery/styles.ts */
  style: z.enum(HALL_STYLE_IDS),
  title: LocaleTextSchema,
  /** 门牌上的一行导语；省略就只显示件数 */
  note: LocaleTextSchema.optional(),
  /** 展品 id，顺序就是挂画顺序 */
  items: z.array(z.string()),
});

export const GallerySchema = z
  .object({
    version: z.literal(1),
    /** 素材前缀：'' 表示用仓库里的 public/gallery/；换 CDN 时填 CDN 地址即可 */
    base: z.string().default(''),
    items: z.array(GalleryItemSchema),
    /** 自由展厅：自己取名、自己挑形制和展品 */
    halls: z.array(HallSchema).default([]),
    /**
     * 派生房间（theme-* / year-*）用哪套形制：键是房间 id。
     * 没写到的按 rooms() 里的顺序轮流分配（见 styleByRotation）。
     */
    styles: z.record(z.string(), z.enum(HALL_STYLE_IDS)).default({}),
    labels: z
      .object({
        theme: z.record(z.string(), LocaleTextSchema).default({}),
      })
      .default({ theme: {} }),
  })
  // 按 theme / year 派生房间时，id 重复会让两件展品互相顶掉
  .refine((g) => new Set(g.items.map((i) => i.id)).size === g.items.length, {
    message: 'id 必须唯一',
  })
  .refine((g) => new Set(g.halls.map((h) => h.id)).size === g.halls.length, {
    message: 'halls.id 必须唯一',
  })
  // 自由展厅引用的展品必须存在：写错 id 会在 3D 里留一个空画框
  .refine(
    (g) => {
      const known = new Set(g.items.map((i) => i.id));
      return g.halls.every((hall) => hall.items.every((id) => known.has(id)));
    },
    { message: 'halls.items 里引用了不存在的展品 id' },
  )
  // 同一件展品不能同时挂在两间自由展厅里：那一层展厅共用一套画框 id
  .refine(
    (g) => {
      const seen = new Set<string>();
      for (const hall of g.halls) {
        for (const id of hall.items) {
          if (seen.has(id)) return false;
          seen.add(id);
        }
      }
      return true;
    },
    { message: '同一件展品在 halls 里出现了多次' },
  );

export type GalleryItem = z.infer<typeof GalleryItemSchema>;
export type Gallery = z.infer<typeof GallerySchema>;
export type GalleryHall = z.infer<typeof HallSchema>;
export type LocaleText = z.infer<typeof LocaleTextSchema>;

import { useTranslations, type Locale } from '../../i18n/ui';

/**
 * 画廊四个页面共用的**界面契约**：外壳的三个槽（页头入口、左栏目录、右栏说明）
 * 各吃什么，都在这儿定一次。
 *
 * 为什么单开一个 .ts 而不是写在 GalleryShell.astro 的 frontmatter 里：
 * .astro 的 frontmatter 导出类型给别的模块 import 时不太可靠（它不是一个普通的
 * 模块），而这些形状四个页面都要用 —— 放这儿，谁都能静态引用。
 */
export interface NavEntry {
  href: string;
  label: string;
  /** 一个字符的图标：▦ ◆ ▣ …（与顶栏导航同一套写法） */
  icon: string;
  /** 当前页：会标 aria-current="page" */
  current?: boolean;
  /** 排到工具簇外面的独立入口（如私人放映室） */
  accent?: boolean;
}

export interface DirItem {
  /** 与正文里对应块的 data-gal-block 相同 —— 两边互相点亮靠它 */
  id: string;
  /** 两位编号；给空串就不显示编号列 */
  no: string;
  name: string;
  sub?: string;
  /** 给了就是真链接（封面页：点目录进合集）；不给则用锚点兜底 */
  href?: string;
  /**
   * 只是一条清单、点了不该有反应（放映室的片单就是这种）。
   * 渲染成 <span> 而不是 <a>：假链接对键盘和读屏都是噪音。
   */
  plain?: boolean;
  /**
   * 就是当前这一页（3D 展厅页的左栏：「你正在这间」）。会标 aria-current="page"。
   * 标了当前项也照样给 href —— 从别的房间过来还得靠这个链接。
   */
  current?: boolean;
}

export interface Fact {
  k: string;
  v: string;
}

export type GallerySection = 'index' | 'rooms' | 'screening';

/**
 * 画廊内部的分区入口（三处）。地址由页面传进来的 base 拼 ——
 * base 形如 '/gallery/' 或 '/en/gallery/'（带尾斜杠），
 * 由 getRelativeLocaleUrl(locale, 'gallery') 得到，这里不重复那份 i18n 路由逻辑。
 *
 * `current` 省略 = 三处都不标当前页（合集详情页就不属于这三处里的任何一处，
 * 标了反而是错的 —— aria-current 是说「这就是当前这一页」）。
 */
export function galleryNav(locale: Locale, base: string, current?: GallerySection): NavEntry[] {
  const t = useTranslations(locale);
  return [
    {
      href: base,
      label: t('gallery.nav.index'),
      icon: '▦',
      current: current === 'index',
    },
    {
      href: `${base}rooms/`,
      label: t('gallery.entry.rooms'),
      icon: '◆',
      current: current === 'rooms',
    },
    {
      href: `${base}screening-room/`,
      label: t('screening.entry'),
      icon: '▣',
      accent: true,
      current: current === 'screening',
    },
  ];
}

/** 两位编号：目录栏、封面、详情页共用同一套，切页时不会跳号 */
export const no2 = (index: number): string => String(index + 1).padStart(2, '0');

/**
 * 合集详情的两种地址（2026-09-15 起分开）：
 *   flat —— /gallery/<id>/         图片平铺（杂志式照片流）
 *   hall —— /gallery/rooms/<id>/   3D 展厅（复刻的展厅，可以走动）
 *
 * 为什么不合成一个地址、让 meta.json 的 mode 说了算：**入口决定你要看什么**。
 * 从「合集」索引点封面，来意是看照片；从「3D 艺术展厅」点门，来意是走进展厅。
 * 一个地址两头都想满足，两头的期待就都得落空 —— 而这正是改版前发生的事。
 * 地址分开之后，「看哪种」不再依赖「你从哪来」这种页面记不住的状态，
 * 还能分享、能回退、能被 e2e 直接断言。
 *
 * base 形如 '/gallery/' 或 '/en/gallery/'（带尾斜杠），由 getRelativeLocaleUrl 得来。
 */
export function collectionHref(base: string, id: string, view: 'flat' | 'hall' = 'flat'): string {
  return view === 'hall' ? `${base}rooms/${id}/` : `${base}${id}/`;
}

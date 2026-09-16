/**
 * 词表（taxonomy）—— 全站「词」的唯一来源。
 *
 * 为什么要有它：以前**值本身就是显示名、同时也是 URL**，于是
 *   · 改显示名 = 换地址（外链失效）
 *   · 中英各写一套，对不上（实测 5 对同义词里 4 对字面不同）
 *   · 同义词合不了、拼错没人发现、没有任何地方能看到「我一共有哪些词」
 * 现在引用只写 key（ASCII），显示名按语言从这张表取。
 *
 * 治理方式（2026-09-16 定）：**分类受控、标签自由但归一化**。
 * 表里所有 key 都要过 SLUG（小写 ASCII + 连字符），因为它同时是 URL 段。
 * 规格：docs/superpowers/specs/2026-09-16-taxonomy-wordbook.md
 *
 * ⚠️ 这个文件**不许 import 任何东西**：3D 展厅的客户端代码
 * （lib/gallery/blueprint.ts）也引它，一旦带上 zod 之类的依赖就会被打进
 * 浏览器包里。校验与取用在 lib/taxonomy.ts（只跑构建期）。
 *
 * 当前只有 themes（画廊题材）。文章的分类 / 标签在下一期迁进来。
 */

export interface ThemeTerm {
  /** 中文显示名 */
  zh: string;
  /** 英文显示名 */
  en: string;
  /**
   * 3D 展厅的展墙主题色。**不填就是不参与**：一间展厅的作品都没有配色时，
   * 展墙用 blueprint 的默认配色 —— 这是正当的，不是错。同一时期只出现一种颜色。
   */
  color?: string;
  /** 旧名 / 异名：只用于归一化与生成旧地址，不显示 */
  alias?: readonly string[];
  /** 一句说明，给索引页与后台看 */
  desc?: string;
}

/**
 * 题材词表。三条规矩：
 * 1. 一个合集只有一个题材（meta.json 的 theme），一期里最多的那个决定展墙色
 * 2. `misc` 是「没想好」的兜底：meta.json 不写 theme 就落到它 —— 所以它必须在表里
 * 3. 加题材时顺手写全 zh/en；漏了会在构建期抛错（见 lib/taxonomy.ts）
 */
export const THEMES: Record<string, ThemeTerm> = {
  misc: { zh: '其它', en: 'Misc', desc: '还没归类的合集' },
  city: { zh: '城市', en: 'City', color: '#364852', desc: '烟熏蓝灰' },
  sea: { zh: '海', en: 'Sea', color: '#30494B', desc: '暮色蓝绿' },
};

/** 词表里所有题材键 */
export const THEME_KEYS: readonly string[] = Object.keys(THEMES);

/**
 * 题材 → 可移动展墙的主题色（只有配了色的才在表里）。
 * 3D 那边取「本期作品里出现最多的题材」，挑不到就用默认配色。
 *
 * 这张表是**派生**的，别再手写一份 —— 以前 blueprint.ts 里硬编码 { city, sea }，
 * meta.json 写个别的题材键就静默掉色，肉眼看不出来。
 */
export const THEME_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(THEMES)
    .filter(([, term]) => Boolean(term.color))
    .map(([key, term]) => [key, term.color as string])
);

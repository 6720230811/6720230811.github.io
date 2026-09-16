import { z } from 'zod';
import { THEMES, THEME_KEYS, type ThemeTerm } from '../data/taxonomy';
import { formatIssues } from '../data/profile.schema';
import type { Locale } from '../i18n/ui';

/**
 * 词表的**校验 + 取用**。
 *
 * 为什么和 data/taxonomy.ts 分两层：那份是纯数据（3D 客户端代码也引它，不能带依赖），
 * 校验要 zod，就落在这里 —— 只有构建期（Node）会引到这个文件。
 *
 * 校验策略与本站其它数据文件一致：**不一致就让构建红掉**（profile / friends / gallery 同款）。
 */

/** ASCII key：与 gallery.schema.ts 的 SLUG 同一套，因为它同时是 URL 段 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const WORD_BOOK = 'src/data/taxonomy.ts';

const ThemeTermSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  alias: z.array(z.string().regex(SLUG)).default([]),
  desc: z.string().optional(),
});

const WordbookSchema = z.object({
  themes: z.record(z.string().regex(SLUG), ThemeTermSchema),
});

const parsed = WordbookSchema.safeParse({ themes: THEMES });
if (!parsed.success) {
  throw new Error(`${WORD_BOOK} 的词表不合规：\n${formatIssues(parsed.error)}`);
}

/** 校验过的词表主题（类型比 data 那份更确定：alias 一定存在） */
export const themes: Record<string, ThemeTerm & { alias: readonly string[] }> = parsed.data.themes;

/**
 * 别名不许与任何 key 或别的别名相撞：撞了归一化就会把合集归到错的词上，
 * 而这种错在产物里看不出来（页面上显示的还是对的）。
 */
(() => {
  const owner = new Map<string, string>();
  for (const key of Object.keys(themes)) owner.set(key, key);
  for (const [key, term] of Object.entries(themes)) {
    for (const alias of term.alias) {
      const taken = owner.get(alias);
      if (taken && taken !== key) {
        throw new Error(
          `${WORD_BOOK} 里别名「${alias}」同时指向 ${taken} 和 ${key}，归一化会归错。` +
            `删掉其中一个。`
        );
      }
      owner.set(alias, key);
    }
  }
})();

export function hasTheme(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(themes, key);
}

/**
 * 题材的显示名，按语言取。
 * 取不到就抛：调用点前面一定有 assertTheme 挡过，走到这里说明漏了校验 ——
 * 那就得红，不能悄悄把裸键名给访客看（这正是以前 Kickoff 显示 `city` 的原因）。
 */
export function themeLabel(locale: Locale, key: string): string {
  const term = themes[key];
  if (!term) {
    throw new Error(
      `题材「${key}」不在词表里（${WORD_BOOK}）。已登记：${THEME_KEYS.join('、')}`
    );
  }
  return locale === 'en' ? term.en : term.zh;
}

/** 这个题材有没有展墙配色 */
export function hasThemeColor(key: string): boolean {
  return Boolean(themes[key]?.color);
}

/** 编辑距离：给拼错的键挑最近的候选（「是不是想写 xxx」） */
function distance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function nearest(key: string, candidates: readonly string[], take = 3): string[] {
  return [...candidates].sort((a, b) => distance(key, a) - distance(key, b)).slice(0, take);
}

/**
 * 题材必须登记在词表里，否则抛。
 *
 * 钩在数据层（data/gallery.ts 读 meta.json 时）：改一行 meta.json 就该在构建期红掉，
 * 而不是等某间展厅的墙颜色不对了再回头找 —— 那个症状以前是**完全静默**的。
 */
export function assertTheme(key: string, where: string): void {
  if (hasTheme(key)) return;
  const listed = THEME_KEYS.map((k) => `${k}（${themes[k].zh}）`).join('、');
  const guess = nearest(key, THEME_KEYS);
  throw new Error(
    `${where} 里的 theme 是「${key}」，但词表（${WORD_BOOK}）里没有登记。` +
      `\n已登记：${listed}` +
      (guess.length ? `\n是不是想写：${guess.join('、')}？` : '')
  );
}

/**
 * 3D 展厅的展墙色按题材查，没配色的题材退回默认配色 ——
 * 这是**允许**的（见 data/taxonomy.ts 的 ThemeTerm.color），但别让它悄悄发生，
 * 至少在构建日志里说一声。
 */
export function warnThemeColor(key: string, where: string): void {
  if (hasThemeColor(key)) return;
  console.warn(
    `[gallery] ${where}: 题材「${key}」没有配色，这间展厅的展墙会用默认配色。` +
      `想让它有颜色，就往 ${WORD_BOOK} 的 THEMES.${key} 加一个 color。`
  );
}

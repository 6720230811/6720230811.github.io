import { z } from 'zod';
import {
  CATEGORIES,
  CATEGORY_KEYS,
  LEGACY_TERM_ROUTES,
  TAGS,
  TAG_KEYS,
  THEMES,
  THEME_KEYS,
  type CategoryTerm,
  type TagTerm,
  type ThemeTerm,
} from '../data/taxonomy';
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

/* ───────────────────────────── 结构校验 ───────────────────────────── */

// alias 不要求是 SLUG：它是**当年真实出现过的写法**，可以是中文、带空格与括号
// （`前端`、`AI Agent(智能体) 教程`）。它只用于归一化与生成旧地址，不进 URL。
const alias = z.array(z.string().min(1)).default([]);

const ThemeTermSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  alias,
  desc: z.string().optional(),
});

const CategoryTermSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1),
  order: z.number().int(),
  desc: z.string().min(1).optional(),
});

const TagTermSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1),
  alias,
});

const WordbookSchema = z.object({
  themes: z.record(z.string().regex(SLUG), ThemeTermSchema),
  categories: z.record(z.string().regex(SLUG), CategoryTermSchema),
  tags: z.record(z.string().regex(SLUG), TagTermSchema),
});

const parsed = WordbookSchema.safeParse({ themes: THEMES, categories: CATEGORIES, tags: TAGS });
if (!parsed.success) {
  throw new Error(`${WORD_BOOK} 的词表不合规：\n${formatIssues(parsed.error)}`);
}

/** 校验过的题材（类型比 data 那份更确定：alias 一定存在） */
export const themes: Record<string, ThemeTerm & { alias: readonly string[] }> = parsed.data.themes;
/** 校验过的分类 */
export const categories: Record<string, CategoryTerm> = parsed.data.categories;
/** 校验过的标签 */
export const tags: Record<string, TagTerm & { alias: readonly string[] }> = parsed.data.tags;

/* ───────────────────── 一致性校验（不合规就让构建红） ───────────────────── */

/**
 * 别名不许与任何 key 或别的别名相撞：撞了归一化就会把词归到错的词上，
 * 而这种错在产物里看不出来（页面上显示的还是对的）。
 */
function assertNoAliasCollision(
  kind: string,
  terms: Record<string, { alias: readonly string[] }>
): void {
  const owner = new Map<string, string>();
  for (const key of Object.keys(terms)) owner.set(key, key);
  for (const [key, term] of Object.entries(terms)) {
    for (const name of term.alias) {
      const taken = owner.get(name);
      if (taken && taken !== key) {
        throw new Error(
          `${WORD_BOOK} 的 ${kind} 里别名「${name}」同时指向 ${taken} 和 ${key}，` +
            `归一化会归错。删掉其中一个。`
        );
      }
      owner.set(name, key);
    }
  }
}

assertNoAliasCollision('themes', themes);
assertNoAliasCollision('tags', tags);

/** 分类的 order 必须两两不同：相同的话排序会退化成「看声明顺序」，加新类时容易踩 */
(() => {
  const seen = new Map<number, string>();
  for (const [key, term] of Object.entries(categories)) {
    const taken = seen.get(term.order);
    if (taken) {
      throw new Error(
        `${WORD_BOOK} 的分类 ${taken} 和 ${key} 的 order 都是 ${term.order}。` +
          `排序会变得不确定，改掉一个（同类之间留 10 的间隔）。`
      );
    }
    seen.set(term.order, key);
  }
})();

/* ───────────────────────────── 取用 ───────────────────────────── */

export function hasTheme(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(themes, key);
}

export function hasCategory(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(categories, key);
}

export function hasTag(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(tags, key);
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

/** 分类的显示名，按语言取。取不到就抛（同 themeLabel） */
export function categoryLabel(locale: Locale, key: string): string {
  const term = categories[key];
  if (!term) {
    throw new Error(
      `分类「${key}」不在词表里（${WORD_BOOK}）。已登记：${CATEGORY_KEYS.join('、')}`
    );
  }
  return locale === 'en' ? term.en : term.zh;
}

/** 标签的显示名，按语言取。取不到就抛（同 themeLabel） */
export function tagLabel(locale: Locale, key: string): string {
  const term = tags[key];
  if (!term) {
    throw new Error(`标签「${key}」不在词表里（${WORD_BOOK}）。已登记：${TAG_KEYS.join('、')}`);
  }
  return locale === 'en' ? term.en : term.zh;
}

/**
 * 分类按 order 排好的键。
 * 索引页与落地页都从这里取顺序，于是「分类骨架」在两边一致 ——
 * 空分类也要排进去（它只是还没写，不是不存在）。
 */
export function orderedCategories(): Record<string, CategoryTerm> {
  return Object.fromEntries(
    Object.entries(categories).sort((a, b) => a[1].order - b[1].order)
  );
}

/** 这个题材有没有展墙配色 */
export function hasThemeColor(key: string): boolean {
  return Boolean(themes[key]?.color);
}

/* ───────────────────────────── 报错信息 ───────────────────────────── */

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

/** 「已登记：paper（论文笔记）、ai（智能体与 AI）…」 */
function listed(terms: Record<string, { zh: string }>, keys: readonly string[]): string {
  return keys.map((k) => `${k}（${terms[k].zh}）`).join('、');
}

/**
 * 把一个不认识的值认到词表里的 key 上 —— 只在**有把握**时才认（别名精确匹配）。
 * 认出来是为了把报错说清楚：「`前端` 是 `frontend` 的旧名」比「不在词表里」有用得多。
 */
function asAliasOf(
  value: string,
  terms: Record<string, { alias: readonly string[] }>
): string | undefined {
  const hit = Object.entries(terms).find(([, term]) => term.alias.includes(value));
  return hit?.[0];
}

/* ───────────────────────────── 断言 ───────────────────────────── */

/**
 * 题材必须登记在词表里，否则抛。
 *
 * 钩在数据层（data/gallery.ts 读 meta.json 时）：改一行 meta.json 就该在构建期红掉，
 * 而不是等某间展厅的墙颜色不对了再回头找 —— 那个症状以前是**完全静默**的。
 */
export function assertTheme(key: string, where: string): void {
  if (hasTheme(key)) return;
  const guess = nearest(key, THEME_KEYS);
  throw new Error(
    `${where} 里的 theme 是「${key}」，但词表（${WORD_BOOK}）里没有登记。` +
      `\n已登记：${listed(themes, THEME_KEYS)}` +
      (guess.length ? `\n是不是想写：${guess.join('、')}？` : '')
  );
}

/**
 * 文章的分类必须是词表里的 key，否则抛。
 *
 * 为什么不让它「随便写」：分类的 key 同时是 URL 段（`/categories/tech/`），
 * 而且中英两版共用同一个 key —— 自由写的话 `技术` / `Tech` 会各长一个页面，
 * 切语言时对不上（这正是迁移前的状况）。
 */
export function assertCategory(key: string, where: string): void {
  if (hasCategory(key)) return;
  const guess = nearest(key, CATEGORY_KEYS);
  throw new Error(
    `${where} 里的 category 是「${key}」，但词表（${WORD_BOOK}）里没有登记。` +
      `\n已登记：${listed(categories, CATEGORY_KEYS)}` +
      (guess.length ? `\n是不是想写：${guess.join('、')}？` : '') +
      `\n（分类只答「这是什么领域」，受控；随手想到的词放 tags）`
  );
}

/**
 * 文章的标签必须登记在词表里，否则抛。
 *
 * 「标签自由」指的是**随时可以加**，不是「不用登记」：值同时是 URL 段，
 * 自由输入会让 `/tags/Docker/` 和 `/tags/docker/` 变成两页。
 * 加一个标签的成本是一行 TAGS，收益是它可数、旧名可归一、中英对得上。
 */
export function assertTags(keys: readonly string[], where: string): void {
  const bad = keys.filter((key) => !hasTag(key));
  if (!bad.length) return;

  const lines = bad.map((key) => {
    const aliasOf = asAliasOf(key, tags);
    if (aliasOf) {
      return `  · 「${key}」是 ${aliasOf} 的**旧名**，把它改成 ${aliasOf}（旧地址会自动跳转）`;
    }
    const guess = nearest(key, TAG_KEYS);
    return (
      `  · 「${key}」没有登记` + (guess.length ? `，是不是想写：${guess.join('、')}？` : '')
    );
  });

  throw new Error(
    `${where} 里的 tags 有未登记的词：\n${lines.join('\n')}` +
      `\n已登记：${TAG_KEYS.join('、')}` +
      `\n要加新标签就往 ${WORD_BOOK} 的 TAGS 里加一行：` +
      `\n    newkey: { zh: '中文名', en: 'English' },`
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

/* ───────────────────────── 旧地址（迁移用） ───────────────────────── */

// 一次性校验：目标必须真的存在，否则会生成一堆指向 404 的跳转页 ——
// 而跳转页不会报错，人也不会点进去看，就这么烂着。
(() => {
  for (const route of LEGACY_TERM_ROUTES) {
    const [kind, key] = route.to.split('/');
    const known =
      kind === 'categories' ? CATEGORY_KEYS.includes(key) : kind === 'tags' && TAG_KEYS.includes(key);
    if (!known) {
      throw new Error(
        `${WORD_BOOK} 的 LEGACY_TERM_ROUTES 里，「${route.from}」指向 ${route.to}，` +
          `但这个词条不存在 —— 跳转页会指向 404。`
      );
    }
    // 旧地址不能与同一类里的任何 key **只差大小写**：
    // 在大小写不敏感的文件系统上（Windows / macOS 默认），`tags/Astro/` 与
    // `tags/astro/` 是**同一个目录** —— 真页面与跳转页抢一个位置，谁后写谁赢。
    // 真页面被顶掉时跳转目标还是它自己，就成了指向自己的死循环，比 404 糟得多。
    const sameKind = route.kind === 'categories' ? CATEGORY_KEYS : TAG_KEYS;
    const clash = sameKind.find((key) => key.toLowerCase() === route.from.toLowerCase());
    if (clash) {
      throw new Error(
        `${WORD_BOOK} 的 LEGACY_TERM_ROUTES 里，旧地址「${route.from}」与现有的 ` +
          `${route.kind} key「${clash}」只差大小写 —— 在大小写不敏感的文件系统上` +
          `那是同一个目录，跳转页会顶掉真页面（且跳转目标就是它自己）。` +
          `这条旧地址只能不要：它要么与新地址一字不差（本来就不需要跳转），` +
          `要么就是当年写成了大写。`
      );
    }
  }
})();

/**
 * 某一语言、某一类词条的旧地址 → 新地址（新地址是**含语言前缀的站内路径**）。
 * 给 pages/categories/[category].astro 与 pages/tags/[tag].astro 的 getStaticPaths 用。
 */
export function legacyTermRoutes(
  locale: Locale,
  kind: 'categories' | 'tags'
): { from: string; to: string }[] {
  return LEGACY_TERM_ROUTES.filter(
    (route) => route.locale === locale && route.kind === kind
  ).map(({ from, to }) => ({ from, to }));
}

import { z } from 'zod';
import { TOPICS, TOPIC_KEYS, type TopicTerm } from '../data/gleanings/topics';
import { formatIssues } from '../data/profile.schema';
import linksJson from '../data/gleanings/links.json';
import nowJson from '../data/gleanings/now.json';
import starsJson from '../data/gleanings/stars.json';
import curatedJson from '../data/gleanings/stars-curated.json';
import type { Locale } from '../i18n/ui';

/**
 * 拾遗（gleanings）的**校验 + 取用**。
 *
 * 与 `lib/taxonomy.ts` 同一个套路，为什么分两层也同一个理由：
 * `data/gleanings/topics.ts` 是纯数据（零 import），校验要 zod，落在这里。
 *
 * 校验策略与本站其它数据文件一致：**不一致就让构建红掉**
 * （profile / friends / gallery / taxonomy 同款）。
 *
 * 规格：docs/superpowers/specs/2026-09-16-gleanings-design.md
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORD_BOOK = 'src/data/gleanings/topics.ts';

/** 过期阈值（天）：超过就让页面上那个时间戳带上「可能已过期」 */
export const STALE_DAYS = 7;

/* ───────────────────────────── 结构校验 ───────────────────────────── */

const TopicTermSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1),
  order: z.number().int(),
  desc: z.string().min(1),
});

const TopicsSchema = z.record(z.string().regex(SLUG), TopicTermSchema);

/**
 * 手写散文段：`zh` 必填、`en` 可省。
 *
 * **刻意偏离 `friends.json` 的双语并列数组**：57 个仓库要维护两份是不可能的，
 * 它只会导致这个模块没人维护。结构化字段（url / 主题 / 日期 / 采集值）共享一份，
 * 人类可读的散文段允许只写中文，英文缺失时回落中文。
 * 界面文案仍然中英各写一份，与全站一致。
 */
const ProseSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1).optional(),
});

const LinkSchema = z.object({
  // z.url() 而不是 z.string().url()：zod 4 里后者已废弃（astro check 会报 ts(6385)）
  url: z.url().startsWith('https://'),
  title: z.string().min(1),
  note: ProseSchema,
  topics: z.array(z.string().min(1)).min(1),
  addedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  featured: z.boolean().default(false),
});

const LinksSchema = z.object({ links: z.array(LinkSchema) });

const NowSchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(ProseSchema).min(1),
});

/** 抓取产物：字段一律是 API 的**客观值**，不含任何人的判断 —— 所以脚本可以整份覆盖 */
const RepoSchema = z.object({
  fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  url: z.url().startsWith('https://'),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  pushedAt: z.string().nullable(),
  starredAt: z.string().nullable(),
  archived: z.boolean(),
});

const StarsSchema = z.object({
  source: z.literal('github'),
  owner: z.string().min(1),
  fetchedAt: z.string().min(1),
  repos: z.array(RepoSchema),
});

/** 覆盖层：一个仓库一个对象，**只写与默认值不同的字段**，所以这个文件可以很短 */
const CuratedSchema = z.object({
  repos: z.record(
    z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    z.object({
      topic: z.string().regex(SLUG),
      featured: z.boolean().default(false),
      note: ProseSchema.optional(),
    })
  ),
});

/* ───────────────────────────── 读入并校验 ───────────────────────────── */

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, where: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${where} 不符合 ${where} 的数据约定：\n${formatIssues(result.error)}`);
  }
  return result.data;
}

const topicsParsed = parseOrThrow(TopicsSchema, TOPICS, WORD_BOOK);
const linksData = parseOrThrow(LinksSchema, linksJson, 'src/data/gleanings/links.json');
const nowData = parseOrThrow(NowSchema, nowJson, 'src/data/gleanings/now.json');
const starsData = parseOrThrow(StarsSchema, starsJson, 'src/data/gleanings/stars.json');
const curatedData = parseOrThrow(
  CuratedSchema,
  curatedJson,
  'src/data/gleanings/stars-curated.json'
);

/** 校验过的主题词表 */
export const topics: Record<string, TopicTerm> = topicsParsed;

/* ───────────────────── 一致性校验（不合规就让构建红） ───────────────────── */

/** order 必须两两不同：相同的话排序会退化成「看声明顺序」 */
(() => {
  const seen = new Map<number, string>();
  for (const [key, term] of Object.entries(topics)) {
    const taken = seen.get(term.order);
    if (taken) {
      throw new Error(
        `${WORD_BOOK} 里 ${taken} 和 ${key} 的 order 都是 ${term.order}。` +
          `排序会变得不确定，改掉一个（同类之间留 10 的间隔）。`
      );
    }
    seen.set(term.order, key);
  }
})();

function hasTopic(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(topics, key);
}

/** 编辑距离：给写错的 key 挑最近的候选（「是不是想写 xxx」） */
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

/** 「agent（智能体与 Skill）、llm（模型与训练）…」 */
function listed(): string {
  return TOPIC_KEYS.map((k) => `${k}（${topics[k].zh}）`).join('、');
}

/**
 * 主题必须登记在词表里，否则抛。
 *
 * 收藏夹与仓库**都**过这一道：两者都是手写的，写错就是构建红 ——
 * 不能等到页面上出现一个裸 key 才发现（迁移前的分类就是这么烂掉的）。
 *
 * 导出是为了让探针能直接驱动它（同 `lib/taxonomy.ts` 的 assertTheme 一族）。
 */
export function assertTopic(key: string, where: string): void {
  if (hasTopic(key)) return;
  const guess = nearest(key, TOPIC_KEYS);
  throw new Error(
    `${where} 里的主题「${key}」没登记在词表（${WORD_BOOK}）里。` +
      `\n已登记：${listed()}` +
      (guess.length ? `\n是不是想写：${guess.join('、')}？` : '') +
      `\n要加新主题就往 TOPICS 里加一行：newkey: { zh: '中文名', en: 'English', order: 100, desc: '…' }`
  );
}

for (const link of linksData.links) {
  for (const key of link.topics) assertTopic(key, `links.json 的「${link.title}」`);
}
for (const [fullName, entry] of Object.entries(curatedData.repos)) {
  assertTopic(entry.topic, `stars-curated.json 的「${fullName}」`);
}

/** 收藏夹的 url 是主键：重复的话 React 那种 key 冲突在 Astro 里不报错，只会静默少一条 */
(() => {
  const seen = new Map<string, string>();
  for (const link of linksData.links) {
    const taken = seen.get(link.url);
    if (taken) {
      throw new Error(
        `src/data/gleanings/links.json 里「${taken}」与「${link.title}」的 url 相同（${link.url}）。` +
          `url 是主键，必须唯一。`
      );
    }
    seen.set(link.url, link.title);
  }
})();

/**
 * 覆盖层里指向一个**已经不在 star 列表里**的仓库 —— 不算错，但要说一声：
 * 多半是你取消了 star，那一行可以删了。
 */
(() => {
  const live = new Set(starsData.repos.map((r) => r.fullName));
  const ghost = Object.keys(curatedData.repos).filter((name) => !live.has(name));
  if (ghost.length) {
    console.warn(
      `[gleanings] stars-curated.json 里有 ${ghost.length} 条指向已不在 star 列表里的仓库，` +
        `可以删掉：${ghost.join('、')}`
    );
  }
})();

/* ───────────────────────────── 取用 ───────────────────────────── */

/**
 * 散文段按语言取，英文缺失时回落中文。
 * 界面文案（模块名、统计条、空态）不走这里 —— 那些在 `i18n/ui.ts`，中英各一份。
 */
export function pick(locale: Locale, text: { zh: string; en?: string }): string {
  return locale === 'en' ? (text.en ?? text.zh) : text.zh;
}

export function topicLabel(locale: Locale, key: string): string {
  const term = topics[key];
  if (!term) {
    throw new Error(`主题「${key}」不在词表里（${WORD_BOOK}）。已登记：${TOPIC_KEYS.join('、')}`);
  }
  return locale === 'en' ? term.en : term.zh;
}

/** 主题按 order 排好的 key。收藏夹与仓库共用同一套顺序 */
export function orderedTopicKeys(): string[] {
  return Object.keys(topics).sort((a, b) => topics[a].order - topics[b].order);
}

/* ───────────────────────────── 收藏夹 ───────────────────────────── */

export interface LinkItem {
  url: string;
  title: string;
  /** 「为什么收它」。必填 —— 没有这句的链接等于书签栏 */
  note: { zh: string; en?: string };
  topics: string[];
  addedAt: string;
  featured: boolean;
}

export const links: readonly LinkItem[] = linksData.links;

export interface LinkGroup {
  key: string;
  label: string;
  items: LinkItem[];
}

/**
 * 收藏夹按主题分组。
 *
 * **空组不出现** —— 这一条与 spec 初稿「每个 key 都出组（含 0 条的）」不同，
 * 是拿到 9 个主题的实底后改的：主题不像博客的 4 个分类，
 * 9 个里有 7 个空着会变成一片「还没有」的噪声。
 * 词表仍然决定**顺序**，空组只是不渲染。
 */
export function linkGroups(locale: Locale): LinkGroup[] {
  return orderedTopicKeys()
    .map((key) => ({
      key,
      label: topicLabel(locale, key),
      items: links.filter((link) => link.topics.includes(key)).sort(byLinkWeight),
    }))
    .filter((group) => group.items.length > 0);
}

/* ───────────────────────────── 仓库 ───────────────────────────── */

export interface Repo {
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  pushedAt: string | null;
  starredAt: string | null;
  archived: boolean;
  /** 覆盖层给的主题；`null` = 还没归类，落进「未归类」组 */
  topic: string | null;
  featured: boolean;
  note?: { zh: string; en?: string };
}

/** 未归类组的条数上限：超出的部分只报数、不渲染 —— 防止新 star 无声地把页面撑烂 */
export const UNSORTED_SHOWN = 12;

export const starsFetchedAt: string = starsData.fetchedAt;

/**
 * GitHub 自己的 star 列表页 —— 未归类组被截断时的**出口**。
 *
 * 有它才敢截断：截掉的那部分不是消失了，是「去 GitHub 看」。
 * 没有出口的截断就等于藏东西。
 */
export const starsSourceUrl = `https://github.com/${starsData.owner}?tab=stars`;

/** 抓取来的客观事实 + 手写的判断，在**读取时**合并 —— 两边都不污染对方 */
export const repos: readonly Repo[] = starsData.repos.map((repo) => {
  const entry = curatedData.repos[repo.fullName];
  return {
    ...repo,
    topic: entry?.topic ?? null,
    featured: entry?.featured ?? false,
    note: entry?.note,
  };
});

export interface RepoGroup {
  /** `null` 表示「未归类」 */
  key: string | null;
  label: string;
  items: Repo[];
  /** 被截掉没渲染的条数（只有未归类组可能不为 0） */
  hidden: number;
}

/** 组内排序：精选优先，其余按 star 数降序（star 少的排后面，不代表不好，只是还没长起来） */
function byWeight(a: Repo, b: Repo): number {
  return Number(b.featured) - Number(a.featured) || b.stars - a.stars;
}

/**
 * 仓库按主题分组，末尾附一个「未归类」组。
 *
 * **未归类不隐藏、不报错** —— 你新 star 一个仓库，第二天它就出现在这一组里等着被归类。
 * 这是诚实的做法（没有东西被悄悄丢掉），代价是要防它膨胀，所以有 `UNSORTED_SHOWN` 上限。
 *
 * 列表作为参数传进来（而不是直接闭包 `repos`）：未归类那条分支在**当前数据上走不到**
 * （57 个全归类了），做成纯函数才能用合成数据把上限与 hidden 那两行逼出来 ——
 * 否则它们永远不会被执行到，也就永远不知道写得对不对。
 */
export function groupRepos(
  list: readonly Repo[],
  locale: Locale,
  unsortedLabel: string
): RepoGroup[] {
  const groups: RepoGroup[] = orderedTopicKeys()
    .map((key) => ({
      key,
      label: topicLabel(locale, key),
      items: list.filter((repo) => repo.topic === key).sort(byWeight),
      hidden: 0,
    }))
    .filter((group) => group.items.length > 0);

  const unsorted = list.filter((repo) => repo.topic === null).sort(byWeight);
  if (unsorted.length) {
    groups.push({
      key: null,
      label: unsortedLabel,
      items: unsorted.slice(0, UNSORTED_SHOWN),
      hidden: Math.max(0, unsorted.length - UNSORTED_SHOWN),
    });
  }

  return groups;
}

/** 页面用的那个：分组当前这份真实数据 */
export function repoGroups(locale: Locale, unsortedLabel: string): RepoGroup[] {
  return groupRepos(repos, locale, unsortedLabel);
}

/**
 * 仓库那一行显示什么：**我写的注优先，没写就回落仓库自述**。
 *
 * 英文页另有一条：注只有中文时不硬塞给英文读者 —— 仓库自述本来就是英文，
 * 那比一段看不懂的中文有用。所以英文侧的优先级是 en 注 → 自述 → 中文注。
 */
export function repoBlurb(locale: Locale, repo: Repo): string {
  if (locale === 'en') {
    return repo.note?.en ?? tidy(repo.description) ?? repo.note?.zh ?? '';
  }
  return repo.note?.zh ?? tidy(repo.description) ?? '';
}

/** 自述的展示上限。上游描述常被当成 SEO 位，尾巴上挂着邀请链接 */
const MAX_BLURB = 140;

/**
 * 收拾仓库自述：去掉裸链接、压掉多余空白、超长截断。
 *
 * 只处理**仓库自述**，不动我写的注 —— 注是自己写的，本来就干净，
 * 被自动加工反而是越权。这也不是改数据（`stars.json` 里原样保留），只是排版。
 * 实底：57 条里有若干条自述结尾是「Join our Discord: https://…」。
 */
function tidy(text: string | null): string | undefined {
  if (!text) return undefined;
  const stripped = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[\s·|—–-]+$/, '')
    .trim();
  if (!stripped) return undefined;
  return stripped.length > MAX_BLURB ? `${stripped.slice(0, MAX_BLURB).trimEnd()}…` : stripped;
}

/** 这个仓库显示的「一句话」是不是我写的注（是的话排版上更重一点） */
export function hasOwnNote(locale: Locale, repo: Repo): boolean {
  return locale === 'en' ? Boolean(repo.note?.en) : Boolean(repo.note?.zh);
}

/**
 * star 数压缩：83597 → `83.6k`。
 * 满 10 万就去掉小数（`259k`）—— 那个量级的小数位没有信息量，只占地方。
 */
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 100 ? k.toFixed(1) : Math.round(k)}k`;
}

/** 年月，给「最后推送」用：`2026-09`。日粒度对一行列表来说太吵 */
export function monthOf(iso: string | null): string {
  return iso ? dayOf(iso).slice(0, 7) : '';
}

/** 语言色点。查不到返回 undefined，由 CSS 退回主题的中性色（这样暗色下也看得见） */
export function langColor(language: string | null): string | undefined {
  if (!language) return undefined;
  return LANGUAGE_COLORS[language];
}

// GitHub 官方语言色（linguist）。只收常见的那几十个 —— 查不到也不是错，
// 前端会退回中性色，不会出现一个看不见的点。
const LANGUAGE_COLORS: Record<string, string> = {
  Python: '#3572A5',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Lua: '#000080',
  Haskell: '#5e5086',
  Elixir: '#6e4a7e',
  Clojure: '#db5855',
  Scala: '#c22d40',
  'Jupyter Notebook': '#DA5B0B',
  MDX: '#fcb32c',
  Astro: '#ff5a03',
  Zig: '#ec915c',
  Nix: '#7e7eff',
  PowerShell: '#012456',
  Makefile: '#427819',
  Dockerfile: '#384d54',
  R: '#198CE7',
  MATLAB: '#e16737',
  TeX: '#3D6117',
  'Vim Script': '#199f4b',
  Solidity: '#AA6746',
  OCaml: '#ef7a08',
  Julia: '#a270ba',
  Nim: '#ffc200',
  Crystal: '#000100',
  'F#': '#b845fc',
  'Objective-C': '#438eff',
  Assembly: '#6E4C13',
  Perl: '#0298c3',
  Groovy: '#4298b8',
  Batchfile: '#C1F12E',
  GDScript: '#355570',
};

/* ───────────────────────────── 现在 ───────────────────────────── */

export const now = {
  updatedAt: nowData.updatedAt,
  items: nowData.items as readonly { zh: string; en?: string }[],
};

/* ───────────────────────────── 时间 ───────────────────────────── */

/**
 * ISO 时间 → `YYYY-MM-DD`（UTC）。
 *
 * **静态渲染绝对日期，不算相对时间**：静态站的「3 小时前」在构建那一刻就冻住了，
 * 页面久不重建它就开始说谎。绝对日期永远不说谎。
 */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/** 快照是不是已经过期（构建时判断）。过期要被**看见**，不是被藏起来 */
export function isStale(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > STALE_DAYS * 24 * 60 * 60 * 1000;
}

/* ───────────────────────────── 统计 ───────────────────────────── */

/** 页首统计条用。全部现算 —— 加内容不用回来改文案 */
export const gleaningsTotals = {
  links: links.length,
  repos: repos.length,
  topics: orderedTopicKeys().filter((key) => repos.some((r) => r.topic === key)).length,
};

/* ───────────────────── 总览页：抽屉里最上面那几件 ───────────────────── */

/**
 * 收藏夹的组内排序：精选优先，其余按加入日期倒序（新收的排前面）。
 *
 * 单独抽出来是为了让**抽屉内部**与**把手下那三行预览**用同一把尺子 ——
 * 预览的全部意义就是「点进去先看到它」，两处排序一旦不一致，预览就是在骗人。
 * （函数声明会提升，所以可以先在这里被 `linkGroups` 用、后在这里定义。）
 */
function byLinkWeight(a: LinkItem, b: LinkItem): number {
  return Number(b.featured) - Number(a.featured) || b.addedAt.localeCompare(a.addedAt);
}

/**
 * 卡片抬头显示来源域名：比标题先给出「这是谁家的东西」。
 * 去掉 `www.` —— 它在标题行里既占宽度又没有信息量。
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 总览页的收藏夹预览：与组内同序，取前 n 条 */
export function linkPreview(limit: number): LinkItem[] {
  return [...links].sort(byLinkWeight).slice(0, limit);
}

/** 总览页的仓库预览：与组内同序（精选优先，其余按 star 降序） */
export function repoPreview(limit: number): Repo[] {
  return [...repos].sort(byWeight).slice(0, limit);
}

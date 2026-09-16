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
 * 分类是信息架构（少、稳、承担导航，所以有 order 与 desc）；
 * 标签是检索索引（多、散、随写随加，所以只有显示名与旧名）。
 * 表里所有 key 都要过 SLUG（小写 ASCII + 连字符），因为它同时是 URL 段。
 * 规格：docs/superpowers/specs/2026-09-16-taxonomy-wordbook.md
 *
 * ⚠️ 这个文件**不许 import 任何东西**：3D 展厅的客户端代码
 * （lib/gallery/blueprint.ts）也引它，一旦带上 zod 之类的依赖就会被打进
 * 浏览器包里。校验与取用在 lib/taxonomy.ts（只跑构建期）。
 */

/* ────────────────────────────── 画廊题材 ────────────────────────────── */

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
  /** 旧名 / 异名：只用于归一化与生成旧地址跳转，不显示 */
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

/* ────────────────────────────── 文章分类 ────────────────────────────── */

export interface CategoryTerm {
  /** 中文显示名 */
  zh: string;
  /** 英文显示名 */
  en: string;
  /** 排序，小的在前。同类之间留 10 的间隔，中间插新类不用重排 */
  order: number;
  /**
   * 收什么、不收什么（**中文，单语**）。
   * 这是给自己与后台看的落点依据，不显示给访客 —— 所以不做双语：
   * 双语字段只写一边、另一边永远没人读，比单语更糟。
   */
  desc?: string;
}

/**
 * 分类词表。**只答一个问题：这是什么领域。**
 *
 * 三条刻意的选择（2026-09-16 从 9 篇的实底里定出来的，不是凭空拍的）：
 * 1. 只有 4 个。分类是导航，挂得越多越没用 —— 原来自由输入的 5 个里，
 *    `agent` / `tailscale` 是**软件名**，那是标签该待的地方
 * 2. 不设「建站与前端」：本站的两篇 Astro 踩坑是「踩框架的坑」，与 Git、Docker
 *    同类 —— 都是「动手做技术的事」，合在 tech 里比单开一类更结实
 * 3. **体裁不占分类**：`随笔` / `新闻` 答的是「什么形式」不是「什么领域」。
 *    转载与否已经有 `source` 字段，列表页给个徽章即可
 *
 * 落点判定靠**动作**、不靠领域 —— 这条是四个类不打架的关键：
 *   在读一篇论文（不论什么领域）→ paper
 *   动手做 AI 的事 / 评价一个 AI 事件 → ai
 *   查工具、记命令、踩框架的坑 → tech
 *   不是技术内容 → notes
 */
export const CATEGORIES: Record<string, CategoryTerm> = {
  paper: {
    zh: '论文笔记',
    en: 'Paper Notes',
    order: 10,
    desc: '论文阅读、方法梳理、复现记录。关于论文的新闻报道不在这里。',
  },
  ai: {
    zh: '智能体与 AI',
    en: 'AI & Agents',
    order: 20,
    desc: 'Agent 的原理与工程、模型能力、行业事件与评论。',
  },
  tech: {
    zh: '技术与工具',
    en: 'Tech & Tools',
    order: 30,
    desc: '命令行与容器、组网与自托管、框架踩坑与工程实践。',
  },
  notes: {
    zh: '随笔',
    en: 'Notes',
    order: 40,
    desc: '站务、生活、杂记。技术内容不放这里。',
  },
};

/* ────────────────────────────── 文章标签 ────────────────────────────── */

export interface TagTerm {
  /** 中文显示名 */
  zh: string;
  /** 英文显示名 */
  en: string;
  /**
   * 旧名 / 异名：只用于**归一化**与生成旧地址跳转，不显示。
   * 与 key 不同，别名可以是中文、带空格与括号 —— 它是当年真实出现过的写法。
   */
  alias?: readonly string[];
}

/**
 * 标签词表。标签是「检索索引」：随手加是它的本分，但**加完要登记**。
 *
 * 为什么不干脆全自由：值同时是 URL 段，自由输入会让
 * `/tags/Docker/` 和 `/tags/docker/` 变成两个页面，中英各写一套也必然漂。
 * 登记的成本很低（一行），换来的是「这个词一共有几篇」可数、旧名可归一。
 *
 * 原来 13 个写法（含中文、大小写、带括号的长句）归一成这 8 个 key。
 */
export const TAGS: Record<string, TagTerm> = {
  astro: { zh: 'Astro', en: 'Astro', alias: ['Astro'] },
  frontend: { zh: '前端', en: 'Frontend', alias: ['前端'] },
  site: { zh: '建站', en: 'Site', alias: ['建站', 'meta'] },
  git: { zh: 'Git', en: 'Git' },
  docker: { zh: 'Docker', en: 'Docker' },
  networking: { zh: '组网', en: 'Networking', alias: ['组网', 'vpn'] },
  agent: { zh: '智能体', en: 'Agent', alias: ['AI Agent(智能体) 教程'] },
  openai: { zh: 'OpenAI', en: 'OpenAI' },
};

/* ────────────────────────────── 派生常量 ────────────────────────────── */

/** 词表里所有题材键 */
export const THEME_KEYS: readonly string[] = Object.keys(THEMES);

/** 词表里所有分类键（声明顺序；要按 order 排用 lib/taxonomy.ts 的 orderedCategories） */
export const CATEGORY_KEYS: readonly string[] = Object.keys(CATEGORIES);

/** 词表里所有标签键 */
export const TAG_KEYS: readonly string[] = Object.keys(TAGS);

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

/* ────────────────────────── 旧地址（迁移用，一次性） ────────────────────────── */

export interface LegacyTermRoute {
  /** 旧地址里的那一段，原样照抄当年的产物 */
  from: string;
  /** 旧地址属于哪一类，决定它当年挂在 /categories/ 还是 /tags/ 之下 */
  kind: 'categories' | 'tags';
  /** 新地址：**词条页根之下的路径**，例如 'categories/tech'。与画廊的 legacyRoutes() 同一写法 */
  to: string;
  /** 当年是哪一种语言的地址 */
  locale: 'zh' | 'en';
}

/**
 * 词条旧地址 → 新地址。**迁移用的，一次性**。
 *
 * 2026-09-16 之前「词的值本身就是显示名、也是 URL 段」，于是旧地址里有
 * 中文（`/categories/技术/`）、有大写（`/categories/Tech/`）、
 * 甚至带空格与括号（`/tags/AI Agent(智能体) 教程/`）。
 *
 * 这些**推导不出来** —— 「技术」该去 `tech` 还是 `ai`？只有当年的产物知道。
 * 所以照抄产物里真实存在过的 20 条，逐条写死，不做自动推导。
 *
 * `to` 用的是**路径**而不是词条 key，因为有些旧地址**跨了类型**：
 * `/tags/随笔/` 现在归到分类 `/categories/notes/`。
 *
 * 生成方式：pages/categories/[category].astro 与 pages/tags/[tag].astro 的
 * getStaticPaths 各取自己那一份（按 locale + kind 过滤），多落地一个跳转页 ——
 * 静态站没有服务端 301，只能这样（与文章的 aliases 同一套做法）。
 *
 * ⚠️ 当年存在过的 20 条里，**有 7 条刻意没列进来**：
 *   `docker` / `git`（zh 标签）、`frontend`（en 标签）—— 旧写法与新 key 一字不差；
 *   `Astro`（zh 与 en 各一条）、`Tech` / `Notes`（en 的两个旧分类）—— 只差大小写。
 *
 * 共同点是**只差大小写、或完全相同**：在大小写不敏感的文件系统上（Windows / macOS 默认），
 * `dist/tags/Astro/` 与 `dist/tags/astro/` 是**同一个目录** —— 真页面与跳转页抢一个位置，
 * 谁后写谁赢。真页面被顶掉时，跳转目标还是它自己，就成了指向自己的死循环，
 * 比 404 糟得多。所以这几条旧地址**宁可放着 404**（何况一字不差的那些，
 * 地址本来就没变，根本不需要跳转）。下面那条守卫会拦住任何想把它们加回来的改动。
 *
 * 这份表观察一段时间后可以删：它只服务于 2026-09-16 之前存在过的地址。
 */
export const LEGACY_TERM_ROUTES: readonly LegacyTermRoute[] = [
  // 中文 · 分类（5 条）
  { locale: 'zh', kind: 'categories', from: '技术', to: 'categories/tech' },
  { locale: 'zh', kind: 'categories', from: '新闻', to: 'categories/ai' },
  { locale: 'zh', kind: 'categories', from: '随笔', to: 'categories/notes' },
  { locale: 'zh', kind: 'categories', from: 'agent', to: 'categories/ai' },
  { locale: 'zh', kind: 'categories', from: 'tailscale', to: 'categories/tech' },
  // 中文 · 标签（6 条）
  { locale: 'zh', kind: 'tags', from: 'AI Agent(智能体) 教程', to: 'tags/agent' },
  { locale: 'zh', kind: 'tags', from: 'vpn', to: 'tags/networking' },
  { locale: 'zh', kind: 'tags', from: '前端', to: 'tags/frontend' },
  { locale: 'zh', kind: 'tags', from: '建站', to: 'tags/site' },
  { locale: 'zh', kind: 'tags', from: '组网', to: 'tags/networking' },
  { locale: 'zh', kind: 'tags', from: '随笔', to: 'categories/notes' },
  // 英文 · 标签（2 条）
  { locale: 'en', kind: 'tags', from: 'meta', to: 'tags/site' },
  { locale: 'en', kind: 'tags', from: 'notes', to: 'categories/notes' },
];

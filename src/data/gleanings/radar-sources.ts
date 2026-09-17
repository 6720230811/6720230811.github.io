/**
 * 拾遗 · 雷达 —— **源元数据**（显示名 / 主页 / 语区 / 顺序）。
 *
 * 为什么与 `radar.json` 分家：
 * `radar.json` 是 `scripts/collect-radar.mjs` 每天整份覆盖的**抓取产物**，
 * 里面只许放客观值。而「这个源该排在前面还是后面」「它中文名叫什么」
 * 是**判断**，一旦进了抓取产物，某天改个端点就会把它擦掉。
 * 所以判断全部留在这个手写文件里（与 `topics.ts` / `stars-curated.json` 同一条边界）。
 *
 * ⚠️ 这个文件**不许 import 任何东西**，理由同 `topics.ts`：
 * 数据与校验分家，校验在 `src/lib/gleanings.ts`（只跑构建期）。
 *
 * ⚠️ 三处 id 必须一致，漏一处都会被拦住（见 `src/lib/gleanings.ts` 的对账断言）：
 *   ① 本文件的 `id`
 *   ② `scripts/collect-radar.mjs` 里 `ADAPTERS` 的 `id`
 *   ③ `radar.json` 的 `sources` 的 key
 * ①↔③ 由构建期断言管；①② 由探针管（它 esbuild 打包后 import 两边比对）。
 *
 * 规格：docs/superpowers/specs/2026-09-16-gleanings-radar-design.md
 */

export interface RadarSourceTerm {
  /** 与 adapter、radar.json 的 key 一致的 ASCII id */
  id: string;
  /** 中文显示名 */
  zh: string;
  /** 英文显示名 */
  en: string;
  /**
   * 源主页。**这不是装饰** —— 它是「这一源抓不到」时的出口。
   * 没有出口的失败态等于一堵墙。
   */
  home: string;
  /**
   * 语区，**只用来给总览条分两段**（中文热榜 / 技术榜单），
   * 不参与抽屉的顺序 —— 抽屉是平的，按 `order` 排。
   */
  zone: 'hot' | 'tech';
  /** 排列顺序，小的在前。彼此留 10 的间隔，中间插新源不用重排 */
  order: number;
  /**
   * 这个源的一句话说明（可选）。
   * 凡是**语义与「榜单」有偏差**的源，必须写在这里 ——
   * 不然就是让访客自己猜「这一格为什么不像热榜」。
   */
  note?: { zh: string; en?: string };
}

/**
 * 九个源。
 *
 * 中文热榜排前面、技术榜单排后面，是**手写的判断**，不是按 id 或数字排的：
 * 这一页是中文站，先给中文访客看他最熟的五个，再看技术向的四个。
 *
 * 选源经过实探（见规格 §二）：五家中文热榜走各自官方端点，微博与抖音
 * 直连即可、不需要 cookie 或签名；GitHub 趋势走官方 search API 而不爬 trending 页面。
 */
export const RADAR_SOURCES: RadarSourceTerm[] = [
  {
    id: 'weibo',
    zh: '微博热搜',
    en: 'Weibo Hot Search',
    home: 'https://s.weibo.com/top/summary',
    zone: 'hot',
    order: 10,
  },
  {
    id: 'douyin',
    zh: '抖音热榜',
    en: 'Douyin Trending',
    home: 'https://www.douyin.com/',
    zone: 'hot',
    order: 20,
  },
  {
    id: 'toutiao',
    zh: '头条热榜',
    en: 'Toutiao Hot Board',
    home: 'https://www.toutiao.com/',
    zone: 'hot',
    order: 30,
  },
  {
    id: 'baidu',
    zh: '百度热搜',
    en: 'Baidu Hot Search',
    home: 'https://top.baidu.com/board?tab=realtime',
    zone: 'hot',
    order: 40,
    note: {
      // 「按榜位画刻度」这件事必须说出来：不说的话，访客会把
      // 「榜首与第二名的落差」当成热度落差，而它只是名次差
      zh: '这一源只给榜位、不给热度，刻度按名次画。',
      en: 'This source ranks without heat values, so the scale follows rank.',
    },
  },
  {
    id: 'tencent',
    zh: '腾讯热点',
    en: 'Tencent News',
    home: 'https://news.qq.com/',
    zone: 'hot',
    order: 50,
    note: {
      zh: '这一源只给榜位、不给热度，刻度按名次画。',
      en: 'This source ranks without heat values, so the scale follows rank.',
    },
  },
  {
    id: 'hn',
    zh: 'Hacker News',
    en: 'Hacker News',
    home: 'https://news.ycombinator.com/',
    zone: 'tech',
    order: 60,
    note: {
      // HN 的首页顺序是它自己的排序算法，**不按分数**。这条不说清，
      // 访客会以为刻度乱了 —— 实测榜首 1311 分、第二名 1606 分
      zh: '首页顺序按它自己的算法，不按分数排。',
      en: 'Front-page order follows its own ranking, not the score.',
    },
  },
  {
    id: 'lobsters',
    zh: 'Lobsters',
    en: 'Lobsters',
    home: 'https://lobste.rs/',
    zone: 'tech',
    order: 70,
    note: {
      zh: '热度含时间衰减，所以分数不是从高到低。',
      en: 'Heat decays over time, so scores are not descending.',
    },
  },
  {
    id: 'gh-trending',
    zh: 'GitHub 趋势',
    en: 'GitHub Trending',
    home: 'https://github.com/trending',
    zone: 'tech',
    order: 80,
    note: {
      // 它不是「今日最热」，是「最近一周新建且涨得快」——
      // 语义差别必须讲明，否则「怎么全是新仓库」就是必然的疑问
      zh: '按「最近一周新建、star 涨得快」取，不等于今日最热。',
      en: 'Newly created in the last week with fast star growth — not today’s most popular.',
    },
  },
  {
    id: 'sspai',
    zh: '少数派',
    en: 'sspai',
    home: 'https://sspai.com/',
    zone: 'tech',
    order: 90,
    note: {
      // 少数派没有热榜，它的索引接口是按时间倒序 —— 这是「最近发的」，
      // 不是「最热的」。这一层语义差别必须写在页面上（规格 §八.6）
      zh: '没有热榜，这里是按发布时间倒序的新文章。',
      en: 'No hot list here — this is simply the newest articles by publish time.',
    },
  },
];

/** 全部源 id。对账断言与探针都用它 */
export const RADAR_SOURCE_IDS = RADAR_SOURCES.map((source) => source.id);

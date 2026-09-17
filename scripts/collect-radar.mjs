#!/usr/bin/env node
/**
 * 拾遗 / 雷达 —— 多源榜单抓取脚本
 *
 *   node scripts/collect-radar.mjs
 *
 * 产出 `src/data/gleanings/radar.json`：九个源（微博 / 抖音 / 头条 / 百度 / 腾讯 /
 * HN / Lobsters / GitHub 趋势 / 少数派）各自的榜单条目与抓取状态。
 *
 * 规格：docs/superpowers/specs/2026-09-16-gleanings-radar-design.md
 *
 * ---------------------------------------------------------------------------
 * 为什么不用第三方聚合 API
 *
 * 一条端点覆盖多家很省事，但那是**别人的服务器**。本机实测：
 * DailyHotApi 的公共实例整站 fetch failed（已死）、vvhan 连不上；
 * 60s 与 NewsNow 还活着，但把整块模块的可用性押在另一个人的免费实例上，
 * 等于把「哪天它下线」的死法留给自己。所以九家全部走**各家自己的端点**。
 *
 * 代价是九种 JSON 形状 —— 下面每个 adapter 都写着实测出来的**字段路径**，
 * 以及那个源特有的坑（百度双层信封、腾讯占位条、微博广告、头条字符串热度……）。
 * 改某个源之前先跑 `D:/homepage/.pet-e2e-dual/probe-radar-fields.mjs` 复核。
 *
 * ---------------------------------------------------------------------------
 * 为什么是「按源独立守卫 + 按源合并」，而不是沿用 collect.mjs 的整份覆盖
 *
 * collect.mjs 的四道守卫是全局的：任一命中就整份不写 —— 单源场景正确。
 * 雷达有九个源，全局拒绝**反而有害**：微博限流一次，就会让 HN 和 Lobsters
 * 也一起停在旧快照上。
 *
 * 「宁可数据旧，不可数据烂」在多源下必须细化成：
 * **坏的那一格别动，好的那几格照常更新。**
 *
 * ---------------------------------------------------------------------------
 * 每源独立的五道守卫（命中任一 → 该源 ok:false + 沿用上一次的条目）
 *
 *   ① 请求失败 / 非 200 / 超时 / JSON 解析失败 / 字段路径变了
 *   ② 解析后 0 条（过滤器把条目全滤光了也算 —— 字段整体挪位就是这么现形的）
 *   ③ 条目数骤降（少于该源上次的 60%）
 *   ④ 丢掉的条目超过一半（字段挪位时通常一半对一半错）
 *   ⑤ 逐条形状校验：title 空 / url 非 https 的**丢弃并计数**（不整源判死）
 *
 * 守卫 ⑤ 是逐条过滤而非整源拒绝：一条脏数据不该让另外九条陪葬。
 * 但过滤率进守卫 ④ —— 那说明「源改版了，只是没全改」，该报警。
 *
 * ---------------------------------------------------------------------------
 * 只在被当脚本执行时跑 main()
 *
 * 判据用**文件名**，不用 `import.meta.url === pathToFileURL(process.argv[1]).href`
 * —— 探针会把本文件用 esbuild 打进 `probe-gleanings.out.mjs`，那时两边相等，
 * 于是探针只要 import 一下就会把九趟抓取跑起来并重写 radar.json。
 * 文件改名的话记得同步这一行（与 collect.mjs 同款）。
 *
 * ⚠️ 反过来要知道：**直接 `import './collect-radar.mjs'` 是会跑抓取的**，
 *    因为此时 `import.meta.url` 就是本文件。想拿它的导出做断言，
 *    必须像 `probe-gleanings.mjs` 那样**先 esbuild 打包再 import 产物**
 *    （本条在写守卫测试时当场踩到：断言跑完，抓取跟着也跑了）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/data/gleanings/radar.json', import.meta.url));

/** 每个源留几条。榜单本来就该看前几名 */
export const TOP_N = 10;

/** 条目数骤降阈值：新数据少于旧数据的这个比例就拒绝（与 collect.mjs 同值） */
export const SHRINK_FLOOR = 0.6;

/** 单请求超时。九源串起来跑，给太宽会让整个抓取变慢，给太窄会把慢源误判成挂掉 */
const TIMEOUT_MS = 12_000;

/** 通用 UA：有几家（头条、微博）对默认 UA 不友好 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class GuardError extends Error {
  constructor(guard, message) {
    super(`守卫 ${guard} 拦下：${message}`);
    this.name = 'GuardError';
  }
}

/* ───────────────────────── 取数与路径 ───────────────────────── */

async function getJson(url, extraHeaders = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, */*', ...extraHeaders },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // ⚠️ **一定要把 `err.cause` 打出来。** undici 的 `TypeError: fetch failed`
    //    里面一个字的有用信息都没有；真正的病因（连接超时、试过哪几个 IP、
    //    DNS 失败、TLS 握手失败）全在 `cause` 上。
    //    实测：HN 那次是 `UND_ERR_CONNECT_TIMEOUT`，且 cause.message 里列着
    //    四个 Google IP —— 只看 `fetch failed` 的话，根本分不清是「源挂了」
    //    还是「本机链路不通」，而这两者的处置完全相反。
    const cause = err.cause;
    const detail = cause
      ? `${cause.code ? `${cause.code} ` : ''}${cause.name}: ${cause.message}`
      : `${err.name}: ${err.message}`;
    throw new GuardError('①', `请求失败（${url}）：${detail}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 403 ? '（多半是限流或被风控）' : '';
    throw new GuardError('①', `HTTP ${res.status}${hint}（${url}）：${body.slice(0, 160)}`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new GuardError('①', `不是 JSON（${url}）：${err.message}`);
  }
}

/**
 * 按路径取一个**必须存在**的数组。
 *
 * 为什么不用一堆 `?.`：`data?.cards?.[0]?.content?.[0]?.content` 拼错了只会
 * 得到 `undefined`，接着 `.map` 报「Cannot read properties of undefined」——
 * 报错里**没有路径**，得回来重新翻一遍源。这个 helper 把路径原样写进消息里。
 *
 * 百度那个双层信封就是靠它定位的（真列表在 cards[0].content[0].content[]，
 * 少写一层会得到长度 1 的数组 —— 不会报错，只会静默少九条）。
 */
function digArray(root, path, source) {
  let cur = root;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) {
      cur = undefined;
      break;
    }
    cur = cur[key];
  }
  if (!Array.isArray(cur)) {
    throw new GuardError(
      '①',
      `${source} 的字段路径变了：找不到 \`${path}\`（拿到 ${typeof cur}）。` +
        `跑 probe-radar-fields.mjs 复核这个源的形状。`
    );
  }
  return cur;
}

/** 字符串热度值（头条的 `HotValue` 就是这种）→ number。不是数字就返回 undefined */
function toNum(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ───────────────────────── 九个 adapter ───────────────────────── */

/**
 * 每个 adapter 的契约：
 *   { id, scoreKind, fetch(): Promise<candidate[]> }
 *
 * candidate = { title, url, score?, blurb?, meta? }
 * —— 原样返回候选，**形状过滤与截断交给下面的 sanitize/Take**，
 * 免得九个 adapter 各写一套长度判断，哪天改了上限要改九处。
 *
 * scoreKind 决定页面怎么读热度：
 *   'hot'  = 源给了热度数值
 *   'rank' = 源**没给**（百度只有榜位、腾讯只有排名与质量档、少数派只有时间）
 *            → 刻度按榜位递减，页面上另加一枚小标记，
 *            **不许拿排名假装是热度**
 *
 * 判定 scoreKind 之前**先确认那个字段真的是热度**。第一版把腾讯的 `ranking`
 * 当热度用，画出来正好是 1,2,3…10 —— 那画的是名次。字段名叫得像并不等于它是。
 */
const ADAPTERS = [
  {
    id: 'weibo',
    scoreKind: 'hot',
    async fetch() {
      const j = await getJson('https://weibo.com/ajax/side/hotSearch', {
        Referer: 'https://weibo.com/',
      });
      const list = digArray(j, 'data.realtime', '微博');
      return (
        list
          // 广告（实测 52 条里有 2 条）。**必须滤**：不滤就是往榜单里塞推广
          .filter((x) => !x.is_ad && !x.adid)
          .map((x) => {
            // word_scheme 对话题类带 `#…#`，普通词条没有 —— 两个都认
            const word = x.word_scheme || x.note || x.word;
            return {
              title: word,
              // 微博条目里没有链接字段，全靠拼。s.weibo.com 的搜索页实测 200
              url: `https://s.weibo.com/weibo?q=${encodeURIComponent(word)}`,
              score: toNum(x.num),
            };
          })
      );
    },
  },

  {
    id: 'douyin',
    scoreKind: 'hot',
    async fetch() {
      const j = await getJson('https://www.douyin.com/aweme/v1/web/hot/search/list/', {
        Referer: 'https://www.douyin.com/',
      });
      const list = digArray(j, 'data.word_list', '抖音');
      return list.map((x) => ({
        title: x.word,
        // ⚠️ 惯用的 `https://www.douyin.com/hot/{sentence_id}` 实测 **000（连不上）**；
        //    `/search/{word}` 才是 200。照惯例写就是十条打不开的链接。
        url: `https://www.douyin.com/search/${encodeURIComponent(x.word)}`,
        score: toNum(x.hot_value),
      }));
    },
  },

  {
    id: 'toutiao',
    scoreKind: 'hot',
    async fetch() {
      const j = await getJson('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
        Referer: 'https://www.toutiao.com/',
      });
      const list = digArray(j, 'data', '头条');
      return list.map((x) => ({
        title: x.Title,
        // ⚠️ 源给的 `Url` 是 **820 字符**的跟踪链接（内嵌 log_pb 的整段 JSON
        //    与一次性的 impr_id）。十条就是 8 KB 的垃圾进 git。
        //    短链 `.../trending/{ClusterIdStr}/` 实测 **200**，41 字符。
        url: `https://www.toutiao.com/trending/${x.ClusterIdStr}/`,
        // ⚠️ HotValue 是**字符串**（"14284312"）。直接算术会得到 NaN，
        //    而 NaN 的刻度画出来是「一根都没有」—— 看着像源挂了，其实是我们算错了
        score: toNum(x.HotValue),
      }));
    },
  },

  {
    id: 'baidu',
    scoreKind: 'rank',
    async fetch() {
      const j = await getJson('https://top.baidu.com/api/board?platform=wise&tab=realtime');
      // ⚠️ 双层信封：cards[0].content 长度是 1，它自己还是个对象，真列表在它的 .content 里。
      //    少写一层不会报错，只会静默拿到 1 条。
      const list = digArray(j, 'data.cards.0.content.0.content', '百度');
      return list
        // 只收**入榜**的条目：`isTop` 那条是**钉上去的置顶条**，没有 `index`，
        // 不属于榜单（实测恰好 1 条；入榜的 50 条 index 正好是 1..50）。
        // 这条规则顺带把一个常年挂在那儿的时政置顶条挡在页面外 ——
        // 理由不是「它有政治内容」，而是**它在语义上不是榜位**，用不着特判。
        .filter((x) => typeof x.index === 'number')
        .map((x) => ({
          title: x.word,
          url: x.url,
          // 百度**没有热度数值**，只有 index。这里不给 score，
          // 由 scoreKind:'rank' 让页面按榜位画刻度（页面上另加一枚小标记）。
        }));
    },
  },

  {
    id: 'tencent',
    scoreKind: 'rank',
    async fetch() {
      const j = await getJson('https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=50', {
        Referer: 'https://news.qq.com/',
      });
      const list = digArray(j, 'idlist.0.newslist', '腾讯新闻');
      // ⚠️ newslist[0] 是**占位条**：只有 {id, articletype, title, picShowType}，
      //    标题是「腾讯新闻用户最关注的热点，每10分钟更新一次」。
      //    它**没有 url 字段**，所以下面这一条 filter 就把它挡在外面了 ——
      //    但仍然显式写出来：这条假数据混进榜首是最容易发生、也最难看的一种坏。
      return list
        .filter((x) => typeof x.url === 'string' && x.url.startsWith('https://'))
        .map((x) => ({
          title: x.title,
          url: x.url,
          // ⚠️ **腾讯没有热度值，别乱挑一个字段当热度。**
          //    实测：`ranking` 就是 1..50（榜单顺序本身）；`qualityScore` 是 "3"/"4"
          //    这种质量档；`readCount` 是 103 / 158 / 5112，且大量条目为 0。
          //    第一版误用了 `ranking`，于是十条热度画出来正好是 1,2,3…10 ——
          //    那画的是「第几名」，不是「多热」。所以这个源走 `scoreKind:'rank'`。
        }));
    },
  },

  {
    id: 'hn',
    scoreKind: 'hot',
    async fetch() {
      const ids = await getJson('https://hacker-news.firebaseio.com/v0/topstories.json');
      if (!Array.isArray(ids)) throw new GuardError('①', 'HN topstories 不是数组');
      // 多取一倍：里面有 job / poll 这类非 story，滤掉之后要还够 TOP_N
      const picked = ids.slice(0, TOP_N * 2);
      const items = await Promise.all(
        picked.map((id) =>
          getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
        )
      );
      return items
        .filter((it) => it && it.type === 'story')
        .map((it) => ({
          title: it.title,
          // Ask HN / 文本贴**没有 url**（实测存在）→ 回落讨论页，
          // 否则 sanitize 会把它们全当脏数据丢掉，HN 那一格就只剩半截
          url: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
          score: toNum(it.score),
        }));
    },
  },

  {
    id: 'lobsters',
    scoreKind: 'hot',
    async fetch() {
      const list = await getJson('https://lobste.rs/hottest.json');
      if (!Array.isArray(list)) throw new GuardError('①', 'Lobsters 不是数组');
      return list.map((x) => ({
        title: x.title,
        // 文本贴的 url 是**空串**，得回落到讨论页
        url: x.url || x.short_id_url,
        score: toNum(x.score),
      }));
    },
  },

  {
    id: 'gh-trending',
    scoreKind: 'hot',
    async fetch() {
      // 不爬 `github.com/trending`（实测回 623 KB HTML，没有官方 API，改版频繁）。
      // 用官方 search API 造同语义：最近一周新建、star 数高的仓库。
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const q = encodeURIComponent(`stars:>500 created:>${since}`);
      const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${TOP_N}`;
      const headers = { Accept: 'application/vnd.github+json' };
      // CI 里带上 token（未认证的 search 是 10 次/分钟，够但还是带上更稳）
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

      const j = await getJson(url, headers);
      const list = digArray(j, 'items', 'GitHub 趋势');
      return list.map((x) => ({
        title: x.full_name,
        url: x.html_url,
        score: toNum(x.stargazers_count),
        // 光一个 `owner/name` 不构成标题 —— 仓库自述是它的一半
        blurb: typeof x.description === 'string' ? x.description : undefined,
      }));
    },
  },

  {
    id: 'sspai',
    scoreKind: 'rank',
    async fetch() {
      const j = await getJson('https://sspai.com/api/v1/article/index/page/get?limit=10&offset=0');
      const list = digArray(j, 'data', '少数派');
      return list.map((x) => ({
        title: x.title,
        // 条目里**没有 url 字段**，靠 id 拼（实测 200）
        url: `https://sspai.com/post/${x.id}`,
        // 少数派没有热度值（like/view 都是 0~1，不是热度）→ 走榜位刻度。
        // 顺带把发布日期放进右栏：这是「最近发的」，不是「最热的」，
        // 这一层语义差别必须写在页面上（见 spec §八.6）
        meta: typeof x.released_time === 'number' ? isoDay(x.released_time * 1000) : undefined,
      }));
    },
  },
];

function isoDay(ms) {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** 探针用它做三处 id 对账（脚本 / 手写元数据 / radar.json） */
export const ADAPTER_IDS = ADAPTERS.map((a) => a.id);

/* ───────────────────────── 守卫 ⑤：逐条形状过滤 ───────────────────────── */

/**
 * 逐条过滤。返回 `{ items, dropped }` —— dropped 交给守卫 ④ 判。
 *
 * `title` 必须是**非空字符串**、`url` 必须是 **https://**。
 * 重复 url 也算脏（源返回同一件事五次是它的问题），一并计入 dropped。
 */
function sanitize(candidates) {
  const seen = new Set();
  const items = [];
  let dropped = 0;

  for (const c of candidates) {
    const title = typeof c?.title === 'string' ? c.title.trim() : '';
    const url = typeof c?.url === 'string' ? c.url.trim() : '';
    if (!title || !url.startsWith('https://') || seen.has(url)) {
      dropped += 1;
      continue;
    }
    seen.add(url);
    items.push({
      title,
      url,
      ...(typeof c.score === 'number' && Number.isFinite(c.score) ? { score: c.score } : {}),
      ...(typeof c.blurb === 'string' && c.blurb.trim() ? { blurb: c.blurb.trim() } : {}),
      ...(typeof c.meta === 'string' && c.meta.trim() ? { meta: c.meta.trim() } : {}),
    });
  }

  return { items, dropped };
}

/* ───────────────────────── 守卫 ②③④ ───────────────────────── */

/**
 * 三条守卫，每条都**只比较同一种量**。
 *
 * 这里曾经写错过一次，很值得留着：守卫 ③ 原先拿「未截断的候选数」去比
 * 「上一次存下来的条数」——候选可能是 50（截断前），而存下来的是 10，
 * 于是 `50 < 10 * 0.6` 永远为假，**守卫 ③ 是一条永远不会触发的死代码**。
 * 而它恰恰是「源悄悄开始只返回 4 条」的唯一防线。
 *
 * 教训：守卫里出现两个来自不同环节的数字时，先问「这两个是同一件事吗」。
 * 现在三个数都是显式传入的，名字里带着各自的环节。
 */
function assertPlausible(id, { kept, dropped, candidates }, previous) {
  // ② 一条都没剩下 —— 字段整体挪位时最常见的形态
  if (kept === 0) {
    throw new GuardError('②', `抓到 0 条（候选 ${candidates} 条全被滤掉）—— 宁可用旧快照`);
  }

  // ④ 过滤率过半 = 「源改版了，只是没全改」。逐条丢是容错，过半就是坏信号
  if (candidates >= 4 && dropped > candidates / 2) {
    throw new GuardError(
      '④',
      `候选 ${candidates} 条里丢了 ${dropped} 条（超过一半）—— 字段多半挪位了`
    );
  }

  // ③ 数量骤降。**比的是截断后的条数**（上次存的也是截断后的），不是候选数
  const prevCount = previous?.items?.length ?? 0;
  if (prevCount > 0) {
    const floor = Math.floor(prevCount * SHRINK_FLOOR);
    if (kept < floor) {
      throw new GuardError(
        '③',
        `只剩 ${kept} 条，少于上次 ${prevCount} 条的 ${SHRINK_FLOOR * 100}%（${floor} 条）`
      );
    }
  }
}

/* ───────────────────────── 按源合并 ───────────────────────── */

/**
 * 读现有 radar.json。读不到或解析失败都返回 null（**解析失败也返回 null**：
 * 一份坏掉的旧文件不该让脚本连数据都不去抓，同 collect.mjs）。
 */
async function readPrevious() {
  try {
    const parsed = JSON.parse(await readFile(OUT, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function main() {
  const previous = await readPrevious();
  const next = {};
  const failed = [];

  for (const adapter of ADAPTERS) {
    const prev = previous?.sources?.[adapter.id];
    try {
      const { items, dropped } = sanitize(await adapter.fetch());
      // 先截断、再进守卫：守卫 ③ 比的是「上次存下来的条数」，
      // 拿未截断的候选数去比它就永远为假（见 assertPlausible 的注释）
      const kept = items.slice(0, TOP_N);
      assertPlausible(adapter.id, { kept: kept.length, dropped, candidates: items.length + dropped }, prev);
      next[adapter.id] = {
        ok: true,
        fetchedAt: new Date().toISOString(),
        scoreKind: adapter.scoreKind,
        items: kept,
      };
      const note = dropped ? `（滤掉 ${dropped} 条脏数据）` : '';
      console.log(`  ✓ ${adapter.id.padEnd(12)} ${kept.length} 条${note}`);
    } catch (err) {
      // 坏的那一格别动：条目与 fetchedAt **都**沿用上一次。
      // 把 fetchedAt 写成「现在」，页面就会宣称「这一格是刚抓的」——
      // 而它其实是一天前的数据。那是「过期可见」的反面，属于说谎。
      const keep = prev?.items ?? [];
      next[adapter.id] = {
        ok: false,
        fetchedAt: prev?.fetchedAt ?? null,
        error: err.message,
        scoreKind: adapter.scoreKind,
        items: keep,
      };
      failed.push(adapter.id);
      console.log(`  ✗ ${adapter.id.padEnd(12)} ${err.message}`);
      console.log(
        `      沿用上一次快照（${keep.length} 条${prev?.fetchedAt ? `，${prev.fetchedAt}` : '，无可用快照'}）`
      );
    }
  }

  const okCount = ADAPTERS.length - failed.length;
  const snapshot = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    okCount,
    total: ADAPTERS.length,
    sources: next,
  };

  // 格式化写入：这是要进 git、要被人读的文件，一行一条比压成一行好审
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  console.log(`\n✓ ${okCount}/${ADAPTERS.length} 个源成功 → src/data/gleanings/radar.json`);
  if (failed.length) {
    console.log(`  ${failed.length} 个源沿用旧快照：${failed.join('、')}`);
    console.log('  站点照常用这份数据构建部署 —— 红得看得见，但站照常上。');
    // 有源失败 → 非零码。**但文件已经写好了**（好的那几格留下来）
    process.exitCode = 1;
  }
}

const isEntry = import.meta.url.endsWith('/collect-radar.mjs');
export { ADAPTERS, OUT, readPrevious, sanitize, assertPlausible, digArray, toNum };

if (isEntry) {
  console.log('雷达抓取：九个源各跑一遍\n');
  main().catch((err) => {
    // 走到这里说明连「写文件」都失败了（比如磁盘满）—— 那才是真的什么都没留下
    console.error(`✗ ${err.message}`);
    console.error('  radar.json 未被修改，站点会用上一次的数据继续部署。');
    process.exitCode = 1;
  });
}

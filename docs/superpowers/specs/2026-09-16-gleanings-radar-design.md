# 拾遗 · 雷达模块（模块 04）—— 各站榜单聚合设计（2026-09-16）

`/gleanings/all/` 的**第三个抽屉**。把九个站点的榜单并列在一处，
回答一个问题：**「外面现在在说什么。」**

母规格：`docs/superpowers/specs/2026-09-16-gleanings-design.md`（§三 模块 04 / §八 P3）。
本文是这一刀的**唯一凭据** —— 越界没越界、以后怎么复跑，都看这里。

---

## 一、为什么它单切一刀（母规格 §八 的原话）

> **P3 | 雷达 | 多源 adapter + 防腐阈值，最容易出事的一环单独切**

母规格早就把它标成最危险的一环，理由是三条，这一刀全部撞上了：

1. **九个源、九种 JSON 形状**，任何一家的字段挪一层，adapter 就静默产出 `undefined`；
2. **中文热榜没有官方公开 API** —— 官方端点随时可能加签名、加 cookie；
3. 它的失败形态**不是报错，是「空」** —— 而空在页面上和「今天没热点」长得一模一样。

所以这一刀的取舍全部围绕一句话：**抓不到要看得见，抓坏了不许把好的擦掉。**

---

## 二、选源（**实探过，不是想当然**）

九条源全部走**各家自己的端点**，不用第三方聚合 API。

### 2.1 为什么不用第三方聚合

常见的第三方现成方案，本机实测：

| 方案 | 结果 |
|---|---|
| `api-hot.imsyy.top`（DailyHotApi 公共实例） | **全站 fetch failed** —— 已死 |
| `api.vvhan.com`（vvhan 热榜） | **fetch failed** |
| `60s.viki.moe/v2/weibo` | 通，`{code,message,data}`，内层 50 条 |
| `newsnow.busiyi.world/api/s?id=weibo` | 通，内层 30 条 |

后两个是活的，但**仍然不用**：那是我控制不了的第三方服务器。
把整块模块的可用性押在另一个人的免费实例上，等于把 `DailyHotApi` 的死法留给自己。
真正值钱的是「哪家的端点、字段在第几层」—— 这份知识本文后面全部记下来了。

### 2.2 九条源与实测结果

| id | 显示名 | 端点 | 实测 |
|---|---|---|---|
| `weibo` | 微博热搜 | `weibo.com/ajax/side/hotSearch` | 200 / 18 KB / `data.realtime[]` 52 条 |
| `douyin` | 抖音热榜 | `douyin.com/aweme/v1/web/hot/search/list/` | 200 / 66 KB / `data.word_list[]` 50 条 |
| `toutiao` | 头条热榜 | `toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | 200 / 125 KB / `data[]` 50 条 |
| `baidu` | 百度热搜 | `top.baidu.com/api/board?platform=wise&tab=realtime` | 200 / 20 KB / **双层信封** |
| `tencent` | 腾讯热点 | `r.inews.qq.com/gw/event/hot_ranking_list?page_size=50` | 200 / 327 KB / `idlist[0].newslist[]` 51 条 |
| `hn` | Hacker News | `hacker-news.firebaseio.com/v0/topstories.json` + `item/{id}.json` | 200 / 数组[500] 条 id |
| `lobsters` | Lobsters | `lobste.rs/hottest.json` | 200 / 数组[25] 条，字段最全 |
| `gh-trending` | GitHub 趋势 | `api.github.com/search/repositories`（**不爬 trending 那个 HTML**） | 200 / `items[]` |
| `sspai` | 少数派 | `sspai.com/api/v1/article/index/page/get?limit=10&offset=0` | 200 / `data[]` 10 条 |

**微博与抖音官方端点本机直连能拿到，不需要 cookie、不需要签名。**
这比预期好得多 —— 也正因为如此，更要防它哪天开始要 —— 见 §四 的守卫设计。

### 2.3 GitHub 趋势为什么不用 `github.com/trending`

那个页面实测 200 但回的是 **HTML**（623 KB），要正则/解析器去抠。
它是**没有官方 API 的页面**，改版还频繁。改用官方 search API 造同语义的东西：

```
q=stars:>500 created:>{七天前}  sort=stars  order=desc
```

语义完全对得上「最近冒出来、涨得快的仓库」，而且字段是结构化的。
**同一个东西有官方 API 就别爬页面** —— 这条不是洁癖，是这一模块的可用性。

### 2.4 V2EX 与 Reddit：探不通，所以没进

两家本机都是 `fetch failed`（V2EX 与 Reddit 各有各的不可达原因）。
**本机不通不等于 CI 不通**（CI 在境外机房），但既然用户没有点名要这两家，
就不为了「多一个源」去赌一条没验过的链路。
将来要加，按 §六 加一个 adapter 即可，不用动别的。

### 2.5 用户点名要的五家，全在

微博 / 抖音 / 头条 / 百度 / 腾讯新闻 —— 加 HN / Lobsters / GitHub 趋势 / 少数派，共**九条**。

---

## 三、数据层

### 3.1 三个文件、三种权限

| 文件 | 谁写 | 放什么 |
|---|---|---|
| `src/data/gleanings/radar.json` | **抓取脚本**（按源合并） | 九个源的条目（榜位 / 标题 / 链接 / 热度）与每源的抓取状态 |
| `src/data/gleanings/radar-sources.ts` | **手工**（零 import） | 显示名 zh/en、源主页、语区、排列顺序 |
| `scripts/collect-radar.mjs` | 手工 | 九个 adapter（端点 + 解析 + 守卫） |

**这条边界是硬约束**（沿用母规格 §4.1）：`collect-radar.mjs` 只允许写 `radar.json`。
显示名与顺序是**判断**，永远待在手写文件里 —— 一旦脚本有权覆盖它们，
某天改个端点就会把你起的名字擦掉。

### 3.2 `radar.json` 的形状：**按源分块**，不是一个大数组

这是与 `stars.json` 最重要的一处不同。`stars.json` 是**整份覆盖** ——
因为它只有一个源，源挂了就没得可写。雷达有九个源，
**任何一家限流都不该让另外八家的数据跟着变旧**：

```json
{
  "version": 1,
  "sources": {
    "weibo": {
      "ok": true,
      "fetchedAt": "2026-09-16T08:12:00.000Z",
      "scoreKind": "hot",
      "items": [
        { "rank": 1, "title": "一点点 威胁员工", "url": "https://s.weibo.com/…", "score": 2355109 }
      ]
    },
    "baidu": {
      "ok": true,
      "fetchedAt": "2026-09-16T08:12:03.000Z",
      "scoreKind": "rank",
      "items": [ { "rank": 1, "title": "…", "url": "https://m.baidu.com/s?word=…" } ]
    },
    "douyin": {
      "ok": false,
      "fetchedAt": "2026-09-16T02:00:00.000Z",
      "error": "守卫 ② 拦下：抓到 0 条 —— 宁可用旧快照",
      "scoreKind": "hot",
      "items": [ "…上一次成功时的 10 条，原样留着…" ]
    }
  }
}
```

四条不变量：

1. **`ok:false` 的源，`items` 是上一次成功的原样** —— 不是空数组。
   这样页面上一格坏掉只影响那一格，而且能诚实标出「这一格是几点的」。
2. **`fetchedAt` 每源各一份**，顶层的 `fetchedAt` 是「这次运行的时刻」。
   两者不是一回事，页面用前者。
3. **`scoreKind` 决定热度怎么读**：`hot` = 源给了数值；`rank` = 源没给（百度就是这种）。
   页面据此决定刻度怎么画、标签怎么写 —— 见 §五.2。
4. **`error` 只在 `ok:false` 时出现**，且是守卫的原话（含守卫编号）。

### 3.3 字段的四个坑（全部实测，adapter 必须按这个写）

| # | 源 | 坑 | 后果 |
|---|---|---|---|
| ① | 百度 | 真列表是 **`data.cards[0].content[0].content[]`** —— 两层信封，`content[0]` 自己还是个对象 | 少写一层 → 长度为 1，页面只有一条 |
| ② | 百度 | **条目里没有热度数值**，只有 `index` 与 `isTop`；首条 `isTop:true` 且没有 `index` | 当数值读 → `NaN` → 刻度全一样长 |
| ③ | 腾讯 | `newslist[0]` 是**占位条**：只有 `{id, articletype, title, picShowType}`，标题是「腾讯新闻用户最关注的热点，每10分钟更新一次」 | 混进榜单 → 榜首是一条假标题（**这条一眼假，最该防**） |
| ④ | 微博 | `realpos` **会缺**（实测第 3 条就是 `undefined`）；另有 **2 条是广告** | 按 `realpos` 排序 → 顺序错乱；不滤广告 → 榜单里混进推广 |
| ⑤ | 头条 | `HotValue` 是**字符串** `"14284312"` | 直接参与算术 → `NaN` |
| ⑥ | 抖音 | `word` 是**字符串**（这个是好的），但 `word_list[].word_type` 与 `label` 是数字枚举 | 当字符串显示 → 显示数字 |

**排序一律用数组下标 + 1，不用源给的 `realpos`/`position`/`index`。**
源给的榜位字段会缺、会重复、会从 0 开始；**数组顺序才是榜单顺序**。
只有「取哪一条」的判断需要源字段时（比如滤广告）才读它。

### 3.4 条目 URL：**每一条都实测过**

| 源 | 怎么来 | 实测 |
|---|---|---|
| `weibo` | `https://s.weibo.com/weibo?q={encodeURIComponent(word_scheme)}` | 200 |
| `douyin` | `https://www.douyin.com/search/{encodeURIComponent(word)}` | 200 |
| `toutiao` | 条目自带 `Url`（长、带跟踪参数，直接用） | — |
| `baidu` | 条目自带 `url`（`m.baidu.com/s?word=…`，手机版，桌面会跳转） | — |
| `tencent` | 条目自带 `url`（50/51 有；没有的那条就是占位条，已被 ③ 滤掉） | 200 |
| `hn` | 条目自带 `url`；**Ask HN / 文本贴没有 `url`** → 回落到 `news.ycombinator.com/item?id={id}` | — |
| `lobsters` | 条目自带 `url`；**文本贴是空串** → 回落到 `short_id_url` | — |
| `gh-trending` | 条目自带 `html_url` | — |
| `sspai` | **条目里没有 url 字段** → `https://sspai.com/post/{id}` | 200 |

**抖音那条是这一轮唯一「拼接会被打穿」的**：惯用的
`https://www.douyin.com/hot/{sentence_id}` 实测 **000（连不上）**，
`/search/{word}` 才是 200。这一条如果照惯例写，页面上就是十个打不开的链接 ——
而链接死掉在断言里是看不见的（`<a href>` 有没有值是另一回事）。

---

## 四、抓取脚本：**按源独立守卫 + 按源合并**

### 4.1 为什么不能沿用 `stars.json` 的「整份覆盖」

`collect.mjs` 的四道守卫是**全局**的：任一命中就整份不写。
单源场景正确；九源场景**反而有害** —— 微博限流一次，就会让 HN 和 Lobsters 也跟着停在旧快照上。
「宁可数据旧，不可数据烂」这条原则在单源下等价于整份拒绝，
在多源下必须细化成：**坏的那一格别动，好的那几格照常更新。**

### 4.2 每源独立跑的五道守卫

| # | 守卫 | 判据 |
|---|---|---|
| ① | 请求失败 / 非 200 / 超时（12s） | fetch 抛错、`!res.ok`、JSON 解析失败 |
| ② | 解析后 0 条 | 过滤器把条目全滤光了也算（那种「解析成功但字段全挪位」最阴） |
| ③ | 条目数骤降 | 少于该源上次的 60%（`SHRINK_FLOOR`，与 `collect.mjs` 同值） |
| ④ | 条目质量 | **丢掉的条目超过一半**就判失败 —— 字段挪位时通常是一半对一半错 |
| ⑤ | 形状校验 | `title` 空、`url` 非 `https://` 的条目**丢弃并计数**（不是整源判死） |

守卫 ⑤ 是**逐条过滤**而不是**整源拒绝**：一条脏数据不该让另外九条陪葬。
但过滤率进守卫 ④ —— 这说明「源改版了，只是没全改」，该报警。

命中任一 → 该源的 `ok:false` + 写 `error` + **items 延续上一次**。

### 4.3 写入是「按源替换」，不是重写整份

```js
const previous = await readRadarJson();          // 读得到就按源继承
const next = {};
for (const adapter of ADAPTERS) {
  const prev = previous?.sources?.[adapter.id];
  try {
    const items = await adapter.fetch();          // 内部跑守卫 ①②④⑤
    assertShrink(adapter.id, items.length, prev); // 守卫 ③
    next[adapter.id] = { ok: true, fetchedAt: new Date().toISOString(), scoreKind: adapter.scoreKind, items };
  } catch (err) {
    next[adapter.id] = {
      ok: false,
      fetchedAt: prev?.fetchedAt ?? null,         // ← 保留上一次的时刻，不是现在
      error: err.message,
      scoreKind: adapter.scoreKind,
      items: prev?.items ?? [],                   // ← 原样留着
    };
  }
}
```

三个必须做对的细节：

- **`items` 留旧的、`fetchedAt` 也留旧的。** 写成当下的时刻，页面就会宣称
  「这一格是刚抓的」—— 而它其实是一天前的数据。**这是「过期可见」的反面，属于说谎。**
- **某一源第一次就失败**（`prev` 不存在）→ `items: []`、`fetchedAt: null`。
  页面据此显示空态而不是崩溃。
- **顶层 `okCount` 一并写出来**，CI 日志与页面都能一眼看到「九格里活了几格」。

### 4.4 退出码

- 九源全成功 → 退出 0。
- **有源失败 → 仍然写文件（好的留下来）**，然后以**非零码退出**。
  这一点与 `collect.mjs` 相同：**红得看得见，站照常上。**
- 采用 `continue-on-error: true` 挂在 CI 上，失败信息透给 deploy 之后再判 ——
  与母规格 §六 对 `collect.outcome` 的处置完全一致。

### 4.5 只在被当脚本执行时跑 main()

判据同样用 `import.meta.url.endsWith('/collect-radar.mjs')`，
**不用** `import.meta.url === pathToFileURL(process.argv[1]).href`
—— 理由与 `collect.mjs` 一样（探针会 esbuild 打包它，那时两边相等，
一 import 就把九趟抓取跑起来并重写 `radar.json`）。

---

## 五、展示

### 5.1 位置：第三个抽屉

`/gleanings/all/` 现在是「收藏夹 / 仓库」两个标签，雷达接成**第三个**
（`data-panel="radar"`，把手标签「雷达」，页尾再放一排）。
**没有 JS 时三个面板都摊着** —— 母规格 §五 那条底线一字不改。

内容自上而下：

```
[快照行]        九格活了几格 + 这次运行的时刻 + 过期徽章 + 各源失败提示
[雷达总览条]    ← 这一刀新加的视觉主体
[来源抽屉 ×9]   复用 .gl-drawer（原生 <details>，默认只展开第一个）
```

### 5.2 雷达总览条：**刻度一律源内归一化**

这是这一刀最容易画错、也最值得记的一处。

**九个源的热度数值互相之间没有任何可比性。** 实测同一时刻：

| 源 | 榜首热度 | 量级 |
|---|---|---|
| 微博 | `num` = 2,355,109 | 百万 |
| 抖音 | `hot_value` = 11,518,195 | 千万 |
| 头条 | `HotValue` = `"14284312"` | 千万 |
| HN | `score` = 203 | 百 |
| Lobsters | `score` = 70 | 十 |
| 百度 | **没有这个字段** | — |

按原始值画柱子 → 百度是零、Lobsters 是一根发丝、抖音顶穿 —— 那是**错的**，
它画的是「哪个站的计数单位大」，不是「哪个站更热」。

**所以：每格的刻度只表达该源内部的形状。**

```
归一化 = 该条的 score / 该源榜首的 score        （scoreKind = "hot"）
归一化 = 1 - (rank - 1) / 条数                  （scoreKind = "rank"，百度走这条）
```

一格 = 一条竖列 + 十个刻度点，第 1 名在下、第 10 名在上，点的**亮度**按归一化值。
读出来的信息是「这个源的榜单是头部悬殊（点集中在底部）还是势均力敌（点均匀铺开）」——
这正是「雷达」该有的语义：**看的是形状，不是绝对值。**

`scoreKind: "rank"` 的源，格子里加一枚极小的标记（实测百度是唯一一个）。
**不许悄悄用排名假装是热度** —— 那是在编数据。

### 5.3 扫描动画：一次，且必须是渐进增强

一条竖线从左扫到右，扫到哪格哪格点亮。三条约束：

- **只扫一次**：`IntersectionObserver` 触发，进视口才开始；不循环、不重复。
  母规格对本站动画的口径是「克制」—— 循环扫描会变成一根一直在动的装饰，
  在这一页（正文页）是干扰。
- **无 JS 时是静态刻度**：刻度的高度与亮度**由服务端渲染就写进 CSS 自定义属性**，
  动画只负责「让它亮一下」。断 JS 之后画面依旧完整。
- **尊重 `prefers-reduced-motion`**：直接跳到终态。

### 5.4 来源抽屉：复用 `.gl-drawer`，不新造

与仓库同一形状（`<summary>` + `.gl-drawer__chev`（定宽居中，排标签前面）+ 标签 + 计数）。
理由是母规格 §三 原则 2：三个大件用同一档白卡片语言，交替才有索引柜的节奏。
**开合箭头的排法一字不改** —— 那一条在 §12.4 已经用截图与断言钉死过
（推到行尾会变成角落里一粒浮着的小三角）。

抽屉内每行：`排名 · 标题 · 热度`。排名用等宽、两位数对齐（`01`…`10`），
免得 1 与 10 的宽度差让整列左右跳。

### 5.5 空态与失败态

| 情况 | 显示 |
|---|---|
| 某源 `ok:false` 且有旧条目 | 抽屉正常渲染，**抬头挂一枚「这一源暂时取不到 · 用的是 <日期> 的快照」** |
| 某源 `ok:false` 且无旧条目（首次就挂） | 抽屉里一行小字「这一源暂时取不到」，**不渲染空列表** |
| 九源全挂 | 面板级一行提示 + 指向各源主页的链接（**不许出现一片空白**） |

---

## 六、加一个源要改几处（这是这一刀的可维护性判据）

四处，且**每一处漏改都会被拦住**：

| 改哪 | 漏改的后果 | 谁拦 |
|---|---|---|
| `scripts/collect-radar.mjs` 的 `ADAPTERS` | 抓不到 → 没有数据 | 探针（三处 id 对账） |
| `src/data/gleanings/radar-sources.ts` | 页面找不到显示名 | **构建期 zod + 双向对账断言**（红） |
| i18n（只有新增**界面文案**才要，源名不走 i18n） | — | TS：`en` 是 `Record<keyof typeof zh, string>` |
| `deploy.yml` | — | 不需要，脚本自己遍历 `ADAPTERS` |

**双向对账断言**（写在 `src/lib/gleanings.ts`，与主题词表那道同族）：

```ts
// radar.json 的 id 集合 必须 等于 radar-sources.ts 的 id 集合
// 少一个 → 抓到了但页面渲染不出来；多一个 → 手写了元数据却没抓
```

`radar.json` 的 id 来自脚本、元数据的 id 来自手写，**这两份是对账的主体**；
脚本里 `ADAPTERS` 的 id 由探针（`probe-gleanings.mjs`，esbuild 打包后 import 两边）比对。
两层各管一段，合起来才是三处闭合。

---

## 七、验证与复跑

| 验什么 | 怎么验 |
|---|---|
| 源可达性 | `D:/homepage/.pet-e2e-dual/probe-radar-sources.mjs`（九个端点各打一次） |
| 字段形状 | `D:/homepage/.pet-e2e-dual/probe-radar-shape.mjs` + `probe-radar-fields.mjs`（打全 keys 与取值） |
| 守卫与合并 | `probe-gleanings.mjs` 扩展：驱动每条守卫（含「某源失败时另外八源不受影响」）与三处 id 对账 |
| 抓取 | `node scripts/collect-radar.mjs`（本地跑一次刷新快照） |
| 构建 | `npx astro build` 后**单独** `npx pagefind --site dist`；页数用 `find dist -name '*.html' \| wc -l` 数，**别信 `EXIT=124`** |
| 浏览器 | `D:/homepage/.pet-e2e-dual/gleanings.mjs light` + `dark` |
| 视觉 | 截图单独看一次（断言证明「刻度写对了」，证明不了「好不好看」）；刻度那条要**裁到 2× 数像素** |
| 归一化 | e2e 断言：总览条的刻度值**与源内榜首归一化一致**，且**不等于**原始热度比 |

**三条一定要单独量、不能靠顺带覆盖的**：

1. **刻度是源内归一化、不是原始热度比** —— 拿测试数据把「按原始值画」也实现一遍，
   断言两者不同；否则这条约束只是注释里的一句话。
2. **`ok:false` 的源用的是旧 `fetchedAt`** —— 用一个合成快照把这条分支逼出来
   （真实数据里九源都是好的，这条分支**永远走不到**）。
3. **无 JS 时第三个面板也在** —— 母规格那条底线的第三次确认。

---

## 八、这一刀的已知取舍

1. **每源 10 条**（`TOP_N = 10`）。榜单本身就该看前几名；
   九源 × 10 = 90 行，全摊开约两屏多，靠抽屉默认收起控住。
2. **不做跨源去重。** 同一个热点同时上榜是**信息**（说明它真的在爆），不是冗余。
   这也与母规格 §三 原则 3「不强行统一分类」一致。
3. **不做单独路由。** 母规格把雷达定成模块 04（抽屉），不是第 03 条路由。
4. **`radar.json` 进 git。** 与 `stars.json` 同款：本地构建看到的是上次快照，
   刷新就本地跑一次脚本。抓取产物入库才有「数据旧但完整」这个兜底。
5. **不抓 V2EX / Reddit。** 本机探不通，用户也没点名 —— 不赌没验过的链路。
6. **九个源里八个是「热点」、一个（`sspai`）是「新文章」。** 少数派没有热榜，
   它的索引接口按时间倒序 —— 语义是「最近发的」而不是「最热的」。
   这一条要在抽屉抬头的说明里讲明白，不能假装它也是榜单。
   （`gh-trending` 同理：它是「新建且涨得快」，不是「今日最热」。）
7. **`astro check` 的 3 个既有 error 不修**（`GalleryFloor.astro`、`admin/gallery.ts` ×2）。
8. **CI 在境外机房，五个中文源能不能通是这个设计最大的未知数。**
   本机实测全通，但本机在国内。**这正是按源独立守卫存在的理由**：
   哪一格不通就只有那一格显示失败，站点照常构建、照常部署。首次 CI 跑完看日志即可确认。

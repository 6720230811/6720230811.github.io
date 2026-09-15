> **【已被取代，仅作历史留存】**
> 本文描述的「艺术平铺 = 全站照片拼贴」在**同一天晚些时候**被推翻，
> 现行为合集制。请读 **`2026-09-15-gallery-collections.md`**。
> 文中提到的 `ArtSpread.astro`、`gallery.json`、按主题派生的房间路由**都已删除**。
> 仍然成立的三条（`--bleed` 只能用在 `margin-inline`、右栏躲宠物复用 `--toc-pet-reserve`、
> `<img width height>` 顶掉 `aspect-ratio`）已原样带进新文档第 6 节。

# 艺术平铺（画廊首页）改版：画册跨页式版面

日期：2026-09-15
状态：已实现（`src/components/gallery/ArtSpread.astro` + `src/styles/gallery-spread.css` + `src/lib/gallery/studio.ts`）

## 一、为什么改

上一轮把画廊收敛成三项之后，艺术平铺页是「等宽等距的网格」——
`repeat(auto-fill, minmax(320px, 1fr))` 排 6 张 = 3×2，工整、无主次、无看点；
内容套在共享的 `.section` 卡片里，卡片之外还有一圈灰留白，页面两侧很空。

三条要求（用户原话）：

1. 不要这么工整的平铺，要有创意、有视觉冲击；
2. 页面两侧太空，加些内容丰富一下；
3. 把艺术平铺设成画廊的初始页面。

## 二、结构变更（会动 URL）

| 路由 | 之前 | 现在 |
|---|---|---|
| `/gallery/` | 3D 展厅门排（`RoomIndex`） | **艺术平铺**（`ArtSpread`，画廊首页） |
| `/gallery/rooms/` | — | 3D 展厅门排（`RoomIndex` 原样搬过来） |
| `/gallery/theme-city/`、`/gallery/theme-sea/` | 3D 房间 | 不变 |
| `/gallery/screening-room/` | 放映室 | 不变 |
| `/gallery/works/` | 艺术平铺（上一轮才加的，**从未推送过**） | 删除 |

`/gallery/works/` 是上一轮新增、尚未推送的页面，所以没有外链依赖，直接删掉、不留跳转。
房间页的「返回 / 离开展厅」链接随之改指 `/gallery/rooms/`（`[room].astro` 的 `indexUrl`）。

## 三、版面契约（改版面时按这三条走）

### 1. 跨页借宽

`.gal-spread` 用 `--bleed: clamp(0px, calc((100vw - 100%) / 2 - 1rem), 6rem)` 向左右留白
各借最多 6rem，`margin-inline: calc(-1 * var(--bleed))`。

- 它必须**只用在这一个属性上**：百分比要按包含块的行内尺寸解析；
- 上限 6rem + 减 1rem 保底 → 窄屏自动退化成 0，且**永不产生横向滚动条**
  （e2e 有 `scrollWidth <= clientWidth` 断言）；
- 借宽是 1440 下 1360 vs 版心 1200，e2e 断言 `spreadW > pageW + 60`。

### 2. 拼贴 = 12 栏 + 显式列位 + 逐件错落

`CURATED` 定顺序，`SLOTS` 定「占几栏 / 往下错开多少」：

```
01  1 / -1       0rem      开篇通栏（唯一一张满宽的）
02  1 / span 4   0rem      竖构图 → 一道竖轴
03  6 / span 6   3rem
04  1 / span 5   2rem
05  7 / span 6   0rem
06  1 / span 6   0rem
cue 8 / span 5   align-self:stretch + align-content:space-between   收尾块（见下）
```

**挑栏位的硬约束**：同一行两件的**高度要接近**。高度 = 栏宽 ÷ 原始比例，
所以横图 6 栏（≈284px）正好配竖图 4 栏（≈405px）——
差得多就会在矮的那张下面留一个明显的大洞（第一版横图 6 栏配竖图 3 栏，差 100px+）。

#### 收尾块：不去「填满」，改成「把空夹起来」

末排只有 1 张图（06）+ 1 块文字（cue），文字总比图矮，那段空**跑不掉** ——
除非往文字里注水。所以：

- 盒子 `align-self: stretch`（覆盖父级的 `align-items: start`）撑满整行；
- 内容 `align-content: space-between`：**说明句贴列顶**（正好接在 05 那排的注脚后面，
  顺读得下去）、**按钮压列底**（与末排图的下缘齐平，整幅才「合上」）；
- 左侧用 `::before` 画一根**撑满整行高**的竖线。

竖线**必须用 `--c-border`**，不能用 `--c-border-soft`：后者（浅色 `#eef0f2`）是给白卡片
当描边用的，压在页面底色（`#f0f2f5`）上只差 **2/255** —— 画了等于没画。
第一版就是这么白画的，靠裁到像素里数非背景像素才找出来。
实测（1440 浅色）：线在 x=764、高 331px（= 整末排）。

窄屏（≤780px）单列里「右边那半列」不存在，竖线失去意义 → 换成 `border-top`，
`::before` 置 `content: none`。

**「不工整」是可量的**，e2e 三条断言把它钉住：

- 宽度至少 3 档（等宽网格只有 1 档）—— 实测 4 档 `[872/277/426/352/426/426]`；
- 行内基线至少 4 种（`margin-top` 错落生效）—— 实测 6 种；
- 开篇那张宽度 == 拼贴宽度（±2px）。

### 3. 两侧栏

- 左 = **目录** `01–06`（编号 / 标题 / 主题·年份），与拼贴**双向互相点亮**；
- 右 = **展览前言** + 合计（件数 / 主题 / 年份跨度）+ 器材 + 关键词。

右栏必须**躲开右下角的宠物浮层**：

```css
.gal-rail--note {
  max-height: calc(100vh - var(--nav-h) - 3rem - var(--toc-pet-reserve, 0rem));
}
```

`--toc-pet-reserve` 是 global.css 里现成的全局变量（`html:has(.pet-layer…)` 按宠物外观
档位给 12.75rem / 24.25rem，数值已含宠物本体 + 头顶那列气泡）。**复用，不要另起变量。**
横向没得让（栏本来就贴右缘），只能纵向错开；sticky 同时给 top 和 bottom 时 top 优先、
bottom 被忽略，所以只能砍 `max-height`。

### 4. 平铺页必须 `hero="none"`（这条是让位公式的**前提**）

默认横幅 `.hero` 在文档流里占 `--banner-h − --banner-overlap`
（900px 视口下 `clamp(200px,35vh,380px)`=315 − 56 = **259px**），
加上顶栏（`--nav-h` = 4.5rem = 72）正好把跨页推到 **y ≈ 331**：

| | 跨页起点 | 右栏 sticky 起跑线 | 右栏下缘 | 宠物上缘 |
|---|---|---|---|---|
| 带横幅 | 331 | 331（**没到就粘不住**） | 331+392 = **723** | 564 ✗ 压住 |
| `hero="none"` | 72 | **96**（= nav-h + 1.5rem，首屏即接管） | **488** | 564 ✓ |

**根因不是 `max-height` 算错，而是它乘的那个前提（栏顶 = 顶栏下方）不成立。**
少这 259px 就全对了。何况跨页自己的**通栏开篇大图**就是这一页的门面，
上面再压一条通用蓝横幅是两重门面。房间页 `/rooms/` 是普通列表页，横幅照旧。

**推广**：凡「`position: sticky` + 按视口算的可视高度」的组合，先问一句
**「这个元素的自然位置在哪」**——文章页的 `.toc` 也吃过同一口亏
（那里靠 `top: calc(var(--nav-h) + 1rem - 100vh)` 把起点挪到视口之上绕过）。
e2e 为此专门加了一条断言**把前提本身钉住**（`railTop <= navH + 40 且 scrollY == 0`），
而不是只断言结果——前提一坏，结果断言的报错信息会把人往错的方向带。


## 四、联动（`src/lib/gallery/studio.ts`）

只有一件事：**目录某行 ↔ 拼贴里对应的那张，互相点亮**；点亮时给拼贴挂 `is-dimming`，
其余张退到 `opacity: .5`（用 opacity 不用 filter —— 只动合成层，不触发重绘）。

- 绑定用本仓既有的 `window.__galStudioCleanup` 单例 + `AbortController`，
  `astro:page-load` 也挂同一个 signal → 恒为恰好一套监听（首屏会跑两遍，见 Search.astro 的长注释）；
- 目录行渲染成 `<a href="#gm-<id>">`：**有 JS** 时拦下点击改成开灯箱（一页照片里跳锚点
  几乎等于没动），**无 JS** 时那个锚点就是兜底。

## 五、两个「只有当它成了主视图才现形」的坑

1. **`<img width height>` 属性顶掉 `aspect-ratio`**：属性会落成 `height: 832px` 的
   presentational hint，把 `aspect-ratio` 压掉（`getComputedStyle` 里写着 3/2 却无效）。
   必须显式 `height: auto`。房间页 `mode=3d` 一直把网格藏着，所以这个坑上一轮才第一次露头。
2. **降级网格的列宽不能直接当主视图**：房间页那份是 `minmax(190px, 1fr)` 的容错排法，
   拿来做首页只会得到一片规整的小格子。

## 六、验收

`D:\homepage\.pet-e2e-dual\gallery.mjs`（端口 4342 / CDP 9342）**62 通过 · 0 失败**，
几条机制判据值得单独记：

- **不工整**：宽度档位 / 基线种数 / 开篇占满（见上）；
- **聚光联动**：用**真实鼠标** `Input.dispatchMouseEvent` 移到目录某行，断言
  「对应那张拿到 `is-lit`、拼贴挂 `is-dimming`、其余 5 张被压暗」，移开后撤干净；
- **目录点下去开的是那一张**：真实点击 → 灯箱 `open` 且标题 == 那一张的标题；
- **右栏在首屏就粘住**（`railTop <= navH + 40 且 scrollY == 0`）—— 让位公式**前提**的断言；
- **右栏下缘没有压到宠物**：浮动层不参与布局，必须**显式拿两个矩形求交**
  （量的对象是 `.pet` 与 `.pet__dock` 的上缘取小值 —— `.pet-layer` 铺满视口、top 恒为 0，
  量它等于没量）；
- **平铺页没有通用横幅**（`!document.querySelector('.hero')`）—— 与上一条同病的另一面。

另外几条**判据前置**的坑（都先假失败过）：

- 验「点拼贴开灯箱」时**必须重新载入页面**取干净起点。本站开着 Lenis 惯性滚动，
  `window.scrollTo(0,0)` 是空操作 → 按 `rect` 算出的 y 变成负数，点击落到视口外，
  看起来像「点了没反应」。顺手用 `elementFromPoint` 断言「点下去确实落在图块上」。
- 「已删路由」只能**问文件系统**（`!existsSync(dist + p + 'index.html')`）：
  e2e 的 `serve.mjs` 对未知路径回落 `index.html` 回 200，HTTP 状态码永远看不出差别。

定妆照：`shot-gallery.mjs`（4343 / 9343）→ `shots-gallery/`，四页 × 浅/深。
另加 **`narrow [宽度]`**：`node shot-gallery.mjs light narrow 900` → `shots-gallery-narrow-900/`
（验 1080 那条「两栏改上下」），`... narrow 700` → `shots-gallery-narrow-700/`
（验 780 那条「拼贴收单列」）。
**1440 下这两条媒体查询根本不参与级联，宽屏全绿证明不了窄屏没塌** —— 改断点就得单独看一眼。

### 窄屏两条补充

- 1080 以下 `.gal-dir` 由竖排改**横向三列**，写死 `repeat(3, minmax(0,1fr))`
  而不是 `auto-fill`：6 件在 `auto-fill` 下会按「这行还能塞几个」断成 **5+1**
  （900px 实测），落单那一行看着像漏排。3 列恒为 2 行。
- 780 以下拼贴单列、错落取消（错落在单列里只剩参差，没有版面的意思）。


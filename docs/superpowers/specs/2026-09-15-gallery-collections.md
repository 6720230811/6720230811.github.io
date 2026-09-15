# 画廊第三轮重构：合集即一等公民

日期：2026-09-15
状态：已实现。规格相关的代码：
`src/data/gallery.ts`、`src/lib/gallery/imageSize.ts`、`src/components/gallery/{GalleryShell,CollectionIndex,CollectionStream,CollectionHall,HallModeSwitch}.astro`、
`src/styles/gallery-{spread,collections}.css`、`src/lib/admin/gallery.ts`

> 本文件取代 `2026-09-15-gallery-art-spread.md`（那版描述的「艺术平铺 = 全站照片拼贴」
> 已被本轮推翻）。仍然成立的那几条约束在下文第 6 节原样带过来了。

## 一、为什么改

用户四条原话：

0. 导航栏与下方内容**缺少背景图撑开、彼此紧贴**，要合理间距 + 背景填充；
1. 切到 **3D 展厅 / 放映厅**时，要和艺术平铺页**保持同一套风格与布局**；
2. 把平铺页**重构成「合集封面展示页」**：左侧封面、右侧合集信息（展览前言等），
   点封面进合集看图；**要能扛住后续上传大量图片**；合集内要一个**有视觉冲击力**的展示页；
3. 设计**后台 admin** 管理这些图片与前端展示数据。

第 2 条里的「扛住大量图片」是这次改架构的真正驱动力：
旧结构把全部照片摊在一层 `gallery.json` 的数组里，前端再按 `theme` 分组拼装。
加一批图 = 回数据文件里手写几十条记录（标题 / 年份 / 相机 / 描述），
还要人工维护宽高 —— 这条路上「上传大量图片」是不可能的。

## 二、新信息架构：一个合集 = 一个目录

```
public/gallery/
  night-walk/
    01-last-bus.jpg
    02-convenience.jpg
    03-rooftop.jpg
    thumbs/02-convenience.webp     ← 可选。按「同名 stem」匹配，可跨格式
    meta.json                      ← 文案与编排，schema 见 gallery.schema.ts
  slow-shutter/…
  tide/…

src/data/gallery-redirects.json    ← 后台改名合集时登记的旧地址（见 §3.3）
```

三条规则：

1. **图片就是目录里的文件，不列清单。** 构建期 `readdirSync` 扫出来 ——
   所以「上传一张图」= 「往目录里放一个文件」，不需要改任何数据文件。
2. **`meta.json` 只管文案与编排**（标题 / 副标题 / 前言 / `mode` / `style` / `theme` /
   `year` / `cover` / `order` / `tags` / `gear` / 每张的 `title`·`desc`·`year`·`camera`·`tags`）。
   缺字段一律有兜底：标题从文件名推（`02-last-bus.jpg` → `Last Bus`），
   `cover` 默认第一张，`order` 里没点到的按文件名自然序接在后面（`2.jpg` 在 `10.jpg` 前）。
3. **不想展出就删掉整个目录**，不设 `published: false` 之类的软开关 —— 少一个状态少一处不一致。

出错一律**抛**（缺 `meta.json`、JSON 不合法、schema 不过、一张图都没有、`cover` 指向不存在的文件）：
宁可构建失败，也不要线上少一块内容。与 `profile` / `friends` 两处的做法一致。

### 路由表

| 路由 | 是什么 | 组件 |
|---|---|---|
| `/gallery/` | **合集封面索引**（首页）：每个合集一块封面，信息在封面右侧 | `CollectionIndex` + `GalleryLightbox` |
| `/gallery/<合集 id>/` | **合集详情**。`mode: 'flat'` → 杂志式照片流；`mode: '3d'` → 复刻展厅 | `CollectionStream` / `CollectionHall` |
| `/gallery/rooms/` | **3D 展厅门排**：只列 `mode: '3d'` 的合集 | `CollectionIndex`（传 `threeDCollections`） |
| `/gallery/screening-room/` | **暮色放映室**（独立 3D，`lib/screening-room.ts`） | `ScreeningRoom` |

`/en/gallery/…` 是同构的一套（`src/pages/en/gallery/`）。

**`/gallery/rooms/` 与 `/gallery/` 用同一个组件**，只是传进去的 `list` 不同 ——
两页因此天然同款，不会各写一遍再慢慢漂移。这正是第 1 条要求「统一设计」最省力的落法：
不是把两页做得像，而是让它们本来就是同一段代码。

### 已删掉的（本轮清理）

| 删除物 | 为什么 |
|---|---|
| `src/data/gallery.json` | 被目录扫描取代，留着就是第二个真相来源 |
| `src/pages/gallery/[room].astro`、`halls.astro`、`kimbell.astro`、`year.astro` | 房间由合集目录派生，不再按主题/年份派生路由 |
| `src/components/gallery/{ArtSpread,RoomIndex,DoorGrid}.astro` | 拼贴首页与门排被 `CollectionIndex` + `GalleryShell` 取代 |
| `src/lib/light/*`（9 个文件） | 旧 Kimbell 展厅的采光模型，随 `kimbell.astro` 一起下线 |

`/gallery/halls/`、`/gallery/year/`、`/gallery/kimbell/`、`/gallery/works/` 等
**从未推送或已推送过的旧地址不 404**，见 §3.3。

## 三、构建期数据层（`src/data/gallery.ts`）

### 3.1 为什么用 `node:fs` 而不是 `import.meta.glob`

`glob` 拿到的是**模块**：图片会被 Vite 复制进 `_astro/` 并改名，
而这里需要的只是「文件名 + 宽高」两件事。URL 自己按 `public/` 的规则拼（`mediaUrl()`）反而更直：
**后台写进仓库的路径与页面上的地址是同一个**，中间不多一层映射。
本站是纯静态输出、frontmatter 在构建期跑在 Node 里，用 `fs` 是正当的。

### 3.2 宽高必须在构建期读出来（`src/lib/gallery/imageSize.ts`）

「封面比例 / 拼贴的 `aspect-ratio` / 防 CLS 的 `width height`」三件事全靠真实像素尺寸，
而几百个 `w`/`h` 不可能人手维护。

做法是**自己读文件头**（JPEG 的 SOFn、PNG 的 IHDR、GIF 的逻辑屏、WebP 的 VP8/VP8L/VP8X），
零依赖、不引 `sharp`。读不出来时返回 `undefined`，调用方按 `3 / 2` 兜底。

由此得到两条接口约定：

- `photoAR(photo)` → `"1200 / 800"` 或 `"3 / 2"`；
- 渲染 `<img>` 时 `width`/`height` 给的是**真实像素**，所以 CSS 里必须显式 `height: auto`
  才让 `aspect-ratio` 说了算（否则 `width`/`height` 属性会落成 presentational hint 把比例钉死 ——
  这个坑的完整形状见 §6.3）。

### 3.3 旧地址：301 而不是 404（`legacyRoutes()`）

画廊在 2026-09 换过两轮信息架构，旧地址**已经推上线过**，不能让它们 404。
两个来源，手工登记的先来：

1. `src/data/gallery-redirects.json`（后台改名合集时写进去的 `{from, to}` 数组）；
2. 按目录名推出来的两条规则：`hall-<id>` → `<id>`、`theme-<theme>` → 该主题下第一个合集。

**登记表读出来一律先过滤：只留 `to` 真的指向一个现存合集的条目。**
后台删了合集却忘了清登记表时，宁可少一条 301，也不要 301 到 404 ——
**301 会被浏览器和搜索引擎长期缓存，跳错一次很难收回**。

`registeredRedirects()` 先来的原因：它是「改名之后旧地址该去哪」的**明确答案**，
不该被下面按目录名推出来的规则顶掉。

落地在 `pages/gallery/[collection].astro` 的 `getStaticPaths()` 里：旧地址也会生成一个页面，
frontmatter 里 `Astro.redirect(newUrl, 301)` 后立即返回，不渲染内容。
`known` 那层判断是防「哪天有个合集的目录名正好叫 `theme-city`」——以真合集为准。

### 3.4 适配层：不让 3D 那套去理解「合集」

`lib/gallery/`（复刻展厅）是几万行代码，只认 `GalleryItem` 那一组字段。
所以在数据层做一次转换（`toGalleryItem` / `collectionItems`），
而不是让 3D 代码去理解「合集」这个概念。**方向只能是单向的**：
数据层知道 3D 的形状，3D 层不知道合集的形状。

## 四、跨页外壳 `GalleryShell.astro`

四个页面（封面索引 / 合集详情 / 门排 / 放映室）共用一个三段式网格：

```css
.gal-spread {
  padding-top: 1.75rem;                        /* ← 第 0 条要求的「间距」就是这里 */
  display: grid;
  grid-template-columns: 11rem minmax(0, 1fr) 16rem;
  gap: 1.5rem 1.75rem;
  align-items: start;
}
```

左 = 目录，中 = 正文，右 = 说明。**中栏的 `minmax(0, 1fr)` 不能写成 `1fr`**：
`1fr` 就是 `minmax(auto, 1fr)`，轨道里放正文时 `auto` 下限会被内容顶开 → 整页横向溢出。

### 4.1 页头必须留在中栏里（不能横跨整幅）

横跨会占满第一行，把两侧栏挤到第二行、**起跑线掉到标题之下**；
而右栏给宠物让位的余量是按「栏顶 = 顶栏下方」算的，起跑线一低就全废
（实测被推到 529，可用只剩 35px，`max-height` 算得再准也救不了）。

窄屏用 `.gal-spread__main { display: contents }` + `order`
把「标题 → 目录 → 正文 → 前言」的阅读序调回来。

### 4.2 工具条只许有一排（本轮修的一处「设计不统一」）

`GalleryShell` 的页头有一排跨页导航：
`[▤ 合集 | ✦ 3D 艺术展厅] … [▣ 私人放映室]`（前者在胶囊里、后者是描边胶囊）。

合集详情的 `mode: '3d'` 分支本来由 `CollectionHall` **自己再起一行**
`.gal-hall__tools`（`切换为房间 / 切换为网格 / 所有房间`）——
于是 3D 合集页顶部叠了**两排一模一样的胶囊**，而另外三页只有一排。
第 1 条要求「四个页面统一成同一套设计」就是被这一条破的。

改法：

- `GalleryShell` 的 `.gal-head__tools` 里开一个 `<slot name="tools" />`；
- 视图切换单独成 `HallModeSwitch.astro`，由页面投进那个插槽
  （`{collection.mode === '3d' && <HallModeSwitch slot="tools" locale={locale} />}`）——
  **`slot` 属性在表达式里也能正常投影**，构建产物里三枚一组、顺序正确；
- `CollectionHall` 摘掉自己那排，**连「所有房间」一起摘**：它与跨页条的「3D 艺术展厅」
  和画面内 HUD 的「离开展厅」是三处重复出口，留一处。

`.gal-views--local` 抹掉第二层胶囊底色（`padding/background/border` 全归零）：
它与左边那枚胶囊同处一排，但说的是「**怎么看**」不是「**去哪**」，
所以当两枚松散的开关；选中的那枚靠 `button.gal-view[aria-pressed='true']` 的卡片底 + 阴影立起来。

**两个按钮的 id（`gal-mode-3d` / `gal-mode-grid`）不能改**：
`lib/gallery/index.ts` 用 `getElementById`（document 作用域）做状态同步，
拿不到 WebGL 时 `degrade()` 还要按 id 把这两枚收掉。
`button.gal-view` 上没写 `display`，所以 `[hidden]` 仍然生效
（一旦给按钮补 `display`，这条降级就静默失效 —— 见 §6.4）。

### 4.3 背景带：`hero="backdrop"`（第 0 条的「背景填充」）

`BaseLayout` 的第三种页头模式：一条**绝对定位、不占文档流**的通栏背景带，
`top: 0` 挂在初始包含块上（`body`/`html` 都没定位）→ 天然铺满视口宽。

```css
.hero--backdrop {
  position: absolute; top: 0; left: 0; right: 0;
  height: var(--hero-backdrop-h, 30rem);
  opacity: 0.55;
  mask-image: linear-gradient(to bottom, #000 0%, #000 34%, transparent 100%);
  pointer-events: none;
}
```

四个页面都传 `heroHeight="13rem"`（208px）。这个数是量出来的，不是拍的：

- **下界**：要盖住「顶栏 + 顶栏与内容之间那 1.75rem 间距」——
  实测顶栏底 72、内容顶 100，带底 208 **>** 100，空档里不会露出页面底色；
- **上界**：再高就铺到页头下面去了，右栏的小灰字会落在照片最亮的地方，**实测读不出来**。
  第一版 `27rem` + 慢渐隐就是这么翻车的。

渐隐用 `mask-image` 而不是叠一层渐变白：后者在深色主题下会把照片洗成灰雾。
`34%` 那个断点就是「顶栏那一段要实、往下尽快退干净」的落点。

`pointer-events: none` 是必须的：带子横跨顶栏所在的高度，不关掉会挡住导航点击。

## 五、两种展示模式

### 5.1 `flat` —— `CollectionStream`（杂志式照片流）

一本合集一页摊开，宽度档位交替（`1 / -1` 通栏 ↔ `1 / span 7` 缩进），
标题与说明压在照片外。e2e 会读回宽度档位断言「不是等宽网格」。

### 5.2 `3d` —— `CollectionHall`（复刻展厅）

- 展厅里摆的是**所有 3D 合集**（走过拱门换一间 —— 这是 3D 展厅本来的意思），
  出生点是当前这个合集；下面的网格只列**当前合集**的照片。
  「网格 = 这本合集的作品，展厅 = 可走的容器」，两者分工不同。
- 服务端渲染的默认态是 `data-mode='grid'`：无 WebGL / 无 JS / 弱设备都停在网格上，
  脚本确认跑得动才切到 `3d`。**降级不是「出错」，是常态路径**。
- 该页 `smoothScroll={false}`：Lenis 的惯性滚动会与画布里的拖拽/键盘移动打架。

## 六、仍然成立的老约束（从上一版带过来）

### 6.1 `--bleed` 只能用在 `margin-inline` 上

```css
--bleed: clamp(0px, calc((100vw - 100%) / 2 - 1rem), 6rem);
margin-inline: calc(-1 * var(--bleed));
```

百分比要按包含块的**行内尺寸**解析；上限 6rem + 减 1rem 保底 → 窄屏退化成 0、
**永不产生横向滚动条**（e2e 有 `scrollWidth <= clientWidth` 断言）。实测 1440 下跨页 1360 vs 版心 1200。

### 6.2 右栏躲宠物：复用全局变量，不另起

```css
.gal-rail--note { max-height: calc(100vh - var(--nav-h) - 3rem - var(--toc-pet-reserve, 0rem)); }
```

`--toc-pet-reserve` 由 `global.css` 的 `html:has(.pet-layer…)` 按宠物外观档位给
（12.75rem / 24.25rem，已含宠物本体 + 头顶那列气泡）。
横向没得让（栏本来就贴右缘），只能纵向错开；
**sticky 同时给 `top` 和 `bottom` 时 top 优先、bottom 被忽略**，所以只能砍 `max-height`。

### 6.3 `<img width height>` 会顶掉 `aspect-ratio`

那两个属性落成 `height: 832px` 的 presentational hint，把 `aspect-ratio` 压掉 ——
`getComputedStyle` 里 `aspectRatio: "3 / 2"` 赫然在、图片实际渲染成 212×832 的竖条。
**要靠 CSS 控比例就必须显式 `height: auto`。**

### 6.4 作者样式的 `display` 会盖掉 `[hidden]`

UA 的 `[hidden]{display:none}` 优先级最低。凡自己写了 `display` 的组件，
都要补一条 `[hidden]` 规则 —— 否则 `degrade()` 里那两句 `setAttribute('hidden','')` 就是空的。

### 6.5 「`sticky` + 按视口算的可视高度」先问「元素自然位置在哪」

本仓已踩两次：文章页的 `.toc`、画廊跨页右栏。
**前提错了，后面的算术全对也没用**，而且报错会把人往错的方向带
（一直去调那个 `max-height`，真正坏的是它乘的基数）。
e2e 因此**单独断言前提**（`railTop <= navH + 40 且 scrollY == 0`），而不是只断言结果。

### 6.6 压在页面底色上的线不能用 `--c-border-soft`

`--c-border-soft`（浅 `#eef0f2`）是给**白卡片**当描边的，压在页面底色 `#f0f2f5` 上只差 **2/255**
—— 画了等于没画，而 `getComputedStyle` 会显示一切正常，只能裁到像素里数非背景像素。

## 七、后台 admin（第 3 条要求）

`/admin` 是 GitHub-API 驱动的纯前端后台（密钥只在访客浏览器，仓库里没有），
分栏（`post` / `profile` / `friends` / `assets` / **`gallery`**）挂在 `src/lib/admin/main.ts`。

### 7.1 后台与前台共用同一份目录约定

`src/data/admin.ts` 里给的不再是一个 `gallery.json` 的路径，而是一组**按合集的路径函数**：

```
galleryDir()                 → 'public/gallery/'
galleryMeta(id)              → 'public/gallery/<id>/meta.json'
galleryPhoto(id, file)       → 'public/gallery/<id>/<file>'
galleryThumb(id, file)       → 'public/gallery/<id>/thumbs/<file>'
galleryRedirects()           → 'src/data/gallery-redirects.json'
```

`src/lib/admin/assets.ts` 的「引用扫描」也随之改成逐合集列 `meta.json`——
否则它会以为前台还在读一个已经不存在的 `gallery.json`。

### 7.2 `src/lib/admin/gallery.ts` 能做的事

| 动作 | 实现要点 |
|---|---|
| 传图 | `compressToWebp`（长边 2400）+ 生成缩略图（长边 720）写进 `thumbs/` |
| 改文案 | 表单直接读写 `meta.json`；`collectMeta()` 的**键顺序 = schema 顺序**，读回来再写出去不会把文件搅乱 |
| 调顺序 | `order` 数组；`movePhoto()` 上下移 |
| 删图 | 连带删 `thumbs/` 里**同 stem** 的那张（不是同文件名 —— 缩略图是 webp） |
| 新建合集 | `createCollection()`：建目录 + 一份最小 `meta.json` |
| 合集改名 | `renameCollection()`：**逐个文件搬运**（readBase64 → saveBase64File），并登记一条旧地址 |
| 删合集 | `deleteCollection()`：删目录 + `pruneRedirects()` 清掉指向它的登记 |
| 等构建 | `watchBuild()` 走 `waitForBuild`，改完看得到 Pages 构建结果 |

**写 meta 时的排序与缩进由 `serializeMeta()` 统一**：不要在每个调用点各自 `JSON.stringify`，
否则同一份文件会因为「这次是谁写的」而产生不同的 diff。

## 八、验收

`D:\homepage\.pet-e2e-dual\gallery.mjs`（端口 4342 / CDP 9342）——
**134 条全过**。期望值**现读 `public/gallery/` 的文件系统**（合集数、每个合集几张图、
哪些是 3d），不是写死在脚本里的常量：加一个合集目录，脚本自动多验一块。

几条判据值得单独记：

- **期望值来自文件系统**：`page-count == 目录里的文件数`、`--ar` == 解码出来的图片比例
  （手工 PNG 解码比像素，零依赖）；
- **背景带真的盖住了空档**：截图取「顶栏底 → 内容顶」那一条，比对「有带 / 无带」的像素差，
  不是看 `hasHero` 这个布尔值；
- **`gap = contentTop - navBottom >= 12`**，其中
  `contentTop = .gal-spread.firstElementChild.top`（**不是** `.gal-spread.top` ——
  那是它自己的 padding box 顶边、也就是顶栏底边，拿它算恒等于 0，先假失败过一次）；
- **右栏没有压到宠物**：浮动层不参与布局，必须显式拿两个矩形求交，
  且量的对象是 `.pet` / `.pet__dock` 的上缘取小值
  （`.pet-layer` 铺满视口、`top` 恒为 0，**量它等于没量**）；
- **工具条只有一排**：`.gal-hall__tools` 数到 0 **且**
  `.gal-head__tools [data-gal-view-switch]` 存在 —— 把 §4.2 那条设计决策钉在机制上；
- **跨页三处入口都在**：`entries` 取 `.gal-view` 但**按 `data-gal-view-switch` 摘掉**
  视图切换（它是「怎么看」不是「去哪」）；
- **已删路由**只能**问文件系统**（`!existsSync(dist + p + 'index.html')`）：
  `serve.mjs` 对未知路径回落 `index.html` 回 200，HTTP 状态码永远看不出差别 —— 那种绿是假的。

两个判据前置的坑：

- 验「点进去」必须**重新载入页面**取干净起点。本站开着 Lenis，
  `window.scrollTo(0,0)` 是空操作 → 按 `rect` 算出的 y 变成负数、点击落到视口外，
  看起来像「点了没反应」。顺手用 `elementFromPoint` 断言「点下去确实落在目标上」。
- **1440 下媒体查询根本不参与级联**，宽屏全绿证明不了窄屏没塌 ——
  改断点必须单独看一眼（`shot-gallery.mjs ... narrow 900` / `narrow 700`）。

定妆照：`shot-gallery.mjs`（4343 / 9343）→ `shots-gallery/`。

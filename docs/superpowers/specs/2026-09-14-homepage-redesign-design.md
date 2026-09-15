# 沉浸式首页改版 · 设计规格

- 日期：2026-09-14
- 状态：设计已批准，待写实现计划
- 需求原话：「现在我想设计一个酷炫的首页，把目前的首页 about 单独作为导航栏一项」

站内既有同类规格：`2026-09-12-multi-pet-design.md`、`2026-09-14-smooth-scroll-lenis.md`。

## 1. 目标与非目标

**目标**

1. 首页从「学术简历长页」变成**沉浸式门面**：一屏视觉 + 向下滚动叙事。
2. 原首页的全部内容（简介 / 论文 / 技能 / 项目 / 教育 / 联系方式）**原样迁到独立页面** `/about`，成为导航的独立一项。
3. 保留博客 / 画廊 / 友链的既有入口地位，并把它们提升到首页首屏之下的内容区。
4. 不牺牲既有质量线：双语、View Transitions、Lenis 惯性滚动、宠物、减动效降级、打印样式全部继续成立。

**非目标（本次明确不做）**

- 不做多幕满屏叙事（那需要 3 张满屏图 + 3 句立得住的文案，内容撑不住就是华丽的空页）。
- 不引入 WebGL / 着色器。站内 Live2D 已经占着 WebGL，再加一层会互相抢上下文，且首屏要付 GPU 与降级的双重代价。
- 不做页面进入时的长序列入场动画（打字机、逐字遮罩、元素飞入……）。首屏只需要「一幅画在动」，其余交给滚动。
- 不动 `/admin` 后台的数据结构。首页新增内容全部由现有数据派生，不新增需要维护的字段。
- 不改画廊、博客、友链三页的任何实现。

## 2. 现状：五条会影响设计的事实

这些是读代码确认过的，不是假设。

| # | 事实 | 出处 | 对设计的影响 |
|---|---|---|---|
| 1 | **已有一个全局 `.hero` 横幅**，每页都渲染，背景是 `banner.jpg`，高 `clamp(200px, 35vh, 380px)`，底部 40% 渐隐到页面底色，`z-index: 0`，被 `.page`（`z-index: 10`）盖住 `--banner-overlap`（3.5rem） | `BaseLayout.astro:203`、`global.css:515-535`、`global.css:70-71` | 首页的沉浸首屏是**这条横幅的升级版**，不是另起一层。要给它做变体，否则会叠两条横幅 |
| 2 | **Navbar 是 `position: sticky`**，高 `--nav-h: 4.5rem`（72px），占文档流 | `global.css:306-310`、`global.css:74` | 首屏高度必须是 `calc(100svh - var(--nav-h))`，两者相加才等于一屏。用 `100vh` 会多出 72px 的空隙，看着像「没铺满」 |
| 3 | **已有 Backdrop**：Canvas 2D 五团柔光 + 噪点，带光标跟随、呼吸、速度感应、`transition:persist`、减动效降级，配色读 `--bd-1/2/3` | `Backdrop.astro`、`global.css:173-181` | 柔光层不用重做，它继续垫在视差层之下，提供「画外还有光」的底子 |
| 4 | **`Rail.astro` 有两处链接指向首页锚点**：`href={`${home}#about`}`（第 126 行的迷你头像、第 150 行的「查看更多」） | `Rail.astro:29,126,150` | 迁移后这两处会跳到首页上不存在的锚点。必须改成 `getRelativeLocaleUrl(locale, 'about')` |
| 5 | **首屏图片是全站最大的性能变量**，且站内没有个人照片库（只有 `avatar.jpg`、`banner.jpg`、`gallery/` 6 张示例图、`illustrations/` 9 张文章插图） | `public/` 盘点 | 素材必须生成；规格与体积要在设计阶段定死，不能留给实现期随便挑 |

补充事实（同样读码确认）：

- 导航项定义在 `src/data/nav.ts`，只有 4 项：`''`（首页）/ `blog` / `gallery` / `friends`；文案 key 在 `src/i18n/ui.ts`（zh 段 18-23 行、en 段 267-272 行）。
- 当前首页 `index.astro` 只做了两件事：把 `profile` 与 `locale` 传给 `HomeContent`，并声明 `toc="sections"` 与 `showSidebar`。
- 文章集合 `posts` 用 glob loader，双语靠目录区分（`zh/xxx.md` / `en/xxx.md`），frontmatter 有 `title/description/date/category/tags/cover/aliases/source`。
- 画廊数据在 `src/data/gallery.json`，取图走 `mediaUrl()`（`gallery.ts:126-131`），支持 `base` 前缀与绝对 URL。
- `profile` 可用字段：`name` / `title` / `affiliation` / `location` / `email` / `bio[]` / `interests[]` / `links{}` / `cvFile` / `news[]`。

## 3. 已定的设计决策

三条由用户在三轮问答中选定，后续设计全部服从它们。

1. **方向 = 沉浸首屏 + 滚动叙事**（不是枢纽启动台、不是极简排版、不是可玩交互主角）。
2. **视觉手段 = 图像层叠视差**（不是强化柔光背景、不是 WebGL、不是滚动几何动画）。
3. **素材 = AI 生成一组统一风格的暗色抽象绘画**，延续 `banner.jpg`（深蓝黑 + 橄榄绿笔触）与 Backdrop（蓝紫青柔光）的既有基调。

方案层选的是 **A · 一镜到底**：一幅画拆三层贯穿首屏，滚动时层层拉开，内容从层缝里填进来。落选的 B（多幕叙事）与 C（首屏冲刺 + 枢纽）的理由见 §1「非目标」与 §14。

性能档由用户选定：**三层齐全，单张 ≤330KB、总量 ≤1MB**（画质优先）。

## 4. 架构总览

```
<body>
  <Backdrop />                        ← 既有，不动
  <Navbar />  <NavProgress />         ← 既有，导航多一项
  ┌──────────────────────────────────────────────┐
  │ hero prop 三选一（新增）：                    │
  │   'immersive' → <HomeHero />    ← 首页        │
  │   'banner'    → <div class="hero">  ← 其余页  │
  │   'none'      → 不渲染                        │
  └──────────────────────────────────────────────┘
  <div class="page">                  ← 既有
    <main class="main"><slot /></main> ← 首页放 <HomeBody />
  </div>
  <footer />  <Pet />  <SmoothScroll />  ← 既有，不动
</body>
```

关键点：**沉浸首屏渲染在 `.page` 之外**，与现有 `.hero` 同一个位置。这样它天然是全出血的（不受 `--page-max: 75rem` 与 `.page` 的 `padding: 0 1rem` 限制），也天然在 `Backdrop` 之上、内容与顶栏之下。若把首屏塞进 `<slot />`，就得用 `100vw` 破局技巧去抵消父容器宽度，得不偿失。

单例约束（本仓被坑过两次，见 §11 第 9 条）：`HomeHero` 的脚本必须做成**可重复执行不叠加**的形式 —— 用 `window.__homeHeroCleanup` 存上一份的清理句柄，`astro:page-load` 时先撤旧的再建新的。注意首屏脚本与 `astro:page-load` 在**首次加载时也会跑两遍**（`setup()` 直调一次 + `astro:page-load` 一次），所以「建比撤多一」是稳态，不是 1 比 0。

**样式落点（实施时修正）**：`.hh` 的样式放独立文件 `src/styles/home.css`，但它是**共享 chunk，不是首页专属**。原因是 `BaseLayout` 必须无条件 `import HomeHero`（`hero` 是运行时 prop，构建期无法按页面树摇），vite 于是把它打进全站共用的那个 CSS chunk —— 和 `pet.css` 完全一样的处境。代价为零（首次访问即缓存，后续页面命中缓存），但要清楚：**「非首页页面产物完全不变」这条不成立**，非首页的 HTML 多了一个共享 CSS 引用，只是内容上除了导航多一项、Rail 两行之外没有任何差异。

## 5. 组件设计

### 5.1 `BaseLayout.astro`：新增 `hero` prop

```ts
/**
 * 顶部视觉：
 * - 'banner'（默认）：静态横幅（现状），全站沿用
 * - 'immersive'：首页的沉浸式视差首屏
 * - 'none'：不渲染任何顶部视觉
 */
hero?: 'banner' | 'immersive' | 'none';
```

渲染处（替换现有第 203 行那一行）：

```astro
{
  hero === 'immersive' ? (
    <HomeHero locale={locale} profile={profile} />
  ) : hero === 'none' ? null : (
    <div class="hero" aria-hidden="true" style={`--banner-img: url('${base}banner.jpg')`} />
  )
}
```

默认值是 `'banner'`，所以**其余 60 多页零改动** —— 这一条是实现时必须验证的（构建后比对页面数与非首页的 HTML 差异）。

### 5.2 `HomeHero.astro`：首屏

职责单一：渲染「一幅画 + 首屏文字」，并驱动视差。

```astro
<section class="hh" aria-labelledby="hh-name">
  <div class="hh__scene" aria-hidden="true">
    <div class="hh__layer hh__layer--far"></div>
    <div class="hh__layer hh__layer--mid"></div>
    <div class="hh__layer hh__layer--near"></div>
  </div>

  <div class="hh__content">              <!-- 两行两列网格，见 §7 -->
    <div class="hh__head">               <!-- 左上：刊头 -->
      <p class="hh__eyebrow">{affiliation} · {location}</p>
      <div class="hh__headline">
        <h1 class="hh__name" id="hh-name">{name}</h1>
        <span class="hh__rule" aria-hidden="true"></span>
        <p class="hh__kicker">{title}</p>
      </div>
    </div>

    <div class="hh__note">               <!-- 右上：站点自己的话，两行 -->
      <p class="hh__note-line">{t('home.lede.1')}</p>
      <p class="hh__note-line">{t('home.lede.2')}</p>
    </div>

    <nav class="hh__jump">                <!-- 左下：编号索引 -->
      <a class="hh__jump-link" href="…">
        <span class="hh__no">01</span><span class="hh__label">关于</span>
        <span class="hh__go" aria-hidden="true">→</span>
      </a>
    </nav>
  </div>

  <a class="hh__more" href="#home-body">向下滚动 ↓</a>
</section>
```

要点：

- **首屏不放自我介绍。** `profile.bio` 整段只给关于页 —— 首屏是「刊头」（身份 + 学位 + 一句站点自己的话），不是简历摘要。原来那句是 `bio[0]` 的首句，与关于页第一段**逐字重复**，而且里面是「XX 大学 / XX 教授」这样的占位符。现在换成 `home.lede.1/2`（写在 `ui.ts`，改文案不碰组件）。
- `profile.title` 从「独立一行」降级成刊头右端的小字（`hh__kicker`），与名字共用一条基线 —— 名字 112px、小字 13px，量级对比本身就是版面的一部分。
- 三个去向用 `getRelativeLocaleUrl(locale, ...)` 生成，与 Navbar 同一套；它们是真链接、键盘可达，带 01/02/03 编号（编号是排版骨架，不是顺序含义）。
- 向下提示是锚链接 `#home-body`，滚到内容区。Lenis 的 `anchors: true` 会接管它（它自己读 `scroll-margin-top`），所以内容区要写 `scroll-margin-top: var(--nav-h)`。
- 高度：`height: 100vh; height: calc(100svh - var(--nav-h));`（两行，老浏览器吃第一行）。

### 5.3 `HomeBody.astro`：首屏之下的内容区

三块，全部构建期渲染，无客户端请求。**刻意不用共享的 `Section` 组件**（见 §7「版面为什么不是一排盒子」），
板块头改成「编号 + 栏目名 + 一条横贯细线」，与首屏刊头的 `.hh__rule` 同一套手法：

```astro
<div class="home-body" id="home-body">
  <section class="hbs">
    <h2 class="hbs__label">
      <span class="hbs__no">01</span>
      <span class="hbs__name">{t('home.entries')}</span>
      <span class="hbs__rule" aria-hidden="true"></span>
    </h2>
    <ul class="entries">…</ul>          <!-- 目录四行 -->
  </section>
  <section class="hbs">…<div class="post-list">PostCard ×3</div>…</section>
  <section class="hbs">…<ul class="shots">…</ul>…</section>
</div>
```

| 区块 | 版式 | 数据来源 |
|---|---|---|
| 入口 = 目录 ×4 | 关于 / 博客 / 画廊 / 友链各占**一行**：名称 · 说明 · 数量 · hover 时滑入的箭头；行间是横线，没有盒子 | `getRelativeLocaleUrl`、`gallery.items` |
| 最新文章 ×3 | 复用 `PostCard`，但首页把它排成 **1 大 + 2 小**（见 §7） | `posts` 集合 |
| 画廊精选 ×3 | 前 3 张缩略图，**一大两小错落**（左竖长、右两张横条叠放） | `gallery.ts` 的 `mediaUrl()` |

数量在构建期算好写进 HTML（文章数是集合长度，画廊数是 `gallery.items.length`）。**没有任何运行时 fetch。**

`HomeBody` 横向不加 padding：`.page` 已给 1rem，正好与首屏刊头落在同一条左缘线上
（首屏是 `max(1rem, (100% − --page-max) / 2 + 1rem)`，两边算出来一样）。

**代价与兜底**：`.entry__meta` 在「关于」「友链」上是空的、整条不渲染，所以四列都显式给了
`grid-column`（靠自动放置的话箭头会掉进数量那一列）。`PostCard` 加了图片 `onerror`
兜底：图挂了就摘掉 `post-card--with-cover` 并移除缩略图块 —— 那个类是**版式开关**
（决定头条是「图右文左」还是纯文字通栏），不摘就会留下一个空的图列。

### 5.4 路由与导航迁移

| 动作 | 文件 |
|---|---|
| 新增关于页 | `src/pages/about.astro`、`src/pages/en/about.astro` |
| 首页改版 | `src/pages/index.astro`、`src/pages/en/index.astro` |
| 导航插一项 | `src/data/nav.ts` 在 `nav.home` 之后插 `{ key: 'nav.about', path: 'about' }` |
| 补文案 | `src/i18n/ui.ts`：zh 补 `'nav.about': '关于'`，en 补 `'nav.about': 'About'` |
| 修旧锚点链接 | `src/components/Rail.astro` 第 126、150 行改 `getRelativeLocaleUrl(locale, 'about')` |

关于页 = 原首页的搬运，保留 `toc="sections"` 与 `showSidebar`，`title` 仍用「名字 · 头衔」。首页新写自己的 `title`（`名字 · 站名`）与 `description`（一句自我定位，取 `title` + `interests` 前两项）。

导航顺序：**首页 · 关于 · 博客 · 画廊 · 友链**。`Navbar` 的高亮逻辑按路径首段比对（`Navbar.astro:24-31`），`/about` 天然匹配 `path: 'about'`，无需改判断。

### 5.5 旧锚点垫片

外部链接与搜索引擎可能存了 `/#about`、`/#publications`、`/#skills`、`/#projects`、`/#education`、`/#contact`。静态站没有服务端重定向，只能在首页放一段内联脚本兜住：

```astro
<section class="hh" data-about-url={getRelativeLocaleUrl(locale, 'about')}>
  …
</section>

<script is:inline>
  (() => {
    const ids = ['about', 'publications', 'skills', 'projects', 'education', 'contact'];
    const hash = location.hash.slice(1);
    if (!ids.includes(hash)) return;
    const url = document.querySelector('.hh')?.dataset.aboutUrl;
    if (url) location.replace(url + '#' + hash);
  })();
</script>
```

三个实现细节，都是刻意的：

- 目标地址走 **`data-about-url` 属性**传进去（构建期由 `getRelativeLocaleUrl(locale, 'about')` 求值），而不是在脚本里拼字符串。理由：脚本若自己去猜语言前缀，就等于把路由规则抄了第二份，改一次要改两处。站内已有同样做法的先例（`Search.astro` 用 `data-base` / `data-prod` 传构建期值）。
- 用 `is:inline`：模块脚本会被推迟到解析之后执行，而这段要在页面渲染前就把人送走。
- 脚本放在 `.hh` 之后，这样才能读到它的 data 属性。

**注意**：新首页自己不用这六个 id 做页内锚点，否则会与垫片冲突。首页的锚点只有 `#home-body`。

## 6. 数据流

### 6.1 一次滚动（唯一的热路径）

```
用户滚轮
  → Lenis 接管（lerp 0.1），在它自己的 rAF 里把真实 scrollTop 写到位
  → HomeHero 的 rAF 读 window.scrollY
      p = clamp(scrollY / heroHeight, 0, 1)
      scene.style.setProperty('--hh-p', String(p))     ← 每帧只写一处 DOM
  → CSS 让三个层各自算位移
      far  : translate3d(0, calc(var(--hh-p) * -60px), 0)
      mid  : translate3d(0, calc(var(--hh-p) * -140px), 0)
      near : translate3d(0, calc(var(--hh-p) * -260px), 0)
  → 内容层反向小幅下移 + 透明度递减，产生「从层缝里升起」的错觉
```

为什么自己读 `scrollY` 而不是挂 `lenis.on('scroll')`：Lenis 改的是真实滚动位置（它的 `setScroll` 用 `scrollTo({ behavior: 'instant' })`），所以 `window.scrollY` 始终最新；这样 **HomeHero 与 Lenis 完全解耦** —— 移动端 `syncTouch: false` 走原生滚动时一样有效，将来首页若关掉 Lenis 也不受影响。

为什么只写一个 CSS 变量：JS 每帧只碰一处 DOM，三个合成层由浏览器自己算；窄屏要从 3 层降到 2 层，改 CSS 一处即可，JS 不动。

节流与回收：`IntersectionObserver` 观察 `.hh`，不可见时 `cancelAnimationFrame` 并停止写变量。

### 6.2 构建期数据注入

沿用本仓既有惯例（`pet` 的站内目录用的就是这招）：需要给脚本的数据用 `<script is:inline type="application/json" id="...">`，运行时 `JSON.parse` 取用。

本次首屏**不需要任何注入数据** —— 三层图路径写在 CSS 里，文字是 SSR 的。只有内容区的数量是构建期算好直接写进 HTML 文本，连 island 都不用。**这是有意的**：少一个运行时依赖，就少一处可能坏的地方。

## 7. 交互细节

| 项 | 取值 | 理由 |
|---|---|---|
| 层位移速率 | far `-60` / mid `-140` / near `-260`（px，相对一个首屏的滚动量） | 速率比要拉得够开（近景 ≈ 远景的 4 倍）才看得出纵深；比值太接近就退化成整块平移 |
| 视差平滑 | **不额外做 lerp** | Lenis 已经平滑过一次，再套一层会让手感发黏；移动端原生滚动本身就是顺的 |
| 内容层 | 反向 `+40`，`opacity` 从 1 降到 0.25 | 「升起」是相对运动：层向上跑，文字近乎不动，相对观感就是文字在往上浮 |
| 首屏 → 内容区过渡 | `.hh` 底部用渐变过渡到 `--c-page`（沿用既有 `.hero::after` 的做法），**高度取 `min(40%, 160px)`**；内容区自身背景本来就是 `--c-page`。**不做跨区块的层延伸** | 避免硬边即可；要让层延伸到内容区就得让它脱离 `.hh` 的 `overflow: hidden`，代价远大于收益 |
| 文字块的垂直站位 | `.hh__content` 的底部空档用**长度**（`5.5rem`），落在「块中心比首屏中心高 5.3%」 | **不能用百分比**：见下方「两处按比例取值的陷阱」 |
| 版面结构 | 两行两列网格 `'head note' / 'index .'`，`column-gap: 4rem`。见下方「版面为什么不是一列」 | 一列竖排 + 一排等宽胶囊按钮，在超大字号下会收成一个整齐的矩形，与画面本身的纵深互相抵消 |
| 垂直节奏 | 上下两带之间的 `row-gap: clamp(2.5rem, 17vh, 14rem)` —— 用 `vh` 而不是固定值 | 矮屏（笔记本横屏）才不会被两带撑破 |
| 右下角那个空格 | `'index .'` 里那个 `.` 是**故意留的**：宠物层固定在右下角（`pet` 的 `right/bottom: 1rem`），版面把它让出来 | 填进去会与宠物层相交 —— 实测过，句子沉到底就撞上它的气泡 |
| 窄屏索引 | `≤920px` 起索引由横铺改**竖排**（`flex-direction: column`，每项收成内容宽度 ≈86px） | 横铺时最后一项必然伸进宠物层底下：375 下索引右端 359 vs 宠物左缘 171，820 下 804 vs 611 |
| 向下提示 | 落在**左下角、与刊头左缘对齐**（原先是底部居中），轻微上下浮动，reduce 下静止 | 居中会在版面正中再立一条对称轴；右下角被宠物占着 |
| 顶栏 | 首屏时 `.navbar__card` 仍用近实底浮层色，不做透明化。但顶栏本身在第四轮被整版重做（两端分居 / 01–05 编号 / 会滑动的指示线 / 滚动进度线 / 断点 768→1024），见 `2026-09-14-navbar-redesign-design.md` | 透明化要处理滚动状态切换、搜索面板对比度、暗色主题三件事，收益不抵 |

### 版面为什么不是一列（三个把它拆开的装置）

`adgo` 这种超大字号（112px）+ 一列竖排正文，本身就会收成一个整齐的矩形。三个装置
分别在横、纵、节奏上拆它：

1. **刊头一条细线**（`.hh__rule`）：`flex: 1 1 auto` 吃掉名字与右端小字之间的全部余量，
   于是它天然「接到版面右端」。用 `align-items: baseline` 对齐 —— 空盒子的基线就是它的
   下外边距边，所以给它 `margin-bottom` 就等于把线从基线上抬起一点。
2. **右栏一句话**（`.hh__note`）：右对齐、与左边的身份信息**同一条顶线**，两条小字分居两端。
3. **编号索引**（`.hh__jump`）：`01 关于 / 02 博客 / 03 画廊`，每项自带一条细线。
   **刻意不用胶囊边框** —— 边框会把版面重新框回方块，一条线加一个编号已经够。

垂直上是「上带（小字 + 大字）→ 一大段留白 → 下带（索引）」。留白不是没排满，
是让这张画有地方露出来。整块仍**光学居中**（见上表），e2e 有断言盯着。

### 内容区：为什么不是一排盒子

内容区第一版是三个共享 `Section`（白卡 + 左侧竖条 + emoji 标题）+ 四张等宽圆角入口卡 +
三张等宽横卡 + 三张等宽 3:2 图 —— 满眼**等宽方框**，而且是「卡里再装卡」
（`.section` 是一张卡，里面的 `PostCard` / `.entry` 又是一张卡）。

改成**刊物内页**：不套外壳、内容直接落在页面底色上，靠留白与细线分隔；三块各用一种编排：

| 区块 | 手段 | 为什么 |
|---|---|---|
| 板块头 | `01 ─── 从这里开始 ────────`：编号 + 栏目名 + 一条横贯细线 | 与首屏刊头同一套语言（封面与内页是同一本刊物），也替掉了原来那个带 emoji 的小标题 |
| 入口 | **目录四行**（名称 / 说明 / 数量 / 箭头），行间横线，hover 时整行让出 0.85rem 并把箭头滑进来 | 四个目的地本来就是一个「目录」；等宽盒子把四者拉成一样重，而它们轻重其实不同 |
| 文章 | **1 大 + 2 小**：头条横跨整行、日期提到标题上方当刊期、字号 33.6px；副刊左图右文、图 8rem、摘要 clamp 两行 | 三张一样宽等于没有主次。**副刊也不能排成「通栏大图 + 图上文下」** —— 那样副刊高 592px、无图头条只有 161px，主次当场倒挂（已写成断言） |
| 画廊 | `grid-template-areas: 'big a' / 'big b'`：左竖长图通高、右两张 16:10 横条 | 三张等宽等高的图是「相册」不是「版面」；高度差本身就是节奏 |
| 尾部动作 | 「查看全部 →」前面铺一条细线、文字靠右 | 与板块头同形，首尾收口 |

降级：`≤767px` 内容区收成一列；`≤520px` 副刊改回「图上文下」—— 左图右文在 375 下文字列
只剩不到 200px，中文一行放不下十来个字，读起来全是断行。

**一处必须显式写 `height: auto`**：画廊大图的高度是「跨两行」拿到的，窄屏单列后没有行可跨，
`height: 100%` 就成了循环依赖，会塌成 0 高。

### 两处按比例取值的陷阱（实施期发现，都是「照抄既有值」抄出来的）

两条都是同一个错误形状：**把一个按比例表达的数值从它原来的上下文搬到尺寸完全不同的
新上下文里**。数值本身没错，比例才是错的。而且两条都只在桌面端暴露 —— 窄屏下反而
正常，所以很容易被「手机上看着挺好」骗过去。

**① 渐变高度 `40%`。** 既有 `.hero` 只有 **315px** 高，它的 `40%` = 126px，是把横幅
尾巴轻轻抹开的量。首屏 **828px** 高，`40%` = 331px —— 整整刷掉画的下三分之一。浅色
主题下 `--c-page` 是近白，那一截变成灰白雾，画面「发灰」，正好撞上 §8 回退规则要拦的
症状；深色主题下 `--c-page` 本来就是深色，所以完全看不出来。**封到 `min(40%, 160px)`**，
只做收边，笔触完整保留。

**② 文字块底部空档 `30%`。** 百分比 `padding` 是按**包含块的「宽度」**解析的，不是
高度 —— 而 `.hh` 是全出血的（包含块宽 = 视口宽 1440，不是 `--page-max` 的 1200），
于是 `30%` 实际是 **432px**，而不是「首屏高度 828 的 30% ≈ 248px」。实测把文字块顶到
首屏中心以上 **216px**、下方空出 **464px**（首屏高度的 56%）。

它的指纹很有意思：窄屏的 `24%` 只剩 90px，手机上恰好是居中的 —— 同一个类在桌面端
「极度偏上」、在窄屏「正常居中」，看着像媒体查询写错了，实际是百分比的解析基准不同。
改成**长度**（`7rem` / `5.5rem`）后，两端表现一致（6.8% / 6.0%）。

改完的落点：

| 断点 | 首屏 | 文字块 | 块中心比首屏中心高 | 块底到首屏底 |
|---|---|---|---|---|
| 1440×900 | 72..900 | 264..596 | 56px（6.8%） | 304px |
| 375×800 | 72..800 | 252..532 | 44px（6.0%） | 268px |

判定方式：`probe.mjs` 量 `.hh__eyebrow` 顶到 `.hh__jump` 底的矩形，再与 `.hh` 的矩形
比中心 —— 别用截图目测，像素级的位置肉眼判断不可靠。

## 8. 素材规格

三层由 AI 生成，规格定死如下（实现期不做范围外的发挥）：

| 层 | 文件 | 画面分工 | 叠加 |
|---|---|---|---|
| 远景 | `public/home/far.webp` | 最暗，大面积雾状色块，无锐利边缘 —— 氛围底 | 不透明铺底 |
| 中景 | `public/home/mid.webp` | 中等明度笔触，斜向流动（呼应 `banner.jpg` 的走向） | `mix-blend-mode: screen`，`opacity: .85` |
| 近景 | `public/home/near.webp` | 高对比、小面积高光碎片 —— 给「擦过镜头」的速度感 | `mix-blend-mode: screen`，`opacity: .6` |

统一参数：

- 尺寸 **2560×1440**（16:9，覆盖 2x 的 1280 宽视口；超宽屏由 `background-size: cover` 裁切）
- 格式 **WebP，质量 80**；单张 **≤330KB**，三张合计 **≤1MB**（用户的性能档）
- 色调取站内既有的 `--bd-1` 蓝 `#2563EB` / `--bd-2` 紫 `#8B5CF6` / `--bd-3` 青 `#0D9488`，整体压暗到接近 `banner.jpg` 的明度（深蓝黑 + 橄榄绿）
- 三层必须是**同一套色系与笔触语言**，否则叠在一起会像三张不相干的图

**混合模式回退规则**：若截图实测过曝（高光糊白）或发灰（整体对比度下降），退化为纯 `opacity` 叠加、去掉 `mix-blend-mode`。判定方式是首屏整页截图 + 肉眼比对 `banner.jpg` 的明度，不做数值量化。

## 9. 降级矩阵

| 条件 | 行为 | 判定方式 |
|---|---|---|
| `prefers-reduced-motion: reduce` | 不启动 rAF，`--hh-p` 恒为 0，三层静态叠合成一幅画 | `Emulation.setEmulatedMedia` 模拟 |
| 视口 < 768px | `near` 层由 `@media` 置 `display: none`，位移速率乘 0.5 | 视口设 375×800，数**可见**的 `.hh__layer`（`getComputedStyle().display !== 'none'`） |
| `saveData` 或 `effectiveType` 为 2G/3G | 只加载 `far`，`mid`/`near` 不发请求 | 读 `navigator.connection`，无该 API 时按「不降级」处理 |
| 无 JS（脚本被禁） | 三层都在 HTML 里，CSS 定位好 → 静态合成画 + 完整文字，链接可用 | `Emulation.setScriptExecutionDisabled(true)` |
| 图片 404 / 加载失败 | `.hh__scene` 的 `background-color: #141b26` 兜底（沿用现有 `.hero` 的 `#1e2a3a` 思路） | 人为改错路径验证 |
| 打印 | 把 `.hh` 加进 `@media print` 的隐藏清单（现有清单在 `global.css:2348`） | 打印预览 |

无障碍：

- 三个视差层 `aria-hidden="true"`（纯装饰）
- 首屏文字是真 HTML 文本（可选中、可读屏），姓名是该页唯一的 `h1`
- 三个去向与向下箭头都是真 `<a>`，键盘可达，有可见焦点环
- 关于页保证「`main` 内恰好一个 `h1`」——**实施时核对发现原本没有**：`HomeContent`
  的第一个标题就是板块的 `h2`（原首页同样如此，不是本次搬移引入的缺口）。已补一个
  `.sr-only` 的 `<h1>{profile.name}</h1>`，视觉零改动，标题层级补齐为 h1 → h2 → h3。
  `.sr-only` 用 `clip-path: inset(50%)` 而非 `display:none`（后者会把节点从无障碍树摘掉）。
  注意 `clip` 只对绝对定位元素生效，所以必须同时写 `position: absolute`。

## 10. 测试策略

沿用 `web-e2e-harness`：本地静态服务器 + 无头 Chrome + CDP 真滚轮/真点击。驱动脚本放仓库外，与既有 `scroll.mjs`（Lenis）同一套骨架，端口另起（建议 4332，避开 Lenis 的 4331 与宠物的 4321）。

断言清单（9 组）：

1. **路由**：`/about`、`/en/about` 返回 200；板块 id（about / publications / skills / projects / education / contact）齐全；侧栏与目录在
2. **导航**：5 项且顺序为 首页·关于·博客·画廊·友链；中英文案各自正确；当前页 `aria-current="page"` 落对
3. **旧锚点垫片**：访问 `/#about` 最终落在 `/about#about`；访问 `/#publications` 落在 `/about#publications`
4. **层叠是真的**：真滚轮后采样 `--hh-p` 单调递增；同时三层 `getBoundingClientRect().top` 的位移量**互不相同且顺序为 far < mid < near** —— 这条防「做了个整块平移却以为是视差」
5. **首屏刚好一屏**：`hero.offsetHeight + navbar.offsetHeight` 与 `innerHeight` 相差 ≤2px
6. **内容区**：入口卡 4 张、文章 3 篇（日期倒序可验证）、画廊图 3 张；全部 `href` 指向存在的路由
7. **降级三连**：reduce 下滚轮后 `--hh-p` 恒为 0；375px 视口下**可见**的 layer 只有 2 层（被 `display: none` 的那层不生成盒子，其背景图也不会被请求）；禁用 JS 后三层与首屏文字仍可见，链接可点
8. **网络**：首屏图片总字节 ≤1MB；无 404；无控制台报错（第三方请求按既有做法排除）
9. **换页往返后 rAF 只有一份**：从首页跳到博客再返回，随后同时看三件事 ——
   `started - stopped === 1`、`active === 1`、以及**每帧计数的增速没有翻倍**
   （`ticks` 在 0.8s 内的增量与首次基准之比 < 1.6）—— 这条防「换页后多挂一份循环，越翻越卡」
10. **首屏文字没有被宠物层压住**（视觉验收后补的）：把 `.pet__chips / .pet__bubble / .pet__dock / .pet`
    与首屏每个文字块（`.hh__eyebrow / .hh__note / .hh__more`，以及**每一个** `.hh__jump-link`）
    两两求矩形相交，375px 下必须是空集。

11. **内容区版面本身**（内容区改成刊物内页后补的，三条）——
    ① **主次倒挂**：头条宽度 == 版心宽、且标题字号 ≥ 副刊的 1.3 倍（实测 1168px/33.6px vs 572px/16.8px）；
    ② **目录列错位**：四行 `.entry__desc` 的左缘必须完全一致（实测 324/324/324/324）——
    数量在「关于」「友链」上是空的、整条不渲染，靠 grid 自动放置的话箭头会掉进数量那一列；
    ③ **空图列**：`.post-card--with-cover` 必须有缩略图、有缩略图必须有这个类（两边都为 0）——
    那个类是版式开关，图挂了不摘就会留下一个空的图列。

第 4、9、10、11 是重点：第 4 条防测量对象错了；第 9 条防历史坑复发（本仓的搜索按钮、宠物都栽在「首屏脚本 + `astro:page-load` 跑两遍」上）；第 10、11 条防「几何断言全绿但画面是坏的」—— 第 10 条是**浮动覆盖层**遮住了内容（fixed 层不参与布局），第 11 条是**版面关系**错了（谁主谁次、列对不对齐），两类都不在「元素在不在、链接通不通」的射程内。

**第 10 条为什么非补不可**：宠物层是 `position: fixed`、**不参与文档流**，所以上面所有几何断言
（首屏一屏、光学居中、无横向溢出）在它被压住时**全都照过** —— 实测 375 下索引行与宠物按钮条
完全重叠，49 条断言里没有一条会响。两个实现细节也记一下：

- **量的是索引的每一项，不是 `.hh__jump` 容器**。容器是网格单元格，窄屏改竖排后项收窄到 ~86px、
  容器却仍占满整栏 —— 拿容器求交会得到假阳性，把已经修好的报成失败。
- 判定要跳过未显示的宠物（`display: none` 或零尺寸）：宠物可以被用户关掉。

**第 9 条的两个实现修正（实施时定下来的）**：

- 单例证据**不能只数「清理句柄被调了几次」**。句柄计数只证明「撤过」，一份撤不掉的
  旧循环完全不会去改写它 —— 恰恰是要抓的那种故障，它是隐形的。
  改为诊断四件套 `window.__homeHero = { started, stopped, active, ticks }`，其中
  `ticks` 每帧 `+= 1`：**两份循环 ⇒ 增速正好翻倍**，这是唯一与实现方式无关的判据。
  一帧 60/s，两侧实测 60/s → 61/s（比值 1.02）。
- **量层位移必须减去 hero 自身的 `top`**。直接读 `layer.getBoundingClientRect().top`
  会把「文档整体滚上去了」也算进位移，三层看起来位移一样 —— 于是真视差会被误判成
  「整块平移」。一律用 `layer.top - hero.top`。

## 11. 范围边界（具体清单）

**做**：新增 2 个组件（`HomeHero`、`HomeBody`）、2 个页面（`about` 中英）、3 张图、`hero` prop、导航一项、文案十条、Rail 两行、一段垫片、一个 `src/styles/home.css`（含它自己的 `@media print`）、`global.css` 里的 `.sr-only` 工具类。

**不做**：不动 `HomeContent` 内部结构（它被原样搬到关于页，唯一例外是开头多一个不可见 `h1`，见 §9）、不动画廊/博客/友链、不改 `profile` 数据 schema、不给首屏加任何运行时数据注入、不做首屏的入场动画序列。

## 12. 涉及文件

新增：

- `src/components/HomeHero.astro`
- `src/components/HomeBody.astro`
- `src/styles/home.css`（独立文件，但进共享 chunk，见 §4）
- `src/pages/about.astro`、`src/pages/en/about.astro`
- `public/home/far.webp`、`public/home/mid.webp`、`public/home/near.webp`
- `docs/superpowers/specs/2026-09-14-homepage-redesign-design.md`（本文）

修改：

- `src/pages/index.astro`、`src/pages/en/index.astro`
- `src/layouts/BaseLayout.astro`（`hero` prop + 渲染分支）
- `src/data/nav.ts`、`src/i18n/ui.ts`
- `src/components/Rail.astro`（两行：小档案头像与「更多」的锚点改指 `/about`）
- `src/data/sections.ts`（仅注释：板块 id 同时被首页垫片引用，改 id 会破垫片）
- `src/components/HomeContent.astro`（开头加一个 `.sr-only` 的 `h1`，见 §9）
- `src/components/PostCard.astro`（缩略图加 `onerror` 兜底：图挂了摘掉版式开关并移除图块，见 §15 第三轮）
- `src/styles/global.css`（`.sr-only` 工具类，见 §9）

## 13. 风险与取舍

| 风险 | 处置 |
|---|---|
| 首屏图片是全站最大的性能变量 | 规格定死（2560×1440 / WebP q80 / 单张 ≤330KB / 合计 ≤1MB），并给 `saveData` 降级 |
| `mix-blend-mode` 在部分低端 GPU 上会强制合成、掉帧 | 已给回退规则（§8）：截图判定过曝或发灰就退化为纯 `opacity` |
| 三张图叠起来「不像一幅画」 | 三层必须同色系同笔触语言；验收时以首屏整页截图肉眼判定 |
| 首屏只剩「华丽」，信息量为零 | 内容区三块（入口卡 / 文章 / 画廊）保证第二屏就有实际去处；首屏文字含 affiliation + location + 一句定位 |
| 迁走 about 会让首页丢了原有 SEO 权重 | 首页与关于页都进 sitemap；关于页保留原 `title` 文案；首页写新的、面向「站名 + 定位」的 `title` 与 `description` |
| 与 Lenis 双份平滑叠加导致手感发黏 | 视差侧不做 lerp（§7），只跟随 `scrollY` |
| 换页后 rAF 叠加 | 单例清理句柄 `window.__homeHeroCleanup` + e2e 第 9 条 |
| `100svh` 老浏览器不支持 | 两行写法兜底（先 `100vh`） |

## 14. 验收标准

1. 首页首屏铺满一屏（与顶栏相加 = 视口高，误差 ≤2px），滚动时三层可见地拉开纵深。
2. 导航多出「关于 / About」，点击进入 `/about`（`/en/about`），看到与改版前完全一致的内容。
3. `/#about` 等旧锚点不再空跳，落到关于页对应板块。
4. 关掉动画偏好后首屏仍然是一幅完整的画（静止）。
5. 手机视口下只加载 2 层、无横向滚动条、无抖动。
6. e2e 九组断言全绿；首屏图片总量 ≤1MB；无控制台报错。
7. 非首页页面的**内容**与改版前一致（除导航多一项、Rail 两处锚点改指、共享 CSS chunk 变化外无差异）。

## 15. 验证记录（2026-09-14）

**产物**：`astro build` + `pagefind --site dist`，dist 198 个文件，69 个页面。
新页面 `/about/index.html`、`/en/about/index.html` 均存在。

**e2e**：`D:\homepage\.pet-e2e-dual\home.mjs`（仓库外），端口 4332 / CDP 9334，
`--window-size=1440,900` + `Emulation.setDeviceMetricsOverride`，真滚轮真点击。
结果 **53 通过 · 0 失败 · 0 跳过**（9 组）。

实测数据：

| 项 | 实测 |
|---|---|
| 三层相对位移（p=0.3623） | far 21.74 / mid 50.72 / near 94.20 px，期望 21.7 / 50.7 / 94.2（rate −60/−140/−260） |
| 首屏 + 顶栏 vs 视口 | 828 + 72 = 900 = 900（±0） |
| 首屏文字块 | 桌面 271..613，块中心比首屏中心高 44px（5.3%）；375 下 −6.0% |
| 索引与宠物层相交 | 375 / 414 / 820 / 900 / 1440 五档均为空集（375 下索引最右缘 102 < 宠物左缘 171） |
| 首屏图片 | 458.1 KB / 3 文件（far 125K · mid 196K · near 137K），预算 1MB |
| 换页往返后 | `{started:3, stopped:2, active:1}`；tick 增速 60/s → 61/s（比值 1.02） |
| 375px | 可见层 far + mid（near `display:none`），索引竖排，无横向溢出 |
| reduce / 无 JS | `--hh-p` 恒 0 且 `transform: none`；无 JS 下三层仍在且背景图就位、文字可读、3 个去向可点 |
| 404 / 异常 / console.error | 全 0 |

**「几何断言全绿」不等于「画面成立」—— 这一轮最大的收获。** e2e 46 条全过时，
首屏其实有三处是坏的：底部渐隐照抄了 `40%`、文字块用了百分比 `padding`（§7 两处陷阱），
以及 375px 下索引行整个压在宠物按钮条上。三条几何断言对它们**一条都不敏感**。
所以判据要落在**像素级的两两关系**上（渐隐高 vs 首屏高、块中心 vs 首屏中心、
文字矩形 vs 宠物矩形），而不是「首屏高度对得上」。修完补了 3 条断言 → 50 条。

**实施期发现并修掉的三个坑**：

1. **驱动脚本自己的 bug**：`Network.responseReceived` 的参数里**没有 `request` 字段**
   （只有 `requestId` / `response` / `type`…）。写成 `p.request.url` 会在**第一次**
   遇到 4xx/5xx 时抛 `TypeError` 把整个脚本炸掉 —— 而且崩的时候看起来像「当前那一组失败」。
   url 只能靠 `requestId` 反查（与 `loadingFailed` 同一个道理）。
2. **关于页没有 `h1`**：核对发现原首页也没有 —— `HomeContent` 第一个标题就是板块的
   `h2`。补 `.sr-only` 的 `h1` 修掉标题层级（见 §9）。
3. **宠物层压在版面右下**：它是 `position: fixed`、不参与文档流，所以几何断言全绿也
   照样被压。修法是让版面**结构上**避开它（网格里留 `.` 空位、窄屏索引改竖排），
   再把「文字矩形 × 宠物矩形」的相交判定写进 e2e（§10 第 10 条）。

**与本文最初版本的偏差**（正文均已更新）：`.hh` 样式进共享 chunk（§4）、单例证据改用
逐帧 `ticks` 增速（§10）、关于页补不可见 `h1`（§9）、**首屏不再放 `bio[0]` 而是文案表里的
`home.lede.*`**、版面从「一列竖排 + 胶囊按钮」改为「两行两列刊头 + 编号索引」（§5.2 / §7）。

### 第三轮：内容区从「一排盒子」改成刊物内页

**触发**：用户看图后提出「这些也不要这样方方正正的，有点创意好不好」。首屏那版已经改过，
这一轮动的是首屏之下的 `.home-body`。

**改法**（决策依据见 §7「内容区：为什么不是一排盒子」）：弃用共享 `Section`（白卡外壳），
板块头改「编号 + 栏目名 + 横贯细线」；入口改**目录四行**；文章改 **1 大 + 2 小**；
画廊改 **一大两小错落**；尾部动作改「细线 + 右对齐文字」。

**e2e 53 通过 · 0 失败**（第 6 组新增 3 条，见 §10 第 11 条）。实测：

| 项 | 实测 |
|---|---|
| 头条 vs 副刊（防主次倒挂） | 1168px / 33.6px 字号 ↔ 572px / 16.8px（正好 2 倍） |
| 目录描述列左缘 | 324 / 324 / 324 / 324（数量为空的两行也没错位） |
| 版式开关与配图一致 | 开关开着却没图: 0 · 有图却没开关: 0 |
| 内容区总高 | 1861px（上一版 2173px，缩掉 312px） |

**这一轮踩到的坑（都已写进断言）**：

1. **主次倒挂**：第一版副刊排成「通栏大图 + 图上文下」，实测副刊 592px 高、而**无图的头条只有
   161px** —— 副刊比头条显眼，头条就不成其头条。改成左图右文（图 8rem）后三块都约 220px，
   但头条靠「1168px 宽 + 33.6px 字号」建立重量。
   **教训**：`1 大 + 2 小` 里的「大」不能只靠位置，得量化到宽/字号，否则标题长短、有没有配图
   都会把它翻过来。
2. **外链封面会破**：首页有一篇文章的封面是从正文第一张图取的**外链**（博客园图床），
   本机 `curl` 返回 `000`，页面上就是一个破图框 —— 而这个框在新版式里会**带崩一整列**
   （`post-card--with-cover` 是版式开关，图挂了列还在）。给 `PostCard` 的 `<img>` 加了
   `onerror`：摘掉开关类 + 移除缩略图块，版式自动退回单列。渐进增强，无 JS 时最坏与改动前一致。
3. **网格大图的高度是循环依赖**：画廊大图靠「跨两行」拿高度（`height: 100%`），窄屏单列后
   没有行可跨，必须显式写 `height: auto`，否则塌成 0。

### 第四轮：首屏文案去身份信息（同日，按用户反馈）

**触发**：用户看图提出「换一个文案，还有不要出现个人信息，还有导航栏的设计也改的有创意一些」
（截图指着首屏那两行「江西理工大学 · 中国 · 江西」与「计算机科学与技术 · 硕士研究生」）。

**改法**：刊头那两行小字不再从 `profile` 读值，改读文案表 —— `.hh__eyebrow` =
`home.eyebrow`（个人数字花园）、`.hh__kicker` = `home.kicker`（笔记 · 照片 · 书签）；
右栏那句整句换掉（`home.lede.1/2` → 「写下来的东西，比记得住的更可靠。/ 所以想到的、
看见的，都留在这里。」）；首页 `<meta name="description">` 里的学位也一并撤掉
（页面撤干净、搜索结果里还挂着，等于没撤）。**站名（`profile.name`）保留**：它是这个站的
名字，`<title>`、社交卡片与侧栏都用它，首屏 `h1` 与顶栏字标也是它。

**同一批的顶栏整版重做**（两端分居 / 01–05 编号 / 会滑动的指示线 / 卡片下缘滚动进度线 /
断点 768 → 1024）另立规格：`2026-09-14-navbar-redesign-design.md`，§10 是同一份文案表。

**e2e 73 通过 · 0 失败**（顶栏新增第 10 组 20 条，见那份规格 §11）。首屏此前那 53 条
**一条都没改、全部照旧通过** —— 换文案与撤身份信息都不动版面，几何断言不受影响。

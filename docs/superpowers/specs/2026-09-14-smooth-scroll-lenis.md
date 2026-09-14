# 丝滑惯性滚动（Lenis） · 设计规格

> 2026-09-14 实现并端到端验证（34 通过 / 0 失败 / 0 跳过）。

## 1. 目标

给全站加「惯性滚动」的手感：滚轮/触控板推一下之后页面继续滑行一段并缓停，而不是一格一格跳。
验收标准是**手感**，所以判据只能是真浏览器里「一次滚轮之后 scrollY 在多个后续帧里继续增长」，
JS 单测验不到（见 §8）。

## 2. 关键约束：为什么不是「一个 `new Lenis()` 就完事」

本站是 Astro 静态站 + View Transitions（`ClientRouter`）导航，这带来四条别处没有的约束。
每条都对着 `lenis@1.3.26` 的源码确认过（`node_modules/lenis/dist/lenis.mjs`）。

### 2.1 `<html>` 上的 class 活不过一次换页

Astro 换页时 `<html>` 的**属性被新文档整个替换**，Lenis 在构造函数里加的 `lenis` 类就此消失
（实例本身没事，它靠 JS 工作）。后果有两层：

- 任何「用 `html.lenis` 判断实例在不在」的代码在换页后会得到**假否定**；
- 官方 `lenis/dist/lenis.css` 把 `overscroll-behavior: contain` 挂在 `.lenis` 下 ——
  换页后这条规则**静默失效**。

**处置**：① 运行期状态由我们自己的类 `is-smooth-scroll` 表意，并在**每次 page-load 重新贴上**；
② 不引官方 CSS，只把需要的那一条改挂在 `[data-lenis-prevent]` 属性上（属性不随换页消失）。

### 2.2 模块级单例 + 页面级开关，「不渲染组件」关不掉实例

View Transitions 下模块级状态是活的。若靠「这页没渲染组件」来判断该不该开，从普通页进到
展映厅时**旧实例还在跑**——而展映厅正是用 `wheel` 驱动 canvas 的，滚轮会被它抢走。

**处置**：开关写进 `<html data-smooth-scroll="true|false">`（构建期由 layout prop 决定），
控制器每页都读这个属性。组件每页都渲染，包括被排除的页。

### 2.3 嵌套滚动容器是默认关闭的

`allowNestedScroll` 默认 `false`，此时 Lenis 只认 `data-lenis-prevent`
（`onVirtualScroll` 在事件的 `composedPath` 上查这个属性）。
**没标的嵌套容器会被 preventDefault** —— 症状是「在搜索结果列表上滚滚轮，动的却是正文」。

### 2.4 它走原生滚动，不接管滚动容器

写位置用 `wrapper.scrollTo({ behavior: 'instant' })`，**刻意绕过 CSS 的 `scroll-behavior`**。
所以 `html { scroll-behavior: smooth }` 不用删 —— 它继续服务无 JS / 被排除页 / 减动效三条路径。
反过来，Lenis 空闲时也**接受**原生滚动位置（`onNativeScroll` 在 `isScrolling` 为假时把
`animatedScroll` 对齐到 `actualScroll`），所以键盘、锚点回退、屏幕阅读器这些非 Lenis 路径
不会被它覆盖。

## 3. 架构总览

```
BaseLayout.astro ──┬─ <html data-smooth-scroll="true|false">      ← 唯一的开关信号
                   └─ <SmoothScroll />                            ← 挂载点（无可见 DOM）
                                        │
                                        ▼
                     src/lib/smooth-scroll.ts（模块单例控制器）
                       syncSmoothScroll()  ← astro:page-load + 首屏各调一次
                         ├─ watchPreference()   减动效监听（只装一次，活到页面卸载）
                         └─ mount() / unmount()  按 enabled() && !reduceMotion() 决定
                                        │
                                        ▼
                                  lenis 实例（autoRaf 自管循环）

嵌套滚动容器 ── 7 处 data-lenis-prevent 标注（属性即契约）
             └─ global.css: [data-lenis-prevent]{overscroll-behavior:contain}
```

## 4. 组件设计

### 4.1 控制器 `src/lib/smooth-scroll.ts`

模块级单例 `let lenis: Lenis | null`。三个函数：

| 函数 | 职责 | 关键点 |
|---|---|---|
| `enabled()` | 读 `<html data-smooth-scroll>` | **唯一**的开关来源，不猜「有没有组件」 |
| `syncSmoothScroll()` | 每次 page-load 调一次 | 先 `watchPreference()`；不满足条件则 `unmount()`；实例活着就重贴状态类 + `resize()`；否则 `mount()` |
| `watchPreference()` | 减动效切换 | **只装一次**（`watching` 守卫），**不随实例销毁** |

实例参数：

```js
new Lenis({
  autoRaf: true,          // 自管 rAF，不在外面搭循环
  smoothWheel: true,
  syncTouch: false,       // 触屏保持系统原生惯性
  lerp: 0.1,              // 官方默认；越小越飘
  anchors: true,          // 锚点交给它，偏移自动读 scroll-margin-top（见 4.3）
  stopInertiaOnNavigate: true,  // 站内跳转先停惯性，否则与换页抢同一帧
  autoResize: true,
  respectReducedMotion: true,   // 第二道保险
})
```

### 4.2 挂载点 `src/components/SmoothScroll.astro`

```astro
<script>
  import { syncSmoothScroll } from '../lib/smooth-scroll';
  // astro:page-load 首屏也会触发，所以这两行不会漏掉首屏
  document.addEventListener('astro:page-load', () => syncSmoothScroll());
  syncSmoothScroll();
</script>
```

不引官方 `lenis/dist/lenis.css`，理由见 §2.1。官方其余几条（`html.lenis{height:auto}`、
iframe 指针事件）本站都用不到。

### 4.3 锚点：不手写偏移

`scrollTo()` 自己会读目标元素的 `scroll-margin-top` 与容器的 `scroll-padding-top`
（`lenis.mjs` 第 783-786 行）：

```js
const scrollMargin = parseFloat(getComputedStyle(node).scrollMarginTop);
target = rect.top + this.animatedScroll - scrollMargin - scrollPadding;
```

本站这个值已经写在 `.section` 与 `.prose h2/h3/h4` 上（`calc(var(--nav-h) + 1rem)`）。
再给 Lenis 传一个 offset 就是**同一个数在两处各写一份**，CSS 改 `--nav-h` 时必然对不上。
实测落点误差 **2.0px**（见 §8.1 第 6 条）。

它也不影响地址栏：`onClick` 只调 `scrollTo()`、**不** `preventDefault`，
浏览器对 hash 的默认导航（写 URL）照常发生。

### 4.4 页面级开关

`BaseLayout.astro` 新增 prop `smoothScroll?: boolean`（默认 `true`），渲染成
`<html data-smooth-scroll={smoothScroll ? 'true' : 'false'}>`。
**只在一处**关掉：`/gallery/screening-room/`（中英各一份），因为那页 canvas 是滚轮驱动的。

### 4.5 嵌套容器标注（7 处）

| 位置 | 容器 | 场景 |
|---|---|---|
| `Search.astro` | `#search-results` | 刚打完字就把鼠标放到结果上（最高频） |
| `Sidebar.astro` | `.sidebar` | 窄屏侧栏 |
| `Toc.astro` | `.toc__inner` | ≥1536px 的目录 |
| `Rail.astro` | `.rail__inner`、`.heat__day-list` | 文章页右栏与热力图 |
| `GalleryFloor.astro` | `#gal-focus` | 画廊聚焦层 |
| `Pet.astro` | `.pet__bubble-body` | 宠物气泡正文 |

`global.css` 里配一条：

```css
[data-lenis-prevent] { overscroll-behavior: contain; }
```

## 5. 数据流：一次滚轮

```
wheel 事件
  └─ Lenis onVirtualScroll
       ├─ 事件 composedPath 上有 [data-lenis-prevent]？
       │    ├─ 有 → 不 preventDefault，容器自己滚（且 contain 挡住 scroll chaining）
       │    └─ 无 → preventDefault，进入 Lenis 的惯性轨道
       └─ 惯性轨道：每帧 lerp 逼近目标位置 → wrapper.scrollTo({behavior:'instant'})
            （不加 lenis 类时就是原生滚动，什么都不做）
```

## 6. 交互细节

- **触屏**：`syncTouch: false`，手机完全走系统原生惯性。JS 模拟跟不上手指，
  官方自己对 iOS 也不打包票。
- **换页**：`stopInertiaOnNavigate: true` 让惯性在跳转时先停；`syncSmoothScroll()`
  在换页后再 `resize()` 把 `animatedScroll` 拉回原生位置，免得它把新页拽回旧文档的位置。
  实测「惯性进行中点击导航」后新页 scrollY 稳定在 0（8 次采样全 0，旧位置 1200）。
- **history.back()**：Astro 自己把离开时的 scrollY 存进 `history.state`，恢复**不是一步到位**
  （文档布局稳定后才补正）。实测 `history.state.scrollY=1689`，首次读到 1648，约 250ms 后
  收敛到 1689 并稳住（6 次采样偏移 0px）。

## 7. 错误处理与降级

按顺序四道：

1. **用户偏好**：`prefers-reduced-motion: reduce` → 不创建实例（`syncSmoothScroll` 里判定）。
   切回 `no-preference` → 实例自动重建。
2. **Lenis 自带**：`respectReducedMotion: true`（万一偏好变化与我们的监听之间有时序缝隙，
   它自己会把 `lerp` 压成 1、程序化滚动改瞬移）。
3. **被排除页**：`data-smooth-scroll="false"` → `unmount()`（`destroy()` 摘掉全部监听、
   停掉 rAF、撤掉它自己加的类）。
4. **无 JS**：什么都不发生，`html { scroll-behavior: smooth }` 照常工作。

## 8. 测试策略

沿用 `web-e2e-harness`（本地静态服务 + 无头 Chrome + CDP 真实交互）。驱动脚本在仓库外
`.pet-e2e-dual/scroll.mjs`（端口 4331，与宠物那套 4321 错开，两者可同时跑）。

**判据只用「只有成功才会出现的东西」**：

| # | 节 | 判据 |
|---|---|---|
| 1 | 实例创建与开关 | `is-smooth-scroll` 类；客户端跳转进出排除页后类的有无 |
| 2 | 惯性存在 | 一次滚轮后**多个后续帧**继续增长（不是「有位移」，那一步到位也算） |
| 3 | 嵌套容器 | 悬停其上滚轮后，容器 `scrollTop` 变**且**页面 `scrollY` 不变；滚到底不把溢出传给页面 |
| 4 | 锚点 | 目标顶边 == 它自己的 `scroll-margin-top`；`location.hash` 已更新；原生 `scrollTo` 仍被接受 |
| 5 | 导航 | 惯性进行中跳转后落在新页顶部且不被拽回；`history.back()` 收敛到记录位置并稳住 |
| 6 | 减动效 | reduce 下类名清空、滚轮一步到位；偏好切回后实例**自动重建** |
| 7 | 网络与异常 | 本站 0 条失败请求、0 条未捕获异常（第三方失败归并单列） |

### 8.1 端到端验证结果（2026-09-14 · 34 通过 / 0 失败 / 0 跳过）

| 节 | 结果 | 证据（关键一条） |
|---|---|---|
| 1 实例与开关 | ✅ | 首页 `class="lenis is-smooth-scroll"`；客户端跳进展映厅后类名 `""`；离开后又回来 |
| 2 惯性存在 | ✅ | 一次滚轮：`48 → 226 → 316 → 388 → 425 → 455 → 470 → 482 → 489 → 493 → 495 → 497 → 498 → 499`（70ms/次，跨度 > 400ms） |
| 3 嵌套容器 | ✅ | `#search-results` 查询「的」7 条、`705/384` 溢出；滚轮后容器 `0 → 220` 而页面 `300 → 300`；滚到底 `321/321` 页面仍 300 |
| 3 机制层 | ✅ | `#search-switch` 上 `{click:1}`、`#search-input` 上 `{input:1}`（见第 2 个 bug） |
| 4 锚点 | ✅ | `#about` 顶边 **90.0px** vs `scroll-margin-top=88px`（误差 2.0px）；`location.hash="#about"`；原生 `scrollTo(0,500)` → 实测 500 |
| 5 导航 | ✅ | 惯性中跳转后 8 次采样全 0（旧位置 1200）；`back()` 后 `1689 → 1689`，偏移 0px |
| 6 减动效 | ✅ | reduce 下类名 `""`、100ms 时已到 400（一步到位）；偏好切回后 `class="lenis is-smooth-scroll"` |
| 7 网络与异常 | ✅ | 本站 0 条失败请求、0 条未捕获异常（第三方 `ipapi.co` 1 条，单列不判定） |

**1 项环境不可验证（既不伪装 PASS 也不抹成 FAIL）**：键盘 Home 回顶。
无头 Chrome 不驱动键盘滚动（派发 `Home` 后 `800 → 800`，焦点也安抚过了），
本环境测不到。能确证的是**代码事实**（控制器没注册任何键盘监听、Lenis 也不吃键盘）+
紧随其后的原生 `scrollTo` 被正常接受这条断言。

#### e2e 抓出来的两个真 bug（都已修）

1. **减动效偏好是单向门**（控制器）。原写法把 `prefers-reduced-motion` 的 change 监听
   装进 `mount()`、在 `unmount()` 里摘掉 —— 看着整洁，实际切到 `reduce` 时 `unmount`
   顺手摘了监听，等偏好切回 `no-preference` 时**已经没有任何人调 sync**，实例永远回不来。
   修法：监听只装一次（`watching` 守卫），与实例生命周期解耦。
   *第 6 节就是靠「切回偏好后 `is-smooth-scroll` 是否回来」把它抓出来的。*

2. **搜索按钮完全点不开**（`Search.astro`，与本特性相邻但独立的既有 bug）。
   该组件的 `btn` / `input` 两个监听**没挂 `AbortController` 的 signal**，
   而 `cleanup()` 只 `abort()` 挂了的那些 —— 于是首屏 `init()` 跑两遍就留下两份处理器，
   一次点击跑两遍：前一个刚 `setOpen(true)`，后一个看到「已经开着」立刻 `setOpen(false)`。
   症状是**按钮点了毫无反应**（既不打开也不报错）。
   修法三处：两个监听挂上 signal；把清理句柄放到 `window.__searchCleanup` 做成
   跨实例单例（换页时内联脚本可能整体重跑，各份实例各留一套同样会叠）；
   `astro:page-load` 的自我登记也挂同一个 controller。

   这一条不是行为断言发现的 —— 行为断言只给得出「面板没打开」这个**结果**。
   是**机制层断言**（`DOMDebugger.getEventListeners` 数按钮上挂几个 click）直接指出原因。

#### 测试脚本自身的三个坑（都改了，值得复用）

1. **探针会污染测量。** 为定位上面第 2 个 bug 往页面注入的探针（capture 阶段挂在同一个
   按钮上）被 `getEventListeners` 数了进去，误报成「还有 2 个」。修法：探针挂在自己的
   `AbortController` 上，读完诊断立刻 `abort()` 再量。
2. **用例之间没收尾。** 第 3 节把搜索面板留在打开状态，而它是 `position: fixed` 的浮层，
   1600px 视口下正压在右侧目录上 —— 第 4 节「点目录链接」实际点到了**面板里的搜索结果链接**，
   页面被导航走，于是目标元素消失、锚点断言假失败。修法：进第 4 节先点搜索按钮把面板关回去，
   并用面板自己的 class 确认真的关了。
3. **`null` 展开把结论升级成崩溃。** 目标元素查不到时 `{...null}` 得到 `{}`，
   随后 `observed.top.toFixed()` 抛 TypeError，**整节跑不完**，失败信息也丢了。
   修法：展开时带上 `found: !!p`，报告函数对非数值走 `String(v)`。

## 9. 假设验证结果（2026-09-14 已实测 · 全部通过）

| 假设 | 来源 | 结果 |
|---|---|---|
| `anchors: true` 自动读 `scroll-margin-top`，无需再传 offset | 源码 783-786 行 | ✅ 落点误差 2.0px |
| `onClick` 不 `preventDefault`，hash 照常写 URL | 源码 | ✅ `location.hash="#about"` |
| `allowNestedScroll: false` 时 `data-lenis-prevent` 是唯一闸门 | 源码 `onVirtualScroll` | ✅ 标注的容器自己滚、页面不动 |
| `setScroll` 用 `behavior:'instant'` 绕开 CSS `scroll-behavior` | 源码 | ✅ 原生 `scroll-behavior:smooth` 保留且不冲突 |
| 空闲 Lenis 接受原生滚动位置 | 源码 `onNativeScroll` | ✅ `scrollTo(0,500)` → 实测 500 |
| View Transitions 会替换 `<html>` 属性 | Astro 行为 | ✅ 换页后 `lenis` 类消失、`is-smooth-scroll` 需重贴 |
| 模拟媒体特性会触发 `matchMedia` 的 change 事件 | CDP 行为 | ✅ 偏好切回后实例自动重建（否则第 6 节永远证不了） |
| 减少动效时「不建实例」比「建了再压平」更干净 | 设计选择 | ✅ 类名直接为空，滚轮一步到位 |

## 10. 范围

**做**：全站惯性滚动；桌面滚轮与触控板；嵌套容器标注；减动效降级；被排除页开关；锚点接管。

**不做**（明确的非目标）：

- 触屏惯性模拟（`syncTouch` 保持 false）
- 入场动画 / 视差 / 滚动进度条（本轮只要手感，不要表演）
- 自建滚动容器（`wrapper` 保持 `window`，这是 §2.4 全部好处的前提）
- 改 `html { scroll-behavior: smooth }`（它继续服务三条非 Lenis 路径）

## 11. 涉及文件

**新增**

- `src/lib/smooth-scroll.ts` — 控制器（模块单例）
- `src/components/SmoothScroll.astro` — 挂载点
- 本文件

**修改**

| 文件 | 改动 |
|---|---|
| `src/layouts/BaseLayout.astro` | 新增 `smoothScroll` prop；`<html data-smooth-scroll>`；挂载组件 |
| `src/pages/gallery/screening-room.astro` | `smoothScroll={false}` |
| `src/pages/en/gallery/screening-room.astro` | 同上 |
| `src/components/Search.astro` | `#search-results` 标 `data-lenis-prevent`；**并修掉按钮双绑 bug**（见 §8.1） |
| `src/components/Sidebar.astro` | `.sidebar` 标 `data-lenis-prevent` |
| `src/components/Toc.astro` | `.toc__inner` 标 `data-lenis-prevent` |
| `src/components/Rail.astro` | `.rail__inner`、`.heat__day-list` 标 `data-lenis-prevent` |
| `src/components/gallery/GalleryFloor.astro` | `#gal-focus` 标 `data-lenis-prevent` |
| `src/components/Pet.astro` | `.pet__bubble-body` 标 `data-lenis-prevent` |
| `src/styles/global.css` | `[data-lenis-prevent]{overscroll-behavior:contain}` |
| `package.json` / `package-lock.json` | 新增依赖 `lenis@^1.3.26` |

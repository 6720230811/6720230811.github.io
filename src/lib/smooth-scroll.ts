/**
 * 丝滑惯性滚动（Lenis）控制器。
 *
 * 四条设计约束，每条都有源码依据（node_modules/lenis/dist/lenis.mjs，v1.3.26）：
 *
 * 1. **只接管桌面滚轮与触控板**。`syncTouch` 保持 false —— 手机用系统原生惯性，
 *    JS 模拟反而跟不上手指（官方自己对 iOS 也不打包票）。
 *
 * 2. **锚点不做手写偏移**。`scrollTo()` 自己会读目标元素的 `scroll-margin-top`
 *    与容器的 `scroll-padding-top`，再把它们从目标位置里减掉：
 *      const scrollMargin = parseFloat(getComputedStyle(node).scrollMarginTop);
 *      target = rect.top + this.animatedScroll - scrollMargin - scrollPadding;
 *    本站这个值已经写在 `.section` 与 `.prose h2/h3/h4` 上
 *    （`calc(var(--nav-h) + 1rem)`），所以 `anchors: true` 就够 —— 再传 offset
 *    就是同一个数在两处各写一份，CSS 改了 `--nav-h` 就会对不上。
 *    它也不影响地址栏：`onClick` 只调 `scrollTo()`、**不** preventDefault，
 *    浏览器对 hash 的默认导航（写 URL）照常发生。
 *
 * 3. **嵌套滚动容器必须显式标 `data-lenis-prevent`**。`allowNestedScroll` 默认
 *    false，此时 Lenis 只认这个属性（`onVirtualScroll` 在事件的 composedPath 上
 *    查它）。没标的嵌套容器会被 preventDefault —— 表现是「在搜索结果列表上滚
 *    滚轮，动的却是正文」。7 处标记见各组件。
 *
 * 4. **它走原生滚动**。写位置用 `wrapper.scrollTo({behavior:'instant'})`，
 *    刻意绕过 CSS 的 `scroll-behavior`。所以 `html{scroll-behavior:smooth}`
 *    **不用删** —— 它继续服务无 JS / 被排除页 / 减动效这三条路径。
 *
 * 三条反直觉的点，别踩：
 *
 * - **`<html>` 的 class 活不过一次 View Transitions 换页。** Astro 换页时
 *   `<html>` 的属性会被新文档**整个**替换，Lenis 在构造函数里加的 `lenis` 类
 *   就此消失（实例本身没事，它靠 JS 工作）。所以运行期状态由我们自己用一个类
 *   `is-smooth-scroll` 表意，并在**每次 page-load 重新贴上** —— 官方 lenis.css
 *   把 `overscroll-behavior: contain` 挂在 `.lenis` 下，正是因为这个类会没，
 *   那条规则会在换页后静默失效；我们改挂在 `[data-lenis-prevent]` 上（见 global.css）。
 * - **偏好监听必须与实例生命周期解耦。** 它一旦被摘掉，`reduce` 偏好再切回来时
 *   就没人调 sync 了 —— 实例永远装不回来。所以监听只装一次、活到页面卸载，
 *   绝不放进 mount/unmount。
 * - 空闲时 Lenis **不写滚动位置**；反过来它会**接受**原生位置
 *   （`onNativeScroll` 在 `isScrolling` 为假时把 animatedScroll 对齐到 actualScroll）。
 *   所以非 Lenis 路径（键盘、锚点回退、屏幕阅读器）不会被它覆盖。
 */

import Lenis from 'lenis';

/** 构建期策略开关，对应 <html data-smooth-scroll>。改名字要两处一起改（BaseLayout.astro） */
const ATTR = 'smoothScroll';
const ENABLED = 'true';

/** 运行期状态类。挂在 <html> 上，每次 page-load 重新贴（见上面第三条注释） */
const CLASS = 'is-smooth-scroll';

let lenis: Lenis | null = null;

/**
 * 偏好监听只装一次，**不随实例销毁**。
 *
 * 曾经的写法是把监听放进 mount()、在 unmount() 里 removeEventListener ——
 * 看起来整洁，实际是个单向门：切到 reduce 时 unmount 顺手摘掉监听，等偏好切回
 * no-preference 时已经没有任何人调 sync 了，实例再也回不来。
 * e2e 第 6 节就是靠「切回偏好后 is-smooth-scroll 是否回来」把它抓出来的。
 */
let watching = false;

/**
 * 这一页要不要丝滑滚动 —— 只有 `<html data-smooth-scroll>` 说了算。
 *
 * 为什么不用「这页有没有渲染组件」来判断：View Transitions 换页时模块级状态是活的。
 * 若靠「页面上没有组件」来关，从普通页进到展映厅时旧实例还在跑，而展映厅正是靠
 * wheel 驱动 canvas 的，滚轮会被它抢走。必须有一个显式的「这页该关」信号。
 */
function enabled(): boolean {
  return document.documentElement.dataset[ATTR] === ENABLED;
}

function reduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function watchPreference(): void {
  if (watching) return;
  watching = true;
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    syncSmoothScroll();
  });
}

function mount(): void {
  if (lenis) return;

  lenis = new Lenis({
    // Lenis 自管 rAF，不需要我们在外面搭循环
    autoRaf: true,
    smoothWheel: true,
    // 触屏保持系统原生惯性
    syncTouch: false,
    // 官方默认值。想更跟手就往 0.15 加一点，想更飘就往 0.07 减一点
    lerp: 0.1,
    // 锚点交给 Lenis，偏移取自元素的 scroll-margin-top（见文件头第 2 条）
    anchors: true,
    // 站内跳转时先停惯性：否则它会和 View Transitions 换文档抢同一帧
    stopInertiaOnNavigate: true,
    autoResize: true,
    // 第二道保险：万一偏好变化与我们这个监听之间有时序缝隙，
    // Lenis 自己也会把 lerp 压成 1、程序化滚动改瞬移。
    // 第一道在 syncSmoothScroll() 里 —— 减动效时干脆不建实例。
    respectReducedMotion: true,
  });

  document.documentElement.classList.add(CLASS);
}

function unmount(): void {
  if (!lenis) return;
  // destroy()：摘掉全部监听、停掉 rAF、并撤掉 Lenis 自己加在 <html> 上的 lenis* 类
  lenis.destroy();
  lenis = null;
  document.documentElement.classList.remove(CLASS);
}

/**
 * 按当前页面的 `<html>` 标记决定创建还是销毁实例。每次换页都要调 ——
 * `<html>` 的属性随新文档更新，`data-smooth-scroll` 也就跟着变了。
 */
export function syncSmoothScroll(): void {
  watchPreference();

  if (!enabled() || reduceMotion()) {
    unmount();
    return;
  }
  if (lenis) {
    // 已经活着。两件事：① 换页把 <html> 的 class 整个换掉了，状态类得重新贴；
    // ② resize() 把 animatedScroll 拉回原生位置，免得惯性把页面拽回旧文档的位置。
    document.documentElement.classList.add(CLASS);
    lenis.resize();
    return;
  }
  mount();
}

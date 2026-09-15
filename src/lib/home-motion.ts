/**
 * 首页内容区的动效层（`/` 首屏之下那三块）。
 *
 * 设计规格见 `docs/superpowers/specs/2026-09-14-home-motion-design.md`。
 * 这里只做三件事：滚动落版、指针合流、诊断计数。样式全在 home.css。
 *
 * 三条贯穿全篇的约束：
 *
 * 1. **一个 rAF，不是四个。** `pointermove` 每秒能发 100+ 次，直接写样式会逼浏览器
 *    每帧同步布局。所以监听里只记坐标，帧里统一写 —— 与 HomeHero 的视差同形态
 *    （那边每帧只写一个 `--hh-p`）。帧内还必须**先读完再写**：中间夹一次写，
 *    后面那次读就会触发强制重排。
 *
 * 2. **变量写在目标元素自己身上，不写全局。** 写全局的话，一张卡上的指针会带着
 *    所有卡片一起动 —— 那观感是页面在抖，不是元素在动。
 *
 * 3. **JS 没跑起来时页面必须照常可读。** 初始隐藏态是服务端写在 HTML 里的
 *    （`data-rv-state="out"`），四道兜底见规格 §7 与 HomeBody.astro 里的注释。
 *
 * 这里**不 import home.css**：那份样式由 HomeHero.astro 引入（它被 BaseLayout 引，
 * 所以每页都在），而首页又必然渲染 HomeHero。在这里再引一次只会多一份重复产物。
 */

/** 墨条长度，与 home.css 里 `.entries__ink` 的宽度必须一致 */
const INK_WIDTH = 40;

/** 落版观察根：往里收一圈，让落版发生在元素真的读得到的时候 */
const REVEAL_MARGIN = '-4% 0px -8% 0px';

/**
 * 把比例夹到 0~1。**两组指针比例都必须过这一关。**
 *
 * 指针面是**整张卡**（`data-card`），指针可以跑到配图框或标题块之外很远：
 *
 * · 倾斜不夹：比值轻松到 1.65，`rotateY` 算出 16°、框内图平移 18px —— 远超设计的
 *   ±7° / ±8px，画面上看着就是坏的（e2e 的现场记录里读到过 `mx=1.6562`）。
 * · 细线不夹：负比值会被 `scaleX` **翻到左边**，标题左侧凭空多出一条线。
 *
 * 夹住之后语义反而更清楚：**指针在哪一侧，元素就往哪一侧靠到底**。
 */
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

type MotionDiag = {
  /** 落版次数（每次 out → in 记一次） */
  reveals: number;
  /** 撤版次数（每次 in → out 记一次）。**回退坏掉时这个值会停在 0** */
  outs: number;
  /** 回退扫描跑过多少帧。把它与 outs 分开记：扫描在跑但 outs 不涨，
   *  说明「扫描执行了、但没人满足离开条件」，与「扫描压根没跑」是两回事 */
  sweeps: number;
  /** 指针那套监听建立过几次 */
  binds: number;
  /** 撤过几次。**只有 binds − unbinds === 1 才能证明没双绑** */
  unbinds: number;
  /** 指针帧跑了多少帧 */
  ticks: number;
  /** 帧里往 DOM 写过多少次变量 */
  writes: number;
};

type MotionWindow = Window & {
  __homeMotion?: MotionDiag;
  __homeMotionCleanup?: null | (() => void);
};

/**
 * 诊断对象**在模块求值时就贴上**，不是进了 setup 才建 ——
 * HomeBody 末尾那段看门狗靠它判断「模块到底加载成功了没有」。
 * 放在 setup 里的话，中间就有一段窗口期会被误判成失败。
 */
const diag: MotionDiag = ((window as MotionWindow).__homeMotion ??= {
  reveals: 0,
  outs: 0,
  sweeps: 0,
  binds: 0,
  unbinds: 0,
  ticks: 0,
  writes: 0,
});

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 省流 / 慢网：整层动效不启用。判据与 HomeHero 的 shouldTrim 相同 */
const shouldTrim = () => {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  if (!connection) return false;
  return Boolean(connection.saveData) || /^(slow-)?2g$|^3g$/.test(connection.effectiveType ?? '');
};

/* ------------------------------------------------------------
   ① 落版
   ------------------------------------------------------------ */
function initReveal(): () => void {
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-rv]'));
  if (targets.length === 0) return () => {};

  /**
   * 回退扫描：**谁已经完全离开视口，就收回去。**
   *
   * 只扫 `'in'` 的那几个（已经 `'out'` 的没什么可做），矩形现读 —— 这个函数是
   * 状态切换路径，不在每帧写样式的路径上，强制一次布局无所谓。
   */
  const sweep = () => {
    diag.sweeps += 1;
    const vh = window.innerHeight;
    for (const el of targets) {
      if (el.dataset.rvState !== 'in') continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= vh) {
        el.dataset.rvState = 'out';
        diag.outs += 1;
      }
    }
  };

  let raf = 0;
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      sweep();
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // 只处理「进来」这一个方向。**回退不在这里做**，理由见下面那段长注释。
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        if (el.dataset.rvState !== 'in') {
          el.dataset.rvState = 'in';
          diag.reveals += 1;
        }
      }
    },
    { rootMargin: REVEAL_MARGIN, threshold: 0 },
  );

  /**
   * 回退**为什么不能挂在 IntersectionObserver 的通知上**（这是实测出来的，不是推测）：
   *
   * IO 只在**比例穿越阈值**的那一刻通知。回退要的是「完全离开视口」，但通知送达的
   * 时机由 `rootMargin` 决定 —— 元素跨出那个**收缩过的根**（这里 `[36, 828]`）时，
   * 它通常**还在真实视口里**（`top ≈ 828 < innerHeight 900`）。于是
   * `rect.top >= window.innerHeight` 不成立，一个字节都没写；而此后比例恒为 0，
   * 再也不会穿越、**再也不会通知** —— 状态就永久停在 `'in'`。
   *
   * e2e 的三段快照抓到的正是这个：`scrollY` 从 1871 回到 **0**（确实到顶了），
   * `shots` 的 `top` 是 **1975**（远在 900 的视口之下），状态却还是 `in`；
   * 而同一次里另一个元素收回了 —— 同一套条件、同一个位置，一个回一个不回，
   * 说明问题不在条件本身，在「分支压根没被执行」。
   *
   * 顺带一提：反方向的 out → in 不读矩形，所以只有回退坏掉、落版看起来一切正常。
   * 这与 `entry.boundingClientRect` 那个坑是**两个独立的毛病**（那个给的是离开前
   * 那一帧的位置），换成现读矩形只修掉了后者，前者依旧：通知根本没来。
   *
   * 所以回退改成**滚动驱动的重扫**。不管你是怎么到达新位置的（瞬时 `scrollTo`、
   * 平滑动画、滚轮、键盘、锚点），滚动帧一定会再来一次，最后停住的位置必被扫到。
   *
   * 与 `in` 方向的不对称是**故意留的滞回**：进来要走到收缩根之内才落版，
   * 出去要彻底离开真实视口才收回。中间那条宽带里无论怎么抖都不会切状态 ——
   * 这正是原设计要的「边界附近只有一个状态」，只不过现在它真的成立。
   *
   * 代价是滚动期间每帧 8 次 `getBoundingClientRect`（读在写之后，每帧一次强制布局）。
   * 这个量级可以忽略，换来的是回退行为完全确定、不依赖 IO 的通知语义。
   */
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  for (const el of targets) {
    // 初始态由服务端写好；万一没有（旧缓存 / 手工插入的标记）补一个确定的值，
    // e2e 要能读到，不靠「属性不存在」推断
    if (!el.dataset.rvState) el.dataset.rvState = 'out';
    observer.observe(el);
  }

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    observer.disconnect();
    for (const el of targets) delete el.dataset.rvState;
  };
}

/* ------------------------------------------------------------
   ②③④ 指针：墨条 / 卡片倾斜 / 画廊推移
   ------------------------------------------------------------ */

/** 一帧的待办：**只装坐标，不装算好的结果** —— 结果在帧里读，读出来的才是最新布局 */
interface Frame {
  /** 配图框：倾斜变量写在它身上，用**框内坐标**算 */
  tilt: HTMLElement | null;
  /** 标题块：细线变量写在它身上，用**块内坐标**算 */
  head: HTMLElement | null;
  /** 整张卡：聚光与位移的变量（`--gx` / `--gy`）写在它身上，用**卡内坐标**算 */
  card: HTMLElement | null;
  /** 墨条：目标行与它所在的列表容器 */
  row: HTMLElement | null;
  list: HTMLElement | null;
  x: number;
  y: number;
}

/**
 * 一个指针目标里「吃变量的盒子」。
 *
 * 卡片（`data-card`）**整张都算指针面**，但变量分散在卡里两个子元素上：配图框吃
 * `--mx` / `--my`、标题块吃 `--cx` —— 而且**各按自己的盒子算坐标**。这一条是必须的，
 * 不是讲究：
 *
 * · 倾斜的数学只有相对图框才对。改成相对整卡算，指针停在图上的那一刻图已经被拧了
 *   几度（副刊的图在左、头条的在右），落手就是「歪的」；
 * · 细线要画到指针所在处，就得知道指针在标题块里走到了哪。副刊的图占了卡片左侧
 *   一大截，用卡内比例算出来的线，位置和指针对不上。
 *
 * 画廊格（`data-lens`）没有这层结构，它自己就是那个盒子。
 */
const boxesOf = (el: HTMLElement) => {
  const isCard = el.matches('[data-card]');
  return {
    isCard,
    tilt: isCard ? el.querySelector<HTMLElement>('[data-tilt]') : el,
    head: isCard ? el.querySelector<HTMLElement>('[data-rule]') : null,
    /**
     * 整张卡自己。**只有卡片有这一层** —— 画廊格（`data-lens`）自己就是那个盒子，
     * 它的聚光直接用已有的 `--mx` / `--my`，不必再来一套坐标。
     *
     * 卡片为什么需要第三个坐标系：聚光（背景上的径向渐变）要跟着指针在**整张卡**
     * 上走、整卡的位移也要按它在卡里的位置算。而倾斜必须用配图框的坐标（副刊的图
     * 在左、头条的在右，用卡坐标算出来的倾斜落手就是歪的）——
     * 三者共用一套的话，总有两个是错的。
     */
    card: isCard ? el : null,
  };
};

function initPointer(): () => void {
  const root = document.querySelector<HTMLElement>('[data-motion-root]');
  if (!root) return () => {};

  let pending: Frame | null = null;
  let raf = 0;
  /** 当前亮着的目录行与它所在的列表 */
  let lit: HTMLElement | null = null;
  let litList: HTMLElement | null = null;
  /**
   * 指针当前所在的目标（卡片 / 画廊格）与它里面那两个吃变量的盒子。
   *
   * 缓存而不是每个事件现查：指针在卡里每走 1px 就重发一次 pointermove，每帧再
   * querySelector 两次没有意义；更要紧的是**归位时得知道往哪儿删变量**。
   */
  let hit: HTMLElement | null = null;
  let tilt: HTMLElement | null = null;
  let head: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  /**
   * 画廊「聚焦」的两个句柄：容器（吃 `data-focus`）与被压住的那一张（吃 `data-lit`）。
   *
   * 为什么要缓存而不是归位时现查：`release()` 可能因为指针离开整块内容区而被调用
   * （`pointerleave`），那一刻指针已经不在任何格子上了，`closest` 查不到东西。
   */
  let focusRoot: HTMLElement | null = null;
  let focusShot: HTMLElement | null = null;

  const clearVars = (el: HTMLElement) => {
    // 删掉而不是设成 0.5：CSS 那边 `var(--mx, .5)` 会兜回中位，
    // 于是「归位」与「进入」共用同一条过渡，不会跳一下
    el.style.removeProperty('--mx');
    el.style.removeProperty('--my');
  };

  const dim = () => {
    if (lit) delete lit.dataset.inkOn;
    if (litList) delete litList.dataset.inkOn;
    lit = null;
    litList = null;
  };

  /** 画廊聚焦归位：容器退回「三张一样亮」 */
  const unfocus = () => {
    if (focusRoot) delete focusRoot.dataset.focus;
    if (focusShot) delete focusShot.dataset.lit;
    focusRoot = null;
    focusShot = null;
  };

  /**
   * 归位：**整张卡作为一个单位**，不是「指针一离开配图就弹回中位」。
   *
   * 旧写法判的是配图框，于是指针从图挪到标题上（明明还在同一张卡里）就会把图撤回去 ——
   * 观感正是「只有角落里那张图能玩」。现在只有离开整张卡才收。
   */
  const release = () => {
    if (tilt) clearVars(tilt);
    if (head) head.style.removeProperty('--cx');
    if (card) {
      card.style.removeProperty('--gx');
      card.style.removeProperty('--gy');
    }
    unfocus();
    hit = null;
    tilt = null;
    head = null;
    card = null;
  };

  const flush = () => {
    raf = 0;
    const frame = pending;
    pending = null;
    if (!frame) return;
    diag.ticks += 1;

    // 先把这一帧要读的全读完，再统一写。中间夹一次写，后面那次读就会逼出同步布局。
    let mx = '';
    let my = '';
    if (frame.tilt) {
      const rect = frame.tilt.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // 为什么要夹：见 clamp01 上面那段 —— 指针面是整张卡，比值会跑出 0~1 很远
        mx = clamp01((frame.x - rect.left) / rect.width).toFixed(4);
        my = clamp01((frame.y - rect.top) / rect.height).toFixed(4);
      }
    }

    /**
     * 细线长度 = 指针在**标题块内部**的横向比例，同样夹到 0~1。
     * 不夹的话负比值会被 scaleX 把线**翻到左边** —— 画面上是标题左侧凭空多出一条线。
     * 指针停在配图上时正是这种情况（副刊的图在左、头条的在右）。
     */
    let cx = '';
    if (frame.head) {
      const rect = frame.head.getBoundingClientRect();
      if (rect.width > 0) cx = clamp01((frame.x - rect.left) / rect.width).toFixed(4);
    }

    /**
     * 聚光与整卡位移的位置 = 指针在**整张卡**里的比例，同样夹到 0~1。
     *
     * 这两个效果本来就是「整张卡被照亮、被推动」，所以必须用卡自己的坐标系；
     * 而且它们的前提是**卡没有配图也要有效果**（这一页三张卡里两张没配图），
     * 用配图框的坐标就正好把没图的那两张排除在外了。
     */
    let gx = '';
    let gy = '';
    if (frame.card) {
      const rect = frame.card.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        gx = clamp01((frame.x - rect.left) / rect.width).toFixed(4);
        gy = clamp01((frame.y - rect.top) / rect.height).toFixed(4);
      }
    }

    let inkX = '';
    let inkY = '';
    if (frame.row && frame.list) {
      const listRect = frame.list.getBoundingClientRect();
      const max = Math.max(0, frame.list.clientWidth - INK_WIDTH);
      const left = Math.min(Math.max(frame.x - listRect.left - INK_WIDTH / 2, 0), max);
      inkX = `${left.toFixed(1)}px`;
      // offsetTop 相对 offsetParent（.entries-wrap 是 position: relative）算，
      // 行本身静态定位，所以这个值天然含 li 的位置
      inkY = `${frame.row.offsetTop + frame.row.offsetHeight - 1}px`;
    }

    if (mx && frame.tilt) {
      frame.tilt.style.setProperty('--mx', mx);
      frame.tilt.style.setProperty('--my', my);
      diag.writes += 1;
    }

    if (cx && frame.head) {
      frame.head.style.setProperty('--cx', cx);
      diag.writes += 1;
    }

    if (gx && frame.card) {
      frame.card.style.setProperty('--gx', gx);
      frame.card.style.setProperty('--gy', gy);
      diag.writes += 1;
    }

    if (inkX && frame.row && frame.list) {
      frame.list.style.setProperty('--ink-x', inkX);
      frame.list.style.setProperty('--ink-y', inkY);
      diag.writes += 1;
    }
  };

  const onMove = (event: PointerEvent) => {
    // 触屏没有 hover，而手指拖动时指针会在页面上滑过 —— 不挡掉就会「滚动时卡片乱转」
    if (event.pointerType === 'touch') return;
    const target = event.target as Element | null;
    if (!target) return;

    const row = target.closest<HTMLElement>('[data-ink-row]');
    if (row) {
      const list = row.closest<HTMLElement>('[data-ink]');
      if (list) {
        if (lit !== row) {
          if (lit) delete lit.dataset.inkOn;
          row.dataset.inkOn = 'true';
          lit = row;
        }
        /**
         * 亮起的状态**同时写在容器上**：墨条是容器的子元素，这样 CSS 侧
         * `.entries-wrap[data-ink-on] .entries__ink` 就够了。用 `:has()` 也可以，
         * 但 Safari 15.0~15.3 没有它 —— 而本仓 vite 的 cssTarget 正是 safari15。
         */
        list.dataset.inkOn = 'true';
        litList = list;
        pending = { tilt: null, head: null, card: null, row, list, x: event.clientX, y: event.clientY };
      }
    } else {
      // 配图框在卡片**里面**，所以指针压在图上时 closest 给的也是整张卡 —— 一个入口，
      // 不必分别认「图」和「卡」
      const box = target.closest<HTMLElement>('[data-card], [data-lens]');
      if (box) {
        if (hit && hit !== box) release();
        if (!hit) {
          hit = box;
          const boxes = boxesOf(box);
          tilt = boxes.tilt;
          head = boxes.head;
          card = boxes.card;

          /**
           * 画廊聚焦：指针压住哪一张，**其余两张退到 0.6**。
           *
           * 状态写在容器上（`data-focus`）而不是让 CSS 用 `:hover` 自己判 ——
           * 网格有 0.9rem 的间隙，指针落进缝里时容器同样 `:hover`，而那时没有任何
           * `li` 是 `:hover`，`:not(:hover)` 会命中全部三张：整块画廊闪一下变暗再弹回。
           * 写在容器上就没有这个窗口。
           */
          if (box.matches('[data-lens]')) {
            const group = box.closest<HTMLElement>('[data-lens-group]');
            if (group) {
              group.dataset.focus = 'true';
              box.dataset.lit = 'true';
              focusRoot = group;
              focusShot = box;
            }
          }
        }
        // 卡里既没配图也没标题块（理论上不会有）：不排帧，免得空转
        if (tilt || head || card) {
          pending = { tilt, head, card, row: null, list: null, x: event.clientX, y: event.clientY };
        }
      }
    }

    if (pending && !raf) raf = requestAnimationFrame(flush);
  };

  /** 归位。必须判 relatedTarget 是否还在**同一个目标里**，否则子节点之间移动也会被当成离开 */
  const onOut = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (!target) return;
    const related = event.relatedTarget as Node | null;
    /** related 还留在这个元素里就不算离开 —— pointerout 在子节点之间移动时也会冒出来 */
    const stayedIn = (el: Element) => Boolean(related && el.contains(related));

    const row = target.closest<HTMLElement>('[data-ink-row]');
    if (row && lit === row && !stayedIn(row)) dim();

    /**
     * 判据是「离开**整张卡**」。旧写法判的是配图框：指针从图挪到标题上（明明还在
     * 卡里）图就先弹回中位 —— 那正是「只有配图能玩」的观感。
     */
    const box = target.closest<HTMLElement>('[data-card], [data-lens]');
    if (box && box === hit && !stayedIn(box)) release();
  };

  /** 指针直接离开内容区（或切走标签页）时的兜底 */
  const onLeave = () => {
    dim();
    release();
  };

  /**
   * 按下就把变量清掉。
   *
   * 因为倾斜与推移都会给元素留下 transform，而点下去往往紧接着一次站内跳转 ——
   * 跨页共享元素会**把此刻的渲染当快照抓走**，带着 1.13 的缩放和偏移飞出去，
   * 落点却是张没被放大的图，起始帧就对不上。清掉之后快照是中性姿态。
   * 细线那根变量（--cx）也要一起清：它同样是被 pointermove 写在节点上的，
   * 页面切换不会让它自己消失。
   */
  const onPress = (event: Event) => {
    const box = (event.target as Element | null)?.closest<HTMLElement>('[data-card], [data-lens]');
    if (!box) return;
    const boxes = boxesOf(box);
    if (boxes.tilt) clearVars(boxes.tilt);
    if (boxes.head) boxes.head.style.removeProperty('--cx');
    if (boxes.card) {
      boxes.card.style.removeProperty('--gx');
      boxes.card.style.removeProperty('--gy');
    }
  };

  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('pointerleave', onLeave);
  // 捕获阶段：免得中间有人 stopPropagation 就漏掉
  root.addEventListener('pointerdown', onPress, true);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pending = null;
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerout', onOut);
    root.removeEventListener('pointerleave', onLeave);
    root.removeEventListener('pointerdown', onPress, true);
    onLeave();
    for (const el of root.querySelectorAll<HTMLElement>('[data-ink]')) {
      el.style.removeProperty('--ink-x');
      el.style.removeProperty('--ink-y');
    }
  };
}

/* ------------------------------------------------------------
   装配
   ------------------------------------------------------------ */

const setup = () => {
  // 本仓被「首屏脚本 + astro:page-load 跑两遍」坑过多次（搜索按钮、宠物、首屏视差），
  // 这里同样先撤上一份再挂，保证任何时刻只有一套。
  const win = window as MotionWindow;
  if (typeof win.__homeMotionCleanup === 'function') win.__homeMotionCleanup();
  win.__homeMotionCleanup = null;

  const targets = document.querySelectorAll<HTMLElement>('[data-rv]');

  /**
   * 关掉动画偏好 / 省流：不绑任何监听，页面就是现在这张静止版面。
   *
   * **但必须主动把它们推成 `'in'`**：初始态是服务端写的 `'out'`（这样首帧之前就是
   * 收着的、不会「先看见再消失」）。reduced-motion 在 CSS 里有兜底，**省流没有** ——
   * 不推的话，这批设备上内容会永远不露。
   */
  const settle = () => {
    for (const el of targets) el.dataset.rvState = 'in';
  };

  if (reduceMotion() || shouldTrim()) {
    settle();
    return;
  }

  const root = document.querySelector<HTMLElement>('[data-motion-root]');
  if (!root) {
    settle();
    return;
  }

  diag.binds += 1;
  const stopReveal = initReveal();
  const stopPointer = initPointer();

  win.__homeMotionCleanup = () => {
    stopPointer();
    stopReveal();
    diag.unbinds += 1;
  };
};

setup();
document.addEventListener('astro:page-load', setup);

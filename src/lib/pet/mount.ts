import { findCharacter, live2dModelUrl, pet } from '../../data/pet';
import type { Locale } from '../../i18n/ui';
import {
  ask,
  clip,
  detachDocLinks,
  normalizeEndpoint,
  probe,
  readSetting,
  SECRET,
  writeSetting,
  type ChatLink,
  type SiteDoc,
  type Turn,
} from './chat';
import { initLive2D } from './live2d';
import { banterLine, moodLabel, pickLine, sourceLabel, type LineKind } from './lines';
import { createOrchestrator, type Orchestrator, type StageFace } from './orchestrator';
import { createRenderer, type RendererHandle } from './stage-iframe';
import {
  addAffection,
  affection,
  clearOnceFlag,
  isChipsHidden,
  isHidden,
  isLive2DEnabled,
  lead,
  onceFlag,
  position,
  roster,
  setChipsHidden,
  setCompanion,
  setHidden,
  setLead,
  setLive2DEnabled,
  setPosition,
} from './state';

/**
 * 宠物的客户端运行时。三个工厂函数对应三层职责：
 *
 * | 函数 | 作用域 | 内容 |
 * |---|---|---|
 * | `createStage` | **每只一个** | 气泡、拖拽、点/喂、外观层、它自己的对话历史 |
 * | `bindPanel` | **全局一份** | 设置面板（成员 / 外观 / API 配置）+ 三条全局监听 |
 * | `createOrchestrator` | **全局一份** | 谁在什么时候跟谁说（见 orchestrator.ts） |
 *
 * **面板为什么不算「舞台的一部分」**：它配置的是整个宠物系统 —— 哪几只在、
 * 用不用模型、气泡关不关，没有一条属于某一只有。齿轮按钮留在**主角**身上：
 * 同伴是来访的，不带设置入口。
 *
 * 六条必须记住的约束：
 *
 * 1. **事件只绑一次，文案每次都刷。** 容器带 transition:persist，站内跳转时它
 *    连同监听一起被搬到新文档里，dataset.petReady 还在 —— 所以再调 initPet 时
 *    只重读页面上的 JSON（语言可能换了）并刷新文案，不重新绑事件。
 *    若哪天把 persist 去掉，dataset 会随新节点消失，自然就退回「每次重绑」，
 *    两条路都能跑。
 *
 * 2. **模型输出永远走 textContent。** 气泡里的字是外部内容，
 *    一律 createElement + textContent 拼，绝不碰 innerHTML。
 *
 * 3. **拖拽换算依赖固定尺寸的锚点盒。** 见 pet.css 里 .pet 的 width/height。
 *    外观切换会换尺寸（5.5×6.5rem ↔ 12×18rem），所以切完必须 relayout()，
 *    否则拖拽会拿着旧基准算，宠物一动就跳。
 *
 * 4. **事件绑在 stage 上，不绑在精灵按钮上。** Live2D 上来之后画布会盖住
 *    精灵，绑在精灵上就会漏掉点击。绑在共同父节点上，两种外观走同一条路径。
 *
 * 5. **每只自建自毁。** 同伴的舞台是**克隆主角那份**来的，送走时连元素带监听
 *    一起销毁（所有 addEventListener 都挂在同一个 AbortController 上）。
 *    上次「关掉气泡就再也找不到开关」的教训在这里的等价物是：克隆必须把
 *    设置入口（齿轮）和面板摘掉，否则会出现第二份没人管的设置界面。
 *
 * 6. **主角走同页画布，只有同伴走 iframe。** 运行时是模块级单例（详见
 *    stage-iframe.ts 的注释），所以第二只必须有自己的浏览上下文；
 *    而主角留在原路径上，**不召唤同伴的访客一切与今天完全一致** ——
 *    没有 iframe、没有 postMessage、没有指针转发。
 */

interface Runtime {
  locale: Locale;
  docs: SiteDoc[];
  /** UI 文案。由 Pet.astro 与服务端渲染共用同一份，避免两处对不上 */
  strings: Record<string, string>;
  /**
   * 角色按钮的显示名。**必须放进这段 JSON，不能只写死在 HTML 里** ——
   * 宠物带 transition:persist，切语言时服务端那段 HTML 不会被重渲染，
   * 只有这里是重新读的（和 strings 同一个道理）。
   */
  cast?: { id: string; name: string }[];
}

const HISTORY_MAX = 12;
/** 气泡/对话框向上展开，锚点在下方：给它们留出的垂直余量 */
const DOCK_ROOM = 380;
/** 资源预热完到淡入之间再空一小会儿，盖住运行时解析 moc 的那点时间 */
const REVEAL_DELAY_MS = 450;
/** 服务端渲染的那一份就是主角；同伴由它克隆出来 */
const LEAD_SELECTOR = '.pet[data-pet-role="lead"]';

let runtime: Runtime | null = null;
let app: App | null = null;

function el<T extends HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

function loc(): Locale {
  return runtime?.locale ?? 'zh';
}

function label(key: string): string {
  return runtime?.strings[key] ?? '';
}

function siteDocs(): readonly SiteDoc[] {
  return runtime?.docs ?? [];
}

/** 角色的显示名。走构建期烤进来的 cast 表，查不到再回落到数据层 */
function displayName(id: string): string {
  const hit = runtime?.cast?.find((item) => item.id === id);
  if (hit) return hit.name;
  const who = findCharacter(id);
  return loc() === 'zh' ? who.name : who.nameEn;
}

/** 数值夹取；当范围本身为空（窄屏）时退到上界，至少不飞出视口 */
function clampValue(min: number, max: number, value: number): number {
  if (max < min) return max;
  return Math.min(max, Math.max(min, value));
}

/**
 * 重算层上的 `has-l2d`。**唯一用途**是决定同伴的默认泊位按哪一档宽度算，
 * 所以它在「有一只刚上/下了 Live2D」和「有一只被送走」这两处都要调。
 */
function markLayerMode(layer: HTMLElement | null): void {
  if (!layer) return;
  layer.classList.toggle('has-l2d', layer.querySelector('.pet--l2d') !== null);
}

/** 构建期由 Pet.astro 写进页面的站内目录与文案 */
function readRuntime(): Runtime | null {
  const node = document.getElementById('pet-index');
  if (!node?.textContent) return null;
  try {
    const parsed = JSON.parse(node.textContent) as Runtime;
    if (!Array.isArray(parsed.docs)) return null;
    if (!parsed.strings) parsed.strings = {};
    return parsed;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 入口

interface App {
  /** persist 之后每次换页都调：语言可能换了，文案得跟上 */
  refresh(): void;
}

export function initPet(): void {
  const layer = document.getElementById('pet-root');
  if (!layer) return;

  // 每页都重读：切了语言要立刻跟上（宠物本身被 persist 保住，不会重新渲染）
  const fresh = readRuntime();
  if (!fresh) return;
  runtime = fresh;

  if (layer.dataset.petReady !== '1') {
    layer.dataset.petReady = '1';
    app = boot(layer);
  }
  app?.refresh();
}

function boot(layer: HTMLElement): App {
  const stages = new Map<string, StageHandle>();
  /** 这只身上的监听全挂在它上面，送走时一次摘干净 */
  const ac = new AbortController();

  const orchestrator: Orchestrator = createOrchestrator(() => Array.from(stages.values()), {
    locale: loc,
  });

  // 面板与舞台互相依赖（面板里点「同伴」要能动舞台，舞台上的齿轮要能开面板），
  // 所以先把面板建起来 —— syncRoster 是函数声明，hoist 之后在这里引用是安全的
  const panel = bindPanel(layer, {
    stages,
    signal: ac.signal,
    onCompanionChange: () => syncRoster(true),
    onInteract: () => orchestrator.onInteract(),
    onRestore: () => syncRoster(false),
  });

  /** 让在场的舞台与状态对齐：多退少补 */
  function syncRoster(announce: boolean): void {
    const want = roster();

    // 先送走不在名单里的。destroy() 会摘监听、销毁外观层、把元素移出文档
    for (const [id, stage] of Array.from(stages)) {
      if (want.includes(id)) continue;
      stages.delete(id);
      stage.destroy();
    }

    const arrived: StageHandle[] = [];
    for (const id of want) {
      if (stages.has(id)) continue;
      const isLead = id === lead();
      const host = isLead ? el<HTMLElement>(layer, LEAD_SELECTOR) : cloneCompanion(layer, id);
      if (!host) continue;

      const stage = createStage(host, id, {
        // 主角走同页画布（沿用已验过的路），同伴走 iframe（运行时是单例）
        mode: isLead ? 'canvas' : 'iframe',
        // 刚被召唤来的由编排器说「arrive」，自己不再说「greet」—— 否则连说两句
        arriving: announce && !isLead,
        // 两只同时在场时把问候错开，别让两条气泡同一毫秒冒出来
        greetDelay: 1400 + stages.size * 1600,
        onInteract: () => orchestrator.onInteract(),
        onPoke: (line) => {
          const self = stages.get(id);
          if (self) orchestrator.onPoke(self, line);
        },
        onAnswered: (question, answer) => {
          const self = stages.get(id);
          if (self) orchestrator.onAsk(self, question, answer);
        },
        onGear: () => {
          for (const item of stages.values()) item.putAway();
          panel.open();
        },
      });
      if (!stage) continue;
      stages.set(id, stage);
      if (announce && !isLead) arrived.push(stage);
    }

    for (const stage of arrived) orchestrator.onArrive(stage);
    panel.applyGroupState();
  }

  // -------------------------------------------------------------- 全局监听

  /**
   * 眼神跟随。主页面**只监听一次**，再按每只各自的坐标系转发：
   *   - 主角什么都不用做 —— 运行时本来就在监听它自己的 window
   *   - 同伴在 iframe 里，那份运行时监听的是**它的** window，得我们把坐标喂进去
   * rAF 节流是必要的：pointermove 一帧能来好几条，而 iframe 那边只需要最新那个。
   */
  let frame = 0;
  let px = 0;
  let py = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      px = e.clientX;
      py = e.clientY;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        for (const stage of stages.values()) stage.pointer(px, py);
      });
    },
    { passive: true, signal: ac.signal }
  );

  // 窗口尺寸变了：每个舞台的拖拽基准都要重算，否则下一次拖动会拿着旧尺寸换算
  window.addEventListener(
    'resize',
    () => {
      for (const stage of stages.values()) stage.relayout();
    },
    { signal: ac.signal }
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      if (panel.isOpen()) {
        panel.close();
        return;
      }
      for (const stage of stages.values()) if (stage.closeTransient()) return;
    },
    { signal: ac.signal }
  );

  // 点空白处收掉设置与对话框。宠物被 persist，这两条全局监听只会挂一次
  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as Node;
      if (panel.isOpen() && !panel.contains(target)) panel.close();
      for (const stage of stages.values()) stage.closeOutside(target);
    },
    { signal: ac.signal }
  );

  syncRoster(false);

  return {
    refresh(): void {
      panel.refreshLabels();
      for (const stage of stages.values()) stage.refreshLabels();
      panel.applyGroupState();
    },
  };
}

// ------------------------------------------------------------- 同伴的克隆

/**
 * 同伴的舞台是主角那份**克隆**出来的。
 *
 * 为什么用克隆而不是在 JS 里手搭一份：那份 DOM 有 200 多行（内联 SVG 精灵、
 * 气泡、对话框、芯片行），手搭等于把同一份结构写两遍，改一处必然漏一处。
 * 克隆保证两只长得一模一样。
 *
 * 代价是**必须把不该复制的部分摘掉**：齿轮（设置入口）、面板、画布 id、
 * 以及服务端那份可能带着的运行时痕迹（状态类、内联 transform、气泡内容）。
 */
function cloneCompanion(layer: HTMLElement, id: string): HTMLElement | null {
  const template = el<HTMLElement>(layer, LEAD_SELECTOR);
  if (!template) return null;
  const clone = template.cloneNode(true) as HTMLElement;

  clone.dataset.petRole = 'companion';
  clone.dataset.petId = id;

  // 齿轮是设置面板唯一的入口，只留主角那一份（同伴是来访的，不带设置）
  clone.querySelector('[data-pet-gear]')?.remove();
  // 面板挂在主角身上，克隆里绝不能出现第二份
  clone.querySelector('[data-pet-panel]')?.remove();
  // 外观层要按**类名**摘，不能用 data 属性 —— 这两层是运行时创建的，
  // 身上没有 data-pet-canvas（这里曾经写成 [data-pet-canvas]，于是主角的画布
  // 每次都被一起克隆过去：同伴里多一个空画布，而且 id 与主角**重复**。
  // 之所以是灾难：运行时是按 getElementById 找画布的。这是 e2e 抓出来的）。
  clone.querySelector('.pet__canvas')?.remove();
  clone.querySelector('.pet__frame')?.remove();

  // 服务端那份可能已经带上了运行时留下的痕迹，全部回到初始态
  clone.classList.remove('pet--l2d', 'pet--sleep', 'is-bump');
  clone.removeAttribute('style');

  const bubble = el<HTMLElement>(clone, '[data-pet-bubble]');
  if (bubble) bubble.hidden = true;
  const body = el<HTMLElement>(clone, '[data-pet-bubble-body]');
  if (body) body.textContent = '';
  const form = el<HTMLFormElement>(clone, '[data-pet-form]');
  if (form) form.hidden = true;
  const input = el<HTMLInputElement>(clone, '[data-pet-input]');
  if (input) input.value = '';

  layer.appendChild(clone);
  return clone;
}

// ----------------------------------------------------------------- 舞台

export interface StageHandle extends StageFace {
  readonly el: HTMLElement;
  /** 换页 / 换语言时刷新这只身上的文案与无障碍标签 */
  refreshLabels(): void;
  /** 拖拽基准重算（换外观层、窗口尺寸变化），并把落盘的位移重新贴上去 */
  relayout(): void;
  /** 把指针位置喂给这只的渲染器（同页那只不需要，见 boot 里的注释） */
  pointer(clientX: number, clientY: number): void;
  /** 把**已经就绪**的外观层换上来 / 换下去。**不触发加载** —— 加载时机单独管 */
  setAppearance(on: boolean): void;
  /** 现在就去加载外观层（访客刚拨开开关 / 刚从藏起来的状态叫回来） */
  ensureAppearance(): void;
  /** 收掉临时浮层：先对话框，再气泡 */
  closeTransient(): boolean;
  /** 点空白处：关掉这只的对话框（气泡留着，它有自己的倒计时） */
  closeOutside(target: Node): void;
  /** 整组被藏起来时把这只收拾干净：气泡、对话框一起收 */
  putAway(): void;
  destroy(): void;
}

interface StageOptions {
  /** 主角走同页画布，同伴走 iframe */
  mode: 'canvas' | 'iframe';
  /** 刚被召唤来的：由编排器说「arrive」，这里不再说「greet」 */
  arriving: boolean;
  /**
   * 第一句问候往后推多久。两只同时登场时要用它**错开** ——
   * 不然两条问候同一毫秒冒出来，看起来像坏了
   */
  greetDelay: number;
  onInteract(): void;
  onPoke(line: string): void;
  onAnswered(question: string, answer: string): void;
  onGear?(): void;
}

/** 气泡里一次渲染要带的东西 */
interface RenderOptions {
  links?: readonly ChatLink[];
  detail?: string;
  source?: 'local' | 'llm';
  hold?: number;
  /**
   * 「这条要读完」—— 访客提问产生的回答才带它。
   * 带它的气泡会让同伴的即兴评论**排队等**：答案被一句吐槽顶掉是不可接受的。
   * 短句（问候 / 吐槽 / 戳一下）不带，所以两只的短句可以并排出现 ——
   * 对话的节奏感靠的就是这个，一条一句地等会显得很迟钝。
   */
  mustRead?: boolean;
}

function createStage(host: HTMLElement, id: string, options: StageOptions): StageHandle | null {
  const stage = el<HTMLElement>(host, '[data-pet-stage]');
  const sprite = el<HTMLButtonElement>(host, '[data-pet-sprite]');
  const bubble = el<HTMLElement>(host, '[data-pet-bubble]');
  const bubbleBody = el<HTMLElement>(host, '[data-pet-bubble-body]');
  const dismiss = el<HTMLButtonElement>(host, '[data-pet-dismiss]');
  const askForm = el<HTMLFormElement>(host, '[data-pet-form]');
  const input = el<HTMLInputElement>(host, '[data-pet-input]');
  const gear = el<HTMLButtonElement>(host, '[data-pet-gear]');

  if (!stage || !sprite || !bubble || !bubbleBody || !dismiss || !askForm || !input) return null;

  // 这只身上的监听全挂一起，送走时一次摘干净
  const ac = new AbortController();
  const signal = ac.signal;

  host.dataset.petId = id;

  /** 这只已经被送走了（同伴会被销毁）。销毁后一律不再开口、不再刷新文案 */
  let gone = false;

  // ------------------------------------------------------------ 拖拽范围基准

  let anchor = { left: 0, top: 0, width: 0, height: 0 };
  /** 气泡那一列需要的水平空间，由 refreshDock() 量出来（见下），不硬编码 */
  let dock = 256;

  /**
   * 锚点盒是固定尺寸的，气泡与对话框绝对定位挂在它上方，
   * 所以「量一次未位移时的位置」就是稳定基准。量的时候先把 transform 摘掉。
   */
  function measureAnchor(): void {
    const previous = host.style.transform;
    host.style.transform = 'none';
    const box = host.getBoundingClientRect();
    anchor = { left: box.left, top: box.top, width: box.width, height: box.height };
    host.style.transform = previous;
    refreshDock();
  }

  /**
   * 气泡向左展开所需的水平空间。**跟着 CSS 走，不硬编码**。
   *
   * 为什么非量不可：窄屏的媒体查询把 `.pet__chips` 的 max-width 从 15rem 收到 12rem，
   * 若这里仍按 256 估就会多要 64px —— 而对一只本来就靠左的同伴来说，那 64px
   * 直接变成「把它往右推」，推到与主角重叠（窄屏 375px 实测重叠 64px，e2e 抓出来的）。
   *
   * max-width 即使元素被 [hidden] 也照常参与计算，所以这里读得到。
   */
  function refreshDock(): void {
    const chips = host.querySelector('[data-pet-chips]');
    const measured = chips ? Number.parseFloat(getComputedStyle(chips).maxWidth) : Number.NaN;
    const want = Number.isFinite(measured) && measured > 0 ? measured : 256;
    dock = Math.min(want, window.innerWidth - 32);
  }

  function clampOffset(x: number, y: number): { x: number; y: number } {
    // 让气泡完整可见所需的最小位移
    const forDock = 8 + dock - anchor.width - anchor.left;
    // 宠物自身不出视口左边界所需的最小位移
    const stayInView = 8 - anchor.left;
    return {
      // 下限取**更宽松**的那个：多只同时在场时，泊位稳定优先于气泡完整。
      // 反之（现在的写法）气泡一塞不下就会把靠左的那只往右推，直接撞上旁边的同伴。
      x: clampValue(
        Math.min(forDock, stayInView),
        window.innerWidth - 8 - anchor.width - anchor.left,
        x
      ),
      y: clampValue(8 + DOCK_ROOM - anchor.height - anchor.top, window.innerHeight - 8 - anchor.height - anchor.top, y),
    };
  }

  function place(x: number, y: number): { x: number; y: number } {
    const next = clampOffset(x, y);
    host.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
    return next;
  }

  /** 把落盘的位移贴上去。两只各自独立，互相不带动 */
  function applyPosition(): void {
    const saved = position(id);
    place(saved.x, saved.y);
  }

  function relayout(): void {
    measureAnchor();
    applyPosition();
  }

  // ---------------------------------------------------------------- 气泡

  /** 流式生成中的那一行，由 startLive / pushLive 维护；收气泡时要一起清掉 */
  let liveLine: HTMLElement | null = null;

  /** 气泡自动收起的计时器。**每只一套** —— 存在模块级就会两只互相打断 */
  let bubbleTimer = 0;

  /**
   * 现在这条气泡是「要读完」的那种（访客提问的回答）。
   * 同伴的评论会等它收起来，见 whenBubbleFree()。
   */
  let reading = false;
  let readWaiters: (() => void)[] = [];

  function releaseReaders(): void {
    const waiting = readWaiters;
    readWaiters = [];
    for (const done of waiting) done();
  }

  function hideBubble(): void {
    window.clearTimeout(bubbleTimer);
    liveLine = null;
    bubble!.hidden = true;
    reading = false;
    releaseReaders();
  }

  /**
   * 这只身上那条「要读完」的气泡收起来了吗。短句不等（立刻兑现）。
   *
   * 为什么要这一条：气泡是**逐条轮转**的（规格 §4.5），而两条长回答并排
   * 一定会互相压到（SVG 那一档尤其明显）。但短句不拦 —— 一来它俩宽度小、
   * 通常根本不碰，二来让「你一句我一句」的吐槽等 13 秒收气泡，那就不是对话了。
   *
   * 兜底超时是必须的：气泡万一卡住不放，不能把编排器一直挂在这儿。
   */
  function whenBubbleFree(): Promise<void> {
    if (bubble!.hidden || !reading) return Promise.resolve();
    return new Promise<void>((resolve) => {
      readWaiters.push(resolve);
      window.setTimeout(resolve, pet.idleAfterMs);
    });
  }

  /**
   * 该停留多久。**跟着字数走** —— 答案从 90 字放到 240 字之后，
   * 固定 12 秒就成了新的「信息来不及看」：还没读完，气泡自己收起来了。
   * 上限 45 秒，免得它赖着不走。
   */
  function holdFor(text: string): number {
    return Math.min(45_000, 12_000 + text.length * 120);
  }

  function armBubble(ms: number): void {
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(hideBubble, ms);
  }

  function render(text: string, opts: RenderOptions = {}): void {
    window.clearTimeout(bubbleTimer);
    // 只清内容层。关闭按钮在外层，长答案滚动时它不会跟着跑掉
    bubbleBody!.textContent = '';

    const line = document.createElement('span');
    line.textContent = text;
    bubbleBody!.appendChild(line);

    // 站内链接一条一行，**每条都能点**：模型引用了几篇就排几行。
    // 之前只支持一条，于是它列的三篇文章里只有一篇是可点的。
    for (const item of opts.links ?? []) {
      const link = document.createElement('a');
      link.className = 'pet__link';
      link.href = item.url;
      link.textContent = `→ ${item.label}`;
      bubbleBody!.appendChild(link);
    }

    // 只有填了 Key 的人才会看到技术提示 —— 那是他自己配的东西，得让他能修
    if (opts.detail) {
      const detail = document.createElement('span');
      detail.className = 'pet__detail';
      detail.textContent = opts.detail;
      bubbleBody!.appendChild(detail);
    }

    // 这句是谁给的：标在气泡角上，免得把兜底台词当成模型输出
    if (opts.source) {
      const source = document.createElement('span');
      source.className = 'pet__detail';
      source.textContent = `${label('source')} ${sourceLabel(opts.source, loc())}`;
      bubbleBody!.appendChild(source);
    }

    bubble!.hidden = false;
    // 内容整茬换掉了，滚动位置也必须回到顶部，否则新答案会停在上一次的底部
    bubbleBody!.scrollTop = 0;
    // 这一条要不要「读完才轮到别人」，见 RenderOptions.mustRead
    reading = opts.mustRead === true;
    armBubble(opts.hold ?? holdFor(text));
  }

  /** 从自己的台词库里取一句说出来。返回说了什么；空串 = 台词库没给东西 */
  function say(kind: LineKind, opts: RenderOptions = {}): string {
    const text = pickLine(kind, loc(), id);
    if (text) render(text, opts);
    return text;
  }

  /** 直接显示一段给定的文本（编排器自己挑好的对撞句） */
  function show(text: string, hold?: number): boolean {
    if (gone || !text || isHidden()) return false;
    render(text, hold ? { hold } : {});
    return true;
  }

  // 指针停在气泡上、或键盘焦点落在里面时就暂停倒计时。
  // 气泡现在可以滚，鼠标一走开就自动收起的话，长答案根本读不完。
  let holdPaused = false;
  const pauseHold = (): void => {
    holdPaused = true;
    window.clearTimeout(bubbleTimer);
  };
  const resumeHold = (): void => {
    if (!holdPaused) return;
    holdPaused = false;
    if (!bubble.hidden) armBubble(4000);
  };
  bubble.addEventListener('pointerenter', pauseHold, { signal });
  bubble.addEventListener('pointerleave', resumeHold, { signal });
  bubble.addEventListener('focusin', pauseHold, { signal });
  bubble.addEventListener(
    'focusout',
    (e) => {
      // 焦点只是在气泡内部挪动（正文 → 链接 → 关闭按钮）就不算离开
      const next = e.relatedTarget as Node | null;
      if (!next || !bubble.contains(next)) resumeHold();
    },
    { signal }
  );

  // ---------------------------------------------------------------- 状态显示

  /** 好感度只出现在那枚小气泡里，心情压在它的 title 上，不占地方 */
  function paint(): void {
    const fav = Math.round(affection(id));
    const favNode = el<HTMLElement>(host, '[data-pet-affection]');
    if (favNode) favNode.textContent = String(fav);
    const stat = el<HTMLElement>(host, '[data-pet-stat]');
    if (stat) stat.title = `${label('affection')} ${fav} · ${moodLabel(fav, loc())}`;
  }

  // ------------------------------------------------------------ 睡着与醒着

  /**
   * 空闲说话的时机由编排器统一管（两只的时候那是「一轮对撞」），
   * 舞台这边只管**睡**：太久没人理就放慢浮动、头顶冒 z。
   */
  let sleepTimer = 0;

  function sleep(): void {
    host.classList.add('pet--sleep');
    if (!isHidden()) render(pickLine('sleep', loc(), id), { hold: 6000 });
  }

  /** 有人跟它互动了：把睡意往后推。睡着之后就不再回应编排器了（available 返回 false） */
  function touch(): void {
    host.classList.remove('pet--sleep');
    window.clearTimeout(sleepTimer);
    sleepTimer = window.setTimeout(sleep, pet.sleepAfterMs);
  }

  // ---------------------------------------------------------------- 互动

  /** 弹一下：先摘 class 再强制重排，否则连点第二次不会重新播动画 */
  function bump(): void {
    stage!.classList.remove('is-bump');
    void stage!.offsetWidth;
    stage!.classList.add('is-bump');
  }

  function poke(): void {
    addAffection(1, id);
    paint();
    const line = say('poke');
    bump();
    touch();
    options.onInteract();
    // 同伴的吐槽靠这句「它刚说了什么」接话
    if (line) options.onPoke(line);
  }

  function feed(): void {
    addAffection(6, id);
    paint();
    const line = say('feed');
    bump();
    touch();
    options.onInteract();
    if (line) options.onPoke(line);
  }

  // ---------------------------------------------------------------- 提问

  /** 这只自己的对话历史。两只各记各的，人格才不会串 */
  let history: Turn[] = [];
  let lastAsk = 0;
  let answering = false;

  /**
   * 流式：模型按分片回来，气泡得跟着长。
   *
   * 只换那一行的文字，不重建整个气泡 —— 重建会闪，也会把链接条、
   * 来源标注、关闭按钮重复插一遍。
   */
  function startLive(): void {
    window.clearTimeout(bubbleTimer);
    bubbleBody!.textContent = '';
    liveLine = document.createElement('span');
    bubbleBody!.appendChild(liveLine);
    bubble!.hidden = false;
  }

  function pushLive(partial: string): void {
    if (!liveLine) startLive();
    // 走和最终渲染同一套「摘链接 → 收口」：流式途中若把 URL 原样显示出来，
    // 答完它们又会整段消失，看起来像答案在往回缩
    liveLine!.textContent = clip(detachDocLinks(partial, siteDocs()).text);
  }

  /** 回答访客。返回答案文本；`null` = 这回没答（在忙 / 间隔太短 / 空输入） */
  async function answer(question: string): Promise<string | null> {
    const text = question.trim();
    if (answering || Date.now() - lastAsk < pet.minAskIntervalMs) return null;
    if (!text) {
      say('empty', { hold: 4000 });
      return null;
    }

    answering = true;
    lastAsk = Date.now();
    addAffection(2, id);
    paint();
    // 停很久再换掉：hold 太短的话，模型还在想气泡就先自己消失了，随后又冒出来，闪一下
    say('thinking', { hold: 30_000 });
    touch();

    try {
      const reply = await ask(text, {
        locale: loc(),
        character: id,
        docs: siteDocs(),
        history,
        // 分片一到就往上贴：「让我想想…」直接过渡成正在生成的句子
        onDelta: pushLive,
      });

      // 兜底台词**不进历史**。否则下一轮模型会看到自己上一句是「外面出问题了」，
      // 越聊越偏；历史只记真实产出。
      if (reply.source === 'llm') {
        const turns: Turn[] = [
          { role: 'user', content: text },
          { role: 'assistant', content: reply.text },
        ];
        history = [...history, ...turns].slice(-HISTORY_MAX);
      }

      liveLine = null;
      // 不传 hold：交给 holdFor 按字数算，长答案才来得及读完
      // mustRead：同伴的吐槽要等这条读完（否则答案会被顶掉）
      render(reply.text, {
        links: reply.links,
        detail: reply.detail,
        source: reply.source,
        mustRead: true,
      });
      paint();
      // 报错不通知编排器 —— 让同伴去评价一句「外面出问题了」是荒唐的
      if (!reply.detail) options.onAnswered(text, reply.text);
      return reply.text;
    } finally {
      answering = false;
    }
  }

  /**
   * 接着 `prev` 那句说。这是「两只真聊起来」的全部机制：
   *
   *   - **没配 Key** → 直接查对撞表。零延迟、零成本、完全可预测
   *   - **配了 Key** → 把上一句当话头交给模型接力；失败**静默**退回对撞表
   *     （这一轮不是访客发起的，页面上不该冒出报错）
   *
   * 对撞的这几句**不进历史**：历史是「访客和这只聊过什么」的记录，
   * 把同伴的话塞成 user 角色会让模型以为那是访客说的。
   */
  async function replyTo(prev: { id: string; name: string; line: string }): Promise<string | null> {
    if (!available()) return null;
    const fallback = banterLine(id, prev.id, loc());

    if (!readSetting(SECRET.key)) {
      return fallback && show(fallback) ? fallback : null;
    }

    const reply = await ask(prev.line, {
      locale: loc(),
      character: id,
      docs: siteDocs(),
      history,
      context: { speaker: prev.name, line: prev.line },
      onDelta: pushLive,
    });
    liveLine = null;

    if (reply.source !== 'llm') {
      return fallback && show(fallback) ? fallback : null;
    }
    render(reply.text, { links: reply.links, source: reply.source });
    return reply.text;
  }

  // ---------------------------------------------------------------- 对话框

  /** 点宠物唯一的动作：开/关对话框。别的不弹 */
  function toggleAsk(open?: boolean): void {
    // hidden 在新版 DOM 类型里是 boolean | 'until-found'，这里收敛成 boolean
    const next = open ?? askForm!.hidden === true;
    askForm!.hidden = !next;
    if (next) {
      touch();
      window.setTimeout(() => input!.focus(), 60);
    }
  }

  // ---------------------------------------------------------------- 外观层
  //
  // Live2D 约 3.4 MB，绝不上首屏关键路径：等 window.load 之后再让出一次空闲。
  // 这条链上任何一环失败（访客关掉 / 系统减少动效 / 弱网 / 没 WebGL / 资源缺失）
  // 都安静地停在 SVG 上，不弹任何错误 —— SVG 是完整形态，不是占位图。
  //
  // **两只各自独立降级**：一只退回 SVG 不影响另一只（规格 §7）。

  let renderer: RendererHandle | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let live2dReady = false;
  let live2dBooting = false;
  /** 画布 / iframe 现在是不是真的露在外面（和「已加载」是两件事） */
  let l2dShown = false;

  /**
   * 层上那个 `has-l2d` 标记的意义只有一个：**同伴的默认泊位要按哪一档宽度算**。
   * 两只一起缩放、一起让位，参考宽度必须是「这一档里那只宽的」，
   * 否则一只 12rem、一只 5.5rem 的时候会叠在一起。见 pet.css 的 --pet-ref-w。
   */
  function syncLayerMode(): void {
    markLayerMode(host.parentElement);
  }

  function useLive2D(): void {
    if (l2dShown) return;
    host.classList.add('pet--l2d');
    l2dShown = true;
    syncLayerMode();
    relayout();
  }

  function useSprite(): void {
    if (!l2dShown) return;
    host.classList.remove('pet--l2d');
    l2dShown = false;
    syncLayerMode();
    relayout();
  }

  async function bootLive2D(): Promise<void> {
    if (live2dBooting || live2dReady || !isLive2DEnabled() || isHidden()) return;
    live2dBooting = true;

    let ok = false;
    if (options.mode === 'iframe') {
      // 同伴：自己的浏览上下文（运行时是模块级单例，同页放不下第二份）
      renderer = createRenderer(stage!);
      ok = renderer ? await renderer.load(id) : false;
    } else {
      // 主角：同页画布，沿用已经验过的那条路
      canvas = document.createElement('canvas');
      canvas.className = 'pet__canvas';
      // 运行时是按 id 找元素的，而**同一份运行时只服务主角**，所以这里的 id 唯一
      canvas.id = `pet-canvas-${id}`;
      canvas.width = 384;
      canvas.height = 576;
      canvas.setAttribute('aria-hidden', 'true');
      stage!.insertBefore(canvas, stage!.firstChild);
      ok = (await initLive2D(canvas, live2dModelUrl(findCharacter(id)))) === 'ok';
    }

    live2dBooting = false;
    if (!ok) {
      // 这只退回内置精灵。清干净，免得留下一个占着位置的空画布 / 空 iframe
      renderer?.destroy();
      renderer = null;
      canvas?.remove();
      canvas = null;
      return;
    }

    live2dReady = true;
    // 资源已预热，第一帧基本就绪；再留一点余量盖住运行时解析 moc 的那点时间
    window.setTimeout(() => {
      if (isLive2DEnabled()) useLive2D();
    }, REVEAL_DELAY_MS);
  }

  /** 首屏优先：不跟 LCP 抢带宽，等 load 之后挑空闲再拉那 3.4 MB */
  function scheduleLive2D(): void {
    const start = (): void => void bootLive2D();
    const afterLoad = (): void => {
      const idle = (
        window as Window & {
          requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void;
        }
      ).requestIdleCallback;
      if (typeof idle === 'function') idle(start, { timeout: 2000 });
      else window.setTimeout(start, 600);
    };
    // 同伴是访客刚召唤出来的：首屏早就过去了，这里会直接开工
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true, signal });
  }

  /**
   * 已就绪的外观层换上来/换下去。**刻意不碰加载**：
   * 谁来加载、什么时候加载是单独一条链（首屏优先 / 访客拨开关），
   * 混在一起的话，每次刷新组级状态都会顺手去拉那 3.4 MB。
   */
  function setAppearance(on: boolean): void {
    if (on) {
      if (live2dReady) useLive2D();
      return;
    }
    useSprite();
  }

  function ensureAppearance(): void {
    if (live2dReady) {
      setAppearance(true);
      return;
    }
    void bootLive2D();
  }

  function pointer(clientX: number, clientY: number): void {
    renderer?.pointer(clientX, clientY);
  }

  // ---------------------------------------------------------------- 拖拽
  //
  // 绑在 stage 而不是精灵按钮上：Live2D 上来之后画布会盖住精灵，
  // 绑精灵就会漏点击。stage 是两者的共同父节点，一套逻辑管两种外观。

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let fromX = 0;
  let fromY = 0;

  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const current = position(id);
      fromX = current.x;
      fromY = current.y;
      stage.setPointerCapture(e.pointerId);
    },
    { signal }
  );

  stage.addEventListener(
    'pointermove',
    (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // 4px 以内算点击：手指和鼠标都会抖
      if (!moved && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;
      moved = true;
      place(fromX + dx, fromY + dy);
    },
    { signal }
  );

  stage.addEventListener(
    'pointerup',
    (e) => {
      if (!dragging) return;
      dragging = false;
      if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
      if (moved) setPosition(id, place(fromX + (e.clientX - startX), fromY + (e.clientY - startY)));
    },
    { signal }
  );

  // ---------------------------------------------------------------- 事件绑定

  stage.addEventListener(
    'click',
    () => {
      // 拖拽结束时浏览器会补一次 click，靠 moved 把它滤掉
      if (moved) {
        moved = false;
        return;
      }
      bump();
      toggleAsk();
    },
    { signal }
  );

  el<HTMLButtonElement>(host, '[data-pet-poke]')?.addEventListener('click', poke, { signal });
  el<HTMLButtonElement>(host, '[data-pet-feed]')?.addEventListener('click', feed, { signal });

  // 齿轮只有主角有（同伴那份在克隆时被摘掉了）
  gear?.addEventListener('click', () => options.onGear?.(), { signal });

  // 关闭按钮是静态节点（以前每次 render 都新建一个），所以只绑一次
  dismiss.addEventListener('click', hideBubble, { signal });

  askForm.addEventListener(
    'submit',
    (e) => {
      e.preventDefault();
      const question = input.value;
      input.value = '';
      void answer(question);
    },
    { signal }
  );

  // ---------------------------------------------------------------- 启动

  paint();
  measureAnchor();
  applyPosition();
  touch();
  scheduleLive2D();

  // 会话内只欢迎一次，**按角色分键** —— 不分键的话，同伴登场时不会打招呼
  if (!options.arriving && !isHidden() && onceFlag(`pet_greeted:${id}`)) {
    window.setTimeout(() => {
      say('greet', { hold: 6000 });
    }, options.greetDelay);
  }

  function available(): boolean {
    // gone：这只已经被送走了。只判 isHidden() 不够 —— 同伴走后渲染器可能还在
    // 等它开口，而它已经不在文档里了（说不出去，也没人会看见）
    return !gone && !isHidden() && !host.classList.contains('pet--sleep') && !answering;
  }

  function refreshLabels(): void {
    for (const node of Array.from(host.querySelectorAll<HTMLElement>('[data-pet-label]'))) {
      const key = node.dataset.petLabel;
      if (!key) continue;
      const text = label(key);
      if (text) node.textContent = text;
    }
    input!.placeholder = label('placeholder');
    input!.setAttribute('aria-label', label('placeholder'));
    sprite!.setAttribute('aria-label', label('sprite'));
    sprite!.title = label('sprite');
    dismiss!.setAttribute('aria-label', label('dismiss'));
    dismiss!.title = label('dismiss');
    paint();
  }

  function closeTransient(): boolean {
    if (askForm!.hidden === false) {
      toggleAsk(false);
      return true;
    }
    if (bubble!.hidden === false) {
      hideBubble();
      return true;
    }
    return false;
  }

  function closeOutside(target: Node): void {
    if (askForm!.hidden === false && !host.contains(target)) toggleAsk(false);
  }

  function putAway(): void {
    hideBubble();
    toggleAsk(false);
  }

  function destroy(): void {
    gone = true;
    ac.abort();
    window.clearTimeout(sleepTimer);
    window.clearTimeout(bubbleTimer);
    releaseReaders();
    renderer?.destroy();
    canvas?.remove();
    const layer = host.parentElement;
    host.remove();
    // 层上那个 has-l2d 的含义是「两只里有没有谁在用 Live2D」，这只走了要重算
    if (layer) markLayerMode(layer);
  }

  return {
    el: host,
    id,
    name: displayName(id),
    available,
    say,
    show,
    replyTo,
    whenBubbleFree,
    refreshLabels,
    relayout,
    pointer,
    setAppearance,
    ensureAppearance,
    closeTransient,
    closeOutside,
    putAway,
    destroy,
  };
}

// ----------------------------------------------------------------- 面板

interface PanelContext {
  stages: Map<string, StageHandle>;
  signal: AbortSignal;
  /** 同伴换了：重建舞台（`true` = 新来的要打招呼） */
  onCompanionChange(): void;
  onInteract(): void;
  /** 换页后把名单重新对齐一次（状态可能被另一个标签页改过） */
  onRestore(): void;
}

interface PanelHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  contains(target: Node): boolean;
  refreshLabels(): void;
  /** hidden / nochips / settings 三个**组级**类 + 召回按钮 */
  applyGroupState(): void;
}

/**
 * 设置面板：**全局一份**。
 *
 * 三个组级状态类挂在容器 `.pet-layer` 上，而不是每只身上：
 *   - `.pet--hidden`    整组藏起来（只留召回按钮）
 *   - `.pet--nochips`   只关那圈气泡（齿轮必须留下，它是设置唯一的入口）
 *   - `.pet--settings`  面板开着，把气泡让出来
 *
 * 而 `.pet--l2d` / `.pet--sleep` 是**每只独立**的，挂在各自的舞台根上 ——
 * 这只退回 SVG 时另一只照样是 Live2D。
 */
function bindPanel(layer: HTMLElement, ctx: PanelContext): PanelHandle {
  const panel = el<HTMLElement>(layer, '[data-pet-panel]');
  const gear = el<HTMLButtonElement>(layer, '[data-pet-gear]');
  const tab = el<HTMLButtonElement>(layer, '[data-pet-tab]');
  const chipsToggle = el<HTMLButtonElement>(layer, '[data-pet-chips-toggle]');
  const live2dToggle = el<HTMLButtonElement>(layer, '[data-pet-live2d-toggle]');
  const hideBtn = el<HTMLButtonElement>(layer, '[data-pet-hide]');
  const closeBtn = el<HTMLButtonElement>(layer, '[data-pet-close]');
  const fold = el<HTMLButtonElement>(layer, '[data-pet-fold]');
  const foldBody = el<HTMLElement>(layer, '[data-pet-fold-body]');
  const note = el<HTMLElement>(layer, '[data-pet-note]');

  const signal = ctx.signal;
  const noop: PanelHandle = {
    open: () => {},
    close: () => {},
    isOpen: () => false,
    contains: () => false,
    refreshLabels: () => {},
    applyGroupState: () => {},
  };
  if (!panel || !gear || !tab || !chipsToggle || !live2dToggle || !hideBtn || !closeBtn || !fold || !foldBody) {
    return noop;
  }

  function openPanel(open: boolean): void {
    const was = panel!.hidden === false;
    if (was === open) return;
    panel!.hidden = !open;
    layer.classList.toggle('pet--settings', open);
    if (open) {
      const key = el<HTMLInputElement>(layer, '[data-pet-key]');
      const endpoint = el<HTMLInputElement>(layer, '[data-pet-endpoint]');
      const model = el<HTMLInputElement>(layer, '[data-pet-model]');
      if (key) key.value = readSetting(SECRET.key);
      if (endpoint) endpoint.value = readSetting(SECRET.endpoint);
      if (model) model.value = readSetting(SECRET.model);
    } else {
      // 「对话模型」永远是收起态登场：下次打开面板不该还停在上次的展开状态。
      // 输入框的值是开面板时现读的，所以收起不丢任何东西
      fold!.setAttribute('aria-expanded', 'false');
      foldBody!.hidden = true;
    }
  }

  /**
   * 状态行：空文本时整行收起来，否则会留一条空白带。
   * 圆点颜色由 CSS 按 data-state 决定，文本部分仍可整段替换。
   */
  function setNote(text: string, state: 'idle' | 'ok' | 'err' | 'busy'): void {
    if (!note) return;
    note.textContent = text;
    note.dataset.state = state;
    note.hidden = text === '';
  }

  /**
   * 两个开关的状态同步。
   *
   * 面板里它们是 role="switch"，不是「会改自己文案的按钮」：文案固定
   * （互动气泡 / Live2D 形象），状态只由 aria-checked 表达，视觉上由 CSS 的
   * [aria-checked='true'] 画成实心。这样切语言时不必为每个状态各备一套文案 ——
   * 而宠物带 transition:persist，切语言时只有这里能被刷到。
   */
  function refreshSwitches(): void {
    chipsToggle!.setAttribute('aria-checked', String(!isChipsHidden()));
    live2dToggle!.setAttribute('aria-checked', String(isLive2DEnabled()));
  }

  function applyGroupState(): void {
    const hidden = isHidden();
    layer.classList.toggle('pet--hidden', hidden);
    layer.classList.toggle('pet--nochips', isChipsHidden());
    tab!.hidden = !hidden;

    for (const stage of ctx.stages.values()) stage.setAppearance(isLive2DEnabled() && !hidden);

    if (hidden) {
      // 整组收起来：气泡、对话框、面板一起走，别留一片浮在半空的 UI
      for (const stage of ctx.stages.values()) stage.putAway();
      openPanel(false);
    }
    refreshSwitches();
    refreshCast();
  }

  /**
   * 名单与选中态。
   *
   * **主角与同伴从数据上就不能选重**：同伴那一行直接**不渲染**当前主角
   * （这里用 hidden + disabled 双保险，因为 persist 之后服务端的 HTML 不会重排）。
   */
  function refreshCast(): void {
    const leadId = lead();
    for (const btn of Array.from(layer.querySelectorAll<HTMLButtonElement>('[data-pet-cast-btn]'))) {
      const id = btn.dataset.petCastBtn;
      if (!id) continue;
      btn.textContent = displayName(id);
      const on = id === leadId;
      btn.classList.toggle('is-on', on);
      // 读屏要知道当前选中的是哪一个
      btn.setAttribute('aria-pressed', String(on));
    }

    const companionId = companionIdOf();
    for (const btn of Array.from(layer.querySelectorAll<HTMLButtonElement>('[data-pet-companion-btn]'))) {
      // data-pet-companion-btn="" 表示「独自」这一项
      const id = btn.dataset.petCompanionBtn || null;
      btn.textContent = id ? displayName(id) : label('solo');
      const on = id === companionId;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      // 主角不能同时是同伴：直接从界面上抹掉，而不是等点下去再回落
      const isLeadOption = id !== null && id === leadId;
      btn.hidden = isLeadOption;
      btn.disabled = isLeadOption;
    }
  }

  /** 同伴 id：从在场名单里取（主角之外的第一个） */
  function companionIdOf(): string | null {
    const list = roster();
    return list.length > 1 ? (list[1] as string) : null;
  }

  // ------------------------------------------------------- 角色切换（主角）
  //
  // 换角色 = 换形象，而 Live2D 运行时**没有卸载接口**：loadlive2d 发射后不管，
  // 它内部那个渲染循环也停不掉。把新模型 load 到第二个 canvas 上"热切换"，
  // 旧模型会继续渲染 —— 切三次就是三个循环在跑，CPU 和显存一起漏。
  //
  // 所以唯一能做的是：**存下选择 + 整页刷新**。它的副作用恰好是我们想要的 ——
  // 对话历史跟着清空，否则涅普顿会带着布兰的记忆说话，人格会串。
  //
  // 刷新**不会空白**：新角色的内置 SVG 精灵在首屏就画好了（配色由 <head> 里
  // 那段脚本写下的 data-pet-character 决定，见 BaseLayout.astro），
  // Live2D 在后台加载完再淡入。
  for (const castBtn of Array.from(layer.querySelectorAll<HTMLButtonElement>('[data-pet-cast-btn]'))) {
    castBtn.addEventListener(
      'click',
      () => {
        const id = castBtn.dataset.petCastBtn;
        // 点自己什么都不做 —— 尤其是别刷新，那只是白闪一下
        if (!id || id === lead()) return;
        setLead(id);
        // 清掉「会话内只欢迎一次」的标记，让新角色登场时自己说第一句话
        clearOnceFlag(`pet_greeted:${id}`);
        location.reload();
      },
      { signal }
    );
  }

  // ----------------------------------------------------------- 同伴的召唤

  for (const btn of Array.from(layer.querySelectorAll<HTMLButtonElement>('[data-pet-companion-btn]'))) {
    btn.addEventListener(
      'click',
      () => {
        const id = btn.dataset.petCompanionBtn || null;
        if (id === companionIdOf()) return;
        setCompanion(id);
        // **不刷新页面**：同伴的舞台是懒建的 —— 送走就销毁，召唤就克隆一个。
        // 只有主角换形象才需要整页刷新（它的 WebGL 上下文是运行时持有的唯一一份）
        ctx.onCompanionChange();
      },
      { signal }
    );
  }

  // ---------------------------------------------------------------- 开关

  chipsToggle.addEventListener(
    'click',
    () => {
      setChipsHidden(!isChipsHidden());
      applyGroupState();
    },
    { signal }
  );

  live2dToggle.addEventListener(
    'click',
    () => {
      const on = !isLive2DEnabled();
      setLive2DEnabled(on);
      // 拨开才去拉那 3.4 MB；关掉只是换回 SVG，不卸载已经跑起来的 WebGL
      if (on) for (const stage of ctx.stages.values()) stage.ensureAppearance();
      applyGroupState();
      ctx.onInteract();
    },
    { signal }
  );

  hideBtn.addEventListener(
    'click',
    () => {
      setHidden(true);
      applyGroupState();
    },
    { signal }
  );

  tab.addEventListener(
    'click',
    () => {
      setHidden(false);
      applyGroupState();
      // 藏起来的时候可能整个外观链都还没启动（bootLive2D 见到 hidden 会跳过），
      // 所以叫回来的时候要补一次「现在去加载」
      for (const stage of ctx.stages.values()) stage.ensureAppearance();
      // 谁被叫醒就说醒来的那句话。两只都在的时候，主角出面
      ctx.stages.get(lead())?.say('wake');
      ctx.onInteract();
    },
    { signal }
  );

  gear.addEventListener(
    'click',
    () => {
      openPanel(!(panel.hidden === false));
    },
    { signal }
  );

  closeBtn.addEventListener('click', () => openPanel(false), { signal });

  // 「对话模型」默认收起：不配置的人不必看见 Key / 端点 / 模型那三行，
  // 折叠头右侧那句「需自备 Key」已经把这里是什么讲清楚了
  fold.addEventListener(
    'click',
    () => {
      const open = fold.getAttribute('aria-expanded') !== 'true';
      fold.setAttribute('aria-expanded', String(open));
      foldBody.hidden = !open;
    },
    { signal }
  );

  // ---------------------------------------------------------------- API 配置

  /** 三项配置落盘。测试与保存都要走它，免得两处漏掉一项 */
  function persistConfig(): void {
    const endpointInput = el<HTMLInputElement>(layer, '[data-pet-endpoint]');
    // 粘进来的多半是基址（.../v1），这里补齐 /chat/completions 并把补好的结果
    // **回填到输入框**——让人直接看见实际会请求哪个地址，而不是悄悄改掉
    const fixed = normalizeEndpoint(endpointInput?.value ?? '');
    if (endpointInput) endpointInput.value = fixed;
    writeSetting(SECRET.key, el<HTMLInputElement>(layer, '[data-pet-key]')?.value ?? '');
    writeSetting(SECRET.endpoint, fixed);
    writeSetting(SECRET.model, el<HTMLInputElement>(layer, '[data-pet-model]')?.value ?? '');
  }

  el<HTMLButtonElement>(layer, '[data-pet-save]')?.addEventListener(
    'click',
    () => {
      persistConfig();
      setNote(label('saved'), 'ok');
    },
    { signal }
  );

  /**
   * 测试连接：先把当前输入框的值落盘（否则测的是上次保存的旧值），再跑只读探测。
   * 会顺带保存 —— 这是刻意的：测通了就能直接对话，不用再想起来点一次保存。
   */
  el<HTMLButtonElement>(layer, '[data-pet-test]')?.addEventListener(
    'click',
    () => {
      const testBtn = el<HTMLButtonElement>(layer, '[data-pet-test]');
      persistConfig();
      if (testBtn) testBtn.disabled = true;
      setNote(label('testing'), 'busy');
      void probe().then((result) => {
        const lines = [`${result.ok ? '✓' : '✕'} ${result.message}`];
        if (result.suggestions?.length) {
          lines.push(`${label('testSuggest')}${result.suggestions.join(' / ')}`);
        }
        // 回显完整地址：后缀到底补上没有，一眼可见
        lines.push(result.endpoint);
        setNote(lines.join('\n'), result.ok ? 'ok' : 'err');
        if (testBtn) testBtn.disabled = false;
      });
    },
    { signal }
  );

  // 「清除配置」= 清掉三项 API 配置。好感度 / 当前角色 / 显示状态都不在这里 ——
  // 它们属于「这只宠物自己的状态」，跟「配置」是两回事，别被顺手一起清掉
  el<HTMLButtonElement>(layer, '[data-pet-clear]')?.addEventListener(
    'click',
    () => {
      for (const field of ['key', 'endpoint', 'model'] as const) writeSetting(SECRET[field], '');
      for (const selector of ['[data-pet-key]', '[data-pet-endpoint]', '[data-pet-model]']) {
        const input = el<HTMLInputElement>(layer, selector);
        if (input) input.value = '';
      }
      setNote(label('cleared'), 'idle');
    },
    { signal }
  );

  function refreshLabels(): void {
    for (const node of Array.from(layer.querySelectorAll<HTMLElement>('[data-pet-label]'))) {
      const key = node.dataset.petLabel;
      if (!key) continue;
      const text = label(key);
      if (text) node.textContent = text;
    }
    tab!.setAttribute('aria-label', label('show'));
    tab!.title = label('show');
    gear!.setAttribute('aria-label', label('settings'));
    gear!.title = label('settings');
    // 关闭按钮的图标是「×」，文案只在 aria-label / title 上，别覆盖它
    closeBtn!.setAttribute('aria-label', label('close'));
    closeBtn!.title = label('close');
    refreshSwitches();
    refreshCast();
  }

  return {
    open: () => openPanel(true),
    close: () => openPanel(false),
    isOpen: () => panel.hidden === false,
    // 齿轮点下去时，outside-click 那条监听会把这一下算成「点了外面」而立刻关掉面板
    contains: (target: Node) => panel.contains(target) || gear.contains(target),
    refreshLabels,
    applyGroupState,
  };
}

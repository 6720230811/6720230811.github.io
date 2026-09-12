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
import { moodLabel, pickLine, sourceLabel, type LineKind } from './lines';
import {
  addAffection,
  affection,
  character,
  clearOnceFlag,
  getState,
  isChipsHidden,
  isHidden,
  isLive2DEnabled,
  onceFlag,
  setCharacter,
  setChipsHidden,
  setHidden,
  setLive2DEnabled,
  setOffset,
} from './state';

/**
 * 布兰的客户端运行时：绑事件、管气泡、处理拖拽、发请求、切外观层。
 *
 * 交互模型（和界面一样，只有三块）：
 *   - 点宠物  → 只开/关**对话框**，别的什么都不弹
 *   - 点气泡  → 戳一下 / 喂零食，回复落在回复气泡里
 *   - 点齿轮  → 设置面板，含「切回内置精灵 / 隐藏气泡 / 隐藏宠物」三个开关
 *
 * 四个必须记住的约束：
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

let runtime: Runtime | null = null;
let refreshLabels: (() => void) | null = null;

let history: Turn[] = [];
let lastAsk = 0;
let idleTimer = 0;
let sleepTimer = 0;
let bubbleTimer = 0;

function el<T extends HTMLElement>(root: HTMLElement, selector: string): T | null {
  return root.querySelector<T>(selector);
}

/** 数值夹取；当范围本身为空（窄屏）时退到上界，至少不飞出视口 */
function clampValue(min: number, max: number, value: number): number {
  if (max < min) return max;
  return Math.min(max, Math.max(min, value));
}

function loc(): Locale {
  return runtime?.locale ?? 'zh';
}

function label(key: string): string {
  return runtime?.strings[key] ?? '';
}

/**
 * 当前角色的台词。
 *
 * 包这一层不是为了写起来短，是为了**不会漏传角色** —— pickLine 的第三个参数
 * 有默认值，漏了既不报错也不崩，只是安静地退回布兰的口吻。四只角色里混进一句
 * 布兰的话，靠肉眼很难发现，所以干脆不给漏的机会。
 */
function line(kind: LineKind, locale: Locale = loc()): string {
  return pickLine(kind, locale, character());
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

export function initPet(): void {
  const root = document.getElementById('pet-root');
  if (!root) return;

  // 每页都重读：切了语言要立刻跟上（宠物本身被 persist 保住，不会重新渲染）
  const fresh = readRuntime();
  if (!fresh) return;
  runtime = fresh;

  if (root.dataset.petReady !== '1') {
    root.dataset.petReady = '1';
    refreshLabels = bindOnce(root);
  }
  refreshLabels?.();
}

/** 绑定全部事件，返回「刷新文案」的闭包（persist 之后每次换页都要调它） */
function bindOnce(root: HTMLElement): () => void {
  const stage = el<HTMLElement>(root, '[data-pet-stage]');
  const sprite = el<HTMLButtonElement>(root, '[data-pet-sprite]');
  const tab = el<HTMLButtonElement>(root, '[data-pet-tab]');
  const bubble = el<HTMLElement>(root, '[data-pet-bubble]');
  const bubbleBody = el<HTMLElement>(root, '[data-pet-bubble-body]');
  const dismiss = el<HTMLButtonElement>(root, '[data-pet-dismiss]');
  const askForm = el<HTMLFormElement>(root, '[data-pet-form]');
  const input = el<HTMLInputElement>(root, '[data-pet-input]');
  const chips = el<HTMLElement>(root, '[data-pet-chips]');
  const gear = el<HTMLButtonElement>(root, '[data-pet-gear]');
  const panel = el<HTMLElement>(root, '[data-pet-panel]');
  const chipsToggle = el<HTMLButtonElement>(root, '[data-pet-chips-toggle]');
  const live2dToggle = el<HTMLButtonElement>(root, '[data-pet-live2d-toggle]');
  const hideBtn = el<HTMLButtonElement>(root, '[data-pet-hide]');
  const closeBtn = el<HTMLButtonElement>(root, '[data-pet-close]');
  const fold = el<HTMLButtonElement>(root, '[data-pet-fold]');
  const foldBody = el<HTMLElement>(root, '[data-pet-fold-body]');
  const note = el<HTMLElement>(root, '[data-pet-note]');

  if (
    !stage ||
    !sprite ||
    !tab ||
    !bubble ||
    !bubbleBody ||
    !dismiss ||
    !askForm ||
    !input ||
    !chips ||
    !gear ||
    !panel ||
    !chipsToggle ||
    !live2dToggle ||
    !hideBtn ||
    !closeBtn ||
    !fold ||
    !foldBody
  ) {
    return () => {};
  }

  // ------------------------------------------------------------ 拖拽范围基准

  let anchor = { left: 0, top: 0, width: 0, height: 0 };

  /**
   * 容器是固定尺寸的，气泡与对话框绝对定位挂在它上方，
   * 所以「量一次容器未位移时的位置」就是稳定基准。量的时候先把 transform 摘掉。
   */
  function measureAnchor(): void {
    const previous = root.style.transform;
    root.style.transform = 'none';
    const box = root.getBoundingClientRect();
    anchor = { left: box.left, top: box.top, width: box.width, height: box.height };
    root.style.transform = previous;
  }

  function clampOffset(x: number, y: number): { x: number; y: number } {
    const dock = Math.min(256, window.innerWidth - 32);
    return {
      // 气泡向左展开，左侧边界得替它留出来
      x: clampValue(8 + dock - anchor.width - anchor.left, window.innerWidth - 8 - anchor.width - anchor.left, x),
      y: clampValue(8 + DOCK_ROOM - anchor.height - anchor.top, window.innerHeight - 8 - anchor.height - anchor.top, y),
    };
  }

  function place(x: number, y: number): { x: number; y: number } {
    const next = clampOffset(x, y);
    root.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
    return next;
  }

  // ---------------------------------------------------------------- 气泡

  /** 流式生成中的那一行，由 startLive / pushLive 维护；收气泡时要一起清掉 */
  let liveLine: HTMLElement | null = null;

  function hideBubble(): void {
    window.clearTimeout(bubbleTimer);
    liveLine = null;
    bubble!.hidden = true;
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

  function say(
    text: string,
    opts: {
      links?: readonly ChatLink[];
      detail?: string;
      source?: 'local' | 'llm';
      hold?: number;
    } = {}
  ): void {
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
    armBubble(opts.hold ?? holdFor(text));
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
    if (!bubble!.hidden) armBubble(4000);
  };
  bubble.addEventListener('pointerenter', pauseHold);
  bubble.addEventListener('pointerleave', resumeHold);
  bubble.addEventListener('focusin', pauseHold);
  bubble.addEventListener('focusout', (e) => {
    // 焦点只是在气泡内部挪动（正文 → 链接 → 关闭按钮）就不算离开
    const next = e.relatedTarget as Node | null;
    if (!next || !bubble!.contains(next)) resumeHold();
  });

  // ---------------------------------------------------------------- 状态显示

  /** 好感度只出现在那枚小气泡里，心情压在它的 title 上，不占地方 */
  function paint(): void {
    const fav = Math.round(affection());
    const favNode = el<HTMLElement>(root, '[data-pet-affection]');
    if (favNode) favNode.textContent = String(fav);
    const stat = el<HTMLElement>(root, '[data-pet-stat]');
    if (stat) stat.title = `${label('affection')} ${fav} · ${moodLabel(fav, loc())}`;
  }

  // ------------------------------------------------------------ 空闲与睡着

  function scheduleIdle(): void {
    window.clearTimeout(idleTimer);
    window.clearTimeout(sleepTimer);
    idleTimer = window.setTimeout(() => {
      if (!isHidden() && bubble!.hidden) say(line('idle'), { hold: 7000 });
    }, pet.idleAfterMs);
    sleepTimer = window.setTimeout(() => {
      root.classList.add('pet--sleep');
      say(line('sleep'), { hold: 6000 });
    }, pet.sleepAfterMs);
  }

  function wake(): void {
    root.classList.remove('pet--sleep');
    scheduleIdle();
  }

  // ---------------------------------------------------------------- 互动

  /** 弹一下：先摘 class 再强制重排，否则连点第二次不会重新播动画 */
  function bump(): void {
    stage!.classList.remove('is-bump');
    void stage!.offsetWidth;
    stage!.classList.add('is-bump');
  }

  function poke(): void {
    addAffection(1);
    paint();
    say(line('poke'));
    bump();
    wake();
  }

  function feed(): void {
    addAffection(6);
    paint();
    say(line('feed'));
    bump();
    wake();
  }

  let asking = false;

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
    liveLine!.textContent = clip(detachDocLinks(partial, runtime?.docs ?? []).text);
  }

  async function submit(): Promise<void> {
    const text = input!.value.trim();
    if (!text) {
      say(line('empty'), { hold: 4000 });
      return;
    }
    // 连点只会烧钱，不会更快
    if (asking || Date.now() - lastAsk < pet.minAskIntervalMs) return;
    asking = true;
    lastAsk = Date.now();
    input!.value = '';

    addAffection(2);
    paint();
    // 停很久再换掉：hold 太短的话，模型还在想气泡就先自己消失了，随后又冒出来，闪一下
    say(line('thinking'), { hold: 30_000 });

    const reply = await ask(text, {
      locale: loc(),
      character: character(),
      docs: runtime?.docs ?? [],
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
    say(reply.text, {
      links: reply.links,
      detail: reply.detail,
      source: reply.source,
    });
    paint();
    asking = false;
    wake();
  }

  // ---------------------------------------------------------------- 对话框

  /** 点宠物唯一的动作：开/关对话框。别的不弹 */
  function toggleAsk(open?: boolean): void {
    // hidden 在新版 DOM 类型里是 boolean | 'until-found'，这里收敛成 boolean
    const next = open ?? askForm!.hidden === true;
    askForm!.hidden = !next;
    if (next) {
      wake();
      window.setTimeout(() => input!.focus(), 60);
    }
  }

  // ---------------------------------------------------------------- 设置面板

  function togglePanel(open?: boolean): void {
    const next = open ?? panel!.hidden === true;
    panel!.hidden = !next;
    root.classList.toggle('pet--settings', next);
    if (next) {
      const key = el<HTMLInputElement>(root, '[data-pet-key]');
      const endpoint = el<HTMLInputElement>(root, '[data-pet-endpoint]');
      const model = el<HTMLInputElement>(root, '[data-pet-model]');
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

  function applyChips(): void {
    root.classList.toggle('pet--nochips', isChipsHidden());
    refreshSwitches();
  }

  function applyHidden(): void {
    const hidden = isHidden();
    root.classList.toggle('pet--hidden', hidden);
    tab!.hidden = !hidden;
    if (hidden) {
      hideBubble();
      toggleAsk(false);
      togglePanel(false);
    }
  }

  // ---------------------------------------------------------------- 外观层
  //
  // Live2D 约 3.4 MB，绝不上首屏关键路径：等 window.load 之后再让出一次空闲。
  // 这条链上任何一环失败（访客关掉 / 系统减少动效 / 弱网 / 没 WebGL / 资源缺失）
  // 都安静地停在 SVG 上，不弹任何错误 —— SVG 是完整形态，不是占位图。

  /** 已经成功过一次：运行时不支持多实例、也没给卸载接口，所以不再重复调 */
  let live2dReady = false;
  let live2dBooting = false;

  /** 角色按钮：文字跟着语言走，高亮跟着当前角色走 */
  function refreshCast(): void {
    const current = character();
    for (const item of runtime?.cast ?? []) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-pet-cast-btn="${item.id}"]`);
      if (!btn) continue;
      btn.textContent = item.name;
      const on = item.id === current;
      btn.classList.toggle('is-on', on);
      // 读屏要知道当前选中的是哪一个
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  /** 换外观层 = 换锚点盒尺寸（5.5×6.5rem ↔ 12×18rem），拖拽基准必须重算 */
  function relayout(): void {
    measureAnchor();
    setOffset(place(getState().offset.x, getState().offset.y));
  }

  function useLive2D(): void {
    root.classList.add('pet--l2d');
    relayout();
  }

  function useSprite(): void {
    root.classList.remove('pet--l2d');
    relayout();
  }

  async function bootLive2D(): Promise<void> {
    if (live2dBooting || live2dReady || !isLive2DEnabled()) return;
    const canvas = el<HTMLCanvasElement>(root, '[data-pet-canvas]');
    if (!canvas) return;

    live2dBooting = true;
    // 模型地址随角色变；认不出的 id 会在 findCharacter 里回落默认角色，
    // 所以这里拿到的永远是个能用的地址，不必再判空
    const result = await initLive2D(canvas, live2dModelUrl(findCharacter(character())));
    live2dBooting = false;
    if (result !== 'ok') return;

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
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
  }

  live2dToggle.addEventListener('click', () => {
    const next = !isLive2DEnabled();
    setLive2DEnabled(next);
    refreshSwitches();
    if (next) {
      // 已经加载过就直接换回来，绝不第二次调 loadlive2d
      if (live2dReady) useLive2D();
      else void bootLive2D();
    } else {
      // 关掉只是换回 SVG，不卸载已经跑起来的 WebGL —— 运行时没给停止接口
      useSprite();
    }
  });

  // ---------------------------------------------------------------- 角色切换
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
  // Live2D 在后台加载完再淡入。这也是选「刷新」而不是 iframe 隔离的主要理由。
  for (const castBtn of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-pet-cast-btn]'))) {
    castBtn.addEventListener('click', () => {
      const id = castBtn.dataset.petCastBtn;
      // 点自己什么都不做 —— 尤其是别刷新，那只是白闪一下
      if (!id || id === character()) return;
      setCharacter(id);
      // 清掉「会话内只欢迎一次」的标记，让新角色登场时自己说第一句话
      clearOnceFlag('pet_greeted');
      location.reload();
    });
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

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const current = getState().offset;
    fromX = current.x;
    fromY = current.y;
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // 4px 以内算点击：手指和鼠标都会抖
    if (!moved && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;
    moved = true;
    place(fromX + dx, fromY + dy);
  });

  stage.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (moved) setOffset(place(fromX + (e.clientX - startX), fromY + (e.clientY - startY)));
  });

  // ---------------------------------------------------------------- 事件绑定

  stage.addEventListener('click', () => {
    // 拖拽结束时浏览器会补一次 click，靠 moved 把它滤掉
    if (moved) {
      moved = false;
      return;
    }
    bump();
    toggleAsk();
  });

  el<HTMLButtonElement>(root, '[data-pet-poke]')?.addEventListener('click', poke);
  el<HTMLButtonElement>(root, '[data-pet-feed]')?.addEventListener('click', feed);
  gear.addEventListener('click', () => {
    hideBubble();
    togglePanel();
  });

  closeBtn!.addEventListener('click', () => togglePanel(false));

  // 「对话模型」默认收起：不配置的人不必看见 Key / 端点 / 模型那三行，
  // 折叠头右侧那句「需自备 Key」已经把这里是什么讲清楚了
  fold!.addEventListener('click', () => {
    const open = fold!.getAttribute('aria-expanded') !== 'true';
    fold!.setAttribute('aria-expanded', String(open));
    foldBody!.hidden = !open;
  });

  chipsToggle.addEventListener('click', () => {
    setChipsHidden(!isChipsHidden());
    applyChips();
  });

  hideBtn.addEventListener('click', () => {
    setHidden(true);
    hideBubble();
    applyHidden();
  });

  tab.addEventListener('click', () => {
    setHidden(false);
    applyHidden();
    wake();
    say(line('wake'));
  });

  // 关闭按钮现在是静态节点（以前每次 say 都新建一个），所以只绑一次
  dismiss.addEventListener('click', hideBubble);

  askForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });

  el<HTMLButtonElement>(root, '[data-pet-save]')?.addEventListener('click', () => {
    const endpointInput = el<HTMLInputElement>(root, '[data-pet-endpoint]');
    // 粘进来的多半是基址（.../v1），这里补齐 /chat/completions 并把补好的结果
    // **回填到输入框**——让人直接看见实际会请求哪个地址，而不是悄悄改掉
    const fixed = normalizeEndpoint(endpointInput?.value ?? '');
    if (endpointInput) endpointInput.value = fixed;
    writeSetting(SECRET.key, el<HTMLInputElement>(root, '[data-pet-key]')?.value ?? '');
    writeSetting(SECRET.endpoint, fixed);
    writeSetting(SECRET.model, el<HTMLInputElement>(root, '[data-pet-model]')?.value ?? '');
    setNote(label('saved'), 'ok');
  });

  /**
   * 测试连接：先把当前输入框的值落盘（否则测的是上次保存的旧值），再跑只读探测。
   * 会顺带保存 —— 这是刻意的：测通了就能直接对话，不用再想起来点一次保存。
   */
  el<HTMLButtonElement>(root, '[data-pet-test]')?.addEventListener('click', () => {
    const testBtn = el<HTMLButtonElement>(root, '[data-pet-test]');
    const endpointInput = el<HTMLInputElement>(root, '[data-pet-endpoint]');
    const fixed = normalizeEndpoint(endpointInput?.value ?? '');
    if (endpointInput) endpointInput.value = fixed;
    writeSetting(SECRET.key, el<HTMLInputElement>(root, '[data-pet-key]')?.value ?? '');
    writeSetting(SECRET.endpoint, fixed);
    writeSetting(SECRET.model, el<HTMLInputElement>(root, '[data-pet-model]')?.value ?? '');

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
  });

  // 「清除配置」= 清掉三项 API 配置。好感度 / 当前角色 / 显示状态都不在这里 ——
  // 它们属于「这只宠物自己的状态」，跟「配置」是两回事，别被顺手一起清掉
  el<HTMLButtonElement>(root, '[data-pet-clear]')?.addEventListener('click', () => {
    for (const field of ['key', 'endpoint', 'model'] as const) writeSetting(SECRET[field], '');
    for (const selector of ['[data-pet-key]', '[data-pet-endpoint]', '[data-pet-model]']) {
      const input = el<HTMLInputElement>(root, selector);
      if (input) input.value = '';
    }
    setNote(label('cleared'), 'idle');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!panel.hidden) togglePanel(false);
    else if (!askForm.hidden) toggleAsk(false);
    else if (!bubble.hidden) hideBubble();
  });

  // 点空白处收掉设置与对话框。宠物被 persist，这两条全局监听只会挂一次
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node;
    if (!panel.hidden && !panel.contains(target) && !gear.contains(target)) togglePanel(false);
    if (!askForm.hidden && !root.contains(target)) toggleAsk(false);
  });

  window.addEventListener('resize', () => {
    measureAnchor();
    setOffset(place(getState().offset.x, getState().offset.y));
  });

  // ---------------------------------------------------------------- 启动

  applyHidden();
  applyChips();
  measureAnchor();
  setOffset(place(getState().offset.x, getState().offset.y));
  scheduleIdle();
  scheduleLive2D();

  if (!isHidden() && onceFlag('pet_greeted')) {
    window.setTimeout(() => {
      say(line('greet'), { hold: 6000 });
    }, 1400);
  }

  return function applyLabels(): void {
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-pet-label]'))) {
      const key = node.dataset.petLabel;
      if (!key) continue;
      const text = label(key);
      if (text) node.textContent = text;
    }
    input.placeholder = label('placeholder');
    input.setAttribute('aria-label', label('placeholder'));
    sprite.setAttribute('aria-label', label('sprite'));
    sprite.title = label('sprite');
    tab.setAttribute('aria-label', label('show'));
    tab.title = label('show');
    gear.setAttribute('aria-label', label('settings'));
    gear.title = label('settings');
    // 关闭按钮的图标是「×」，文案只在 aria-label / title 上，别覆盖它
    dismiss.setAttribute('aria-label', label('dismiss'));
    dismiss.title = label('dismiss');
    refreshSwitches();
    refreshCast();
    // 关闭键只有一个「×」图标，文案走 aria-label / title，别覆盖它
    closeBtn!.setAttribute('aria-label', label('close'));
    closeBtn!.title = label('close');
    paint();
  };
}

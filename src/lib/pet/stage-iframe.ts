import { findCharacter, live2dModelUrl, pet } from '../../data/pet';
import { hasWebGL, shouldSkip } from './live2d';

/**
 * 同伴的 Live2D 形象：父页对 `public/live2d/render.html` 的封装。
 *
 * ## 为什么同伴必须走 iframe，而主角不用
 *
 * `public/live2d/js/live2d.js` 是**模块级单例**：画布存在单变量 `C` 里、
 * 渲染循环用 `b || (b=!0, ...)` 只启动一次、WebGL 上下文与输入监听全挂在
 * `window` 上。同一个 window 里 `loadlive2d` 调两次只会互相顶掉。
 * 所以第二只必须有**自己的浏览上下文**。
 *
 * 而主角留在同页画布上（沿用 `live2d.ts` 那条已经验过的路径），好处很实在：
 * **不召唤同伴的访客，一切与今天完全一致** —— 没有 iframe、没有 postMessage、
 * 没有指针转发循环。多一只的代价只由「真的想要两只」的人付。
 *
 * ## 职责边界
 *
 * 这个模块只管**通信**：建 iframe、握手、发模型地址、等就绪、转发指针、销毁。
 * 它不碰台词、不碰气泡、不碰状态 —— 那些都在主页面，一行都不必为第二只重写。
 */

/** 等 `ready` 的上限。同源、资源已在 HTTP 缓存里，正常 1 秒内；超过就是出问题了 */
const READY_TIMEOUT_MS = 12_000;

/** 指针位移小于它就不重发 —— 每帧两条无效 postMessage 纯属白费 */
const POINTER_EPSILON = 2;

/** 渲染器回传的消息形状（见 public/live2d/render.html 顶部的协议注释） */
interface RendererMessage {
  from?: string;
  t?: string;
  reason?: string;
}

export interface RendererHandle {
  /**
   * 加载某个角色的模型。`false` = 该退回内置 SVG 精灵（调用方负责退）。
   * 重复调用同一个角色是幂等的；换模型会被渲染器明确拒绝（它没有卸载接口）。
   */
  load(characterId: string): Promise<boolean>;
  /**
   * 父页坐标系下的指针位置。内部换算成 iframe **局部**坐标再发 ——
   * 运行时是按 `clientX - 画布 rect` 算的，所以必须换算，不能直接转发。
   */
  pointer(clientX: number, clientY: number): void;
  /** iframe 是否已经就绪（父页据此决定要不要跑指针转发循环） */
  readonly ready: boolean;
  destroy(): void;
}

/**
 * 在 `host` 里建一个渲染器。
 *
 * 返回 `null` 表示**前置条件不满足**（总开关关掉 / 减少动效 / 省流量 / 弱网 /
 * 拿不到 WebGL）—— 这些都不是错误，调用方安静地留在 SVG 上即可。
 * SVG 是完整形态、不是占位图，所以任何一种降级都不会露馅。
 */
export function createRenderer(host: HTMLElement): RendererHandle | null {
  const cfg = pet.live2d;
  if (!cfg.enabled || shouldSkip() || !hasWebGL()) return null;

  const frame = document.createElement('iframe');
  frame.className = 'pet__frame';
  // 这是纯装饰层：读屏不该念它，键盘也不该 Tab 进来（交互都在主页面）
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = '';
  frame.src = cfg.renderUrl;
  host.appendChild(frame);

  let disposed = false;
  let ready = false;
  let helloSent = false;
  let wantedModel: string | null = null;
  let settle: ((ok: boolean) => void) | null = null;
  let timer = 0;
  let lastX = Number.NaN;
  let lastY = Number.NaN;

  /** 结束这一轮等待。重复调用无副作用（比如 fail 之后超时又到点） */
  function finish(ok: boolean): void {
    window.clearTimeout(timer);
    timer = 0;
    const done = settle;
    settle = null;
    if (ok) ready = true;
    done?.(ok);
  }

  function post(message: Record<string, unknown>): void {
    try {
      frame.contentWindow?.postMessage({ from: 'pet-host', ...message }, location.origin);
    } catch {
      // contentWindow 还没建好，或父页正在卸载 —— 这一条丢了就丢了
    }
  }

  function onMessage(e: MessageEvent): void {
    if (e.origin !== location.origin) return;
    // 只认自己这个 iframe 的消息。**必须比 source**：同源下别的 iframe（将来
    // 万一有第三个）也会往 window 上发，只判 origin 会把别人的话当自己的。
    if (e.source !== frame.contentWindow) return;
    const d = e.data as RendererMessage | null;
    if (!d || d.from !== 'pet-render') return;

    if (d.t === 'hello') {
      // 握手：等它把监听挂好再发 load，否则那条消息会石沉大海
      helloSent = true;
      if (wantedModel) post({ t: 'load', modelUrl: wantedModel });
    } else if (d.t === 'ready') {
      finish(true);
    } else if (d.t === 'fail') {
      finish(false);
    }
  }

  window.addEventListener('message', onMessage);

  // 兜底：iframe 自己 404 / 被拦掉时不会有任何消息回来，靠 load 事件发现
  frame.addEventListener('error', () => finish(false));

  function load(characterId: string): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    const modelUrl = live2dModelUrl(findCharacter(characterId));
    wantedModel = modelUrl;

    // 同一只重复 load：渲染器会幂等地回 ready
    return new Promise<boolean>((resolve) => {
      settle = resolve;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => finish(false), READY_TIMEOUT_MS);
      // 握过手就直接发；没握过就等 hello（onMessage 里会补发）
      if (helloSent) post({ t: 'load', modelUrl });
    });
  }

  function pointer(clientX: number, clientY: number): void {
    if (disposed || !ready) return;
    const box = frame.getBoundingClientRect();
    // 被藏起来 / 尺寸塌成 0 时直接跳过，免得算出一堆 NaN 发过去
    if (box.width <= 0 || box.height <= 0) return;

    // **窄屏两只一起缩放**时，getBoundingClientRect 给的是屏幕上的尺寸，
    // 而 iframe 内部那套坐标是未缩放的布局尺寸。缩放比只能这么算：
    // 屏幕上量到的宽 ÷ 布局宽（offsetWidth 不受 transform: scale 影响）。
    const layoutW = frame.offsetWidth || box.width;
    const layoutH = frame.offsetHeight || box.height;
    const x = ((clientX - box.left) * layoutW) / box.width;
    const y = ((clientY - box.top) * layoutH) / box.height;

    if (Math.abs(x - lastX) < POINTER_EPSILON && Math.abs(y - lastY) < POINTER_EPSILON) return;
    lastX = x;
    lastY = y;
    post({ t: 'pointer', x, y });
  }

  function destroy(): void {
    if (disposed) return;
    disposed = true;
    ready = false;
    window.removeEventListener('message', onMessage);
    window.clearTimeout(timer);
    const done = settle;
    settle = null;
    done?.(false);
    frame.remove();
  }

  return {
    load,
    pointer,
    destroy,
    get ready() {
      return ready;
    },
  };
}

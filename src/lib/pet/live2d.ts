import { pet } from '../../data/pet';

/**
 * Live2D 外观层：把内置 SVG 精灵换成真的 Live2D 模型。
 *
 * 三条设计原则，都是被现实逼出来的：
 *
 * 1. **绝不上首屏关键路径。** 运行时 148 KB + 模型约 3.4 MB。全部放在
 *    public/live2d 下、运行时注入 <script>，不进打包图。调用方负责挑时机
 *    （见 mount.ts：等 window.load 之后再挑空闲加载）。
 *
 * 2. **能退就退。** 这条链上任何一环失败 —— 访客关掉了开关、系统开了
 *    减少动效、弱网、拿不到 WebGL、资源 404、运行时没挂上 loadlive2d ——
 *    都返回非 ok，调用方静默留在内置 SVG 上。SVG 是完整形态，不是
 *    「加载中的占位」，所以任何一种降级都不会露馅。
 *
 * 3. **探测 WebGL 必须另开一张画布。** 一张 canvas 只能有一种上下文：
 *    取过 2d 就再也拿不到 webgl，反之亦然。拿目标画布去探测，等于把
 *    它自己废掉。这个坑很隐蔽，错了的表现是「模型永远是空白」。
 *
 * 另外运行时是 Cubism 2 的 WebGL 实现，**没有 WebGL 就直接画不出东西**，
 * 它不会退化到 2D 画布，所以第 3 条的探测不是优化，是必要条件。
 */

/** 运行时挂在 window 上的全局函数，签名见 imuncle/live2d 的 index.html */
type LoadLive2D = (canvasId: string, modelUrl: string) => void;

interface ModelJson {
  model?: string;
  textures?: string[];
  pose?: string;
  physics?: string;
  motions?: Record<string, { file?: string }[]>;
}

const RUNTIME_ID = 'pet-live2d-runtime';

/** 预热整包的上限。慢网下宁可退回 SVG，也别把淡入拖成十几秒 */
const WARMUP_TIMEOUT_MS = 12_000;

export type Live2DResult =
  /** 加载并启动成功 —— 调用方可以把画布淡进来了 */
  | 'ok'
  /** 被前置条件挡下（开关、动效偏好、弱网），不是错误，不必重试 */
  | 'skip'
  /** 环境或资源有问题，退回内置精灵 */
  | 'fail';

function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl') ?? probe.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

/**
 * 三条否决：访客要减少动效、访客开了省流量、网络是 2G/3G。
 * 前两条是明确的用户意愿，第三条是替用户省钱 —— 3.4 MB 不值得为一只宠物花。
 */
function shouldSkip(): boolean {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  } catch {
    // matchMedia 在某些老环境下会抛，当作「没有这个偏好」继续
  }

  // 两个来源要写成同一个类型，否则 ?? 出来的联合类型里会缺字段
  interface NetworkInfo {
    saveData?: boolean;
    effectiveType?: string;
  }
  const nav = navigator as Navigator & { connection?: NetworkInfo; mozConnection?: NetworkInfo };
  const conn: NetworkInfo | undefined = nav.connection ?? nav.mozConnection;

  if (conn?.saveData) return true;
  if (typeof conn?.effectiveType === 'string' && /2g|3g/.test(conn.effectiveType)) return true;
  return false;
}

/** 注入运行时脚本。persist 之后会再调一次，用 id 去重，不插第二份 */
function loadRuntime(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = document.getElementById(RUNTIME_ID) as HTMLScriptElement | null;

    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve(true);
        return;
      }
      // 还在飞行中：挂到同一个 <script> 上，别重复插入
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = RUNTIME_ID;
    script.src = src;
    script.async = true;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = '1';
        resolve(true);
      },
      { once: true }
    );
    script.addEventListener('error', () => resolve(false), { once: true });
    document.head.appendChild(script);
  });
}

/** 把 modelUrl 里的相对引用（贴图 / 动作 / 姿势）解析成绝对地址 */
function resolveAsset(modelUrl: string, ref: string): string {
  return new URL(ref, new URL(modelUrl, location.href)).href;
}

/** 把资源读进 HTTP 缓存。必须把 body 读掉才算真的缓存上，所以用 arrayBuffer */
async function warm(url: string): Promise<void> {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    await res.arrayBuffer();
  } catch {
    // 单条预热失败无所谓，运行时自己还会再取一次
  }
}

/**
 * 预先把整包资源读进 HTTP 缓存，再交给运行时。
 *
 * 不做这一步的后果很具体：loadlive2d 是「发射后不管」的，没有任何
 * 加载完成回调。贴图没到之前它画出来是空白 —— 而调用方没法知道这件事，
 * 于是淡入的那一下会看到一只透明的宠物。先把资源备齐，淡入才有意义。
 */
async function warmup(modelUrl: string): Promise<boolean> {
  let json: ModelJson;
  try {
    const res = await fetch(modelUrl, { cache: 'force-cache' });
    if (!res.ok) return false;
    json = (await res.json()) as ModelJson;
  } catch {
    return false;
  }

  // 描述文件本身不合规（字段缺了），后面的加载必然失败，早退
  if (typeof json.model !== 'string' || !Array.isArray(json.textures) || !json.textures.length) {
    return false;
  }

  const targets: string[] = [
    resolveAsset(modelUrl, json.model),
    ...json.textures.map((t) => resolveAsset(modelUrl, t)),
  ];
  if (json.pose) targets.push(resolveAsset(modelUrl, json.pose));
  if (json.physics) targets.push(resolveAsset(modelUrl, json.physics));
  for (const group of Object.values(json.motions ?? {})) {
    for (const motion of group) {
      if (motion.file) targets.push(resolveAsset(modelUrl, motion.file));
    }
  }

  const all = Promise.allSettled(targets.map(warm));
  // 慢网兜底：超时就不等了，让运行时自己去取（可能白一下，好过一直不出现）
  await Promise.race([all, new Promise((r) => setTimeout(r, WARMUP_TIMEOUT_MS))]);
  return true;
}

/**
 * 初始化。返回 ok 才代表画布上真的有东西了。
 *
 * canvas 必须已经在 DOM 里、且有 id（运行时是按 id 找元素的）。
 */
export async function initLive2D(canvas: HTMLCanvasElement, modelUrl: string): Promise<Live2DResult> {
  const cfg = pet.live2d;
  if (!cfg.enabled) return 'skip';
  if (shouldSkip()) return 'skip';
  if (!hasWebGL()) return 'fail';
  // 模型地址由调用方给（它随角色变，见 data/pet.ts 的 live2dModelUrl）——
  // 运行时是四只共用的，只有模型不同
  if (!(await warmup(modelUrl))) return 'fail';
  if (!(await loadRuntime(cfg.runtimeUrl))) return 'fail';

  const load = (window as unknown as { loadlive2d?: LoadLive2D }).loadlive2d;
  if (typeof load !== 'function') return 'fail';

  try {
    load(canvas.id, modelUrl);
  } catch {
    // WebGL 上下文拿不到、moc 解析失败之类的同步异常
    return 'fail';
  }
  return 'ok';
}

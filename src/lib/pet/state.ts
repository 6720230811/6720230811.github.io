import { DEFAULT_CHARACTER } from '../../data/pet';

/**
 * 宠物的记忆：选了谁、各自的好感度、藏起来没、气泡关没关、被拖到哪儿了、用不用 Live2D。
 *
 * 为什么不放 DOM 上：站内跳转走 View Transitions，正文 DOM 会被整份换掉。
 * 状态存 localStorage，换页之后还是「刚才被喂过零食」的那一只。
 * 组件虽然加了 transition:persist 让它本身不被换掉，但硬刷新还是得有地方落盘。
 *
 * 读取一律包 try：Safari 无痕模式下 localStorage 会直接抛。
 *
 * **换角色不清空任何东西**：四只各自记好感度，来回切谁也不影响谁 ——
 * 中途换回来，那只还记得你之前喂过它。这也是「换角色 = 换一段关系」的落点。
 */
/**
 * localStorage 键名。
 * **BaseLayout.astro 里那段防闪断的内联脚本也读这个键**（它要阻塞渲染，不能 import，
 * 只能自己写一遍字面量）—— 改这里就要同步改那边，两处都有互指的注释。
 */
const KEY = 'pet_v1';

/** 新角色的起步好感度。老版本里写死 30，这里保持同一个值，迁移过去才不突兀 */
const INITIAL_AFFECTION = 30;

export interface PetOffset {
  /** 相对默认位置（右下角）的位移，px；负值向左/向上 */
  x: number;
  y: number;
}

export interface PetState {
  /** 当前角色 id，对应 data/pet.ts 的 characters[].id */
  character: string;
  /**
   * 好感度，**按角色分开记**。0-100，戳一下 +1、喂零食 +6、提问 +2，
   * 只增不减（不做惩罚，宠物不该记仇）。
   * 缺键表示这只还没被喂过，读的时候回落到 INITIAL_AFFECTION。
   */
  affectionById: Record<string, number>;
  /** 访客主动收起后整只消失，右下角只留一个小小的召回按钮 */
  hidden: boolean;
  /** 只把「戳一下 / 喂零食 / 好感度」那圈气泡关掉，宠物本体还在 */
  chipsHidden: boolean;
  /**
   * 是否渲染 Live2D 模型。默认 true，但**不代表真会去加载** ——
   * 动效偏好、弱网、无 WebGL 这三条会先行否决，见 live2d.ts。
   * 这个开关只记「访客主动要或不要」，用来跳过那 3.4 MB。
   */
  live2d: boolean;
  offset: PetOffset;
}

/** 只有 affection 一个数字的**上一版**结构，迁移时要用 */
interface LegacyState extends Partial<PetState> {
  affection?: number;
}

function fresh(): PetState {
  return {
    character: DEFAULT_CHARACTER,
    affectionById: { [DEFAULT_CHARACTER]: INITIAL_AFFECTION },
    hidden: false,
    chipsHidden: false,
    live2d: true,
    offset: { x: 0, y: 0 },
  };
}

/**
 * 好感度的迁移，分三种情况：
 *   1. 已经是 affectionById → 逐个夹到 0-100（防手改 localStorage 塞进脏值）
 *   2. 只有老版的 affection  → 那是喂给布兰的，搬给默认角色
 *   3. 什么都没有            → 空表，读的时候回落到 INITIAL_AFFECTION
 */
function migrateAffection(parsed: LegacyState): Record<string, number> {
  const saved = parsed.affectionById;
  if (saved && typeof saved === 'object') {
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(saved)) {
      out[id] = clamp(Number(value) || 0, 0, 100);
    }
    return out;
  }
  return { [DEFAULT_CHARACTER]: clamp(Number(parsed.affection ?? INITIAL_AFFECTION), 0, 100) };
}

function load(): PetState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as LegacyState;
    return {
      // 认不出的 id 不改也不报错，交给 findCharacter 去回落 ——
      // 这里保留原值，万一只是暂时读不到角色表，还能恢复
      character: typeof parsed.character === 'string' ? parsed.character : DEFAULT_CHARACTER,
      affectionById: migrateAffection(parsed),
      hidden: parsed.hidden === true,
      chipsHidden: parsed.chipsHidden === true,
      // 只有显式存过 false 才算关掉；没存过（老版本数据）按默认开着走
      live2d: parsed.live2d !== false,
      offset: {
        x: Number(parsed.offset?.x ?? 0) || 0,
        y: Number(parsed.offset?.y ?? 0) || 0,
      },
    };
  } catch {
    return fresh();
  }
}

let state: PetState = load();

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 无痕模式：本次会话内存里留着就行
  }
}

export function getState(): Readonly<PetState> {
  return state;
}

/** 当前角色 id（原始值）。要拿完整角色对象用 data/pet.ts 的 findCharacter() */
export function character(): string {
  return state.character;
}

/**
 * 记下选了谁。**只写状态，不负责刷新页面** ——
 * 换形象必须重建 WebGL 上下文（运行时没有卸载接口），所以调用方
 * 紧接着要做的是 location.reload()，见 mount.ts。
 */
export function setCharacter(id: string): void {
  state = { ...state, character: id };
  save();
}

/** 当前角色的好感度 */
export function affection(): number {
  return state.affectionById[state.character] ?? INITIAL_AFFECTION;
}

/** 加当前角色的好感度并落盘，返回加完之后的值 */
export function addAffection(delta: number): number {
  const id = state.character;
  const next = clamp((state.affectionById[id] ?? INITIAL_AFFECTION) + delta, 0, 100);
  state = { ...state, affectionById: { ...state.affectionById, [id]: next } };
  save();
  return next;
}

export function isHidden(): boolean {
  return state.hidden;
}

export function setHidden(hidden: boolean): void {
  state = { ...state, hidden };
  save();
}

export function isChipsHidden(): boolean {
  return state.chipsHidden;
}

export function setChipsHidden(chipsHidden: boolean): void {
  state = { ...state, chipsHidden };
  save();
}

export function isLive2DEnabled(): boolean {
  return state.live2d;
}

export function setLive2DEnabled(live2d: boolean): void {
  state = { ...state, live2d };
  save();
}

export function setOffset(offset: PetOffset): void {
  state = { ...state, offset };
  save();
}

/** 会话内的临时标记（换页要留下，关掉标签页就忘）：用来只欢迎一次 */
export function onceFlag(name: string): boolean {
  try {
    if (sessionStorage.getItem(name)) return false;
    sessionStorage.setItem(name, '1');
    return true;
  } catch {
    return true;
  }
}

/**
 * 清掉会话标记，让「只做一次」的动作再做一次。
 * 目前唯一的用途：换角色后要让新角色重新打一次招呼（见 mount.ts 的角色切换）。
 */
export function clearOnceFlag(name: string): void {
  try {
    sessionStorage.removeItem(name);
  } catch {
    // 无痕模式：本来就是每次都算「第一次」，不用管
  }
}

/**
 * 展厅平面：若干并联的筒拱顶展厅（barrel vault），摆线（cycloid）断面，
 * 拱顶中央一条通长的天光缝。相邻拱顶共享一道墙、开拱门连通。
 *
 * 形制参考金贝尔美术馆（Louis Kahn, 1972）：扁而长的拱、顶部一线天光、
 * 光沿弧面洒下来。坐标约定：
 * - 每个拱沿 z 延伸（长度），沿 x 并排（跨度）
 * - 摆线断面：跨度 W 对应矢高 W/π（比半圆扁得多，这是这套比例的关键）
 * - 起拱线以下才是「墙」，挂画只挂两道长墙
 *
 * 这一层刻意不 import three —— 纯数字进纯数字出，场景（floor.ts）只负责
 * 把下面的规格摆出来。
 */

export type WallKey = 'n' | 'e' | 's' | 'w';

/** 轴对齐矩形，x1 < x2、z1 < z2 */
export interface Rect {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** 与 GalleryFloor.astro 交到 HTML 里的房间数据对齐（只取用得到的字段） */
export interface PlanItem {
  id: string;
  /** 原图像素宽高，未知为 null（先按 3:2 挂，纹理来了再校正） */
  w: number | null;
  h: number | null;
  place: { wall: WallKey; u: number; v: number; size?: number } | null;
  /** 展签用：标题与相机型号，缺了就留空板 */
  title?: string;
  camera?: string;
}

export interface PlanRoomInput {
  id: string;
  label: string;
  items: readonly PlanItem[];
}

/** 拱断面上的一个采样点：x 以拱中心为 0，y 从起拱线往上算 */
export interface ProfilePoint {
  x: number;
  y: number;
}

/** 一个筒拱顶 */
export interface VaultSpec {
  spaceId: string;
  /** 拱的中心 x */
  x: number;
  /** 跨度（米） */
  width: number;
  /** 长度（米），沿 z */
  length: number;
}

/** 拱顶两端的封口：起拱线以上的拱形墙面 */
export interface EndArchSpec {
  spaceId: string;
  /** 端墙所在的 z */
  z: number;
  /** 朝内：+1 表示朝 +z，-1 表示朝 -z */
  normal: 1 | -1;
  x: number;
  width: number;
}

/**
 * 一片墙。墙是「两片背靠背」拼出来的：一片属于一个拱顶，用各自的层高与
 * 材质，所以共享墙两侧可以长得不一样。
 */
export interface WallFace {
  /** 'z'：墙沿 z 延伸（长墙），法线沿 x；'x'：墙沿 x 延伸（端墙），法线沿 z */
  axis: 'x' | 'z';
  /** 沿墙方向的起止（世界坐标） */
  a: number;
  b: number;
  /** 墙中心线的另一个坐标 */
  at: number;
  /** 法线方向：+1 / -1，也是这一面朝向的方向 */
  normal: 1 | -1;
  spaceId: string;
  height: number;
  /** 拱门：沿墙方向的中心与尺寸，floor.ts 会把它拆成左右两段加门楣 */
  door?: { center: number; width: number; height: number };
}

/** 拱门：连通两个拱顶，也是可行走区的桥 */
export interface DoorSpec {
  id: string;
  /** 门两侧的空间 */
  a: string;
  b: string;
  /** 门洞中心（世界坐标；门开在长墙上，所以宽度沿 z） */
  x: number;
  z: number;
  width: number;
  height: number;
}

/** 一件作品在世界坐标里的落点 */
export interface Placement {
  id: string;
  spaceId: string;
  x: number;
  y: number;
  z: number;
  /** 绕 y 轴的朝向：画心法线指向展厅内侧 */
  ry: number;
  fw: number;
  fh: number;
  /** 展签文字 */
  title: string;
  camera: string;
}

export interface SpaceSpec {
  id: string;
  label: string;
  rect: Rect;
  spawn: { x: number; z: number; yaw: number };
}

export interface FloorPlan {
  spaces: SpaceSpec[];
  vaults: VaultSpec[];
  /** 每个拱顶两端的拱形封口 */
  arches: EndArchSpec[];
  walls: WallFace[];
  doors: DoorSpec[];
  placements: Placement[];
  /** 整层的包围盒，用来定相机远平面 */
  bounds: Rect;
}

/** 起拱线高度：墙到此为止，再往上是拱 */
export const SPRING_H = 3.2;
/** 眼睛高度：相机初始高度，也是自动挂画时画框中心想去的高度附近 */
export const EYE_HEIGHT = 1.6;

/** 单个拱的跨度（金贝尔是 20 英尺，约 6 米出头） */
const VAULT_W = 6.4;
/** 拱的最短长度；每两件作品再加一截，免得展厅空得发慌 */
const MIN_LEN = 9;
const LEN_PER_PAIR = 3.2;
/** 拱门尺寸：比住宅门高，配 3.2m 的墙 */
const DOOR_W = 1.9;
const DOOR_H = 2.6;
/** 天光缝与反光翼（floor.ts 用同一组数字，改这里就够了） */
const SLOT_W = 0.7;
const WING_W = 0.9;
/** 天光缝两端各留这么长，别顶到端墙 */
const SLOT_INSET = 0.6;
/** 人身半径：离墙这么近就走不过去了 */
const BODY_R = 0.35;
/** 拱门可行走区沿进深的外扩，要跨过墙厚，否则过门瞬间「哪都不在」 */
const DOOR_DEPTH = 0.85;
/** 画心离墙中心线的距离：半墙厚(0.07) 之外再留 6cm */
const ART_INSET = 0.13;
/** 单件作品的最大长边 */
const MAX_SIZE = 1.5;
/** 挂画区在墙长上留的边距（0.12 起，0.88 止） */
const HANG_MARGIN = 0.12;
/** 有拱门的墙，中间这条带子要空出来 */
const DOOR_BAND = 0.12;
const DEFAULT_ASPECT = 3 / 2;

export const VAULT_METRICS = {
  width: VAULT_W,
  slot: SLOT_W,
  wing: WING_W,
  slotInset: SLOT_INSET,
} as const;

/**
 * 摆线（cycloid）拱的断面采样点，从一端起拱点到另一端。
 *
 * 按**弧长**等距重采样：摆线在 θ=0 处是尖点，均匀采 θ 会把顶点全挤在
 * 尖点附近，弧面就一段段折线了。floor.ts 拿它建拱壳与端墙拱形，
 * 无头测试也拿它算几何断言 —— 单一真源。
 */
export function vaultProfile(width: number, samples = 64): ProfilePoint[] {
  const r = width / (2 * Math.PI);
  // 先密采一遍算弧长
  const dense = 512;
  const xs: number[] = [];
  const ys: number[] = [];
  const arc: number[] = [0];
  for (let i = 0; i <= dense; i += 1) {
    const t = (i / dense) * Math.PI * 2;
    // θ=π 落在拱顶（x=0, y=2r），θ=0 / 2π 落在两侧起拱点
    xs.push(r * (t - Math.sin(t)) - Math.PI * r);
    ys.push(r * (1 - Math.cos(t)));
    if (i > 0) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  }
  const total = arc[dense];

  const points: ProfilePoint[] = [];
  let cursor = 1;
  for (let k = 0; k <= samples; k += 1) {
    const target = (k / samples) * total;
    while (cursor < dense && arc[cursor] < target) cursor += 1;
    const span = arc[cursor] - arc[cursor - 1];
    const f = span > 0 ? (target - arc[cursor - 1]) / span : 0;
    points.push({
      x: xs[cursor - 1] + (xs[cursor] - xs[cursor - 1]) * f,
      y: ys[cursor - 1] + (ys[cursor] - ys[cursor - 1]) * f,
    });
  }
  return points;
}

/** 摆线拱的矢高：跨度 / π（比半圆扁得多） */
export function vaultRise(width: number): number {
  return width / Math.PI;
}

function aspectOf(item: PlanItem): number {
  return item.w && item.h ? item.w / item.h : DEFAULT_ASPECT;
}

function boxOf(size: number, aspect: number): { fw: number; fh: number } {
  return aspect >= 1 ? { fw: size, fh: size / aspect } : { fw: size * aspect, fh: size };
}

/**
 * 一面墙上的挂画位置（沿墙 0~1）。
 * 有拱门的墙要避开中间那条带子，所以分两段排。
 */
function hangSlots(count: number, hasDoor: boolean): number[] {
  const slots: number[] = [];
  if (!hasDoor) {
    const span = 1 - HANG_MARGIN * 2;
    for (let i = 0; i < count; i += 1) slots.push(HANG_MARGIN + ((i + 0.5) / count) * span);
    return slots;
  }
  // 门洞两侧各占一段：[margin, 0.5-band] 与 [0.5+band, 1-margin]
  const left = Math.ceil(count / 2);
  const right = count - left;
  for (let i = 0; i < left; i += 1) {
    const span = 0.5 - DOOR_BAND - HANG_MARGIN;
    slots.push(HANG_MARGIN + ((i + 0.5) / left) * span);
  }
  for (let i = 0; i < right; i += 1) {
    const span = 0.5 - DOOR_BAND - HANG_MARGIN;
    slots.push(0.5 + DOOR_BAND + ((i + 0.5) / right) * span);
  }
  return slots;
}

/** 生成整层平面：并联的筒拱顶展厅 */
export function layoutFloor(rooms: readonly PlanRoomInput[]): FloorPlan {
  const count = rooms.length;
  // 所有拱取统一长度：端墙要齐，外轮廓才成形
  const length = Math.max(
    MIN_LEN,
    ...rooms.map((room) => Math.ceil(room.items.length / 2) * LEN_PER_PAIR),
  );
  const half = length / 2;
  const totalWidth = count * VAULT_W;
  const leftEdge = -totalWidth / 2;

  const spaces: SpaceSpec[] = [];
  const vaults: VaultSpec[] = [];
  const arches: EndArchSpec[] = [];
  const walls: WallFace[] = [];
  const doors: DoorSpec[] = [];
  const placements: Placement[] = [];

  rooms.forEach((room, index) => {
    const cx = leftEdge + (index + 0.5) * VAULT_W;
    const x1 = cx - VAULT_W / 2;
    const x2 = cx + VAULT_W / 2;

    spaces.push({
      id: room.id,
      label: room.label,
      rect: { x1, z1: -half, x2, z2: half },
      // 站在拱的一头，朝另一头看：一眼望穿整条天光缝
      spawn: { x: cx, z: -half + 2, yaw: Math.PI },
    });
    vaults.push({ spaceId: room.id, x: cx, width: VAULT_W, length });

    // 两端的封口：实体端墙（起拱线以下）+ 拱形（起拱线以上）
    for (const [z, normal] of [
      [-half, 1],
      [half, -1],
    ] as [number, 1 | -1][]) {
      walls.push({ axis: 'x', a: x1, b: x2, at: z, normal, spaceId: room.id, height: SPRING_H });
      arches.push({ spaceId: room.id, z, normal, x: cx, width: VAULT_W });
    }

    // ---- 两道长墙 ----
    // 左墙（x1）朝 +x，右墙（x2）朝 -x；与邻拱共享的墙上要开拱门
    const longWalls: { at: number; normal: 1 | -1; hasDoor: boolean }[] = [
      { at: x1, normal: 1, hasDoor: index > 0 },
      { at: x2, normal: -1, hasDoor: index < count - 1 },
    ];

    for (const wall of longWalls) {
      const door = wall.hasDoor
        ? { center: 0, width: DOOR_W, height: DOOR_H }
        : undefined;
      walls.push({
        axis: 'z',
        a: -half,
        b: half,
        at: wall.at,
        normal: wall.normal,
        spaceId: room.id,
        height: SPRING_H,
        ...(door ? { door } : {}),
      });
    }

    // 相邻两拱之间的那道墙只有一个门洞，登记一次即可
    if (index < count - 1) {
      doors.push({
        id: `${room.id}--${rooms[index + 1].id}`,
        a: room.id,
        b: rooms[index + 1].id,
        x: x2,
        z: 0,
        width: DOOR_W,
        height: DOOR_H,
      });
    }

    // ---- 挂画 ----
    // 有拱门的墙尽量不挂画：拱门在墙正中，画挂那儿会被门切断
    const free = longWalls.filter((wall) => !wall.hasDoor);
    const use = free.length > 0 ? free : longWalls;
    const counts = use.map(
      (_, wallIndex) => room.items.filter((_, j) => j % use.length === wallIndex).length,
    );

    room.items.forEach((item, j) => {
      const wallIndex = j % use.length;
      const wall = use[wallIndex];
      const withinWall = Math.floor(j / use.length);
      const countOnWall = counts[wallIndex];
      const slots = hangSlots(countOnWall, wall.hasDoor);
      const auto = Math.min(MAX_SIZE, (length * 0.82) / Math.max(countOnWall, 1) - 0.25);
      const size = Math.max(0.6, item.place?.size ?? auto);

      // 手指定的墙：'w' 左墙、'e' 右墙；'n'/'s' 现在是端墙（不挂画），退回长墙
      const placed = item.place?.wall;
      const byHand =
        placed === 'w' ? longWalls[0] : placed === 'e' ? longWalls[1] : undefined;
      const target = byHand ?? wall;
      const u = item.place?.u ?? slots[withinWall] ?? 0.5;
      const v = item.place?.v ?? (EYE_HEIGHT + size * 0.12) / SPRING_H;

      const { fw, fh } = boxOf(size, aspectOf(item));
      placements.push({
        id: item.id,
        spaceId: room.id,
        x: target.at + target.normal * ART_INSET,
        y: v * SPRING_H,
        z: (u - 0.5) * length,
        ry: target.normal === 1 ? Math.PI / 2 : -Math.PI / 2,
        fw,
        fh,
        title: item.title ?? '',
        camera: item.camera ?? '',
      });
    });
  });

  const bounds: Rect = {
    x1: Math.min(...spaces.map((space) => space.rect.x1)),
    z1: Math.min(...spaces.map((space) => space.rect.z1)),
    x2: Math.max(...spaces.map((space) => space.rect.x2)),
    z2: Math.max(...spaces.map((space) => space.rect.z2)),
  };

  return { spaces, vaults, arches, walls, doors, placements, bounds };
}

/** 点落在哪个拱顶里（用原始矩形，墙厚算在里面） */
export function spaceAt(plan: FloorPlan, x: number, z: number): SpaceSpec | null {
  for (const space of plan.spaces) {
    const { rect } = space;
    if (x >= rect.x1 && x <= rect.x2 && z >= rect.z1 && z <= rect.z2) return space;
  }
  return null;
}

/** 能不能站在这儿：在拱顶内（离墙 BODY_R），或在拱门里（拱门是两个拱顶的桥） */
export function containsPoint(plan: FloorPlan, x: number, z: number): boolean {
  for (const space of plan.spaces) {
    const { rect } = space;
    if (
      x >= rect.x1 + BODY_R &&
      x <= rect.x2 - BODY_R &&
      z >= rect.z1 + BODY_R &&
      z <= rect.z2 - BODY_R
    ) {
      return true;
    }
  }
  for (const door of plan.doors) {
    if (Math.abs(z - door.z) <= door.width / 2 && Math.abs(x - door.x) <= DOOR_DEPTH) return true;
  }
  return false;
}

export interface Waypoint {
  x: number;
  z: number;
}

/**
 * 从 from 走到 to 的途经点。同一个拱顶里直走（矩形是凸的）；跨拱顶就在
 * 「拱门连接成的图」上做一次 BFS —— 从第一个拱到第三个拱得穿过中间那个。
 */
export function routeTo(plan: FloorPlan, from: Waypoint, to: Waypoint): Waypoint[] {
  const a = spaceAt(plan, from.x, from.z);
  const b = spaceAt(plan, to.x, to.z);
  if (!a || !b || a.id === b.id) return [to];

  const cameFrom = new Map<string, { space: string; door: DoorSpec }>();
  const seen = new Set<string>([a.id]);
  const queue: string[] = [a.id];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === b.id) break;
    for (const door of plan.doors) {
      const next = door.a === current ? door.b : door.b === current ? door.a : null;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      cameFrom.set(next, { space: current, door });
      queue.push(next);
    }
  }
  if (!seen.has(b.id)) return [to];

  // 回溯出沿途要穿过的门
  const route: DoorSpec[] = [];
  let cursor = b.id;
  while (cursor !== a.id) {
    const step = cameFrom.get(cursor);
    if (!step) break;
    route.unshift(step.door);
    cursor = step.space;
  }

  const path: Waypoint[] = route.map((door) => ({ x: door.x, z: door.z }));
  path.push(to);
  return path;
}

/** 出生点：指定拱顶那头的视角；找不到就用第一个拱 */
export function spawnOf(plan: FloorPlan, spaceId: string): { x: number; z: number; yaw: number } {
  const space = plan.spaces.find((item) => item.id === spaceId);
  return space?.spawn ?? plan.spaces[0].spawn;
}

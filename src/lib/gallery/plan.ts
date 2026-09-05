/**
 * 展厅平面：若干并联的展厅，摆在同一层里，相邻展厅共享一道墙、开拱门连通。
 *
 * 每间厅有自己的**形制**（见 styles.ts）：跨度、层高、顶棚做法、材质与装饰
 * 都照着某座真实艺术厅来 —— 金贝尔的摆线筒拱、卢浮宫深红墙的长廊、乌菲齐
 * 又窄又长的过道、西斯廷的高厅、白盒子、镜厅、钢玻璃盒子、木构厅堂、古根海姆
 * 的穹顶中庭。各厅跨度不同，所以沿 x 依次排开时房间的宽窄是参差的；长度整层
 * 共用一个数（端墙要齐，外轮廓才成形）。
 *
 * 坐标约定：
 * - 每间厅沿 z 延伸（长度），沿 x 并排（跨度）
 * - 筒拱断面是摆线：跨度 W 对应矢高 W×rise（比半圆扁，这是这套比例的关键）
 * - 起拱线以下才是「墙」，挂画只挂两道长墙
 * - 长墙按画框之间的空当立壁柱（形制要壁柱的才立），分成一间间展位；端墙前
 *   摆一条长凳，家具在地面上的占位（obstacles）要从可行走区里挖掉
 *
 * 这一层刻意不 import three —— 纯数字进纯数字出，场景（floor.ts）只负责
 * 把下面的规格摆出来。
 */
import { hallStyle, type HallStyleId } from './styles';

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
  /** 形制：决定跨度、层高、顶棚与装饰 */
  style: HallStyleId;
  items: readonly PlanItem[];
}

/** 拱断面上的一个采样点：x 以拱中心为 0，y 从起拱线往上算 */
export interface ProfilePoint {
  x: number;
  y: number;
}

/**
 * 一间厅的顶棚。floor.ts 按 shape 决定怎么盖：
 * - 'vault' 筒拱（摆线，按 rise 定矢高）
 * - 'dome' 穹顶（椭圆底，中间开天眼）
 * - 其余（藻井 / 平顶 / 木格栅 / 钢网格）都是平顶 + 各自的一套梁格与灯
 */
export interface CeilingSpec {
  spaceId: string;
  styleId: HallStyleId;
  /** 厅的中心 x */
  x: number;
  /** 跨度（米） */
  width: number;
  /** 长度（米），沿 z；整层统一 */
  length: number;
  /** 起拱线 / 顶棚高度（米） */
  height: number;
}

/** 顶棚两端的封口：筒拱是拱形墙面，平顶是一整片矩形 */
export interface EndSpec {
  spaceId: string;
  styleId: HallStyleId;
  /** 端墙所在的 z */
  z: number;
  /** 朝内：+1 表示朝 +z，-1 表示朝 -z */
  normal: 1 | -1;
  x: number;
  width: number;
  height: number;
  /** true：起拱线以上是拱形；false：一整片矩形到顶 */
  arch: boolean;
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
  /** 墙取哪套材质与装饰：跟着它所在那间厅的形制 */
  styleId: HallStyleId;
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

/**
 * 长墙上的壁柱：把一整面墙分成一间间展位，画挂在开间里。
 * 位置取自相邻两件作品之间的空当（见 layoutFloor），所以画多画少都成立。
 */
export interface PilasterSpec {
  spaceId: string;
  styleId: HallStyleId;
  /** 墙中心线（世界坐标 x） */
  x: number;
  z: number;
  /** 与所在墙的法线同向：+1 朝 +x，-1 朝 -x */
  normal: 1 | -1;
  height: number;
}

/** 长凳：端墙前一条，坐下来回望整条厅 */
export interface BenchSpec {
  spaceId: string;
  styleId: HallStyleId;
  x: number;
  z: number;
  width: number;
  depth: number;
}

/** 家具在地面上的占位（含人身余量），可行走区要绕开它 */
export interface Obstacle {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
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
  styleId: HallStyleId;
  rect: Rect;
  /** 起拱线 / 顶棚高度（米） */
  height: number;
  spawn: { x: number; z: number; yaw: number };
}

export interface FloorPlan {
  spaces: SpaceSpec[];
  ceilings: CeilingSpec[];
  /** 顶棚两端的封口 */
  ends: EndSpec[];
  walls: WallFace[];
  doors: DoorSpec[];
  /** 长墙上分展位的壁柱 */
  pilasters: PilasterSpec[];
  /** 端墙前的长凳 */
  benches: BenchSpec[];
  /** 家具占位：containsPoint 要把它们挖掉 */
  obstacles: Obstacle[];
  placements: Placement[];
  /** 整层的包围盒，用来定相机远平面 */
  bounds: Rect;
}

/** 眼睛高度：相机初始高度，也是自动挂画时画框中心想去的高度附近 */
export const EYE_HEIGHT = 1.6;

/** 整层的最短长度；每间厅还会按自己的形制要求再加（见 layoutFloor） */
const MIN_LEN = 9;
/** 拱门尺寸：比住宅门高，配 3m 上下的墙 */
const DOOR_W = 1.9;
const DOOR_H = 2.6;
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
/** 长凳：尺寸与离端墙的距离 */
const BENCH_W = 1.8;
const BENCH_D = 0.44;
const BENCH_INSET = 0.85;
/** 家具四周要留的人身余量：贴着长凳站会站进凳子里 */
const FURNITURE_CLEAR = 0.28;
/** 壁柱：画框与壁柱之间留的空白，以及空当窄于此就不立柱 */
/** 壁柱：画框与壁柱之间留的空白，以及空当窄于此就不立柱 */
const BAY_PAD = 0.22;
const PILASTER_MIN_GAP = 0.42;

/**
 * 拱的断面采样点，从一端起拱点到另一端，按**弧长**等距重采样。
 *
 * 两种断面：
 * - 摆线（cycloid）：矢高 = 跨度/π，金贝尔那种又扁又长的拱
 * - 椭圆弧：其余矢高都用它，起拱处切线竖直、拱顶圆润（半圆是它的特例）
 *
 * 按弧长重采样是必须的：摆线在 θ=0 处是尖点，均匀采 θ 会把顶点全挤在尖点
 * 附近，弧面就一段段折线了。floor.ts 拿它建拱壳与端墙拱形。
 */
export function archProfile(width: number, rise: number, samples = 64): ProfilePoint[] {
  const cycloid = Math.abs(rise - width / Math.PI) < 0.02;
  const r = width / (2 * Math.PI);

  /** t ∈ [0,1]：0 与 1 是两侧起拱点，0.5 是拱顶 */
  const at = (t: number): ProfilePoint => {
    if (cycloid) {
      const a = t * Math.PI * 2;
      return { x: r * (a - Math.sin(a)) - Math.PI * r, y: r * (1 - Math.cos(a)) };
    }
    const a = t * Math.PI;
    return { x: -(width / 2) * Math.cos(a), y: rise * Math.sin(a) };
  };

  // 先密采一遍算弧长
  const dense = 512;
  const xs: number[] = [];
  const ys: number[] = [];
  const arc: number[] = [0];
  for (let i = 0; i <= dense; i += 1) {
    const point = at(i / dense);
    xs.push(point.x);
    ys.push(point.y);
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

/** 生成整层平面：各间厅按自己的形制并联，相邻两厅之间开拱门 */
export function layoutFloor(rooms: readonly PlanRoomInput[]): FloorPlan {
  const count = rooms.length;
  const styles = rooms.map((room) => hallStyle(room.style));

  /**
   * 长度整层统一：端墙要齐，外轮廓才成形。
   * 取每间厅「按自己形制要求的长度」里最大的那个 —— 乌菲齐要 16m，
   * 隔壁白盒子也得跟着长，但那也比各间参差不齐地拼在一起好看。
   */
  const length = Math.max(
    MIN_LEN,
    ...rooms.map((room, index) => {
      const { minLen, lenPerPair } = styles[index].metrics;
      return minLen + Math.ceil(room.items.length / 2) * lenPerPair;
    }),
  );
  const half = length / 2;
  // 跨度各不相同：沿 x 一间间铺开，总宽是各间跨度之和
  const totalWidth = styles.reduce((sum, style) => sum + style.metrics.width, 0);
  let cursorX = -totalWidth / 2;

  const spaces: SpaceSpec[] = [];
  const ceilings: CeilingSpec[] = [];
  const ends: EndSpec[] = [];
  const walls: WallFace[] = [];
  const doors: DoorSpec[] = [];
  const pilasters: PilasterSpec[] = [];
  const benches: BenchSpec[] = [];
  const obstacles: Obstacle[] = [];
  const placements: Placement[] = [];

  rooms.forEach((room, index) => {
    const style = styles[index];
    const width = style.metrics.width;
    const height = style.metrics.height;
    const x1 = cursorX;
    const x2 = cursorX + width;
    const cx = (x1 + x2) / 2;
    cursorX = x2;

    spaces.push({
      id: room.id,
      label: room.label,
      styleId: style.id,
      rect: { x1, z1: -half, x2, z2: half },
      height,
      // 站在厅的一头，朝另一头看：一眼望到天光缝（或穹顶的天眼）
      spawn: { x: cx, z: -half + 2, yaw: Math.PI },
    });
    ceilings.push({ spaceId: room.id, styleId: style.id, x: cx, width, length, height });

    // 两端的封口：实体端墙 + 拱形（筒拱才有拱形；平顶就一整片到顶）
    const arch = style.ceiling.kind === 'vault';
    for (const [z, normal] of [
      [-half, 1],
      [half, -1],
    ] as [number, 1 | -1][]) {
      walls.push({
        axis: 'x',
        a: x1,
        b: x2,
        at: z,
        normal,
        spaceId: room.id,
        styleId: style.id,
        height,
      });
      ends.push({ spaceId: room.id, styleId: style.id, z, normal, x: cx, width, height, arch });
    }

    // ---- 两道长墙 ----
    // 左墙（x1）朝 +x，右墙（x2）朝 -x；与邻厅共享的墙上要开拱门
    const longWalls: { at: number; normal: 1 | -1; neighbour: number | null }[] = [
      { at: x1, normal: 1, neighbour: index > 0 ? index - 1 : null },
      { at: x2, normal: -1, neighbour: index < count - 1 ? index + 1 : null },
    ];
    /** 门洞要矮过两侧较矮的那间厅，否则门楣会穿到隔壁的顶棚里 */
    const doorHeight = (neighbour: number | null): number =>
      neighbour === null
        ? Math.min(DOOR_H, height)
        : Math.min(DOOR_H, height, styles[neighbour].metrics.height);

    for (const wall of longWalls) {
      const door =
        wall.neighbour === null
          ? undefined
          : { center: 0, width: DOOR_W, height: doorHeight(wall.neighbour) };
      walls.push({
        axis: 'z',
        a: -half,
        b: half,
        at: wall.at,
        normal: wall.normal,
        spaceId: room.id,
        styleId: style.id,
        height,
        ...(door ? { door } : {}),
      });
    }

    // 相邻两厅之间的那道墙只有一个门洞，登记一次即可
    if (index < count - 1) {
      doors.push({
        id: `${room.id}--${rooms[index + 1].id}`,
        a: room.id,
        b: rooms[index + 1].id,
        x: x2,
        z: 0,
        width: DOOR_W,
        height: doorHeight(index + 1),
      });
    }

    // ---- 挂画 ----
    // 有拱门的墙尽量不挂画：拱门在墙正中，画挂那儿会被门切断
    const free = longWalls.filter((wall) => wall.neighbour === null);
    const use = free.length > 0 ? free : longWalls;
    const counts = use.map(
      (_, wallIndex) => room.items.filter((_, j) => j % use.length === wallIndex).length,
    );
    const perWall = use.map((wall, wallIndex) => ({
      wall,
      slots: hangSlots(counts[wallIndex], wall.neighbour !== null),
    }));
    /** 每面墙上被画框占掉的一段段（按墙中心线的 x 归类） */
    const bays = new Map<
      number,
      { normal: 1 | -1; hasDoor: boolean; spans: { z0: number; z1: number }[] }
    >();

    room.items.forEach((item, j) => {
      const wallIndex = j % use.length;
      const wall = use[wallIndex];
      const withinWall = Math.floor(j / use.length);
      const countOnWall = counts[wallIndex];
      const slots = perWall[wallIndex].slots;
      const auto = Math.min(MAX_SIZE, (length * 0.82) / Math.max(countOnWall, 1) - 0.25);
      const size = Math.max(0.6, item.place?.size ?? auto);

      // 手指定的墙：'w' 左墙、'e' 右墙；'n'/'s' 现在是端墙（不挂画），退回长墙
      const placed = item.place?.wall;
      const byHand =
        placed === 'w' ? longWalls[0] : placed === 'e' ? longWalls[1] : undefined;
      const target = byHand ?? wall;
      const u = item.place?.u ?? slots[withinWall] ?? 0.5;
      const v = item.place?.v ?? (EYE_HEIGHT + size * 0.12) / height;

      const { fw, fh } = boxOf(size, aspectOf(item));
      const z = (u - 0.5) * length;

      // 记下画框在墙上占的一段（两侧各加一点留白），壁柱就立在段与段之间
      const bay = bays.get(target.at) ?? {
        normal: target.normal,
        hasDoor: target.neighbour !== null,
        spans: [],
      };
      bay.spans.push({ z0: z - fw / 2 - BAY_PAD, z1: z + fw / 2 + BAY_PAD });
      bays.set(target.at, bay);

      placements.push({
        id: item.id,
        spaceId: room.id,
        x: target.at + target.normal * ART_INSET,
        y: v * height,
        z,
        ry: target.normal === 1 ? Math.PI / 2 : -Math.PI / 2,
        fw,
        fh,
        title: item.title ?? '',
        camera: item.camera ?? '',
      });
    });

    // ---- 壁柱：画框之间的空当立一根，一整面长墙就分成了一间间展位 ----
    // 白盒子那类形制不要壁柱（features.pilasters = false），墙就一整片
    for (const [at, bay] of bays) {
      if (!style.features.pilasters) break;
      const spans = [...bay.spans].sort((a, b) => a.z0 - b.z0);
      const gaps: { from: number; to: number }[] = [];
      // 从墙的一头走到另一头，把没被画框占掉的空当收集起来
      let cursor = -half + 0.15;
      for (const span of spans) {
        if (span.z0 > cursor) gaps.push({ from: cursor, to: span.z0 });
        cursor = Math.max(cursor, span.z1);
      }
      if (cursor < half - 0.15) gaps.push({ from: cursor, to: half - 0.15 });

      for (const gap of gaps) {
        const z = (gap.from + gap.to) / 2;
        if (gap.to - gap.from < PILASTER_MIN_GAP) continue;
        // 门洞那一段不立柱：柱子在门口会挡路，也把门套切断
        if (bay.hasDoor && Math.abs(z) < DOOR_W / 2 + 0.25) continue;
        pilasters.push({
          spaceId: room.id,
          styleId: style.id,
          x: at,
          z,
          normal: bay.normal,
          height,
        });
      }
    }

    // ---- 长凳：端墙前一条，坐下来正好回望整条厅 ----
    if (style.features.bench) {
      const benchZ = half - BENCH_INSET;
      benches.push({
        spaceId: room.id,
        styleId: style.id,
        x: cx,
        z: benchZ,
        width: BENCH_W,
        depth: BENCH_D,
      });
      obstacles.push({
        x1: cx - BENCH_W / 2 - FURNITURE_CLEAR,
        x2: cx + BENCH_W / 2 + FURNITURE_CLEAR,
        z1: benchZ - BENCH_D / 2 - FURNITURE_CLEAR,
        z2: benchZ + BENCH_D / 2 + FURNITURE_CLEAR,
      });
    }
  });

  const bounds: Rect = {
    x1: Math.min(...spaces.map((space) => space.rect.x1)),
    z1: Math.min(...spaces.map((space) => space.rect.z1)),
    x2: Math.max(...spaces.map((space) => space.rect.x2)),
    z2: Math.max(...spaces.map((space) => space.rect.z2)),
  };

  return { spaces, ceilings, ends, walls, doors, pilasters, benches, obstacles, placements, bounds };
}

/** 点落在哪间厅里（用原始矩形，墙厚算在里面） */
export function spaceAt(plan: FloorPlan, x: number, z: number): SpaceSpec | null {
  for (const space of plan.spaces) {
    const { rect } = space;
    if (x >= rect.x1 && x <= rect.x2 && z >= rect.z1 && z <= rect.z2) return space;
  }
  return null;
}

/** 能不能站在这儿：不撞家具、在拱顶内（离墙 BODY_R），或在拱门里（拱门是两个拱顶的桥） */
export function containsPoint(plan: FloorPlan, x: number, z: number): boolean {
  for (const obstacle of plan.obstacles) {
    if (x >= obstacle.x1 && x <= obstacle.x2 && z >= obstacle.z1 && z <= obstacle.z2) {
      return false;
    }
  }
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

/**
 * 展厅平面：Hilbert 曲线生成的一座连续展墙迷宫（48×48 m）。
 *
 *  整体思路是：16×16 = 256 个 cell 排成 Hilbert 曲线，相邻 cell 间都砌上墙
 * （墙高 4 m、厚 0.2 m）。整座建筑是一条蜿蜒的走廊，沿着 Hilbert 走 256 段。
 * 房间按策展切 N 份，每份的中点是这个房间的出生点 —— 换房间 = 传送到不
 * 同的出生点（不是换空间）。这样每个 /gallery/[room]/ 看到的都是同一座建筑，
 * 只是进去的地方不同。
 *
 *  walls 是 Hilbert 走过的每一段，按米坐标（× CELL）。obstacles 取每段墙的
 *  AABB 略微膨胀（wallT/2 + 人身余量）—— 用来做行走碰撞。placements
 *  是 N 个挂画点（循环取 gallery.items），分布在走廊一侧的墙上，间距 ≥ 1.6 m。
 *
 *  这一层刻意不 import three —— 纯数字进纯数字出，场景（floor.ts）只负责
 *  把下面的规格摆出来。
 */
import {
  CELL,
  FLO as FLO_INFO,
  ORDER,
  WALL_T,
  roomSpawns,
  spawnYaw,
  type Pt,
  type WallSegment,
  generateWalls,
} from './hilbert';
import type { HallStyleId } from './styles';

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
  /** 手指定位：n/s = 走廊一侧的墙，u 沿墙 0~1，v 高度 0~1 */
  place: { wall: WallKey; u: number; v: number; size?: number } | null;
  /** 展签用：标题与作者 */
  title?: string;
  author?: string;
}

export interface PlanRoomInput {
  id: string;
  label: string;
  /** 形制：决定墙面做法与画框颜色 */
  style: HallStyleId;
  items: readonly PlanItem[];
}

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
  /** 绕 y 轴的朝向：画心法线指向展厅内侧（走廊一侧） */
  ry: number;
  fw: number;
  fh: number;
  /** 展签文字 */
  title: string;
  author: string;
}

export interface SpaceSpec {
  id: string;
  label: string;
  styleId: HallStyleId;
  rect: Rect;
  spawn: { x: number; z: number; yaw: number };
}

export interface FloorPlan {
  /** 所有 Hilbert 墙段（场景用来建几何，碰撞用 obstacle） */
  walls: WallSegment[];
  /** 墙的 AABB 障碍物（碰撞用） */
  obstacles: Obstacle[];
  /** N 个房间（按策展切），每个对应一段出生点 */
  spaces: SpaceSpec[];
  /** 全部挂画位（沿 Hilbert 一侧墙排布） */
  placements: Placement[];
  /** 建筑包围盒 */
  bounds: Rect;
}

/** 眼睛高度：相机初始高度 */
export const EYE_HEIGHT = 1.6;

/** 门洞尺寸：走廊里不开门（连续开放），但空间之间靠出生点切换 */
const DOOR_W = 2.4;
const DOOR_H = 2.6;
/** 人身半径：离墙这么近就走不过去了 */
const BODY_R = 0.35;
/** 挂画中心线离墙面的距离 */
const ART_INSET = 0.06;
/** 挂画长边（米）：走廊宽 3 m —— 画别挂太大，挡住走动 */
const ART_LONG = 1.6;
const MAX_SIZE = 1.6;
const DEFAULT_ASPECT = 3 / 2;

function aspectOf(item: PlanItem): number {
  return item.w && item.h ? item.w / item.h : DEFAULT_ASPECT;
}
function boxOf(size: number, aspect: number): { fw: number; fh: number } {
  return aspect >= 1 ? { fw: size, fh: size / aspect } : { fw: size * aspect, fh: size };
}

/**
 * 把一段墙用它的 AABB 化作 Obstacle（稍向厚度方向膨胀一点）——
 *  这是个近似：AABB 比真实的旋转矩形更胖，角落里会多挡一点点，但走路
 *  不会穿墙，遇到弯道会绕过去。
 */
function wallObstacle(wall: WallSegment, thickness: number): Obstacle {
  const margin = thickness / 2 + BODY_R;
  return {
    x1: Math.min(wall.a.x, wall.b.x) - margin,
    x2: Math.max(wall.a.x, wall.b.x) + margin,
    z1: Math.min(wall.a.z, wall.b.z) - margin,
    z2: Math.max(wall.a.z, wall.b.z) + margin,
  };
}

/**
 * 生成 Hilbert 画廊布局：256 段墙 + N 个房间出生点 + 挂画位。
 */
export function layoutFloor(rooms: readonly PlanRoomInput[]): FloorPlan {
  const walls = generateWalls();
  const obstacles = walls.map((wall) => wallObstacle(wall, WALL_T));

  // 每个房间的出生点：沿 Hilbert 均匀切 N 份（rooms 与 wall 段的索引对齐）
  const spawnPoints = roomSpawns(rooms.length, walls);
  const spaces: SpaceSpec[] = rooms.map((room, index) => {
    const entry = spawnPoints[index] ?? { pt: { x: 0, z: 0 }, yaw: 0 };
    return {
      id: room.id,
      label: room.label,
      styleId: room.style,
      rect: {
        x1: FLO_INFO.min,
        z1: FLO_INFO.min,
        x2: FLO_INFO.max,
        z2: FLO_INFO.max,
      },
      spawn: { x: entry.pt.x, z: entry.pt.z, yaw: entry.yaw },
    };
  });
  void spawnYaw;

  // 挂画：沿 Hilbert 一侧均匀分布，间隔 ≥ 1.6 m，按 rooms 的展品循环
  const placements: Placement[] = [];
  const items = rooms.flatMap((room) => room.items);
  if (items.length === 0) {
    return { walls, obstacles, spaces, placements, bounds: boundsOf(FLO_INFO.min, FLO_INFO.max) };
  }
  // 在每一段墙上挂 0 或 1 件画（挂画中心在墙中点），相邻两段之间的最小距离
  // ≥ 1.6 m（不挨着）。沿 Hilbert 顺序均匀排
  const placementStep = 1; // 每段墙挂一件（有些墙被跳过）
  const usedWalls: WallSegment[] = [];
  for (let i = 0; i < walls.length; i += placementStep) {
    const wall = walls[i];
    if (wall.length < 1.0) continue; // 太短的墙不挂画
    // 跟上一件画的距离：墙段的中点 + 内法线 - 上件画位置
    if (placements.length > 0) {
      const last = placements[placements.length - 1];
      const dx = last.x - (wall.a.x + wall.b.x) / 2;
      const dz = last.z - (wall.a.z + wall.b.z) / 2;
      if (Math.hypot(dx, dz) < 1.6) continue;
    }
    usedWalls.push(wall);
  }

  usedWalls.forEach((wall, i) => {
    const item = items[i % items.length];
    const cx = (wall.a.x + wall.b.x) / 2;
    const cz = (wall.a.z + wall.b.z) / 2;
    // 墙心在 Hilbert 曲线上，墙厚 0.2 m 往两侧；画作挂在 +normal 那一侧（走
    // 廊方向）的墙面上。nx, nz 就是 normal，画心法线与墙的 +normal 同向 →
    // 摄像头从 +normal 侧看过来就是画作的正面。
    const aspect = aspectOf(item);
    const size = Math.max(0.8, item.place?.size ?? MAX_SIZE);
    const { fw, fh } = boxOf(size, aspect);
    const y = (item.place?.v ?? 1.55) + 0.001;
    const ry = Math.atan2(wall.normal.x, wall.normal.z);
    const spaceId = spaces[Math.floor((i / usedWalls.length) * spaces.length)]?.id ?? '';

    placements.push({
      id: item.id,
      spaceId,
      x: cx + wall.normal.x * ART_INSET,
      y,
      z: cz + wall.normal.z * ART_INSET,
      ry,
      fw,
      fh,
      title: item.title ?? '',
      author: item.author ?? '',
    });
  });

  return {
    walls,
    obstacles,
    spaces,
    placements,
    bounds: boundsOf(FLO_INFO.min, FLO_INFO.max),
  };
}

function boundsOf(min: number, max: number): Rect {
  return { x1: min, z1: min, x2: max, z2: max };
}

/** 离 (x, z) 最近出生点对应的房间 —— 在连续画廊里走到哪儿，「当前房间」就是
 *  离你最近的出生点（每个出生点代表一种策展在 Hilbert 上的一段）。 */
export function spaceAt(plan: FloorPlan, x: number, z: number): SpaceSpec | null {
  if (plan.spaces.length === 0) return null;
  let best = plan.spaces[0];
  let bestDist = (x - best.spawn.x) ** 2 + (z - best.spawn.z) ** 2;
  for (let i = 1; i < plan.spaces.length; i += 1) {
    const d =
      (x - plan.spaces[i].spawn.x) ** 2 + (z - plan.spaces[i].spawn.z) ** 2;
    if (d < bestDist) {
      best = plan.spaces[i];
      bestDist = d;
    }
  }
  return best;
}

/** 能不能站在这儿：不撞墙（在迷宫里走） */
export function containsPoint(plan: FloorPlan, x: number, z: number): boolean {
  for (const obstacle of plan.obstacles) {
    if (x >= obstacle.x1 && x <= obstacle.x2 && z >= obstacle.z1 && z <= obstacle.z2) {
      return false;
    }
  }
  return true;
}

export interface Waypoint {
  x: number;
  z: number;
}

/** 走直线：从 from 到 to 的途经点（没有门，直接穿 —— 在迷宫里走直线会被墙挡） */
export function routeTo(_plan: FloorPlan, _from: Waypoint, to: Waypoint): Waypoint[] {
  return [to];
}

/** 出生点：按 room id 找到对应房间的 spawn；找不到就用第一个房间 */
export function spawnOf(plan: FloorPlan, spaceId: string): { x: number; z: number; yaw: number } {
  const space = plan.spaces.find((item) => item.id === spaceId);
  return space?.spawn ?? plan.spaces[0].spawn;
}
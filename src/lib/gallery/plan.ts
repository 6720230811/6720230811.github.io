/**
 * 展厅平面：夜行折廊 —— 一条 4 m 宽、112 m 长的折廊贯穿全馆，沿途长出
 * 序厅、中央大厅、潮汐之间、临展厅、沉浸展厅、大型作品厅、总览区。
 *
 *  这一层把三样东西拼成一栋楼：
 *  - blueprint.ts：建筑的数字（折线、房间、门洞、支廊、色板、净高）
 *  - walls.ts：从那些数字长出墙、门洞、碰撞盒
 *  - hang.ts：作品墙与挂画位
 *
 *  刻意不 import three —— 纯数字进纯数字出，场景（floor.ts）只负责摆出来。
 */
import { BUILDING, EYE_HEIGHT, SPAWN, ZONES, type Rect, type ZoneId } from './blueprint';
import { buildWalls, type DoorOpening, type Obstacle, type WallSegment } from './walls';
import { deriveArtWalls, hang, type ArtWall, type HangItem, type Placement } from './hang';
import type { Locale } from '../../i18n/ui';

export type { ArtWall, DoorOpening, Obstacle, Placement, WallSegment };
export { EYE_HEIGHT };
export type { Rect, ZoneId };

/** 与 GalleryFloor.astro 交到 HTML 里的房间数据对齐（只取用得到的字段） */
export interface PlanRoomInput {
  id: string;
  label: string;
  items: readonly PlanItem[];
}

export interface PlanItem extends HangItem {
  /** 手指定位暂不用（新建筑按作品墙排布） */
  place?: unknown;
}

/** 一个分区（长廊的一章，或一间房间） */
export interface ZoneSpec {
  id: ZoneId;
  label: Record<Locale, string>;
  chapter?: number;
  ceiling: number;
  wall: string;
  accent: string | null;
  ceilingColor: string;
  floorColor: string;
  floorModule: [number, number];
  kind: 'corridor' | 'room';
  /** 长廊章节在折线上的弧长区间 */
  span?: [number, number];
}

export interface Waypoint {
  x: number;
  z: number;
}

export interface FloorPlan {
  walls: WallSegment[];
  obstacles: Obstacle[];
  doors: DoorOpening[];
  zones: ZoneSpec[];
  artWalls: ArtWall[];
  placements: Placement[];
  bounds: Rect;
  spawn: { x: number; z: number; yaw: number };
}

/** 建筑是固定的，与展品无关的部分算一次就够 */
let cached: Omit<FloorPlan, 'placements' | 'artWalls'> | null = null;

function skeleton(): Omit<FloorPlan, 'placements' | 'artWalls'> {
  if (cached) return cached;
  const built = buildWalls();
  cached = {
    walls: built.walls,
    obstacles: built.obstacles,
    doors: built.doors,
    zones: ZONES.map((item) => ({
      id: item.id,
      label: item.label,
      ...(item.chapter ? { chapter: item.chapter } : {}),
      ceiling: item.ceiling,
      wall: item.wall,
      accent: item.accent,
      ceilingColor: item.ceilingColor,
      floorColor: item.floorColor,
      floorModule: item.floorModule,
      kind: item.kind,
      ...(item.span ? { span: item.span } : {}),
    })),
    bounds: BUILDING,
    spawn: { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw },
  };
  return cached;
}

/**
 * 排一版展厅：建筑固定，作品按分区挂上去。
 * 同一策展视图下的所有房间一起排 —— 3D 展厅里挂的是整馆的作品。
 */
export function layoutFloor(rooms: readonly PlanRoomInput[]): FloorPlan {
  const base = skeleton();
  const artWalls = deriveArtWalls(base.walls);
  const items: HangItem[] = rooms.flatMap((room) =>
    room.items.map((item) => ({
      id: item.id,
      w: item.w,
      h: item.h,
      title: item.title,
      author: item.author,
      theme: item.theme,
    })),
  );
  return { ...base, artWalls, placements: hang(artWalls, items) };
}

/**
 * 走过去的路线：先试直线，走不通就在「能走的格子」上搜一条最短路，
 *  再用视线检查把中间点抹掉（只留拐弯处）。
 *
 *  格子是 0.5 m 一张、静态缓存的（建筑不变，算一次就够）。搜一次约几千格，
 *  点一下地面才跑一次，不进每帧。
 */
const GRID_STEP = 0.5;

interface WalkGrid {
  step: number;
  nx: number;
  nz: number;
  walk: Uint8Array;
}

let cachedGrid: WalkGrid | null = null;

function walkGrid(plan: FloorPlan): WalkGrid {
  if (cachedGrid) return cachedGrid;
  const step = GRID_STEP;
  const nx = Math.ceil((plan.bounds.x2 - plan.bounds.x1) / step) + 1;
  const nz = Math.ceil((plan.bounds.z2 - plan.bounds.z1) / step) + 1;
  const walk = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const x = plan.bounds.x1 + i * step;
      const z = plan.bounds.z1 + j * step;
      walk[i * nz + j] = containsPoint(plan, x, z) ? 1 : 0;
    }
  }
  cachedGrid = { step, nx, nz, walk };
  return cachedGrid;
}

/** 两点之间走得通吗（每 0.35 m 取一个样） */
function clearLine(plan: FloorPlan, from: Waypoint, to: Waypoint): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const samples = Math.max(2, Math.ceil(distance / 0.35));
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    if (!containsPoint(plan, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) {
      return false;
    }
  }
  return true;
}

/** 找到离 (x, z) 最近的可走格子 */
function nearestCell(grid: WalkGrid, plan: FloorPlan, x: number, z: number): number {
  const start = {
    i: Math.round((x - plan.bounds.x1) / grid.step),
    j: Math.round((z - plan.bounds.z1) / grid.step),
  };
  const key = (i: number, j: number): number => i * grid.nz + j;
  const inside = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < grid.nx && j < grid.nz;
  if (inside(start.i, start.j) && grid.walk[key(start.i, start.j)]) return key(start.i, start.j);
  for (let radius = 1; radius <= 12; radius += 1) {
    for (let di = -radius; di <= radius; di += 1) {
      for (let dj = -radius; dj <= radius; dj += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== radius) continue;
        const i = start.i + di;
        const j = start.j + dj;
        if (inside(i, j) && grid.walk[key(i, j)]) return key(i, j);
      }
    }
  }
  return -1;
}

export function routeTo(plan: FloorPlan, from: Waypoint, to: Waypoint): Waypoint[] {
  // 同一间房 / 同一段走廊里点来点去：直走就行
  if (clearLine(plan, from, to)) return [to];

  const grid = walkGrid(plan);
  const startCell = nearestCell(grid, plan, from.x, from.z);
  const endCell = nearestCell(grid, plan, to.x, to.z);
  if (startCell < 0 || endCell < 0) return [to];

  // 广度优先：格子少（几千），最短路就够了
  const cameFrom = new Int32Array(grid.nx * grid.nz).fill(-1);
  const seen = new Uint8Array(grid.nx * grid.nz);
  const queue: number[] = [startCell];
  seen[startCell] = 1;
  let found = startCell === endCell;
  while (queue.length > 0 && !found) {
    const current = queue.shift() as number;
    const ci = Math.floor(current / grid.nz);
    const cj = current % grid.nz;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) continue;
      const next = i * grid.nz + j;
      if (seen[next] || !grid.walk[next]) continue;
      seen[next] = 1;
      cameFrom[next] = current;
      if (next === endCell) {
        found = true;
        break;
      }
      queue.push(next);
    }
  }
  if (!found) return [to];

  // 回溯成一条折线
  const raw: Waypoint[] = [];
  for (let cell = endCell; cell >= 0; cell = cameFrom[cell]) {
    const i = Math.floor(cell / grid.nz);
    const j = cell % grid.nz;
    raw.push({
      x: plan.bounds.x1 + i * grid.step,
      z: plan.bounds.z1 + j * grid.step,
    });
    if (cell === startCell) break;
  }
  raw.reverse();

  // 视线简化：能直连就跳过中间那些格子，只留拐弯处
  const out: Waypoint[] = [];
  let anchor = from;
  let index = 0;
  while (index < raw.length) {
    let furthest = index;
    for (let probe = raw.length - 1; probe > index; probe -= 1) {
      if (clearLine(plan, anchor, raw[probe])) {
        furthest = probe;
        break;
      }
    }
    out.push(raw[furthest]);
    anchor = raw[furthest];
    index = furthest + 1;
  }
  if (out.length === 0) return [to];
  // 最后一点换成真正的目标（格子中心可能落在墙边）
  out[out.length - 1] = to;
  return out;
}

/** 能不能站在这儿：不撞墙 */
export function containsPoint(plan: FloorPlan, x: number, z: number): boolean {
  for (const obstacle of plan.obstacles) {
    if (x >= obstacle.x1 && x <= obstacle.x2 && z >= obstacle.z1 && z <= obstacle.z2) {
      return false;
    }
  }
  return true;
}

/**
 * 点地图上一点，落到能站的地方：落点本身站得住就直接用它，站不住（点在墙
 * 里）就从它向外一圈圈找，直到撞上走廊。
 */
export function nearestWalkable(
  plan: FloorPlan,
  x: number,
  z: number,
  maxRadius = 4,
): Waypoint | null {
  if (containsPoint(plan, x, z)) return { x, z };
  for (let radius = 0.4; radius <= maxRadius; radius += 0.4) {
    const count = Math.max(8, Math.round(radius * 12));
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const cx = x + Math.cos(angle) * radius;
      const cz = z + Math.sin(angle) * radius;
      if (containsPoint(plan, cx, cz)) return { x: cx, z: cz };
    }
  }
  return null;
}

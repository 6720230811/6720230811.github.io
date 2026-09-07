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
 * 走过去：S1 先走直线（跟原来的 stub 一样），S5 会换成沿折线的真实路径
 * （把当前位置投影到折线上，顺着顶点走到目标附近再下来）。
 */
export function routeTo(_plan: FloorPlan, _from: Waypoint, to: Waypoint): Waypoint[] {
  return [to];
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

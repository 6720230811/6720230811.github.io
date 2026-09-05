/**
 * 展厅平面：整座金贝尔美术馆的 16 个摆线筒拱，每个拱是一间展厅。
 *
 * 与上一版（若干并联的厅排成一条）最大的不同：建筑真的在那儿了。
 * 16 个拱分三排（南 6、中 4、北 6）落在一个平台上，拱与拱之间：
 * - 同排相邻的两个拱：在共用的那道山墙上开门洞，沿拱长方向串起来
 * - 相邻两排之间：在填充墙上开门洞，横向串起来
 * 于是整座建筑是连通的，可以从最南一排一路走到最北一排。
 *
 * 每个拱挂一种策展（rooms[i % rooms.length]）：走进一个拱，URL、页面标题
 * 与 HUD 就换成它挂的那种策展；同一种策展可能挂在好几个拱上，它们的
 * SpaceSpec.roomId 相同、id 不同（id 是拱，roomId 是房间）。
 *
 * 这一层刻意不 import three —— 纯数字进纯数字出，场景（floor.ts）只负责
 * 把下面的规格摆出来。
 */
import {
  APEX,
  BUILDING_X,
  BUILDING_Z,
  COL,
  COLUMNS,
  HANG_COUNT,
  HANG_STEP,
  HANG_Y,
  VAULTS,
  VAULT_LEN as VAULT_LENGTH,
  VAULT_W,
  WALL_SEG_LEN,
  WALL_T,
  WALL_Z,
} from '../light/layout';
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
  /** 手指定的挂位：n/s = 拱南北两侧填充墙内立面，u 沿拱长 0~1，v 高度 0~1 */
  place: { wall: WallKey; u: number; v: number; size?: number } | null;
  /** 展签用：标题与相机型号 */
  title?: string;
  camera?: string;
}

export interface PlanRoomInput {
  id: string;
  label: string;
  /** 形制：决定这个拱的墙面做法与画框颜色 */
  style: HallStyleId;
  items: readonly PlanItem[];
}

/** 门洞所在的墙沿哪个方向延伸：'z' = 山墙（法线沿 X），'x' = 填充墙（法线沿 Z） */
export type WallAxis = 'x' | 'z';

/** 门洞：连通两个拱，也是可行走区的桥 */
export interface DoorSpec {
  id: string;
  /** 门两侧的拱 */
  a: string;
  b: string;
  axis: WallAxis;
  x: number;
  z: number;
  /** 门洞宽度（沿墙方向） */
  width: number;
  height: number;
}

/** 家具（这里是柱子）在地面上的占位（含人身余量），可行走区要绕开它 */
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
  /** 拱的 id（唯一） */
  id: string;
  /** 挂在这个拱上的策展房间 id（同一种策展可能挂在好几个拱上） */
  roomId: string;
  label: string;
  styleId: HallStyleId;
  rect: Rect;
  /** 拱顶内表面高度 */
  height: number;
  spawn: { x: number; z: number; yaw: number };
}

export interface FloorPlan {
  spaces: SpaceSpec[];
  doors: DoorSpec[];
  /** 柱子占位：containsPoint 要把它们挖掉 */
  obstacles: Obstacle[];
  placements: Placement[];
  /** 建筑包围盒，用来定相机远平面 */
  bounds: Rect;
}

/** 眼睛高度：相机初始高度 */
export const EYE_HEIGHT = 1.6;

/** 门洞尺寸：2.4 m 宽、2.6 m 高（填充墙 3.2 m 高，上面留 0.6 m 过梁） */
const DOOR_W = 2.4;
const DOOR_H = 2.6;
/** 人身半径：离墙这么近就走不过去了 */
const BODY_R = 0.35;
/** 门洞可行走区沿进深的外扩，要跨过墙厚，否则过门瞬间「哪都不在」 */
const DOOR_DEPTH = 0.85;
/** 画心离墙面的距离 */
const ART_INSET = 0.13;
/** 单件作品的最大长边 */
const MAX_SIZE = 1.4;
const DEFAULT_ASPECT = 3 / 2;
/** 柱子四周的人身余量 */
const COLUMN_CLEAR = 0.3;

function aspectOf(item: PlanItem): number {
  return item.w && item.h ? item.w / item.h : DEFAULT_ASPECT;
}

function boxOf(size: number, aspect: number): { fw: number; fh: number } {
  return aspect >= 1 ? { fw: size, fh: size / aspect } : { fw: size * aspect, fh: size };
}

/**
 * 一个拱的挂画位：南北两侧填充墙内立面各 HANG_COUNT 个。
 * 只有这一侧确实临着另一排（也就是有填充墙）时才有挂位。
 */
function hangSlotsOf(vaultIndex: number): { x: number; z: number; ry: number; face: WallKey }[] {
  const vault = VAULTS[vaultIndex];
  const out: { x: number; z: number; ry: number; face: WallKey }[] = [];
  const startX =
    vault.x - WALL_SEG_LEN / 2 + (WALL_SEG_LEN - (HANG_COUNT - 1) * HANG_STEP) / 2;

  for (const wallZ of WALL_Z) {
    if (Math.abs(vault.z - wallZ) > 4.2) continue;
    const normal: -1 | 1 = vault.z < wallZ ? -1 : 1;
    // normal = -1：墙在拱的北边（墙的南面朝这个拱）；+1：墙在拱的南边
    const face: WallKey = normal === -1 ? 'n' : 's';
    for (let i = 0; i < HANG_COUNT; i += 1) {
      out.push({
        x: startX + i * HANG_STEP,
        z: wallZ + normal * (WALL_T / 2 + ART_INSET),
        // 画心法线指向拱内：墙在南边（normal=+1）时朝 −z
        ry: normal === 1 ? Math.PI : 0,
        face,
      });
    }
  }
  return out;
}

/** 生成整层平面：16 个拱，每个拱挂一种策展 */
export function layoutFloor(rooms: readonly PlanRoomInput[]): FloorPlan {
  const spaces: SpaceSpec[] = [];
  const doors: DoorSpec[] = [];
  const placements: Placement[] = [];

  // ---- 每个拱 = 一间展厅 ----
  VAULTS.forEach((vault, index) => {
    const room = rooms.length > 0 ? rooms[index % rooms.length] : undefined;
    spaces.push({
      id: `vault-${vault.id}`,
      roomId: room?.id ?? '',
      label: room?.label ?? vault.id,
      styleId: room?.style ?? 'kimbell',
      rect: {
        x1: vault.x - VAULT_LENGTH / 2,
        z1: vault.z - VAULT_W / 2,
        x2: vault.x + VAULT_LENGTH / 2,
        z2: vault.z + VAULT_W / 2,
      },
      height: APEX,
      // 站在拱的西端朝东看：一眼望穿整条天窗缝
      spawn: { x: vault.x - VAULT_LENGTH / 2 + 2, z: vault.z, yaw: -Math.PI / 2 },
    });
  });

  // ---- 门洞 ----
  // 同排相邻两拱：山墙上开门（墙沿 Z 延伸，法线沿 X）
  const byRow = new Map<string, typeof VAULTS>();
  for (const vault of VAULTS) {
    const list = byRow.get(vault.row) ?? [];
    list.push(vault);
    byRow.set(vault.row, list);
  }
  for (const list of byRow.values()) {
    for (let i = 0; i < list.length - 1; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      doors.push({
        id: `door-${a.id}-${b.id}`,
        a: `vault-${a.id}`,
        b: `vault-${b.id}`,
        axis: 'z',
        x: (a.x + b.x) / 2,
        z: a.z,
        width: DOOR_W,
        height: DOOR_H,
      });
    }
  }
  // 相邻两排之间：填充墙上开门（墙沿 X 延伸，法线沿 Z）
  for (let i = 0; i < VAULTS.length; i += 1) {
    for (let j = i + 1; j < VAULTS.length; j += 1) {
      const a = VAULTS[i];
      const b = VAULTS[j];
      if (a.row === b.row) continue;
      if (Math.abs(a.x - b.x) > 0.01) continue; // 只连同一条 X 轴线上的两个拱
      if (Math.abs(a.z - b.z) > 8) continue; // 只连相邻两排
      doors.push({
        id: `door-${a.id}-${b.id}`,
        a: `vault-${a.id}`,
        b: `vault-${b.id}`,
        axis: 'x',
        x: a.x,
        z: (a.z + b.z) / 2,
        width: DOOR_W,
        height: DOOR_H,
      });
    }
  }

  // ---- 柱子是障碍物 ----
  const obstacles: Obstacle[] = COLUMNS.map((column) => ({
    x1: column.x - COL / 2 - COLUMN_CLEAR,
    x2: column.x + COL / 2 + COLUMN_CLEAR,
    z1: column.z - COL / 2 - COLUMN_CLEAR,
    z2: column.z + COL / 2 + COLUMN_CLEAR,
  }));

  // ---- 挂画 ----
  VAULTS.forEach((vault, index) => {
    const room = rooms.length > 0 ? rooms[index % rooms.length] : undefined;
    if (!room || room.items.length === 0) return;
    const slots = hangSlotsOf(index);
    if (slots.length === 0) return;

    room.items.forEach((item, i) => {
      // 手指定的墙：'n' 北墙、's' 南墙；'e'/'w' 是山墙，不挂画，退回网格
      const wanted = item.place?.wall;
      const manual = wanted === 'n' || wanted === 's' ? wanted : null;
      const pool = manual ? slots.filter((slot) => slot.face === manual) : slots;
      const use = pool.length > 0 ? pool : slots;
      const slot = use[i % use.length];
      const within = Math.floor(i / use.length);
      const u = item.place?.u ?? (within + 0.5) / Math.max(Math.ceil(use.length / HANG_COUNT), 1);
      const size = Math.max(0.6, item.place?.size ?? MAX_SIZE);
      const v = item.place?.v ?? (HANG_Y + size * 0.1) / APEX;
      const { fw, fh } = boxOf(size, aspectOf(item));

      placements.push({
        id: item.id,
        spaceId: `vault-${vault.id}`,
        // 手指定 u 时沿拱长定位，否则落在网格挂位上
        x: item.place ? vault.x - VAULT_LENGTH / 2 + u * VAULT_LENGTH : slot.x,
        y: v * APEX,
        z: slot.z,
        ry: slot.ry,
        fw,
        fh,
        title: item.title ?? '',
        camera: item.camera ?? '',
      });
    });
  });

  return {
    spaces,
    doors,
    obstacles,
    placements,
    bounds: { x1: BUILDING_X.min, z1: BUILDING_Z.min, x2: BUILDING_X.max, z2: BUILDING_Z.max },
  };
}

/** 点落在哪个拱里（用原始矩形，墙厚算在里面） */
export function spaceAt(plan: FloorPlan, x: number, z: number): SpaceSpec | null {
  for (const space of plan.spaces) {
    const { rect } = space;
    if (x >= rect.x1 && x <= rect.x2 && z >= rect.z1 && z <= rect.z2) return space;
  }
  return null;
}

/** 能不能站在这儿：不撞柱子、在拱内（离墙 BODY_R），或在门洞里（门洞是两个拱的桥） */
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
    // 门洞是一条沿墙方向的带子：沿墙给宽度，垂直墙给进深
    const along = door.axis === 'z' ? z - door.z : x - door.x;
    const across = door.axis === 'z' ? x - door.x : z - door.z;
    if (Math.abs(along) <= door.width / 2 && Math.abs(across) <= DOOR_DEPTH) return true;
  }
  return false;
}

export interface Waypoint {
  x: number;
  z: number;
}

/**
 * 从 from 走到 to 的途经点。同一个拱里直走（矩形是凸的）；跨拱就在
 * 「门洞连接成的图」上做一次 BFS —— 从南排走到北排得穿过中间那一排。
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

/** 出生点：指定拱那一头的视角；找不到就用第一个拱 */
export function spawnOf(plan: FloorPlan, spaceId: string): { x: number; z: number; yaw: number } {
  const space = plan.spaces.find((item) => item.id === spaceId || item.roomId === spaceId);
  return space?.spawn ?? plan.spaces[0].spawn;
}

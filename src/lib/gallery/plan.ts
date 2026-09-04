/**
 * 展厅平面图：把同一策展视图下的若干房间沿一条走廊串起来，算出墙、门洞、
 * 挂画的世界坐标，以及哪儿能走、怎么从一间房走到另一间房。
 *
 * 这一层刻意不 import three —— 纯数字进纯数字出，场景（floor.ts）只负责把它
 * 摆出来。坐标约定：
 * - 走廊沿 x 轴横贯，中心线 z = 0（z ∈ [-1.2, 1.2]）
 * - 房间分列走廊南北：北侧房间在 z 更小的一侧（背墙朝 -z），南侧反之
 * - 每间房只有背墙与左右墙挂画，朝走廊那面墙开门洞
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
}

export interface PlanRoomInput {
  id: string;
  label: string;
  items: readonly PlanItem[];
  colors: { wall: string; floor: string; light: string };
}

/** 一件作品在世界坐标里的落点 */
export interface Placement {
  id: string;
  /** 所属空间（走廊不挂画，所以一定是某个房间 id） */
  spaceId: string;
  x: number;
  y: number;
  z: number;
  /** 绕 y 轴的朝向：画心法线指向房间内侧 */
  ry: number;
  /** 画心尺寸（米），画框在 floor.ts 里按卡纸宽度往外扩 */
  fw: number;
  fh: number;
}

/**
 * 一片墙。墙是「两片背靠背」拼出来的：一片属于一个空间，各自用自己的配色与
 * 层高（走廊比房间矮），所以门洞两侧的墙可以长得不一样。
 */
export interface WallFace {
  /** 'x'：墙沿 x 延伸、法线沿 z；'z'：墙沿 z 延伸、法线沿 x */
  axis: 'x' | 'z';
  /** 沿墙方向的起止（世界坐标） */
  a: number;
  b: number;
  /** 墙中心线的另一个坐标 */
  at: number;
  /** 法线方向：+1 / -1（axis 'x' 时指 ±z，'z' 时指 ±x），也是这一面朝向的方向 */
  normal: 1 | -1;
  /** 这一面属于哪个空间，决定配色 */
  spaceId: string;
  height: number;
  /** 门洞：沿墙方向的中心与宽度。带门洞的墙在 floor.ts 里拆成左/右/门楣三段 */
  door?: { center: number; width: number; height: number };
}

export interface SpaceSpec {
  id: string;
  kind: 'room' | 'corridor';
  label: string;
  rect: Rect;
  height: number;
  colors: { wall: string; floor: string; light: string };
  spawn: { x: number; z: number; yaw: number };
}

/** 门洞：可行走区的桥，也是跨房间寻路的必经点 */
export interface DoorSpec {
  spaceId: string;
  /** 门洞中心（世界坐标） */
  x: number;
  z: number;
}

export interface FloorPlan {
  spaces: SpaceSpec[];
  walls: WallFace[];
  doors: DoorSpec[];
  placements: Placement[];
  /** 整层的包围盒，用来定相机远平面与雾的距离 */
  bounds: Rect;
}

/** 层高。画廊式的空高，画挂太高要仰头看，太低会被人挡住 */
export const ROOM_HEIGHT = 3.2;
/** 走廊压低一档：穿过矮门洞进到高展厅，空间有节奏 */
export const CORRIDOR_HEIGHT = 2.6;
/** 眼睛高度：相机初始高度，也是自动挂画时画框中心想去的高度附近 */
export const EYE_HEIGHT = 1.6;

/** 走廊的 id（也是判断「现在在走廊」的依据） */
export const CORRIDOR_ID = 'corridor';

const CORRIDOR_HALF = 1.2;
const DOOR_W = 1.8;
const DOOR_H = 2.35;
/** 走廊两端超出房间的长度 */
const END_PAD = 0.9;
/** 同侧相邻房间之间的结构缝 */
const SIDE_GAP = 1.0;
/** 人身半径：离墙这么近就走不过去了 */
const BODY_R = 0.35;
/** 门洞可行走区沿进深的外扩，要跨过墙厚，否则过门瞬间「哪都不在」 */
const DOOR_DEPTH = 0.85;
/** 画心离墙中心线的距离：半墙厚(0.07) 之外再留 6cm，画框看着才像挂在墙上 */
const ART_INSET = 0.13;

const MIN_SIDE = 5.5;
const MAX_SIZE = 1.5;
const WALL_PADDING = 0.82;
const DEFAULT_ASPECT = 3 / 2;

/** 走廊配色（属于设计而非内容，所以写在这里，不进 gallery.json） */
const CORRIDOR_COLORS = { wall: '#24272c', floor: '#191c20', light: '#ffe4bd' };

interface RoomBox {
  input: PlanRoomInput;
  /** 北侧（z 更小）还是南侧 */
  north: boolean;
  rect: Rect;
  /** 背墙的 z（北侧房间是 rect.z1，南侧是 rect.z2） */
  backZ: number;
  /** 门洞中心的 x */
  doorX: number;
  /** 房间边长 */
  side: number;
  hang: { perWall: number; walls: number };
}

function aspectOf(item: PlanItem): number {
  return item.w && item.h ? item.w / item.h : DEFAULT_ASPECT;
}

function boxOf(size: number, aspect: number): { fw: number; fh: number } {
  return aspect >= 1 ? { fw: size, fh: size / aspect } : { fw: size * aspect, fh: size };
}

/** 单间房用几面墙、每面几幅 */
function hangPlan(count: number): { perWall: number; walls: number } {
  // 只有背墙与左右墙能挂画，朝走廊那面开了门洞
  const walls = Math.min(3, Math.max(1, Math.ceil(count / 3)));
  return { perWall: Math.ceil(count / walls), walls };
}

/** 房间沿走廊排布：两侧各自居中对齐，同侧多间时按（最长边 + 缝）排开 */
function placeRooms(rooms: readonly PlanRoomInput[]): RoomBox[] {
  const boxes: RoomBox[] = rooms.map((input, index) => {
    const hang = hangPlan(input.items.length);
    const side = Math.max(MIN_SIDE, hang.perWall * 2);
    return {
      input,
      // 偶数号挂北侧，奇数号挂南侧：两间房时门洞正对，走廊最短
      north: index % 2 === 0,
      rect: { x1: 0, z1: 0, x2: 0, z2: 0 },
      backZ: 0,
      doorX: 0,
      side,
      hang,
    };
  });

  const widest = Math.max(...boxes.map((box) => box.side));
  const step = widest + SIDE_GAP;

  for (const north of [true, false]) {
    const group = boxes.filter((box) => box.north === north);
    group.forEach((box, k) => {
      const centerX = (k - (group.length - 1) / 2) * step;
      box.rect = north
        ? {
            x1: centerX - box.side / 2,
            z1: -CORRIDOR_HALF - box.side,
            x2: centerX + box.side / 2,
            z2: -CORRIDOR_HALF,
          }
        : {
            x1: centerX - box.side / 2,
            z1: CORRIDOR_HALF,
            x2: centerX + box.side / 2,
            z2: CORRIDOR_HALF + box.side,
          };
      box.backZ = north ? box.rect.z1 : box.rect.z2;
      box.doorX = centerX;
    });
  }

  return boxes;
}

/** 一条线段减去若干区间后剩下的部分（在走廊长墙上给房间的门墙让位） */
function subtract(span: [number, number], holes: [number, number][]): [number, number][] {
  let pieces: [number, number][] = [span];
  for (const hole of holes) {
    const next: [number, number][] = [];
    for (const [a, b] of pieces) {
      if (hole[1] <= a || hole[0] >= b) {
        next.push([a, b]);
        continue;
      }
      if (hole[0] > a) next.push([a, hole[0]]);
      if (hole[1] < b) next.push([hole[1], b]);
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b - a > 0.02);
}

function hangPosition(
  box: RoomBox,
  wall: 'back' | 'left' | 'right',
  u: number,
  v: number,
): { x: number; y: number; z: number; ry: number } {
  const { rect, north } = box;
  const { side } = box;

  if (wall === 'back') {
    // 背墙：沿 x 铺开，法线朝房间内（北侧房间朝 +z）
    return {
      x: rect.x1 + u * (rect.x2 - rect.x1),
      y: v * ROOM_HEIGHT,
      z: box.backZ + (north ? ART_INSET : -ART_INSET),
      ry: north ? 0 : Math.PI,
    };
  }

  // 侧墙：u=0 在门洞那头，u=1 在背墙那头
  return {
    x: wall === 'left' ? rect.x1 + ART_INSET : rect.x2 - ART_INSET,
    y: v * ROOM_HEIGHT,
    z: north ? -CORRIDOR_HALF - u * side : CORRIDOR_HALF + u * side,
    ry: wall === 'left' ? Math.PI / 2 : -Math.PI / 2,
  };
}

/** 生成整层平面图 */
export function layoutFloor(rooms: readonly PlanRoomInput[], corridorLabel: string): FloorPlan {
  const boxes = placeRooms(rooms);
  const x1 = Math.min(...boxes.map((box) => box.rect.x1));
  const x2 = Math.max(...boxes.map((box) => box.rect.x2));

  const corridor: SpaceSpec = {
    id: CORRIDOR_ID,
    kind: 'corridor',
    label: corridorLabel,
    rect: {
      x1: x1 - END_PAD,
      z1: -CORRIDOR_HALF,
      x2: x2 + END_PAD,
      z2: CORRIDOR_HALF,
    },
    height: CORRIDOR_HEIGHT,
    colors: CORRIDOR_COLORS,
    spawn: { x: (x1 + x2) / 2, z: 0, yaw: Math.PI / 2 },
  };

  const spaces: SpaceSpec[] = [corridor];
  const walls: WallFace[] = [];
  const doors: DoorSpec[] = [];
  const placements: Placement[] = [];

  for (const box of boxes) {
    const { rect, north, input } = box;
    const { side } = box;
    const doorZ = north ? -CORRIDOR_HALF : CORRIDOR_HALF;

    spaces.push({
      id: input.id,
      kind: 'room',
      label: input.label,
      rect,
      height: ROOM_HEIGHT,
      colors: input.colors,
      spawn: {
        x: box.doorX,
        // 站在门里一点，正对背墙
        z: north ? doorZ - 1.1 : doorZ + 1.1,
        yaw: north ? 0 : Math.PI,
      },
    });
    doors.push({ spaceId: input.id, x: box.doorX, z: doorZ });

    // 背墙：单面，朝房间内
    walls.push({
      axis: 'x',
      a: rect.x1,
      b: rect.x2,
      at: box.backZ,
      normal: north ? 1 : -1,
      spaceId: input.id,
      height: ROOM_HEIGHT,
    });

    // 左右侧墙：单面，朝房间内
    walls.push({
      axis: 'z',
      a: rect.z1,
      b: rect.z2,
      at: rect.x1,
      normal: 1,
      spaceId: input.id,
      height: ROOM_HEIGHT,
    });
    walls.push({
      axis: 'z',
      a: rect.z1,
      b: rect.z2,
      at: rect.x2,
      normal: -1,
      spaceId: input.id,
      height: ROOM_HEIGHT,
    });

    // 门墙：两片背靠背，开同样的门洞
    const door = { center: box.doorX, width: DOOR_W, height: DOOR_H };
    walls.push({
      axis: 'x',
      a: rect.x1,
      b: rect.x2,
      at: doorZ,
      normal: north ? -1 : 1, // 房间在门墙的 -z（北侧）/ +z（南侧）
      spaceId: input.id,
      height: ROOM_HEIGHT,
      door,
    });
    walls.push({
      axis: 'x',
      a: rect.x1,
      b: rect.x2,
      at: doorZ,
      normal: north ? 1 : -1,
      spaceId: CORRIDOR_ID,
      height: CORRIDOR_HEIGHT,
      door,
    });

    // ---- 挂画 ----
    const { perWall, walls: wallCount } = box.hang;
    const wallOrder: ('back' | 'left' | 'right')[] = ['back', 'left', 'right'];
    input.items.forEach((item, index) => {
      const wallIndex = Math.min(Math.floor(index / perWall), wallCount - 1);
      const slot = index % perWall;
      const countOnWall = Math.min(perWall, input.items.length - wallIndex * perWall);
      const auto = Math.min(MAX_SIZE, (side * WALL_PADDING) / countOnWall - 0.25);
      const size = Math.max(0.6, item.place?.size ?? auto);

      // 手指定的墙：'n' 背墙、'w' 左墙、'e' 右墙；'s' 是门墙，挂不了，退回背墙
      const placed = item.place?.wall;
      const wall =
        placed === 'e' ? 'right' : placed === 'w' ? 'left' : wallOrder[wallIndex] ?? 'back';
      const u = item.place?.u ?? (slot + 0.5) / countOnWall;
      const v = item.place?.v ?? (EYE_HEIGHT + size * 0.12) / ROOM_HEIGHT;

      const { x, y, z, ry } = hangPosition(box, wall, u, v);
      const { fw, fh } = boxOf(size, aspectOf(item));
      placements.push({ id: item.id, spaceId: input.id, x, y, z, ry, fw, fh });
    });
  }

  // 走廊长墙：整条减去各房间占据的区间，剩下的才是实心墙（单面朝走廊内）
  for (const north of [true, false]) {
    const holes = boxes
      .filter((box) => box.north === north)
      .map((box): [number, number] => [box.rect.x1, box.rect.x2]);
    for (const [a, b] of subtract([corridor.rect.x1, corridor.rect.x2], holes)) {
      walls.push({
        axis: 'x',
        a,
        b,
        at: north ? -CORRIDOR_HALF : CORRIDOR_HALF,
        normal: north ? 1 : -1,
        spaceId: CORRIDOR_ID,
        height: CORRIDOR_HEIGHT,
      });
    }
  }

  // 走廊两端的墙
  walls.push({
    axis: 'z',
    a: -CORRIDOR_HALF,
    b: CORRIDOR_HALF,
    at: corridor.rect.x1,
    normal: 1,
    spaceId: CORRIDOR_ID,
    height: CORRIDOR_HEIGHT,
  });
  walls.push({
    axis: 'z',
    a: -CORRIDOR_HALF,
    b: CORRIDOR_HALF,
    at: corridor.rect.x2,
    normal: -1,
    spaceId: CORRIDOR_ID,
    height: CORRIDOR_HEIGHT,
  });

  const bounds: Rect = {
    x1: Math.min(corridor.rect.x1, x1),
    z1: Math.min(...boxes.map((box) => box.rect.z1), corridor.rect.z1),
    x2: Math.max(corridor.rect.x2, x2),
    z2: Math.max(...boxes.map((box) => box.rect.z2), corridor.rect.z2),
  };

  return { spaces, walls, doors, placements, bounds };
}

/** 点落在哪个空间里（用原始矩形，墙厚算在里面） */
export function spaceAt(plan: FloorPlan, x: number, z: number): SpaceSpec | null {
  for (const space of plan.spaces) {
    const { rect } = space;
    if (x >= rect.x1 && x <= rect.x2 && z >= rect.z1 && z <= rect.z2) return space;
  }
  return null;
}

/** 能不能站在这儿：在空间内（离墙 BODY_R），或在门洞里（门洞是两块空间的桥） */
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
    if (Math.abs(x - door.x) <= DOOR_W / 2 && Math.abs(z - door.z) <= DOOR_DEPTH) return true;
  }
  return false;
}

export interface Waypoint {
  x: number;
  z: number;
}

/**
 * 从 from 走到 to 的途经点。同在一间房/走廊就直走（矩形是凸的，直线一定通）；
 * 跨空间一律绕走廊中心线，不上 A*。
 */
export function routeTo(plan: FloorPlan, from: Waypoint, to: Waypoint): Waypoint[] {
  const a = spaceAt(plan, from.x, from.z);
  const b = spaceAt(plan, to.x, to.z);
  if (!a || !b || a.id === b.id) return [to];

  const path: Waypoint[] = [];
  // 两间房的门洞正对时，「上走廊」和「下走廊」可能是同一个点，去掉重复
  const push = (point: Waypoint): void => {
    const last = path[path.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.z - point.z) > 0.01) path.push(point);
  };
  const doorOf = (id: string): DoorSpec | undefined =>
    plan.doors.find((door) => door.spaceId === id);

  // 出：先走到自己这间房的门洞，再上走廊中心线
  const da = doorOf(a.id);
  if (da) {
    push({ x: da.x, z: da.z });
    push({ x: da.x, z: 0 });
  }
  // 进：沿走廊中心线走到对方门洞的 x，再穿门进屋
  const db = doorOf(b.id);
  if (db) {
    push({ x: db.x, z: 0 });
    push({ x: db.x, z: db.z });
  }
  push(to);

  return path;
}

/** 出生点：指定房间门内的视角；找不到就退回走廊中心 */
export function spawnOf(plan: FloorPlan, spaceId: string): { x: number; z: number; yaw: number } {
  const space = plan.spaces.find((item) => item.id === spaceId);
  return space?.spawn ?? plan.spaces[0].spawn;
}

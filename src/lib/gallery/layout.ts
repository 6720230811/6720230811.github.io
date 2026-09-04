/**
 * 挂画布局：把一批展品分配到四面墙上，算出房间尺寸和每件作品的坐标。
 *
 * 这一层刻意不 import three —— 纯数字进纯数字出，房间场景（room.ts）只负责
 * 把它摆出来。 gallery.json 里的 `place` 可以逐件覆盖，没写的按下面的规则
 * 自动分配：先用满需要的墙数，再在墙内等分。
 */

export type WallKey = 'n' | 'e' | 's' | 'w';

/** 与 GalleryRoom.astro 交到 HTML 里的 data-items 对齐（只取用得到的字段） */
export interface RoomItem {
  id: string;
  /** 原图像素宽高，未知为 null（此时按 DEFAULT_ASPECT 挂，纹理来了再校正） */
  w: number | null;
  h: number | null;
  place: {
    wall: WallKey;
    u: number;
    v: number;
    size?: number;
  } | null;
}

export interface Placement {
  id: string;
  wall: WallKey;
  /** 沿墙位置 0~1 */
  u: number;
  /** 高度 0~1（1 是天花板），画框中心 */
  v: number;
  /** 画框宽（米） */
  fw: number;
  /** 画框高（米） */
  fh: number;
}

export interface RoomLayout {
  /** 房间是正方形，这是边长（米） */
  side: number;
  height: number;
  placements: Placement[];
}

/** 层高。画廊式的空高，画挂太高要仰头看，太低会被人挡住 */
export const ROOM_HEIGHT = 3.2;

/** 眼睛高度：相机初始高度，也是自动挂画时画框中心想去的高度附近 */
export const EYE_HEIGHT = 1.6;

/** 尺寸未知时的比例（横 3:2） */
const DEFAULT_ASPECT = 3 / 2;

/** 单件作品的最大长边，再大就压得房间没有留白 */
const MAX_SIZE = 1.5;

/** 画框最靠边能到哪儿：留一点墙，别贴到墙角 */
const WALL_PADDING = 0.82;

function aspectOf(item: RoomItem): number {
  return item.w && item.h ? item.w / item.h : DEFAULT_ASPECT;
}

/** 按长边 + 比例反算画框宽高 */
function boxOf(size: number, aspect: number): { fw: number; fh: number } {
  return aspect >= 1 ? { fw: size, fh: size / aspect } : { fw: size * aspect, fh: size };
}

/**
 * 自动布局。
 * - 墙数 = ceil(n/3)：3 件以内挂一面墙就够，多了才开始绕房间走
 * - 房间边长跟着「每墙最多几件」长，保证画框之间留得出缝
 */
export function layoutRoom(items: readonly RoomItem[]): RoomLayout {
  const n = items.length;
  const wallOrder: WallKey[] = ['n', 'e', 's', 'w'];
  const wallsUsed = Math.min(wallOrder.length, Math.max(1, Math.ceil(n / 3)));
  const perWall = Math.ceil(n / wallsUsed);
  const side = Math.max(5.5, perWall * 2);

  const placements = items.map((item, index) => {
    const wall = wallOrder[Math.min(Math.floor(index / perWall), wallsUsed - 1)];
    // 墙内等分：取每格中心，perWall=1 时正好在墙正中
    const slot = index % perWall;
    const countOnWall = Math.min(perWall, n - Math.floor(index / perWall) * perWall);
    const u = (slot + 0.5) / countOnWall;

    const auto = Math.min(MAX_SIZE, (side * WALL_PADDING) / countOnWall - 0.25);
    const size = item.place?.size ?? Math.max(0.6, auto);
    const { fw, fh } = boxOf(size, aspectOf(item));

    return {
      id: item.id,
      wall: item.place?.wall ?? wall,
      u: item.place?.u ?? u,
      // 自动挂画时中心略高于视平线：站着看画，画心比眼睛高一点才舒服
      v: item.place?.v ?? (EYE_HEIGHT + size * 0.12) / ROOM_HEIGHT,
      fw,
      fh,
    };
  });

  return { side, height: ROOM_HEIGHT, placements };
}

/** 画框在世界坐标里的落点；frame 的朝向由 room.ts 按 wall 转 */
export function wallPoint(
  placement: Pick<Placement, 'wall' | 'u' | 'v'>,
  side: number,
): { x: number; y: number; z: number } {
  const inset = side / 2 - 0.06; // 画框有厚度，往里让一点免得啃进墙里
  const along = (placement.u - 0.5) * side;
  const y = placement.v * ROOM_HEIGHT;

  switch (placement.wall) {
    case 'n':
      return { x: along, y, z: -inset };
    case 's':
      return { x: -along, y, z: inset };
    case 'e':
      return { x: inset, y, z: along };
    case 'w':
      return { x: -inset, y, z: -along };
  }
}

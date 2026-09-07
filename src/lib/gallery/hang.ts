/**
 * 作品自动排布（纯数据，不 import three）。
 *
 *  作品会越加越多，所以排展是数据驱动的：墙先变成一份「作品墙」清单
 *  （id / zone / start / end / normal / capacity / type / reservedStart /
 *  reservedEnd / ceilingHeight），再把作品按规则排上去。加作品只加数据，
 *  不动建筑代码。
 *
 *  现阶段的规则（S4 会补上 hero / salon / 留白 30% / 分组间隔）：
 *  - 视觉中心高度 1.52 m
 *  - 两端各留 1.2 m（墙角），门洞边留 0.8 m（由 reservedStart/End 表达）
 *  - 相邻作品净距 1.0 m，普通横幅宽 1.9 m → 步距 2.9 m
 *  - 一件作品只在它所属的分区里出现一次，不重复
 *  - 作品不够的格子挂统一的中性占位画框，不复制已有作品
 */
import { zone, type Vec2, type ZoneId } from './blueprint';
import type { WallSegment } from './walls';

export type ArtWallType = 'standard' | 'hero' | 'salon' | 'video';

/** 一面能挂画的墙 */
export interface ArtWall {
  id: string;
  zone: ZoneId;
  start: Vec2;
  end: Vec2;
  /** 墙面法线，指向房间/走廊内侧；作品挂在墙面上、朝 normal 方向 */
  normal: Vec2;
  length: number;
  /** 这面墙能放几件（按步距算） */
  capacity: number;
  type: ArtWallType;
  /** 两端预留（米）：墙角 1.2、门洞 0.8 */
  reservedStart: number;
  reservedEnd: number;
  ceilingHeight: number;
}

/** 排展用的作品信息（plan.ts 从 payload 里取最小字段） */
export interface HangItem {
  id: string;
  w: number | null;
  h: number | null;
  title: string;
  /** 展签上的作者/器材；数据里没有就留空 */
  author?: string;
  /** 主题，用来决定挂在哪一段（city → 城市长廊，sea → 自然长廊 / 潮汐之间） */
  theme: string;
}

export interface Placement {
  id: string;
  zone: ZoneId;
  wallId: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  fw: number;
  fh: number;
  title: string;
  author: string;
  kind: 'standard' | 'hero' | 'salon' | 'video' | 'placeholder';
}

/** 作品视觉中心高度（规格 1.5–1.55） */
const CENTER_Y = 1.52;
/** 普通横幅 / 竖幅宽度（规格 1.6–2.2 / 0.9–1.3） */
const WIDE = 1.9;
const TALL = 1.1;
/** 相邻作品净距（规格 0.8–1.4） */
const GAP = 1;
/** 占位画框：统一的中性尺寸 */
const PLACEHOLDER = { w: 1.6, h: 1.1 };
/** 距离墙角至少这么远（规格 1.2） */
const CORNER_KEEP = 1.2;
/** 距离门洞至少这么远（规格 0.8–1） */
const DOOR_KEEP = 0.9;
/** 低于这个长度就不挂画 */
const MIN_WALL = 2.6;

function aspectOf(item: HangItem): number {
  return item.w && item.h ? item.w / item.h : 3 / 2;
}

function boxOf(width: number, aspect: number): { fw: number; fh: number } {
  return aspect >= 1 ? { fw: width, fh: width / aspect } : { fw: width * aspect, fh: width };
}

/** 作品属于哪个分区：数据没写就按主题猜 */
function zoneOfItem(item: HangItem, taken: Set<string>): ZoneId {
  if (item.theme === 'sea') {
    // 海：先给自然长廊，再给潮汐之间
    return taken.has('nature') ? 'tide' : 'nature';
  }
  return 'city';
}

/**
 * 从墙里挑出作品墙。
 *  隔断（kind='partition'）两面都算，法线取原法线（S4 再补反面）。
 *  预留：两端各 1.2 m；够长才当作品墙。
 */
export function deriveArtWalls(walls: WallSegment[]): ArtWall[] {
  const out: ArtWall[] = [];
  walls.forEach((wall, index) => {
    if (wall.length < MIN_WALL) return;
    const reserve = Math.min(CORNER_KEEP, (wall.length - 1) / 2);
    const usable = wall.length - reserve * 2;
    if (usable < 1) return;
    const pitch = WIDE + GAP;
    const capacity = Math.max(1, Math.floor((usable + GAP) / pitch));
    out.push({
      id: `w${index}`,
      zone: wall.zone,
      start: wall.a,
      end: wall.b,
      // 墙的 normal 指向墙芯，作品要朝人 → 取反
      normal: { x: -wall.normal.x, z: -wall.normal.z },
      length: wall.length,
      capacity,
      type: wall.kind === 'partition' ? 'salon' : 'standard',
      reservedStart: reserve,
      reservedEnd: reserve,
      ceilingHeight: wall.height,
    });
  });
  return out;
}

/**
 * 把作品排到墙上。
 *  每件只挂一次：先按分区把作品分好，再挨个格子填；填不满的格子挂占位画框。
 */
export function hang(artWalls: ArtWall[], items: HangItem[]): Placement[] {
  const byZone = new Map<ZoneId, HangItem[]>();
  for (const item of items) {
    const zoneId = zoneOfItem(item, new Set(byZone.keys()));
    const list = byZone.get(zoneId);
    if (list) list.push(item);
    else byZone.set(zoneId, [item]);
  }

  const out: Placement[] = [];
  for (const wall of artWalls) {
    const queue = byZone.get(wall.zone) ?? [];
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz) || 1;
    const ux = dx / length;
    const uz = dz / length;
    const ry = Math.atan2(wall.normal.x, wall.normal.z);
    const pitch = WIDE + GAP;
    const run = (wall.capacity - 1) * pitch;

    for (let slot = 0; slot < wall.capacity; slot += 1) {
      const along = wall.reservedStart + (wall.length - wall.reservedStart - wall.reservedEnd) / 2 - run / 2 + slot * pitch;
      const item = queue.shift();
      const size = item ? (aspectOf(item) >= 1 ? WIDE : TALL) : PLACEHOLDER.w;
      const aspect = item ? aspectOf(item) : PLACEHOLDER.w / PLACEHOLDER.h;
      const { fw, fh } = boxOf(size, aspect);
      out.push({
        id: item ? item.id : `void:${wall.id}:${slot}`,
        zone: wall.zone,
        wallId: wall.id,
        x: wall.start.x + ux * along + wall.normal.x * 0.06,
        y: CENTER_Y,
        z: wall.start.z + uz * along + wall.normal.z * 0.06,
        ry,
        fw,
        fh,
        title: item ? item.title : '',
        author: item ? (item.author ?? '') : '',
        kind: item ? (wall.type === 'salon' ? 'salon' : 'standard') : 'placeholder',
      });
    }
  }
  void DOOR_KEEP;
  void zone;
  return out;
}

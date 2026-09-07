/**
 * 作品自动排布（纯数据，不 import three）。
 *
 *  作品会一直加，所以排展是数据驱动的：墙先变成一份「作品墙」清单
 *  （id / zone / start / end / normal / capacity / type / reservedStart /
 *  reservedEnd / ceilingHeight），再把作品按规格第九节的规则排上去。加作品
 *  只加数据，不动建筑代码。
 *
 *  规格里的数字（都在这儿，改规则只改这些常量）：
 *  - 视觉中心高度 1.5–1.55 → CENTER_Y 1.52
 *  - 距墙角 ≥ 1.2 → CORNER_KEEP
 *  - 距门洞 0.8–1 → DOOR_KEEP（已含在 CORNER_KEEP 的预留里）
 *  - 相邻净距 0.8–1.4 → GAP / SALON_GAP
 *  - 同一组连续 ≤ 5 → GROUP_RUN
 *  - 不同组之间 2–3 m 空墙 → GROUP_GAP
 *  - 普通横幅 1.6–2.2 → WIDE；竖幅 0.9–1.3 → TALL；重点 2.6–3.4 → HERO
 *  - 每一段长廊只一个主视觉 → 每个分区一面 hero 墙
 *  - 重点优先放在尽端 / 转角正对面 / 放宽节点 → hero 挑「与长廊垂直」的那面
 *  - 留白 ≥ 30% → FILL 0.7
 *  - 数据暂缺挂统一的中性占位画框，不复制已有作品
 */
import { CORRIDOR_PATH, ZONES, zone, type Vec2, type ZoneId } from './blueprint';
import { nearestArc } from './walls';
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
  /** 这面墙放几件（已扣掉 30% 留白） */
  capacity: number;
  type: ArtWallType;
  /** 两端预留（米） */
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
  /** 主题，决定它挂在哪几个分区（见 ZONE_PREFERENCE） */
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
const WIDE = 1.9;
const TALL = 1.1;
const HERO = 3;
/** 相邻作品净距：普通 1.0，沙龙 0.85 */
const GAP = 1;
const SALON_GAP = 0.85;
/** 同一组连续上限 / 换组时留的空墙 */
const GROUP_RUN = 5;
const GROUP_GAP = 2.5;
/** 距墙角（门洞那 0.8–1 也含在这条预留里） */
const CORNER_KEEP = 1.2;
const DOOR_KEEP = 0.9;
/** 短于这个长度就不挂画 */
const MIN_WALL = 2.6;
/** 只填七成墙面，留白三成 */
const FILL = 0.7;
/** 画心离天花至少留这么多 */
const HEAD_ROOM = 0.7;

/**
 * 主题 → 分区的偏好顺序，作品按它轮着分。
 *  「海」先去潮汐之间、再去自然长廊；「城市」先去城市长廊、再去夜行、大型。
 *  加新主题只要在这儿加一行。
 */
const ZONE_PREFERENCE: Record<string, ZoneId[]> = {
  city: ['city', 'night', 'large'],
  sea: ['tide', 'nature', 'light'],
};

function aspectOf(item: HangItem): number {
  return item.w && item.h ? item.w / item.h : 3 / 2;
}

/** 按主题轮着分分区：同主题第 n 件去偏好表第 (n % 长度) 个分区 */
function assignZones(items: HangItem[]): Map<ZoneId, HangItem[]> {
  const byZone = new Map<ZoneId, HangItem[]>();
  const seen = new Map<string, number>();
  for (const item of items) {
    const preference = ZONE_PREFERENCE[item.theme];
    const index = seen.get(item.theme) ?? 0;
    seen.set(item.theme, index + 1);
    const zoneId = preference && preference.length > 0 ? preference[index % preference.length] : 'night';
    const list = byZone.get(zoneId);
    if (list) list.push(item);
    else byZone.set(zoneId, [item]);
  }
  return byZone;
}

/** 画框尺寸：给定宽度 → 宽高，且不许顶到天花 */
function boxOf(width: number, aspect: number, ceiling: number): { fw: number; fh: number } {
  let fw = aspect >= 1 ? width : width * aspect;
  let fh = aspect >= 1 ? width / aspect : width;
  const maxHeight = ceiling - HEAD_ROOM;
  if (fh > maxHeight) {
    fw *= maxHeight / fh;
    fh = maxHeight;
  }
  return { fw, fh };
}

/** 折线上某处的走向（单位向量） */
function corridorDirection(arc: number): Vec2 {
  let travelled = 0;
  for (let i = 0; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const a = CORRIDOR_PATH[i];
    const b = CORRIDOR_PATH[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (arc <= travelled + length || i === CORRIDOR_PATH.length - 2) {
      return { x: (b.x - a.x) / (length || 1), z: (b.z - a.z) / (length || 1) };
    }
    travelled += length;
  }
  return { x: 0, z: 1 };
}

/**
 * 从墙里挑出作品墙，并给每个分区定一面 hero（主视觉）墙。
 *  hero 优先挑「与长廊垂直」的那面 —— 尽端、转角正对面；房间里挑最长那面。
 */
export function deriveArtWalls(walls: WallSegment[]): ArtWall[] {
  const out: ArtWall[] = [];
  walls.forEach((wall, index) => {
    if (wall.length < MIN_WALL) return;
    const info = zone(wall.zone);
    const reserve = Math.min(CORNER_KEEP, (wall.length - 1) / 2);
    const usable = wall.length - reserve * 2;
    if (usable < 1) return;
    const type: ArtWallType =
      wall.zone === 'immersion' ? 'video' : info.kind === 'room' ? 'salon' : 'standard';
    const gap = type === 'salon' ? SALON_GAP : GAP;
    const pitch = (type === 'salon' ? TALL : WIDE) + gap;
    // 留白三成：塞得下的件数 × FILL
    const capacity = Math.max(1, Math.floor(Math.floor((usable + gap) / pitch) * FILL));
    out.push({
      id: `w${index}`,
      zone: wall.zone,
      start: wall.a,
      end: wall.b,
      normal: { x: -wall.normal.x, z: -wall.normal.z },
      length: wall.length,
      capacity,
      type,
      reservedStart: reserve,
      reservedEnd: reserve,
      ceilingHeight: wall.height,
    });
  });

  for (const info of ZONES) {
    // hero 要放得下 2.6–3.4 m 的主视觉：可用墙面够长才当 hero
    const minUsable = HERO * 0.8;
    const all = out.filter((wall) => wall.zone === info.id && wall.type !== 'video');
    if (all.length === 0) continue;
    const score = (wall: ArtWall): { endWall: boolean; length: number } => {
      const mid = { x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2 };
      const dir = corridorDirection(nearestArc(mid.x, mid.z));
      const wx = wall.end.x - wall.start.x;
      const wz = wall.end.z - wall.start.z;
      const len = Math.hypot(wx, wz) || 1;
      const dot = Math.abs((wx / len) * dir.x + (wz / len) * dir.z);
      // 长廊里「尽端墙」= 与走向垂直；房间里看长度
      return { endWall: info.kind === 'corridor' ? dot < 0.35 : true, length: wall.length };
    };
    const fits = all.filter((wall) => wall.length - wall.reservedStart - wall.reservedEnd >= minUsable);
    const pool = fits.length > 0 ? fits : all.slice().sort((a, b) => b.length - a.length).slice(0, 1);
    const scored = pool
      .map((wall) => ({ wall, ...score(wall) }))
      .sort((a, b) => Number(b.endWall) - Number(a.endWall) || b.length - a.length);
    if (scored[0]) {
      scored[0].wall.type = 'hero';
      scored[0].wall.capacity = 1;
    }
  }
  return out;
}

interface Slot {
  center: number;
  item: HangItem | null;
  fw: number;
  fh: number;
}

/**
 * 把作品排到墙上：每件只挂一次，同一组连续不过 5 件、换组留 2.5 m 空墙，
 * 填不满的格子挂中性占位画框（不复制已有作品）。
 */
export function hang(artWalls: ArtWall[], items: HangItem[]): Placement[] {
  const byZone = assignZones(items);
  const out: Placement[] = [];

  for (const wall of artWalls) {
    const queue = byZone.get(wall.zone) ?? [];
    const ceiling = wall.ceilingHeight;
    const usable = wall.length - wall.reservedStart - wall.reservedEnd;
    const gap = wall.type === 'salon' ? SALON_GAP : GAP;

    const slots: Slot[] = [];
    let right = 0;
    let previousGroup = '';
    let runInGroup = 0;

    while (slots.length < wall.capacity) {
      const item = queue.length > 0 ? queue[0] : null;
      const group = item ? item.theme : 'void';
      // 同一组连续到上限就收手
      if (item && group === previousGroup && runInGroup >= GROUP_RUN) break;

      // hero 在短墙上收一点，别超出可用长度（规格 2.6–3.4，墙不够就按墙来）
      const wanted = item
        ? wall.type === 'hero'
          ? Math.min(HERO, usable * 0.95)
          : aspectOf(item) >= 1
            ? WIDE
            : TALL
        : WIDE * 0.85;
      const box = boxOf(wanted, item ? aspectOf(item) : 3 / 2, ceiling);
      const step =
        slots.length === 0
          ? 0
          : item && previousGroup !== 'void' && group !== previousGroup
            ? GROUP_GAP
            : gap;
      const left = right + step;
      if (left + box.fw > usable + 0.01) break;

      if (item) queue.shift();
      slots.push({ center: left + box.fw / 2, item, fw: box.fw, fh: box.fh });
      right = left + box.fw;
      runInGroup = group === previousGroup ? runInGroup + 1 : 1;
      previousGroup = group;
    }

    // 整排居中
    const shift = wall.reservedStart + (usable - right) / 2;
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz) || 1;
    const ux = dx / length;
    const uz = dz / length;
    const ry = Math.atan2(wall.normal.x, wall.normal.z);

    slots.forEach((slot, index) => {
      const along = shift + slot.center;
      out.push({
        id: slot.item ? slot.item.id : `void:${wall.id}:${index}`,
        zone: wall.zone,
        wallId: wall.id,
        x: wall.start.x + ux * along + wall.normal.x * 0.06,
        y: CENTER_Y,
        z: wall.start.z + uz * along + wall.normal.z * 0.06,
        ry,
        fw: slot.fw,
        fh: slot.fh,
        title: slot.item ? slot.item.title : '',
        author: slot.item ? (slot.item.author ?? '') : '',
        kind: slot.item
          ? wall.type === 'video'
            ? 'video'
            : wall.type === 'hero'
              ? 'hero'
              : wall.type === 'salon'
                ? 'salon'
                : 'standard'
          : 'placeholder',
      });
    });
  }
  void DOOR_KEEP;
  return out;
}

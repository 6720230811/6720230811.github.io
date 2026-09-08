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
import {
  CORRIDOR,
  CORRIDOR_LOUVERS,
  CORRIDOR_PATH,
  CORRIDOR_WALL_LIGHTS,
  ZONES,
  zone,
  type LouverSpec,
  type Vec2,
  type ZoneId,
} from './blueprint';
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
  /** 房间点名的主视觉墙（RoomSpec.heroWall） */
  hero?: boolean;
  /**
   * 弧墙上能平贴墙面的最大画宽（由弦高推算）；不给 = 直墙。
   *  短于 MIN_FLAT 的弧墙（转角倒圆那一类）不挂画。
   */
  flat?: number;
  /**
   * 弧墙的折线（含首尾）。有它，作品就沿折线排 —— 直墙直接用 start→end
   *  插值就够了，弧墙那样排会让画浮在弦的外面（弧越高偏得越多）。
   */
  path?: Vec2[];
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
/** 凹龛后壁的预留：龛本身就是为这件作品开的，两端只留一点边 */
const NICHE_KEEP = 0.15;
const DOOR_KEEP = 0.9;
/** 短于这个长度就不挂画 */
const MIN_WALL = 2.6;
/**
 * 弧墙上能平贴墙面的最大画幅：短于这个就不挂。
 *  一片平的画贴在弧上，两端会陷进墙里（90° 转角那种弦高，3 m 的画两端要陷
 *  19 cm）。按弦高算出「偏离墙面不超过 5 cm」的最大宽度，够不上一件最小的
 *  画（1.1 m）就干脆不挂 —— 转角就该是转角，不是展墙。
 */
const MIN_FLAT = 1.1;
const FLAT_TOL = 0.05;
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
  // 序厅是进门第一眼：每个主题的第一件先给它，于是凹龛里的主视觉是真的作品
  city: ['entry', 'city', 'night', 'large'],
  sea: ['entry', 'tide', 'nature', 'light'],
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
    // 偏好表的第一项是「进门第一眼」那间（序厅）：只给它这个主题的第一件，
    //  其余按后面的顺序轮 —— 序厅要空，不能跟长廊一样挂满
    const zoneId =
      preference && preference.length > 0
        ? index === 0
          ? preference[0]
          : preference[1 + ((index - 1) % (preference.length - 1))]
        : 'night';
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
 * 百叶条纹落在的那面墙（行进方向的右手边，与 floor 里条纹的判定一致）。
 *  返回条纹带的那条线（沿百叶的起止）。
 */
function louverWallLine(louver: LouverSpec): Vec2[] {
  const mid =
    louver.along === 'x'
      ? { x: (louver.from + louver.to) / 2, z: louver.center }
      : { x: louver.center, z: (louver.from + louver.to) / 2 };
  const forward = corridorDirection(nearestArc(mid.x, mid.z));
  const right = { x: forward.z, z: -forward.x };
  const half = CORRIDOR.width / 2;
  const at = (t: number): Vec2 =>
    louver.along === 'x'
      ? { x: t, z: louver.center + right.z * half }
      : { x: louver.center + right.x * half, z: t };
  return [at(louver.from), at(louver.to)];
}

/**
 * 特征段占了这面墙多少（0–1）：连续光槽（慢门）与天花百叶的条纹带（光影）
 *  是那面墙的主角，作品的画框和光晕板是贴着墙面的一大片板，会整段压在
 *  光 / 条纹前面把它们挡成一截一截。按每 0.5 m 取一个样本点到特征折线算
 *  距离，落在 SLOT_KEEP 内算被占。
 */
const SLOT_KEEP = 0.25;
function featureCoverage(surface: { start: Vec2; end: Vec2 }): number {
  const dx = surface.end.x - surface.start.x;
  const dz = surface.end.z - surface.start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.5) return 0;
  const lines: Vec2[][] = [
    ...CORRIDOR_WALL_LIGHTS.map((line) => line.path),
    ...CORRIDOR_LOUVERS.map((louver) => louverWallLine(louver)),
  ];
  if (lines.length === 0) return 0;
  const steps = Math.max(2, Math.ceil(length / 0.5));
  let covered = 0;
  for (let i = 0; i <= steps; i += 1) {
    const px = surface.start.x + (dx * i) / steps;
    const pz = surface.start.z + (dz * i) / steps;
    let best = Infinity;
    for (const path of lines) {
      for (let s = 0; s + 1 < path.length; s += 1) {
        const a = path[s];
        const b = path[s + 1];
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const t = Math.max(
          0,
          Math.min(1, ((px - a.x) * ex + (pz - a.z) * ez) / (ex * ex + ez * ez || 1)),
        );
        best = Math.min(best, Math.hypot(px - (a.x + ex * t), pz - (a.z + ez * t)));
      }
    }
    if (best < SLOT_KEEP) covered += 1;
  }
  return covered / (steps + 1);
}

/**
 * 从墙里挑出作品墙，并给每个分区定一面 hero（主视觉）墙。
 *  hero 优先挑「与长廊垂直」的那面 —— 尽端、转角正对面；房间里挑最长那面。
 *  房间要是用 RoomSpec.heroWall 点名了一面，就认那一面（规格的重点墙）。
 */
/** 一面「能挂画的面」：直墙是一段，弧墙是同 group 的若干段并起来的 */
interface Surface {
  id: string;
  zone: ZoneId;
  start: Vec2;
  end: Vec2;
  /** 指向房间 / 长廊内侧（作品挂在墙面上、朝这个方向） */
  normal: Vec2;
  length: number;
  height: number;
  hero?: boolean;
  path?: Vec2[];
  /** 凹龛的后壁：两端不扣墙角预留 */
  niche?: boolean;
  /**
   * 弧墙上能平贴墙面的最大画宽（由弦高推算）。
   *  直墙不给这个字段 —— 整面都是平的。
   */
  flat?: number;
}

/**
 * 弧墙能平贴多宽的画：按「偏离墙面不超过 FLAT_TOL」从弦高反推。
 *  弦高 f 与弦长 c 已知时，宽度 w 的那段弦高约 f·(w/c)²（圆的弦高在这个
 *  量级上按平方走）—— 于是 w = c·√(FLAT_TOL/f)。f 极小（微弧、倒角）就不算了。
 */
function flatSpan(points: Vec2[]): number | undefined {
  const first = points[0];
  const last = points[points.length - 1];
  const cx = last.x - first.x;
  const cz = last.z - first.z;
  const chord = Math.hypot(cx, cz);
  if (chord < 0.5) return undefined;
  let bulge = 0;
  for (const point of points) {
    const t = ((point.x - first.x) * cx + (point.z - first.z) * cz) / (chord * chord);
    const at = Math.max(0, Math.min(1, t));
    bulge = Math.max(
      bulge,
      Math.hypot(point.x - (first.x + cx * at), point.z - (first.z + cz * at)),
    );
  }
  if (bulge < 0.01) return undefined;
  return chord * Math.sqrt(FLAT_TOL / bulge);
}

/** 两段墙首尾相接吗（弧墙拆出来的短段必须严丝合缝） */
function touches(a: WallSegment, b: WallSegment): boolean {
  return Math.hypot(a.b.x - b.a.x, a.b.z - b.a.z) < 1e-3;
}

/**
 * 把墙段并成「面」：同 group 且首尾相接的段（弧墙）合成一面，其余各是一面。
 *  不写 group 的墙行为与以前完全一样 —— 现在全馆还没有弧墙，这里只是先把
 *  路铺好（P1 的序厅凹龛、潮汐东墙都要用）。
 */
function surfaces(walls: WallSegment[]): Surface[] {
  const runs: { start: number; items: WallSegment[] }[] = [];
  const open = new Map<string, { start: number; items: WallSegment[] }>();
  walls.forEach((wall, index) => {
    // 画成实体的隔断（有厚度）：画挂上去会陷进那块体块里，跳过
    if (wall.solid) return;
    const run = wall.group ? open.get(wall.group) : undefined;
    if (run && touches(run.items[run.items.length - 1], wall)) {
      run.items.push(wall);
      return;
    }
    const next = { start: index, items: [wall] };
    runs.push(next);
    // 同 group 但接不上（中间被门洞 / 开口切掉）→ 另起一面
    if (wall.group) open.set(wall.group, next);
  });

  const out: Surface[] = [];
  for (const run of runs) {
    const first = run.items[0];
    const length = run.items.reduce((sum, piece) => sum + piece.length, 0);
    if (length < MIN_WALL) continue;
    const inward = (wall: WallSegment): Vec2 => ({ x: -wall.normal.x, z: -wall.normal.z });
    if (run.items.length === 1) {
      out.push({
        id: `w${run.start}`,
        zone: first.zone,
        start: first.a,
        end: first.b,
        normal: inward(first),
        length,
        height: first.height,
        ...(first.hero ? { hero: true } : {}),
        ...(first.niche ? { niche: true } : {}),
      });
      continue;
    }
    const last = run.items[run.items.length - 1];
    // 弧墙的法线是转的：取各段的平均方向（单位化），只用于「哪一侧是屋内」
    let nx = 0;
    let nz = 0;
    for (const piece of run.items) {
      nx += inward(piece).x;
      nz += inward(piece).z;
    }
    const len = Math.hypot(nx, nz) || 1;
    const path = [first.a, ...run.items.map((piece) => piece.b)];
    const flat = flatSpan(path);
    out.push({
      id: `w${run.start}`,
      zone: first.zone,
      start: first.a,
      end: last.b,
      normal: { x: nx / len, z: nz / len },
      length,
      height: first.height,
      path,
      ...(run.items.some((piece) => piece.hero) ? { hero: true } : {}),
      ...(run.items.some((piece) => piece.niche) ? { niche: true } : {}),
      ...(flat !== undefined ? { flat } : {}),
    });
  }
  return out;
}

export function deriveArtWalls(walls: WallSegment[]): ArtWall[] {
  const out: ArtWall[] = [];
  for (const surface of surfaces(walls)) {
    const info = zone(surface.zone);
    // 凹龛就是给作品留的：两端只让出一点点，不然 3.4 m 的龛扣掉 2.4 m 预留，
    //  3 m 的主视觉会被压成 1 m
    const reserve = surface.niche
      ? NICHE_KEEP
      : Math.min(CORNER_KEEP, (surface.length - 1) / 2);
    const usable = surface.length - reserve * 2;
    if (usable < 1) continue;
    // 弯得太急的墙不挂：画的两端会陷进墙里（转角倒圆那一类，让它是转角就好）
    if (surface.flat !== undefined && surface.flat < MIN_FLAT) continue;
    // 特征段不挂画：连续光槽 / 百叶条纹是那面墙的主角（画框和光晕板会压住它们）
    if (featureCoverage(surface) > 0.5) continue;
    const type: ArtWallType =
      surface.zone === 'immersion' ? 'video' : info.kind === 'room' ? 'salon' : 'standard';
    const gap = type === 'salon' ? SALON_GAP : GAP;
    const pitch = (type === 'salon' ? TALL : WIDE) + gap;
    // 留白三成：塞得下的件数 × FILL
    const capacity = Math.max(1, Math.floor(Math.floor((usable + gap) / pitch) * FILL));
    out.push({
      id: surface.id,
      zone: surface.zone,
      start: surface.start,
      end: surface.end,
      normal: surface.normal,
      length: surface.length,
      capacity,
      type,
      reservedStart: reserve,
      reservedEnd: reserve,
      ceilingHeight: surface.height,
      ...(surface.hero ? { hero: true } : {}),
      ...(surface.path ? { path: surface.path } : {}),
    });
  }

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
    const longEnough = (wall: ArtWall): boolean =>
      wall.length - wall.reservedStart - wall.reservedEnd >= minUsable;
    // 房间点名的那面优先（规格的重点墙就是要挂主视觉的），其次才是「放得下的」、
    // 再其次退到最长那面
    const marked = all.filter((wall) => wall.hero && longEnough(wall));
    const fits = all.filter(longEnough);
    const pool =
      marked.length > 0
        ? marked
        : fits.length > 0
          ? fits
          : all.slice().sort((a, b) => b.length - a.length).slice(0, 1);
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

/**
 * 沿折线走 along 米：返回墙面上的那点与朝向。
 *  局部法线取垂直于当前这一段、且与整面墙的 normal 同侧的那一个 ——
 *  于是弧墙上每一件都正对自己脚下那段墙，而不是齐刷刷朝一个方向。
 */
function alongPath(
  path: Vec2[],
  normal: Vec2,
  along: number,
): { x: number; z: number; ry: number } {
  let left = along;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    if (left > length && i + 2 < path.length) {
      left -= length;
      continue;
    }
    const ux = dx / length;
    const uz = dz / length;
    let nx = -uz;
    let nz = ux;
    if (nx * normal.x + nz * normal.z < 0) {
      nx = uz;
      nz = -ux;
    }
    const t = Math.max(0, Math.min(1, left / length));
    return {
      x: a.x + ux * t + nx * 0.06,
      z: a.z + uz * t + nz * 0.06,
      ry: Math.atan2(nx, nz),
    };
  }
  const last = path[path.length - 1];
  return {
    x: last.x + normal.x * 0.06,
    z: last.z + normal.z * 0.06,
    ry: Math.atan2(normal.x, normal.z),
  };
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
      // 弧墙沿折线走（每件的朝向跟着墙转），直墙仍是 start→end 直线插值
      const at = wall.path
        ? alongPath(wall.path, wall.normal, along)
        : {
            x: wall.start.x + ux * along + wall.normal.x * 0.06,
            z: wall.start.z + uz * along + wall.normal.z * 0.06,
            ry,
          };
      out.push({
        id: slot.item ? slot.item.id : `void:${wall.id}:${index}`,
        zone: wall.zone,
        wallId: wall.id,
        x: at.x,
        y: CENTER_Y,
        z: at.z,
        ry: at.ry,
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

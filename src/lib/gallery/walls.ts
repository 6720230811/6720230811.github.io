/**
 * 从蓝图长出墙体（纯数据，不 import three）。
 *
 *  三样东西要长出来：
 *  1. **主长廊**：把中心线朝左右各偏移半个净宽（2 m），转角用 miter 斜接让
 *     两面墙连续不断开；转角内侧再切一个 0.05 m 的小倒角，相机贴墙时不生硬。
 *     每段墙记下自己在折线上的弧长，于是「这段墙属于第几章」是算出来的。
 *  2. **房间**：四面墙，按门洞断开成几段。长廊穿过来的房间（序厅 / 中央大厅 /
 *     总览区）会把范围内的长廊墙裁掉，由房间自己的墙接管 —— 于是这些房间是
 *     长廊放宽出来的节点，不是另开的一间方屋。
 *  3. **支廊**：同样是中心线两侧偏移，两端是敞口的（接房间门洞）。
 *
 *  最后所有墙一起：
 *  - 去掉落在「必须开敞」的范围里的部分（穿堂房间、长廊上的支廊口子）
 *  - 去掉重合的墙（房间墙与长廊墙共用一条线时只留一段，免得 z-fighting）
 *  - 每段墙按它所在的分区记下净高与墙色
 *
 *  normal 的约定（与原来的 hilbert.ts 一致）：**指向人进不去的一侧**（墙芯 /
 *  房间外 / 隔断内部）。作品挂在 -normal 那一面。
 */
import {
  BODY_R,
  BRANCHES,
  CORRIDOR,
  CORRIDOR_CUTS,
  CORRIDOR_PATH,
  PORCHES,
  ROOMS,
  ZONES,
  zone,
  type BranchSpec,
  type DoorSpec,
  type RoomSpec,
  type Vec2,
  type WallKey,
  type ZoneId,
} from './blueprint';

export interface WallSegment {
  a: Vec2;
  b: Vec2;
  /** 指向墙芯（人进不去的一侧）；作品挂在 -normal 一面 */
  normal: Vec2;
  length: number;
  /** 这面墙的净高（随分区） */
  height: number;
  zone: ZoneId;
  kind: 'base' | 'accent' | 'partition';
  /** 这一片的墙色（序厅四面各一色、可移动展墙有自己的色）；不给就用分区墙色 */
  tint?: string;
}

export interface DoorOpening {
  /** 门洞中心 */
  x: number;
  z: number;
  width: number;
  height: number;
  /** 墙的走向（绕 Y 的角度），门套与拱券按它摆 */
  ry: number;
  depth: number;
  arch: boolean;
  zone: ZoneId;
}

export interface Obstacle {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

const HALF_T = CORRIDOR.wallT / 2;
/** 轴对齐判定用的容差 */
const EPS = 1e-6;

function norm(x: number, z: number): Vec2 {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}


/** 长廊分区：按弧长落在哪一章 */
function corridorZoneAt(arc: number): ZoneId {
  for (const item of ZONES) {
    if (item.kind === 'corridor' && item.span && arc >= item.span[0] && arc <= item.span[1]) {
      return item.id;
    }
  }
  return 'final';
}

/**
 * 把折线朝一侧偏移：顶点用 miter 斜接（两段延长相交，转角不留缺口）。
 * side = +1 是行进方向的左手侧，-1 是右手侧。
 *
 * 转角内侧（拐弯的那一侧）切一个 chamfer 米的小倒角：把 miter 顶点换成沿
 * 两侧各退 chamfer 的两个点。
 */
function offsetPath(points: Vec2[], distance: number, side: 1 | -1, chamfer: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const cur = points[i];
    const prev = i > 0 ? points[i - 1] : undefined;
    const next = i < points.length - 1 ? points[i + 1] : undefined;

    if (!prev || !next) {
      // 端点：用唯一那一段的法线
      const ref = next
        ? { x: next.x - cur.x, z: next.z - cur.z }
        : { x: cur.x - prev!.x, z: cur.z - prev!.z };
      const n = norm(ref.x, ref.z);
      out.push({ x: cur.x + -n.z * side * distance, z: cur.z + n.x * side * distance });
      continue;
    }

    const d1 = norm(cur.x - prev.x, cur.z - prev.z);
    const d2 = norm(next.x - cur.x, next.z - cur.z);
    // n1 / n2 是**单位**法线（不要乘 distance —— 下面最后会统一乘一次，
    // 乘两次会让偏移量变成 distance²，走廊只剩一半宽）
    const n1 = { x: -d1.z * side, z: d1.x * side };
    const n2 = { x: -d2.z * side, z: d2.x * side };

    // miter：两段法线相加，再按 1/cos(θ/2) 修正长度
    let mx = n1.x + n2.x;
    let mz = n1.z + n2.z;
    const len = Math.hypot(mx, mz);
    if (len < 1e-6) {
      mx = n1.x;
      mz = n1.z;
    } else {
      const cos = (n1.x * mx + n1.z * mz) / len;
      const scale = 1 / Math.max(cos, 0.35);
      mx = (mx / len) * scale;
      mz = (mz / len) * scale;
    }
    const vertex = { x: cur.x + mx * distance, z: cur.z + mz * distance };

    // 拐弯方向：cross > 0 是左转。左手偏移（side=+1）在左转时位于转角内侧
    const cross = d1.x * d2.z - d1.z * d2.x;
    if (Math.sign(cross) === side && chamfer > 0) {
      // 倒角：把 miter 顶点换掉 —— 沿来向退 chamfer、沿去向进 chamfer，
      // 中间连一条斜边，于是尖角被切掉一小块（0.05 m）
      out.push({ x: vertex.x - d1.x * chamfer, z: vertex.z - d1.z * chamfer });
      out.push({ x: vertex.x + d2.x * chamfer, z: vertex.z + d2.z * chamfer });
      continue;
    }

    out.push(vertex);
  }
  return out;
}

/** 一条偏移折线 → 墙段（normal 朝墙芯，即偏移的那一侧）。分区按每段中点算，
 *  不用下标 —— 倒角会往折线里插点，下标跟中心线对不上。 */
function polylineWalls(
  path: Vec2[],
  side: 1 | -1,
  info: { heightOf: (mid: Vec2) => number; kind: WallSegment['kind'] },
  zoneOf: (mid: Vec2) => ZoneId,
  tintOf?: (mid: Vec2, side: 1 | -1) => string | undefined,
): WallSegment[] {
  const out: WallSegment[] = [];
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.02) continue;
    const d = norm(dx, dz);
    out.push({
      a,
      b,
      normal: { x: -d.z * side, z: d.x * side },
      length,
      height: info.heightOf({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }),
      zone: zoneOf({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }),
      kind: info.kind,
      tint: tintOf?.({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, side),
    });
  }
  return out;
}

/** 一面墙拆成若干段：落在这段里的 [from, to] 区间要挖掉 */
function splitByGaps(
  from: number,
  to: number,
  gaps: { start: number; end: number }[],
  minLength = 0.25,
): { start: number; end: number }[] {
  const sorted = [...gaps].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cursor = from;
  for (const gap of sorted) {
    if (gap.start > cursor) out.push({ start: cursor, end: Math.min(gap.start, to) });
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out.filter((piece) => piece.end - piece.start >= minLength);
}

/** 门洞在它那面墙上的区间（沿墙坐标） */
function doorGap(door: DoorSpec): { start: number; end: number } {
  return { start: door.at - door.width / 2, end: door.at + door.width / 2 };
}

/** 房间的一面墙：起止点 + 法线（朝房间外）+ 门洞。
 *  注意 +Z 是北，所以「北墙」是 z2 那一条、「南墙」是 z1 那一条。 */
function roomWall(
  room: RoomSpec,
  key: WallKey,
): { a: Vec2; b: Vec2; normal: Vec2; axis: 'x' | 'z'; from: number; to: number } {
  const { x1, z1, x2, z2 } = room.rect;
  if (key === 'n') return { a: { x: x1, z: z2 }, b: { x: x2, z: z2 }, normal: { x: 0, z: 1 }, axis: 'x', from: x1, to: x2 };
  if (key === 's') return { a: { x: x1, z: z1 }, b: { x: x2, z: z1 }, normal: { x: 0, z: -1 }, axis: 'x', from: x1, to: x2 };
  if (key === 'w') return { a: { x: x1, z: z1 }, b: { x: x1, z: z2 }, normal: { x: -1, z: 0 }, axis: 'z', from: z1, to: z2 };
  return { a: { x: x2, z: z1 }, b: { x: x2, z: z2 }, normal: { x: 1, z: 0 }, axis: 'z', from: z1, to: z2 };
}

function roomWalls(room: RoomSpec): WallSegment[] {
  const out: WallSegment[] = [];
  const info = zone(room.id);
  for (const key of ['n', 'e', 's', 'w'] as WallKey[]) {
    const wall = roomWall(room, key);
    const gaps = room.doors.filter((door) => door.wall === key).map(doorGap);
    for (const piece of splitByGaps(wall.from, wall.to, gaps)) {
      const a = wall.axis === 'x' ? { x: piece.start, z: wall.a.z } : { x: wall.a.x, z: piece.start };
      const b = wall.axis === 'x' ? { x: piece.end, z: wall.a.z } : { x: wall.a.x, z: piece.end };
      out.push({
        a,
        b,
        normal: wall.normal,
        length: piece.end - piece.start,
        height: info.ceiling,
        zone: room.id,
        kind: 'base',
        tint: room.wallColors?.[key],
      });
    }
  }
  return out;
}

/** 房间里的隔墙 / 可移动展墙：两面都能挂画，但这里只当墙（碰撞 + 投影） */
function propWalls(room: RoomSpec): WallSegment[] {
  const out: WallSegment[] = [];
  for (const prop of room.props) {
    if (prop.kind !== 'partition') continue;
    const horizontal = Math.abs(prop.x2 - prop.x1) >= Math.abs(prop.z2 - prop.z1);
    out.push({
      a: { x: prop.x1, z: prop.z1 },
      b: { x: prop.x2, z: prop.z2 },
      // 隔断的法线：任取一侧（画会挂在 -normal 面；S4 再决定两面都挂）
      normal: horizontal ? { x: 0, z: -1 } : { x: -1, z: 0 },
      length: Math.hypot(prop.x2 - prop.x1, prop.z2 - prop.z1),
      height: prop.h,
      zone: room.id,
      kind: 'partition',
      tint: prop.tint,
    });
  }
  return out;
}

/** 支廊：中心线两侧各一道墙，两端敞口 */
function branchWalls(branch: BranchSpec): WallSegment[] {
  const path = [branch.from, branch.to];
  // 支廊的顶还是长廊标准高（3.6），墙跟它齐，别顶到所属房间那么高
  const meta = { heightOf: () => CORRIDOR.height, kind: 'base' as const };
  return [
    ...polylineWalls(offsetPath(path, branch.width / 2, 1, 0), 1, meta, () => branch.zone),
    ...polylineWalls(offsetPath(path, branch.width / 2, -1, 0), -1, meta, () => branch.zone),
  ];
}

/** 门廊三面墙（朝北敞口，接房间门洞） */
export function porchWalls(): WallSegment[] {
  const out: WallSegment[] = [];
  for (const rect of PORCHES) {
    const near = PORCHES.indexOf(rect) === 0 ? 'entry' : 'overview';
    const info = zone(near);
    const push = (a: Vec2, b: Vec2, normal: Vec2): void => {
      out.push({
        a,
        b,
        normal,
        length: Math.hypot(b.x - a.x, b.z - a.z),
        height: info.ceiling,
        zone: near,
        kind: 'base',
      });
    };
    push({ x: rect.x1, z: rect.z1 }, { x: rect.x2, z: rect.z1 }, { x: 0, z: -1 });
    push({ x: rect.x1, z: rect.z1 }, { x: rect.x1, z: rect.z2 }, { x: -1, z: 0 });
    push({ x: rect.x2, z: rect.z1 }, { x: rect.x2, z: rect.z2 }, { x: 1, z: 0 });
  }
  return out;
}

/** 矩形范围（用于裁墙）：必须开敞的区域 */
interface Opening {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * 把一段墙落在 opening 里的部分切掉。墙是轴对齐的（倒角那 0.05 m 斜边除外），
 * 所以按区间切就行。
 */
function trimWall(wall: WallSegment, openings: Opening[]): WallSegment[] {
  let pieces: WallSegment[] = [wall];
  for (const opening of openings) {
    const next: WallSegment[] = [];
    for (const piece of pieces) {
      const horizontal = Math.abs(piece.a.z - piece.b.z) < EPS;
      const vertical = Math.abs(piece.a.x - piece.b.x) < EPS;
      if (!horizontal && !vertical) {
        // 倒角那截斜边：中点在外就整段留下，在内就整段去掉
        const mid = { x: (piece.a.x + piece.b.x) / 2, z: (piece.a.z + piece.b.z) / 2 };
        const inside =
          mid.x > opening.x1 && mid.x < opening.x2 && mid.z > opening.z1 && mid.z < opening.z2;
        if (!inside) next.push(piece);
        continue;
      }
      const lo = horizontal ? Math.min(piece.a.x, piece.b.x) : Math.min(piece.a.z, piece.b.z);
      const hi = horizontal ? Math.max(piece.a.x, piece.b.x) : Math.max(piece.a.z, piece.b.z);
      const oLo = horizontal ? opening.x1 - HALF_T : opening.z1 - HALF_T;
      const oHi = horizontal ? opening.x2 + HALF_T : opening.z2 + HALF_T;
      const fixed = horizontal ? piece.a.z : piece.a.x;
      const crosses =
        fixed > (horizontal ? opening.z1 - HALF_T : opening.x1 - HALF_T) &&
        fixed < (horizontal ? opening.z2 + HALF_T : opening.x2 + HALF_T);
      if (!crosses || hi <= oLo || lo >= oHi) {
        next.push(piece);
        continue;
      }
      const at = (value: number): Vec2 =>
        horizontal ? { x: value, z: fixed } : { x: fixed, z: value };
      if (lo < oLo) {
        next.push({ ...piece, a: at(lo), b: at(oLo), length: oLo - lo });
      }
      if (hi > oHi) {
        next.push({ ...piece, a: at(oHi), b: at(hi), length: hi - oHi });
      }
    }
    pieces = next;
  }
  return pieces.filter((piece) => piece.length >= 0.2);
}

type Axis = 'h' | 'v' | 'd';

function axisOf(wall: WallSegment): Axis {
  if (Math.abs(wall.a.z - wall.b.z) < 1e-3) return 'h';
  if (Math.abs(wall.a.x - wall.b.x) < 1e-3) return 'v';
  return 'd';
}

/**
 * 去掉重合的墙：房间墙与长廊墙、支廊墙与长廊墙常共用一条线（比如大型作品厅
 * 的北墙就是终章长廊的南墙），两段共面墙叠在一起会 z-fighting，只留先来的
 * 那段（长廊优先，所以传进来的顺序有意义）。
 */
function dropDuplicates(walls: WallSegment[]): WallSegment[] {
  const out: WallSegment[] = [];
  for (const wall of walls) {
    const axis = axisOf(wall);
    if (axis === 'd') {
      out.push(wall);
      continue;
    }
    const horizontal = axis === 'h';
    const fixed = horizontal ? wall.a.z : wall.a.x;
    const lo = horizontal ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.z, wall.b.z);
    const hi = horizontal ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.z, wall.b.z);
    const clash = out.some((other) => {
      if (axisOf(other) !== axis) return false;
      const otherFixed = horizontal ? other.a.z : other.a.x;
      if (Math.abs(otherFixed - fixed) > 0.05) return false;
      const oLo = horizontal ? Math.min(other.a.x, other.b.x) : Math.min(other.a.z, other.b.z);
      const oHi = horizontal ? Math.max(other.a.x, other.b.x) : Math.max(other.a.z, other.b.z);
      // 重叠超过 0.5 m 才算重复：门洞两侧那几截短墙要留下
      return Math.min(hi, oHi) - Math.max(lo, oLo) > 0.5;
    });
    if (!clash) out.push(wall);
  }
  return out;
}

/** 墙的 AABB 障碍：向厚度方向膨胀半墙厚 + 人身半径 */
function wallObstacle(wall: WallSegment): Obstacle {
  const margin = HALF_T + BODY_R;
  return {
    x1: Math.min(wall.a.x, wall.b.x) - margin,
    x2: Math.max(wall.a.x, wall.b.x) + margin,
    z1: Math.min(wall.a.z, wall.b.z) - margin,
    z2: Math.max(wall.a.z, wall.b.z) + margin,
  };
}

/** 房间的门洞（含拱券），供场景做门套 */
function doorOpenings(room: RoomSpec): DoorOpening[] {
  const { x1, z1, x2, z2 } = room.rect;
  return room.doors.map((door) => {
    const horizontal = door.wall === 'n' || door.wall === 's';
    // +Z 是北：北墙在 z2、南墙在 z1
    const fixed = door.wall === 'n' ? z2 : door.wall === 's' ? z1 : door.wall === 'w' ? x1 : x2;
    return {
      x: horizontal ? door.at : fixed,
      z: horizontal ? fixed : door.at,
      width: door.width,
      height: door.height,
      ry: horizontal ? 0 : Math.PI / 2,
      depth: door.arch ? 0.25 : 0.22,
      arch: !!door.arch,
      zone: room.id,
    };
  });
}

export interface BuildResult {
  walls: WallSegment[];
  doors: DoorOpening[];
  obstacles: Obstacle[];
}

/** 长出来整栋楼的墙 */
export function buildWalls(): BuildResult {
  const half = CORRIDOR.width / 2;

  // 1) 主长廊：两侧偏移，段落按中点的弧长落到某一章
  const corridor: WallSegment[] = [];
  for (const side of [1, -1] as (1 | -1)[]) {
    const path = offsetPath(CORRIDOR_PATH, half, side, CORRIDOR.chamfer);
    corridor.push(
      ...polylineWalls(
        path,
        side,
        // 墙高跟着章节净高走：自然 3.8、光影 4.0 —— 墙不跟到顶，墙顶与天花之间会漏光
        { heightOf: (mid) => zone(corridorZoneAt(nearestArc(mid.x, mid.z))).ceiling, kind: 'base' },
        (mid) => corridorZoneAt(nearestArc(mid.x, mid.z)),
        // 左右墙可以各一色（城市长廊：左微水泥、右矿物灰泥）。
        // side = +1 时墙芯在右手边，也就是人站在长廊里时的左墙。
        (mid, wallSide) => {
          const own = zone(corridorZoneAt(nearestArc(mid.x, mid.z))).sideWalls;
          return own?.[wallSide === 1 ? 'left' : 'right'];
        },
      ),
    );
  }

  // 2) 必须开敞的范围：长廊穿过的房间、长廊上给支廊开的口子
  const openings: Opening[] = [
    ...ROOMS.filter((room) => room.corridorThrough).map((room) => room.rect),
    ...CORRIDOR_CUTS,
  ];
  const trimmedCorridor = corridor.flatMap((wall) => trimWall(wall, openings));

  // 3) 支廊
  const branches = BRANCHES.flatMap(branchWalls);

  // 4) 房间墙 + 隔墙 + 门廊；房间墙要避开支廊占用的那一条（支廊两端门洞已在门表里）
  const roomWallList = ROOMS.flatMap(roomWalls);
  const propWallList = ROOMS.flatMap(propWalls);

  // 长廊墙优先，重合的房间墙/支廊墙让位
  const walls = dropDuplicates([
    ...trimmedCorridor,
    ...branches,
    ...roomWallList,
    ...propWallList,
    ...porchWalls(),
  ]);

  return {
    walls,
    doors: ROOMS.flatMap(doorOpenings),
    obstacles: walls.map(wallObstacle),
  };
}

/** 分区判定：先房间，再支廊，最后按长廊弧长落到某一章 */
export function zoneAt(x: number, z: number): ZoneId {
  for (const room of ROOMS) {
    const { x1, z1, x2, z2 } = room.rect;
    if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return room.id;
  }
  for (const branch of BRANCHES) {
    const halfBranch = branch.width / 2;
    const x1 = Math.min(branch.from.x, branch.to.x) - halfBranch;
    const x2 = Math.max(branch.from.x, branch.to.x) + halfBranch;
    const z1 = Math.min(branch.from.z, branch.to.z) - halfBranch;
    const z2 = Math.max(branch.from.z, branch.to.z) + halfBranch;
    if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return branch.zone;
  }
  return corridorZoneAt(nearestArc(x, z));
}

/** 点到折线最近处的弧长 */
export function nearestArc(x: number, z: number): number {
  let best = 0;
  let bestDist = Infinity;
  let travelled = 0;
  for (let i = 0; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const a = CORRIDOR_PATH[i];
    const b = CORRIDOR_PATH[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (length * length)));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const dist = (x - px) ** 2 + (z - pz) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = travelled + length * t;
    }
    travelled += length;
  }
  return best;
}

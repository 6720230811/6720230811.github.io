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
  CORRIDOR_NICHES,
  CORRIDOR_PATH,
  CORRIDOR_ROUNDS,
  CORRIDOR_VISTAS,
  PORCHES,
  ROOMS,
  ZONES,
  zone,
  type BranchSpec,
  type DoorSpec,
  type NicheSpec,
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
  /** 房间点名的主视觉墙（RoomSpec.heroWall）：hang.ts 优先把 hero 挂这儿 */
  hero?: boolean;
  /**
   * 同一面连续墙面的编号（弧墙是拆成一串短段画出来的）。
   *  hang.ts 把同 group 且首尾相接的段合并成一面「作品墙」—— 不然每段 0.6 m
   *  都短于最短挂画长度，整面弧墙一张都挂不上。
   */
  group?: string;
  /** 凹龛的后壁：挂画时不扣墙角预留（龛就是给作品留的，两端不用让） */
  niche?: boolean;
  /** 已经画成有厚度的实体（隔断给了 t）：别再画它那张纸，也别往它身上挂画 */
  solid?: boolean;
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
  /** 门楣跟着它所在那面墙走色（序厅与大型作品厅四面各一色） */
  tint?: string;
}

export interface Obstacle {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** 凹龛的洞口（供场景做龛楣与龛内的暗缝灯）：(x1,z1)-(x2,z2) 是洞口这条线 */
export interface NicheOpening {
  zone: ZoneId;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** 从洞口往墙里退的方向（单位向量） */
  nx: number;
  nz: number;
  depth: number;
  /** 洞口顶高（米），上面是龛楣 */
  top: number;
  /** 洞口底高（米），下面是龛台 */
  bottom: number;
  tint?: string;
}

const HALF_T = CORRIDOR.wallT / 2;
/** 人贴着墙能站到的最近距离：半墙厚 + 人身半径 */
export const CLEARANCE = HALF_T + BODY_R;
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
 * 偏移折线上的一点。带 group 的那几点（弧墙）会被挂画逻辑并成一面墙，
 *  没有 group 的就是普通的一段直墙。
 */
interface PathPoint extends Vec2 {
  group?: string;
}

/**
 * 凸角倒圆：两条偏移线各往里挪 r，交点就是圆心；再从第一条线的切点扫到第二条。
 *
 *  返回一串点，除最后一点之外都带 group —— 最后一点之后那段已经不是弧了，
 *  带上 group 会把后面那截直墙也算进这面弧墙。
 *  切点越界（r 大于两侧直墙的一半）时返回 null，调用方退回尖角。
 */
function cornerArc(
  vertex: Vec2,
  d1: Vec2,
  d2: Vec2,
  n1: Vec2,
  n2: Vec2,
  radius: number,
  group: string,
): PathPoint[] | null {
  // 圆心：line1 过 (vertex - n1·r) 方向 d1，line2 过 (vertex - n2·r) 方向 d2
  const p1 = { x: vertex.x - n1.x * radius, z: vertex.z - n1.z * radius };
  const p2 = { x: vertex.x - n2.x * radius, z: vertex.z - n2.z * radius };
  const den = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((p2.x - p1.x) * d2.z - (p2.z - p1.z) * d2.x) / den;
  const cx = p1.x + d1.x * t;
  const cz = p1.z + d1.z * t;
  // 两个切点：圆心沿两侧法线各推 r（推回原来那两条偏移线上）
  const t1 = { x: cx + n1.x * radius, z: cz + n1.z * radius };
  const t2 = { x: cx + n2.x * radius, z: cz + n2.z * radius };
  const a1 = Math.atan2(t1.z - cz, t1.x - cx);
  const a2 = Math.atan2(t2.z - cz, t2.x - cx);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const count = Math.max(4, Math.ceil((Math.abs(sweep) * radius) / 0.6));
  const out: PathPoint[] = [];
  for (let i = 0; i <= count; i += 1) {
    const angle = a1 + (sweep * i) / count;
    const point = { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius };
    out.push(i === count ? point : { ...point, group });
  }
  return out;
}

/**
 * 把折线朝一侧偏移：顶点用 miter 斜接（两段延长相交，转角不留缺口）。
 * side = +1 是行进方向的左手侧，-1 是右手侧。
 *
 * 转角内侧（拐弯的那一侧）切一个 chamfer 米的小倒角：把 miter 顶点换成沿
 * 两侧各退 chamfer 的两个点。
 *
 * rounds 里点名的折点，若这一侧正好是外侧（凸角），尖角换成一段圆弧；
 * 半径会被两侧直墙的长度压住（切点不能跑到直墙外面去）。
 */
function offsetPath(
  points: Vec2[],
  distance: number,
  side: 1 | -1,
  chamfer: number,
  rounds?: Map<number, number>,
): PathPoint[] {
  const out: PathPoint[] = [];
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

    // 倒圆：这一侧是外侧（凸角）且这个折点配了半径 → 尖角换成一段圆弧。
    //  半径压到两侧直墙的四成，免得切点跑到直墙外面、把直墙整段吃掉
    const wanted = rounds?.get(i);
    if (wanted) {
      const limit =
        Math.min(Math.hypot(cur.x - prev.x, cur.z - prev.z), Math.hypot(next.x - cur.x, next.z - cur.z)) * 0.4;
      const arc = cornerArc(
        vertex,
        d1,
        d2,
        n1,
        n2,
        Math.min(wanted, limit),
        `round-${i}`,
      );
      if (arc) {
        out.push(...arc);
        continue;
      }
    }

    out.push(vertex);
  }
  return out;
}

/** 一条偏移折线 → 墙段（normal 朝墙芯，即偏移的那一侧）。分区按每段中点算，
 *  不用下标 —— 倒角会往折线里插点，下标跟中心线对不上。 */
function polylineWalls(
  path: PathPoint[],
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
      // 带 group 的（倒圆拆出来的短段）并成一面墙：挂画时不会再被当成八面碎墙
      ...(a.group ? { group: a.group } : {}),
    });
  }
  return out;
}

/**
 * 一串点 → 墙段：法线取垂直于这一段、且与 hint 同侧的那一侧。
 *  房间墙（微弧 / 凹龛）用这个：它们不像长廊那样有「左手/右手」的约定，
 *  只知道墙芯该在房间的外面。
 */
function pathWalls(
  path: Vec2[],
  hint: Vec2,
  meta: { height: number; zone: ZoneId; kind: WallSegment['kind']; tint?: string; group?: string; hero?: boolean; niche?: boolean },
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
    let nx = -d.z;
    let nz = d.x;
    if (nx * hint.x + nz * hint.z < 0) {
      nx = -nx;
      nz = -nz;
    }
    out.push({
      a,
      b,
      normal: { x: nx, z: nz },
      length,
      height: meta.height,
      zone: meta.zone,
      kind: meta.kind,
      ...(meta.tint ? { tint: meta.tint } : {}),
      ...(meta.group ? { group: meta.group } : {}),
      ...(meta.hero ? { hero: true } : {}),
      ...(meta.niche ? { niche: true } : {}),
    });
  }
  return out;
}

/**
 * 弧墙：圆心 (cx, cz)、半径 r，从 from 扫到 to，拆成一串短墙段。
 *
 *  弧在引擎里没有真曲线 —— 拆成足够短的直段（默认每段约 0.6 m），墙还是
 *  那个 InstancedMesh 的一片 plane，只是拼成一条弧。所有段共用一个 group：
 *  挂画时它们会被并成一面墙（见 hang.ts:deriveArtWalls）。
 *
 *  side = +1 时 normal 指向圆心那侧（与 polylineWalls 的约定一致）；
 *  房间那面「向外鼓」的弧（墙芯在房间外）用 +1，凹进去的龛用 -1。
 */
export function arcWall(options: {
  cx: number;
  cz: number;
  r: number;
  /** 起止角（弧度，世界 XZ 平面） */
  from: number;
  to: number;
  height: number;
  zone: ZoneId;
  /** 合并挂画用的组名（同一面弧必须同一个） */
  group: string;
  /** 分段数；不给就按弧长每 0.6 m 一段 */
  segments?: number;
  side?: 1 | -1;
  kind?: WallSegment['kind'];
  tint?: string;
  hero?: boolean;
}): WallSegment[] {
  const { cx, cz, r, from, to, height, zone, group } = options;
  const span = Math.abs(to - from);
  const segments = options.segments ?? Math.max(6, Math.round((span * r) / 0.6));
  const path: Vec2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = from + ((to - from) * i) / segments;
    path.push({ x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r });
  }
  return polylineWalls(
    path,
    options.side ?? 1,
    { heightOf: () => height, kind: options.kind ?? 'base' },
    () => zone,
    () => options.tint,
  ).map((wall) => ({
    ...wall,
    group,
    ...(options.hero ? { hero: true } : {}),
  }));
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
  if (key === 's') return { a: { x: x1, z: z1 }, b: { x: x2, z: z1 }, normal: { x: 0, z: -1 }, axis: 'z', from: x1, to: x2 };
  if (key === 'w') return { a: { x: x1, z: z1 }, b: { x: x1, z: z2 }, normal: { x: -1, z: 0 }, axis: 'z', from: z1, to: z2 };
  return { a: { x: x2, z: z1 }, b: { x: x2, z: z2 }, normal: { x: 1, z: 0 }, axis: 'z', from: z1, to: z2 };
}

/**
 * 微弧：这面墙的全长是弦，矢高 bulge（正 = 朝房间外鼓）。
 *  返回「沿墙坐标 s 处的点」—— 门洞与门廊的收头都靠它算（它们得跟着弧走）。
 */
function arcPointAt(
  wall: { a: Vec2; b: Vec2; normal: Vec2; from: number; to: number },
  bulge: number,
  value: number,
): Vec2 {
  const straight = (s: number): Vec2 => {
    const dx = wall.b.x - wall.a.x;
    const dz = wall.b.z - wall.a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: wall.a.x + (dx / len) * s, z: wall.a.z + (dz / len) * s };
  };
  const chord = wall.to - wall.from;
  if (!bulge || chord <= 0) return straight(value - wall.from);
  const f = Math.abs(bulge);
  const r = (chord * chord) / (4 * f) / 2 + f / 2;
  const x = value - wall.from - chord / 2;
  // 离弦的距离：中点处正好是矢高 f，两端归零
  const off = -(r - f) + Math.sqrt(Math.max(0, r * r - x * x));
  const sign = bulge > 0 ? 1 : -1;
  const point = straight(value - wall.from);
  return { x: point.x + wall.normal.x * off * sign, z: point.z + wall.normal.z * off * sign };
}

/** 一面墙的 [from, to] 段（沿墙坐标）：不给 bulge 就是直墙，给了就用一串短段拼成微弧 */
function wallStrip(
  wall: { a: Vec2; b: Vec2; normal: Vec2; from: number; to: number },
  from: number,
  to: number,
  meta: { height: number; zone: ZoneId; tint?: string; group?: string; hero?: boolean },
): WallSegment[] {
  const straight = { a: arcPointAt(wall, 0, from), b: arcPointAt(wall, 0, to) };
  return pathWalls([straight.a, straight.b], wall.normal, {
    ...meta,
    kind: 'base',
  });
}

/** 微弧版 wallStrip（只有 RoomSpec.arc 写了这面墙才走这里） */
function arcStrip(
  wall: { a: Vec2; b: Vec2; normal: Vec2; from: number; to: number },
  bulge: number,
  from: number,
  to: number,
  meta: { height: number; zone: ZoneId; tint?: string; group?: string; hero?: boolean },
): WallSegment[] {
  const step = 0.6;
  const count = Math.max(2, Math.ceil((to - from) / step));
  const path: Vec2[] = [];
  for (let i = 0; i <= count; i += 1) {
    path.push(arcPointAt(wall, bulge, from + ((to - from) * i) / count));
  }
  return pathWalls(path, wall.normal, { ...meta, kind: 'base' });
}

/**
 * 折墙（锯齿）：把一面墙等分几段，每段给一个偏移，拼成一条折线。
 *  大型作品厅的南墙就是这样：中间凸出去一块、两侧各凹进来一点，
 *  于是同一面墙上能挂三张互不干扰的画（每段朝向不同，视线不打架）。
 *  首尾两个偏移必须是 0 —— 要接得上转角。
 */
function foldStrip(
  wall: { a: Vec2; b: Vec2; normal: Vec2; from: number; to: number },
  offsets: number[],
  meta: { height: number; zone: ZoneId; tint?: string; group?: string; hero?: boolean },
): WallSegment[] {
  const steps = offsets.length - 1;
  if (steps < 1) return [];
  const path: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const value = wall.from + ((wall.to - wall.from) * i) / steps;
    const base = arcPointAt(wall, 0, value);
    path.push({
      x: base.x + wall.normal.x * offsets[i],
      z: base.z + wall.normal.z * offsets[i],
    });
  }
  return pathWalls(path, wall.normal, { ...meta, kind: 'base' });
}

/** 凹龛：两侧的门垛 + 后壁（后壁挂主视觉，所以带 hero 与 niche 两个标记） */
function nicheWalls(
  room: RoomSpec,
  wall: { a: Vec2; b: Vec2; normal: Vec2; from: number; to: number },
  niche: NicheSpec,
  height: number,
  hero: boolean,
): WallSegment[] {
  const tint = room.wallColors?.[niche.wall];
  const meta = { height, zone: room.id, tint, kind: 'base' as const };
  const half = niche.width / 2;
  const at = (value: number): Vec2 => arcPointAt(wall, room.arc?.[niche.wall] ?? 0, value);
  const s1 = niche.at - half;
  const s2 = niche.at + half;
  const open1 = at(s1);
  const open2 = at(s2);
  const back1 = { x: open1.x + wall.normal.x * niche.depth, z: open1.z + wall.normal.z * niche.depth };
  const back2 = { x: open2.x + wall.normal.x * niche.depth, z: open2.z + wall.normal.z * niche.depth };
  // 门垛：法线朝龛外（即墙芯在龛的两侧），后壁：法线朝房间外
  const sideHint1 = { x: -(open2.x - open1.x), z: -(open2.z - open1.z) };
  return [
    ...pathWalls([open1, back1], sideHint1, meta),
    ...pathWalls([open2, back2], { x: -sideHint1.x, z: -sideHint1.z }, meta),
    ...pathWalls([back1, back2], wall.normal, {
      ...meta,
      group: `${room.id}-niche-${niche.wall}`,
      ...(hero ? { hero: true, niche: true } : { niche: true }),
    }),
  ];
}

function roomWalls(room: RoomSpec): WallSegment[] {
  const out: WallSegment[] = [];
  const info = zone(room.id);
  for (const key of ['n', 'e', 's', 'w'] as WallKey[]) {
    const wall = roomWall(room, key);
    const bulge = room.arc?.[key] ?? 0;
    const fold = room.fold?.[key];
    const niche = room.niches?.find((item) => item.wall === key);
    const gaps = [
      ...room.doors.filter((door) => door.wall === key).map(doorGap),
      ...(niche ? [{ start: niche.at - niche.width / 2, end: niche.at + niche.width / 2 }] : []),
    ];
    // 主视觉墙上有凹龛时，主视觉挂龛的后壁上，不再挂墙上剩下的那两截
    const heroHere = room.heroWall === key;
    const heroOnStrip = heroHere && !niche;
    const meta = {
      height: info.ceiling,
      zone: room.id,
      tint: room.wallColors?.[key],
      group: `${room.id}-${key}`,
      ...(heroOnStrip ? { hero: true } : {}),
    };
    // 切了角的房间（八边形大厅）：每面墙两头各短一截，缺口由转角那道斜墙补
    const cut = room.chamfer ?? 0;
    const lo = wall.from + cut;
    const hi = wall.to - cut;
    for (const piece of splitByGaps(lo, hi, gaps)) {
      const built = fold
        ? foldStrip(wall, fold, meta)
        : bulge
          ? arcStrip(wall, bulge, piece.start, piece.end, meta)
          : wallStrip(wall, piece.start, piece.end, meta);
      out.push(...built);
    }
    if (niche) out.push(...nicheWalls(room, wall, niche, info.ceiling, heroHere));
  }
  if (room.chamfer) out.push(...cornerWalls(room, { height: info.ceiling, zone: room.id }));
  return out;
}

/** 切角房间的四道转角斜墙：把四个直角切成 45°，方盒子就变成八边形 */
function cornerWalls(
  room: RoomSpec,
  meta: { height: number; zone: ZoneId },
): WallSegment[] {
  const c = room.chamfer ?? 0;
  const { x1, z1, x2, z2 } = room.rect;
  const corners: [Vec2, Vec2, Vec2][] = [
    [
      { x: x1 + c, z: z1 },
      { x: x1, z: z1 + c },
      { x: -1, z: -1 },
    ],
    [
      { x: x2 - c, z: z1 },
      { x: x2, z: z1 + c },
      { x: 1, z: -1 },
    ],
    [
      { x: x2, z: z2 - c },
      { x: x2 - c, z: z2 },
      { x: 1, z: 1 },
    ],
    [
      { x: x1, z: z2 - c },
      { x: x1 + c, z: z2 },
      { x: -1, z: 1 },
    ],
  ];
  return corners.flatMap(([a, b, hint]) =>
    pathWalls([a, b], hint, { ...meta, kind: 'base' }),
  );
}

/** 房间里的隔墙 / 可移动展墙：两面都能挂画，但这里只当墙（碰撞 + 投影） */
function propWalls(room: RoomSpec): WallSegment[] {
  const out: WallSegment[] = [];
  for (const prop of room.props) {
    if (prop.kind !== 'partition') continue;
    const horizontal = Math.abs(prop.x2 - prop.x1) >= Math.abs(prop.z2 - prop.z1);
    const solid = prop.t !== undefined;
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
      ...(solid ? { solid: true } : {}),
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

/**
 * 门廊三面墙（朝北敞口，接房间门洞）。
 *  侧墙的北端要收到「房间那面墙在它这个 x 处的弧线上」—— 序厅南墙是微弧，
 *  侧墙要是还停在 z=0，就会从弧面里戳出来一截（或者留一道缝）。
 */
export function porchWalls(): WallSegment[] {
  const out: WallSegment[] = [];
  const rooms = ROOMS;
  for (const rect of PORCHES) {
    const near: ZoneId = PORCHES.indexOf(rect) === 0 ? 'entry' : 'overview';
    const info = zone(near);
    const room = rooms.find((item) => item.id === near);
    const bulge = room?.arc?.s ?? 0;
    const wall = room ? roomWall(room, 's') : undefined;
    const push = (a: Vec2, b: Vec2, normal: Vec2): void => {
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.05) return;
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
    /** 侧墙在 x 处该收在哪个 z（跟着弧走） */
    const endZ = (x: number): number =>
      wall && bulge ? arcPointAt(wall, bulge, x).z : rect.z2;
    push({ x: rect.x1, z: rect.z1 }, { x: rect.x2, z: rect.z1 }, { x: 0, z: -1 });
    push({ x: rect.x1, z: rect.z1 }, { x: rect.x1, z: endZ(rect.x1) }, { x: -1, z: 0 });
    push({ x: rect.x2, z: rect.z1 }, { x: rect.x2, z: endZ(rect.x2) }, { x: 1, z: 0 });
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
 * 线段落在矩形里的参数区间 [t0, t1]（Liang–Barsky）。完全在矩形外返回 null。
 *  矩形按 HALF_T 外扩：墙正好压在开口边线上时（长廊墙贴着房间边界）也要算进去。
 */
function insideSpan(a: Vec2, b: Vec2, opening: Opening): [number, number] | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const p = [-dx, dx, -dz, dz];
  const q = [
    a.x - (opening.x1 - HALF_T),
    opening.x2 + HALF_T - a.x,
    a.z - (opening.z1 - HALF_T),
    opening.z2 + HALF_T - a.z,
  ];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) < EPS) {
      // 平行于这对边：在外面就整段不相交
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** 沿 a→b 插值取点 */
function alongWall(wall: WallSegment, t: number): Vec2 {
  return {
    x: wall.a.x + (wall.b.x - wall.a.x) * t,
    z: wall.a.z + (wall.b.z - wall.a.z) * t,
  };
}

function sliceBetween(wall: WallSegment, from: number, to: number): WallSegment {
  const a = alongWall(wall, from);
  const b = alongWall(wall, to);
  return { ...wall, a, b, length: Math.hypot(b.x - a.x, b.z - a.z) };
}

/**
 * 把一段墙落在 opening 里的那截切掉，留下两头。
 *  墙可以是任意方向（弧墙拆出来的短段、斜切的展墙、转角倒角那截斜边），
 *  所以不按轴切 —— 用线段与矩形求交算出「在开口里」的那段参数区间。
 */
function trimWall(wall: WallSegment, openings: Opening[]): WallSegment[] {
  let pieces: WallSegment[] = [wall];
  for (const opening of openings) {
    const next: WallSegment[] = [];
    for (const piece of pieces) {
      const span = insideSpan(piece.a, piece.b, opening);
      if (!span) {
        next.push(piece);
        continue;
      }
      const [t0, t1] = span;
      if (t0 > 0) next.push(sliceBetween(piece, 0, t0));
      if (t1 < 1) next.push(sliceBetween(piece, t1, 1));
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

/** 墙在它那条轴上的区间（不分 a→b 的方向） */
function spanOf(wall: WallSegment): [number, number] {
  const horizontal = axisOf(wall) === 'h';
  const lo = horizontal ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.z, wall.b.z);
  const hi = horizontal ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.z, wall.b.z);
  return [lo, hi];
}

/** 从 [s,e] 里挖掉 [lo,hi]：剩下的碎块短于 0.25 m 就不要 */
function subtractSpan(
  s: number,
  e: number,
  lo: number,
  hi: number,
  min = 0.25,
): [number, number][] {
  if (Math.min(e, hi) - Math.max(s, lo) <= 0) return [[s, e]];
  const out: [number, number][] = [];
  if (Math.min(lo, e) - s >= min) out.push([s, Math.min(lo, e)]);
  if (e - Math.max(hi, s) >= min) out.push([Math.max(hi, s), e]);
  return out;
}

/**
 * 按区间切一段墙：沿 a→b 的方向插值。
 *  端点未必是「小 → 大」—— 顺着折线（或弧）切出来的段可能是反着的，
 *  所以按 a→b 的参数取值，不能从最小值往最大值走（那样会把切出来那截挪错位置）。
 */
function sliceWall(wall: WallSegment, lo: number, hi: number): WallSegment | null {
  if (hi - lo < 0.2) return null;
  const horizontal = axisOf(wall) === 'h';
  const from = horizontal ? wall.a.x : wall.a.z;
  const to = horizontal ? wall.b.x : wall.b.z;
  const span = to - from || 1;
  const at = (value: number): Vec2 => {
    const t = (value - from) / span;
    return {
      x: wall.a.x + (wall.b.x - wall.a.x) * t,
      z: wall.a.z + (wall.b.z - wall.a.z) * t,
    };
  };
  return { ...wall, a: at(lo), b: at(hi), length: hi - lo };
}

/**
 * 去掉共面的重叠墙：房间墙与长廊墙、支廊墙与长廊墙常共用一条线（大型作品厅
 * 的北墙就压在终章长廊的南墙上），两段共面的墙叠在一起会 z-fighting。
 *
 *  不是「谁先来留谁」—— 那样会出洞：长廊那面墙只有 3.6 m，房间那面 5.5 m，
 *  留矮的那面就等于在房间墙上开了一条通到外面的缝。这里按区间算：
 *  重叠处**留高的**，矮的只保留没被压住的那截（必要时一拆二）。
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
    const [lo, hi] = spanOf(wall);
    const sameLine = (other: WallSegment): boolean =>
      axisOf(other) === axis &&
      Math.abs((horizontal ? other.a.z : other.a.x) - fixed) <= 0.05;

    // 先让开「不矮于它」的旧墙占住的那截
    let spans: [number, number][] = [[lo, hi]];
    for (const other of out) {
      if (!sameLine(other) || other.height < wall.height) continue;
      const [oLo, oHi] = spanOf(other);
      spans = spans.flatMap(([s, e]) => subtractSpan(s, e, oLo, oHi));
    }

    // 再把比它矮的旧墙压住的那截收回来（旧墙可能一拆二）
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const other = out[i];
      if (!sameLine(other) || other.height >= wall.height) continue;
      const [oLo, oHi] = spanOf(other);
      const rest = subtractSpan(oLo, oHi, lo, hi);
      if (rest.length === 1 && rest[0][0] === oLo && rest[0][1] === oHi) continue;
      out.splice(i, 1);
      for (const [s, e] of rest) {
        const piece = sliceWall(other, s, e);
        if (piece) out.push(piece);
      }
    }

    for (const [s, e] of spans) {
      const piece = sliceWall(wall, s, e);
      if (piece) out.push(piece);
    }
  }
  return out;
}

/**
 * 墙的 AABB：向四周膨胀 CLEARANCE。
 *  只是**粗筛** —— plan.ts:containsPoint 先拿它排掉「离这面墙还很远」的点，
 *  再对候选点算「点到线段距离」。斜墙 / 弧墙的 AABB 会比墙本身胖出小半米，
 *  光靠盒子判碰撞会在弧墙边上多出一圈看不见的垫。
 */
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
    // 这面墙是微弧时，门洞得落在弧上（不然门套会浮在离墙 0.3 m 的地方）
    const bulge = room.arc?.[door.wall] ?? 0;
    const onArc = bulge
      ? arcPointAt(roomWall(room, door.wall), bulge, horizontal ? door.at : door.at)
      : null;
    return {
      x: onArc ? onArc.x : horizontal ? door.at : fixed,
      z: onArc ? onArc.z : horizontal ? fixed : door.at,
      width: door.width,
      height: door.height,
      ry: horizontal ? 0 : Math.PI / 2,
      depth: door.arch ? 0.25 : 0.22,
      arch: !!door.arch,
      zone: room.id,
      ...(room.wallColors?.[door.wall] ? { tint: room.wallColors[door.wall] } : {}),
    };
  });
}

/**
 * 在**任意一段墙**上挖一个壁龛：从 along 处量 width 宽，沿墙芯方向退 depth。
 *  长廊的墙是折线偏移出来的，没有房间那套「哪面墙 + 沿墙坐标」的说法，
 *  只能直接对这一段墙下手：切两截 + 两片门垛 + 一片后壁。
 */
function nicheInSegment(
  wall: WallSegment,
  from: number,
  to: number,
  spec: { depth: number; top: number; bottom: number; tint?: string },
): { pieces: WallSegment[]; niche: NicheOpening } {
  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const length = wall.length || 1;
  const dir = { x: dx / length, z: dz / length };
  const n = wall.normal;
  const at = (value: number): Vec2 => ({
    x: wall.a.x + dir.x * value,
    z: wall.a.z + dir.z * value,
  });
  const back = (point: Vec2): Vec2 => ({
    x: point.x + n.x * spec.depth,
    z: point.z + n.z * spec.depth,
  });
  const p1 = at(from);
  const p2 = at(to);
  const b1 = back(p1);
  const b2 = back(p2);
  const meta = { height: wall.height, zone: wall.zone, tint: spec.tint ?? wall.tint };
  const pieces: WallSegment[] = [];
  // 洞口两侧剩下的墙
  for (const [a, b] of [
    [wall.a, p1],
    [p2, wall.b],
  ] as [Vec2, Vec2][]) {
    if (Math.hypot(b.x - a.x, b.z - a.z) >= 0.2) {
      pieces.push(...pathWalls([a, b], n, { ...meta, kind: 'base' }));
    }
  }
  // 门垛：墙芯在龛外（沿墙的两端）
  pieces.push(...pathWalls([p1, b1], { x: -dir.x, z: -dir.z }, { ...meta, kind: 'base' }));
  pieces.push(...pathWalls([p2, b2], dir, { ...meta, kind: 'base' }));
  // 后壁
  pieces.push(...pathWalls([b1, b2], n, { ...meta, kind: 'base' }));
  return {
    pieces,
    niche: {
      zone: wall.zone,
      x1: p1.x,
      z1: p1.z,
      x2: p2.x,
      z2: p2.z,
      nx: n.x,
      nz: n.z,
      depth: spec.depth,
      top: spec.top,
      bottom: spec.bottom,
      ...(meta.tint ? { tint: meta.tint } : {}),
    },
  };
}

/**
 * 长廊墙上找壁龛落在哪一段：取离这个点最近的那段墙，返回下标 + 沿墙的距离。
 *  不用弧长定位 —— 转角处「最近的中心线点」有两解（前后两段等距），
 *  弧长会跳，直接按世界坐标投影反而稳。
 */
function locatePoint(
  list: WallSegment[],
  at: Vec2,
): { index: number; along: number } | null {
  let best: { index: number; along: number } | null = null;
  let bestDist = Infinity;
  list.forEach((wall, index) => {
    const dx = wall.b.x - wall.a.x;
    const dz = wall.b.z - wall.a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((at.x - wall.a.x) * dx + (at.z - wall.a.z) * dz) / l2));
    const dist = Math.hypot(at.x - (wall.a.x + dx * t), at.z - (wall.a.z + dz * t));
    if (dist < bestDist) {
      bestDist = dist;
      best = { index, along: t * wall.length };
    }
  });
  // 离墙超过半米就是数据写错了，宁可不开这个龛
  return bestDist <= 0.5 ? best : null;
}

/** 把 CORRIDOR_NICHES 插到长廊两侧墙上 */
function corridorNiches(
  bySide: Map<1 | -1, WallSegment[]>,
): { walls: WallSegment[]; niches: NicheOpening[] } {
  const niches: NicheOpening[] = [];
  for (const spec of CORRIDOR_NICHES) {
    // side = +1 那一侧的墙，在行进方向的右手边（与长廊竖缝那套 side 判定一致：
    //  法线朝墙芯、人站在长廊里看过去，+1 是右墙）
    const side: 1 | -1 = spec.side === 'left' ? -1 : 1;
    const list = bySide.get(side);
    if (!list) continue;
    const hit = locatePoint(list, spec.at);
    if (!hit) continue;
    const wall = list[hit.index];
    const from = hit.along - spec.width / 2;
    const to = hit.along + spec.width / 2;
    // 太靠墙端（转角、门洞边）就不挖：不然会把墙角切掉一小截
    if (from < 0.3 || to > wall.length - 0.3 || to - from < 0.2) continue;
    const built = nicheInSegment(wall, from, to, spec);
    list.splice(hit.index, 1, ...built.pieces);
    niches.push(built.niche);
  }
  return { walls: [...(bySide.get(1) ?? []), ...(bySide.get(-1) ?? [])], niches };
}

/** 把 CORRIDOR_VISTAS 插到长廊两侧墙上：穿透的框景洞口 + 后面的光腔 */
function corridorVistas(
  bySide: Map<1 | -1, WallSegment[]>,
): { walls: WallSegment[]; vistas: VistaOpening[] } {
  const vistas: VistaOpening[] = [];
  for (const spec of CORRIDOR_VISTAS) {
    const side: 1 | -1 = spec.side === 'left' ? -1 : 1;
    const list = bySide.get(side);
    if (!list) continue;
    const hit = locatePoint(list, spec.at);
    if (!hit) continue;
    const wall = list[hit.index];
    const from = hit.along - spec.width / 2;
    const to = hit.along + spec.width / 2;
    if (from < 0.3 || to > wall.length - 0.3 || to - from < 0.2) continue;
    // 与壁龛同一套切法（两侧墙 + 门垛 + 后壁）：后壁挡住人，光腔在它前面造
    const built = nicheInSegment(wall, from, to, spec);
    list.splice(hit.index, 1, ...built.pieces);
    vistas.push({
      ...built.niche,
      glow: spec.glow,
      frame: spec.frame,
    });
  }
  return { walls: [...(bySide.get(1) ?? []), ...(bySide.get(-1) ?? [])], vistas };
}

/** 房间的凹龛洞口：给场景做龛楣与龛内暗缝灯 */
function nicheOpenings(room: RoomSpec): NicheOpening[] {
  return (room.niches ?? []).map((niche) => {
    const wall = roomWall(room, niche.wall);
    const bulge = room.arc?.[niche.wall] ?? 0;
    const a = arcPointAt(wall, bulge, niche.at - niche.width / 2);
    const b = arcPointAt(wall, bulge, niche.at + niche.width / 2);
    return {
      zone: room.id,
      x1: a.x,
      z1: a.z,
      x2: b.x,
      z2: b.z,
      nx: wall.normal.x,
      nz: wall.normal.z,
      depth: niche.depth,
      top: niche.top,
      bottom: 0,
      ...(room.wallColors?.[niche.wall] ? { tint: room.wallColors[niche.wall] } : {}),
    };
  });
}

/**
 * 框景洞口的洞口（供场景做青铜收边与后面的光腔）：
 *  几何与 NicheOpening 一样，(x1,z1)-(x2,z2) 是洞口这条线。
 */
export interface VistaOpening extends NicheOpening {
  /** 借来的光：与潮汐厅发光顶同色 */
  glow: { color: string; intensity: number };
  /** 洞口收边 */
  frame: { color: string; width: number };
}

export interface BuildResult {
  walls: WallSegment[];
  doors: DoorOpening[];
  niches: NicheOpening[];
  /** 长廊墙上的框景洞口（自然长廊那一处） */
  vistas: VistaOpening[];
  obstacles: Obstacle[];
}

/** 长出来整栋楼的墙 */
export function buildWalls(): BuildResult {
  const half = CORRIDOR.width / 2;

  // 1) 主长廊：两侧偏移，段落按中点的弧长落到某一章
  //  倒圆的半径按折点给（CORRIDOR_ROUNDS 用世界坐标点名折点，取最近的那一个）
  const rounds = new Map<number, number>();
  for (const round of CORRIDOR_ROUNDS) {
    let best = -1;
    let bestDist = Infinity;
    CORRIDOR_PATH.forEach((point, index) => {
      if (index === 0 || index === CORRIDOR_PATH.length - 1) return;
      const dist = Math.hypot(point.x - round.at.x, point.z - round.at.z);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    // 差得远就是数据写错了，宁可不倒圆
    if (best > 0 && bestDist < 0.5) rounds.set(best, round.r);
  }
  const corridorBySide = new Map<1 | -1, WallSegment[]>();
  for (const side of [1, -1] as (1 | -1)[]) {
    const path = offsetPath(CORRIDOR_PATH, half, side, CORRIDOR.chamfer, rounds);
    corridorBySide.set(
      side,
      polylineWalls(
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
  // 长廊墙上的壁龛（夜行那三处）与框景洞口：先挖，再裁，不然洞会被裁墙的逻辑抹掉
  const corridorWithNiches = corridorNiches(corridorBySide);
  const corridorWithVistas = corridorVistas(corridorBySide);
  const corridor: WallSegment[] = corridorWithVistas.walls;

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
    niches: [...ROOMS.flatMap(nicheOpenings), ...corridorWithNiches.niches],
    vistas: corridorWithVistas.vistas,
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

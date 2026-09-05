/**
 * Hilbert 曲线生成（参考 virtual-art-gallery 的 src/map.js）
 *
 *  关键约定（之前搞反过一次，这里写死）：
 *  **Hilbert 曲线是走廊的中线，不是墙。** 墙在走廊两侧 —— 把曲线朝左、朝右
 *  各偏移半个走廊宽度，得到两条连续的折线，那两条才是墙。夹在中间的那条带
 *  子就是能走的走廊。之前把曲线当墙，结果整块 48×48 m 变成一个大房间，中间
 *  一条孤零零的弯墙。
 *
 *  参数：
 *  - ORDER = 4 → 16×16 cell，256 个曲线点
 *  - CELL = 3 m → 建筑 48×48 m
 *  - CORRIDOR_W = 2.6 m → 相邻两条走廊的墙刚好贴在一起（3 − 2.6 = 0.4 = 两道墙厚）
 *
 *  转角用 miter（斜接）处理：两条偏移折线在 90° 拐角处延长相交，不留缺口。
 *
 *  纯数据层：不 import three。
 */

// Hilbert 阶数（grid = 2^n × 2^n）
export const ORDER = 4;
/** 单个 cell 边长（米） */
export const CELL = 3;
/** 走廊宽度（米）—— 两条墙中心线之间的距离 */
export const CORRIDOR_W = 2.6;
/** 墙体厚（米） */
export const WALL_T = 0.2;
/** 墙体高（米） */
export const WALL_H = 4.0;

const GRID = Math.pow(2, ORDER); // 16

/** 点 (x, z) —— y 在场景里另算 */
export interface Pt {
  x: number;
  z: number;
}

/** 一段墙：从 a 到 b，外法线 normal（**背离走廊**），墙长 length（米） */
export interface WallSegment {
  a: Pt;
  b: Pt;
  normal: Pt;
  length: number;
}

/** 二维向量归一化 */
function norm(x: number, z: number): Pt {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

/**
 * Hilbert 曲线：把「沿曲线的距离 d」换算成格点坐标（John Skilling 的 d2xy）。
 * 用这个而不是递归展开 —— 之前那版递归转错了象限，点会跑出格子。
 * n = 网格边长（2 的幂），返回 4^n 个点，相邻点距离恒为 1 格。
 */
function d2xy(n: number, d: number): Pt {
  let x = 0;
  let z = 0;
  let t = d;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & Math.floor(t / 2);
    const ry = 1 & (t ^ rx);
    // 按象限旋转 / 翻转
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        z = s - 1 - z;
      }
      const tmp = x;
      x = z;
      z = tmp;
    }
    x += s * rx;
    z += s * ry;
    t = Math.floor(t / 4);
  }
  return { x, z };
}

/** 曲线的格点坐标序列（0 … 2^ORDER-1 的整数格） */
function hilbertPoints(): Pt[] {
  const n = GRID;
  const out: Pt[] = [];
  for (let d = 0; d < n * n; d += 1) out.push(d2xy(n, d));
  return out;
}

/** Hilbert 曲线（世界坐标，米）—— 这是走廊的中线 */
export function curvePoints(): Pt[] {
  return hilbertPoints().map((p) => ({ x: p.x * CELL, z: p.z * CELL }));
}

/**
 * 把折线朝一侧偏移：每个顶点用相邻两段的法线做 miter 斜接，
 * 90° 拐角处两段延长相交，转角不留缺口。side = +1 / -1 决定偏哪边。
 */
function offsetPolyline(points: Pt[], d: number, side: 1 | -1): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const cur = points[i];
    const prev = i > 0 ? points[i - 1] : undefined;
    const next = i < points.length - 1 ? points[i + 1] : undefined;

    // 三种情况分开写，让 TS 能各自收窄 prev / next
    if (prev && next) {
      // 中间点：两段法线的 miter
      const d1 = norm(cur.x - prev.x, cur.z - prev.z);
      const d2 = norm(next.x - cur.x, next.z - cur.z);
      const n1 = { x: -d1.z * side, z: d1.x * side };
      const n2 = { x: -d2.z * side, z: d2.x * side };
      let mx = n1.x + n2.x;
      let mz = n1.z + n2.z;
      const len = Math.hypot(mx, mz);
      if (len < 1e-6) {
        mx = n1.x;
        mz = n1.z;
      } else {
        // miter 长度修正：1 / cos(θ/2)，钳一下避免锐角处拉出尖刺
        const cos = (n1.x * mx + n1.z * mz) / len;
        const scale = 1 / Math.max(cos, 0.35);
        mx = (mx / len) * scale;
        mz = (mz / len) * scale;
      }
      out.push({ x: cur.x + mx * d, z: cur.z + mz * d });
      continue;
    }

    // 端点：用唯一那一段的法线
    const ref = next
      ? { x: next.x - cur.x, z: next.z - cur.z }
      : prev
        ? { x: cur.x - prev.x, z: cur.z - prev.z }
        : { x: 1, z: 0 };
    const n = norm(ref.x, ref.z);
    out.push({ x: cur.x + -n.z * side * d, z: cur.z + n.x * side * d });
  }
  return out;
}

/**
 * 全部墙段：走廊左右两侧各一道连续墙。
 * 每段的 normal 朝**外**（背离走廊），走廊那一侧是 -normal。
 */
export function generateWalls(): WallSegment[] {
  const curve = curvePoints();
  const half = CORRIDOR_W / 2;
  const walls: WallSegment[] = [];

  for (const side of [1, -1] as (1 | -1)[]) {
    const path = offsetPolyline(curve, half, side);
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      // 外法线：段方向右手侧（与偏移方向 side 同号）
      const n = norm(dx, dz);
      walls.push({
        a,
        b,
        normal: { x: -n.z * side, z: n.x * side },
        length,
      });
    }
  }
  return walls;
}

/** 建筑占地（48 × 48 m） */
export const FLO = {
  size: GRID * CELL,
  min: 0,
  max: GRID * CELL,
};

/**
 * 每个房间的出生点：落在 Hilbert 曲线上（走廊正中），朝向沿曲线前进方向。
 * 曲线是走廊中线，所以出生点天然在走廊里、两侧都是墙。
 */
export function roomSpawns(count: number): { pt: Pt; yaw: number }[] {
  const curve = curvePoints();
  const out: { pt: Pt; yaw: number }[] = [];
  if (curve.length < 2 || count === 0) return out;
  for (let i = 0; i < count; i += 1) {
    const idx = Math.min(
      Math.floor(((i + 0.5) / count) * (curve.length - 1)),
      curve.length - 2,
    );
    const cur = curve[idx];
    const next = curve[idx + 1];
    out.push({
      pt: { x: cur.x, z: cur.z },
      yaw: Math.atan2(next.x - cur.x, next.z - cur.z),
    });
  }
  return out;
}

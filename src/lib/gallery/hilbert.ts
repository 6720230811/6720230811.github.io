/**
 * Hilbert 曲线生成（参考 virtual-art-gallery 的 src/map.js）
 *
 *  走一条 4 阶 Hilbert 曲线，整面墙都贴着它走。曲线穿过 16×16 = 256 个 cell，
 *  建筑占地 48×48 m。比参考项目的 6 阶（≈ 10 km）小很多，加载即生。
 *
 *
 *  不做随机墙开口：每个相邻 cell 间都砌墙，靠门洞让整条路贯通。
 *
 *  纯数据层：不 import three，给 plan.ts 喂墙体 + 单元格 + 外接 AABB。
 */

// Hilbert 阶数（grid = 2^n × 2^n）
export const ORDER = 4;
/** 单个 cell 边长（米） */
export const CELL = 3;
/** 墙体高（米） */
export const WALL_H = 4.0;
/** 墙体厚（米） */
export const WALL_T = 0.2;

const GRID = Math.pow(2, ORDER); // 16

/** 点 (x, z) —— y 在场景里另算 */
export interface Pt {
  x: number;
  z: number;
}

/** 一段墙：从 a 到 b，外法线 normal，墙长 length（米） */
export interface WallSegment {
  a: Pt;
  b: Pt;
  normal: Pt;
  length: number;
}

/**
 * Hilbert 曲线：递归生成 2^n × 2^n 网格上的 4^n 个点，相邻两点之间就是
 * 一段墙。基例（n=1）走 L 形：左下、左上、右上、右下。
 */
function hilbert(n: number): Pt[] {
  if (n === 1) {
    return [
      { x: 0, z: 0 },
      { x: 0, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 0 },
    ];
  }
  const h = hilbert(n - 1);
  const scale = Math.pow(2, n - 2);
  const out: Pt[] = [];
  // 左下：逆时针转 90°（x 变 z，z 归零）
  for (const p of h) out.push({ x: p.z * scale, z: 0 });
  // 左上：原样
  for (const p of h) out.push({ x: p.x * scale, z: p.z * scale + scale });
  // 右上：原样
  for (const p of h) out.push({ x: p.x * scale + scale, z: p.z * scale + scale });
  // 右下：顺时针转 90° 后沿 z 翻
  for (const p of h.slice().reverse()) {
    out.push({ x: scale - p.z * scale + scale, z: p.x * scale });
  }
  return out;
}

/** 全部墙段：相邻两个 cell 间的墙（在 y=0 投影上的位置） */
export function generateWalls(): WallSegment[] {
  const points = hilbert(ORDER);
  const walls: WallSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx === 0 && dz === 0) continue;
    const length = Math.hypot(dx, dz) * CELL;
    // 外法线：曲线方向 (-dz, dx) 旋转 90°（让墙厚方向朝外）
    walls.push({
      a: { x: a.x * CELL, z: a.z * CELL },
      b: { x: b.x * CELL, z: b.z * CELL },
      normal: { x: -dz, z: dx },
      length,
    });
  }
  return walls;
}

/** 建筑占地（48 × 48 m） */
export const FLO = {
  size: GRID * CELL,
  min: 0,
  max: GRID * CELL,
};

/** Hilbert 曲线的第一个 cell 的中心偏内一点（避开 Hilbert 角） */
export const SPAWN_START: Pt = { x: 1.5, z: 1.5 };

/**
 *  起点朝向：顺着 Hilbert 第一段墙走出第一步的方向。
 *  摄像机 forward =  (−sin yaw, −cos yaw) → 第一步方向 (dx, dz) 对应 yaw。
 */
export function spawnYaw(walls: WallSegment[]): number {
  const first = walls[0];
  if (!first) return 0;
  return Math.atan2(first.b.x - first.a.x, first.b.z - first.a.z);
}

/** 把整段 Hilbert 按房间数切成 N 份，每份在墙的 +normal 一侧 0.6 m 出生（走廊里） */
export function roomSpawns(
  count: number,
  walls: WallSegment[],
): { pt: Pt; yaw: number }[] {
  const out: { pt: Pt; yaw: number }[] = [];
  if (walls.length === 0 || count === 0) return out;
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(((i + 0.5) / count) * walls.length);
    const wall = walls[idx];
    const cx = (wall.a.x + wall.b.x) / 2;
    const cz = (wall.a.z + wall.b.z) / 2;
    out.push({
      pt: { x: cx + wall.normal.x * 0.6, z: cz + wall.normal.z * 0.6 },
      // yaw 沿段方向：摄像头朝下一段看
      yaw: Math.atan2(wall.b.x - wall.a.x, wall.b.z - wall.a.z),
    });
  }
  return out;
}
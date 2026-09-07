/**
 * 大厅：从 Hilbert 迷宫里挖出来的一间 12 × 12 m 的大房间。
 *
 *  长廊之外要有一处「站得住的地方」—— 四面挂满照片的大房间。做法是：在
 *  Hilbert 的格子上圈一块 4×4 的方格区（i/j 各 8…11 → 世界坐标
 *  [22.5, 34.5]²），把这一片里的迷宫墙全部拆掉，再沿这块的四条边砌上自己的
 *  墙；Hilbert 曲线穿过边界的那两处留门洞 —— 走廊因此是直接通进房间的，
 *  不用传送、不用过场。
 *
 *  房间中间再立两道 8 m 长的隔断（双面挂画）：12 × 12 m 的空场子四面挂满
 *  画，站在门口一眼就看完了，立两道隔断才把「一间大屋」切出纵深，走到不同
 *  位置看到的是不同的墙。
 *
 *  约定（与 hilbert.ts 一致）：**normal 指向墙芯**（人进不去的一侧），画挂
 *  在 -normal 那一面。四壁的 normal 朝房间外，隔断的 normal 朝隔断内部 ——
 *  于是画一律朝着人。
 *
 *  纯数据层：不 import three。
 */
import { CELL, CORRIDOR_W, WALL_T, curvePoints } from './hilbert';
import type { WallSegment } from './hilbert';

/** 轴对齐矩形：x1 < x2、z1 < z2 */
export interface Rect {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** 大厅圈在 Hilbert 的哪几格上（格坐标，闭区间）：4×4 格 = 12 × 12 m */
const BLOCK = { i0: 8, i1: 11, j0: 8, j1: 11 };

/** 拆墙范围：比房间外皮再外扩这么多，把贴着房间砌的那道迷宫墙一并吃掉 */
const CARVE_MARGIN = 0.35;
/** 门洞半宽：走廊 2.6 m，两侧各留一点余量 */
const DOOR_HALF = CORRIDOR_W / 2 + 0.15;
/** 太短的墙片不砌：门洞开到墙角时，角上剩下的那一小截直接并进门洞 */
const MIN_PIECE = 0.5;
/** 隔断：两片墙背对背，中间这么厚 */
const PARTITION_HALF_T = 0.12;
/** 隔断离房间中心的距离，以及它的一半长度（总长 8 m，两端各留 2 m 通道） */
const PARTITION_OFFSET = 3;
const PARTITION_HALF_LEN = 4;

export interface HallSpec {
  /** 房间内空：四面墙就立在这四条边上 */
  rect: Rect;
  /** 房间的墙（四壁 + 两道隔断的两个面）；normal 指向墙芯，画挂在 -normal 一侧 */
  walls: WallSegment[];
}

/** 大厅的内空矩形（世界坐标，米） */
export const HALL_RECT: Rect = {
  x1: BLOCK.i0 * CELL - CELL / 2,
  z1: BLOCK.j0 * CELL - CELL / 2,
  x2: BLOCK.i1 * CELL + CELL / 2,
  z2: BLOCK.j1 * CELL + CELL / 2,
};

/** 要拆掉的迷宫范围：房间外皮再外扩一圈 */
const CARVE_RECT: Rect = {
  x1: HALL_RECT.x1 - CARVE_MARGIN,
  z1: HALL_RECT.z1 - CARVE_MARGIN,
  x2: HALL_RECT.x2 + CARVE_MARGIN,
  z2: HALL_RECT.z2 + CARVE_MARGIN,
};

/** 这段迷宫墙是不是被大厅吃掉了：拿它的 AABB 跟拆墙范围做重叠测试 */
export function isCarved(wall: WallSegment): boolean {
  const half = WALL_T / 2;
  const x1 = Math.min(wall.a.x, wall.b.x) - half;
  const x2 = Math.max(wall.a.x, wall.b.x) + half;
  const z1 = Math.min(wall.a.z, wall.b.z) - half;
  const z2 = Math.max(wall.a.z, wall.b.z) + half;
  return !(x2 < CARVE_RECT.x1 || x1 > CARVE_RECT.x2 || z2 < CARVE_RECT.z1 || z1 > CARVE_RECT.z2);
}

type Edge = 'w' | 'e' | 'n' | 's';

/** Hilbert 曲线穿过房间边界的地方 —— 那里要开成门洞 */
function doorways(): { edge: Edge; at: number }[] {
  const points = curvePoints();
  const inside = (x: number, z: number): boolean =>
    x >= BLOCK.i0 * CELL &&
    x <= BLOCK.i1 * CELL &&
    z >= BLOCK.j0 * CELL &&
    z <= BLOCK.j1 * CELL;

  const out: { edge: Edge; at: number }[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    // 相邻两点必在同一行/列上只差一格，所以跨越时中点正好落在房间边界上
    if (inside(a.x, a.z) === inside(b.x, b.z)) continue;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if (near(mx, HALL_RECT.x1)) out.push({ edge: 'w', at: mz });
    else if (near(mx, HALL_RECT.x2)) out.push({ edge: 'e', at: mz });
    else if (near(mz, HALL_RECT.z1)) out.push({ edge: 'n', at: mx });
    else out.push({ edge: 's', at: mx });
  }
  return out;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** 一条边上挖掉若干门洞之后剩下的墙片：[起点, 终点]（沿边坐标） */
function piecesOf(from: number, to: number, doors: number[]): [number, number][] {
  const gaps = doors
    .map((at) => [at - DOOR_HALF, at + DOOR_HALF] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cursor = from;
  for (const [start, end] of gaps) {
    if (start > cursor) out.push([cursor, Math.min(start, to)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < to) out.push([cursor, to]);
  return out.filter(([a, b]) => b - a >= MIN_PIECE);
}

/**
 * 砌出大厅：四壁（门洞处断开）+ 中间两道双面隔断。
 * 隔断用两片相距 PARTITION_HALF_T×2 的墙表示，normal 朝内 —— 于是两个面
 * 各自朝外挂画，中间那点空腔人进不去（碰撞盒按人身半径膨胀后是实心的）。
 */
export function buildHall(): HallSpec {
  const rect = HALL_RECT;
  const doors = doorways();
  const walls: WallSegment[] = [];

  const edge = (kind: Edge, from: number, to: number): void => {
    // 墙所在的固定坐标，以及沿边方向、外法线方向
    const fixed = kind === 'w' ? rect.x1 : kind === 'e' ? rect.x2 : kind === 'n' ? rect.z1 : rect.z2;
    const horizontal = kind === 'n' || kind === 's';
    const normal = kind === 'w' ? { x: -1, z: 0 } : kind === 'e' ? { x: 1, z: 0 } : kind === 'n' ? { x: 0, z: -1 } : { x: 0, z: 1 };
    for (const [a, b] of piecesOf(from, to, doors.filter((d) => d.edge === kind).map((d) => d.at))) {
      walls.push({
        a: horizontal ? { x: a, z: fixed } : { x: fixed, z: a },
        b: horizontal ? { x: b, z: fixed } : { x: fixed, z: b },
        normal,
        length: b - a,
      });
    }
  };

  edge('w', rect.z1, rect.z2);
  edge('e', rect.z1, rect.z2);
  edge('n', rect.x1, rect.x2);
  edge('s', rect.x1, rect.x2);

  // 两道隔断：沿 z 摆，两端各留 2 m 绕过去
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  for (const dx of [-PARTITION_OFFSET, PARTITION_OFFSET]) {
    for (const side of [-1, 1] as (-1 | 1)[]) {
      const x = cx + dx + side * PARTITION_HALF_T;
      walls.push({
        a: { x, z: cz - PARTITION_HALF_LEN },
        b: { x, z: cz + PARTITION_HALF_LEN },
        // 法线朝隔断内部：-normal 才是朝房间的那一面，画挂在那儿
        normal: { x: -side, z: 0 },
        length: PARTITION_HALF_LEN * 2,
      });
    }
  }

  return { rect, walls };
}

/**
 * 摆线拱（cycloid）的几何与尺寸。
 *
 * 参数方程（数据卡指定，不得近似）：
 *   x = r(θ − sinθ)，y = r(1 − cosθ)，θ ∈ [0, 2π]
 * 一个完整拱跨 2πr、矢高 2r —— 起拱点处切线竖直，这是康选摆线的原因：
 * 拱脚能垂直落在墙上，而矢高只有跨度的 1/π，比半圆扁得多。
 *
 * 尺寸（数据卡：长 30.48 m、宽 6.1 m、拱高 6.1 m，原著 100×20×20 ft）：
 *   跨度 = 2πr = 6.1 m  →  r = 0.97046 m
 *   矢高 = 2r   = 1.9409 m（摆线自身的几何，改不了）
 *   「拱高 6.1 m」按室内净高理解：起拱线 = 6.1 − 1.9409 = 4.1591 m，
 *   拱顶内表面正好落在 6.1 m。三个数字同时成立，且与金贝尔实测
 *   （起拱线约 13 ft、总高 20 ft）一致。
 */

export const SPAN = 6.1; // 跨度（20 ft）
export const R = SPAN / (2 * Math.PI); // 滚圆半径
export const RISE = 2 * R; // 摆线矢高 = 跨度 / π
export const APEX_H = 6.1; // 室内净高（拱顶内表面）
export const SPRING_H = APEX_H - RISE; // 起拱线高度
export const LENGTH = 30.48; // 拱长（100 ft）
export const SLOT_W = 0.61; // 天窗缝宽（2 ft）
export const SHELL_T = 0.22; // 混凝土拱壳厚
export const WALL_T = 0.2; // 侧墙厚

/**
 * 摆线断面的网格段数。
 * 单拱研究时用到 192；整馆 16 拱要一起进 4096² 的阴影图，64 段已经看不出折线
 * （矢高只有 1.94 m，弦长误差 < 0.1 mm）。
 */
export const PROFILE_SEGMENTS = 64;
/** 沿拱长方向的网格段数：拱壳是直纹面，分段只为阴影过渡，8 段已够 */
export const LENGTH_SEGMENTS = 8;

export interface Pt {
  x: number;
  y: number;
}

/** 摆线参数方程；x 平移到以拱中心为 0（θ=0 与 2π 是两侧起拱点，θ=π 是拱顶） */
export function cycloid(theta: number): Pt {
  return {
    x: R * (theta - Math.sin(theta)) - Math.PI * R,
    y: R * (1 - Math.cos(theta)),
  };
}

/**
 * 摆线断面的采样点，按**弧长**等距重采样。
 *
 * 必须按弧长：θ=0 处是尖点（切线竖直），均匀采 θ 会把顶点全挤在尖点附近，
 * 拱面就一段段折线了。返回 segments + 1 个点，从 −跨度/2 到 +跨度/2。
 */
export function archProfile(segments = PROFILE_SEGMENTS): Pt[] {
  const dense = 4096;
  const xs: number[] = [];
  const ys: number[] = [];
  const arc: number[] = [0];
  for (let i = 0; i <= dense; i += 1) {
    const p = cycloid((i / dense) * Math.PI * 2);
    xs.push(p.x);
    ys.push(p.y);
    if (i > 0) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  }
  const total = arc[dense];

  const out: Pt[] = [];
  let cursor = 1;
  for (let k = 0; k <= segments; k += 1) {
    const target = (k / segments) * total;
    while (cursor < dense && arc[cursor] < target) cursor += 1;
    const span = arc[cursor] - arc[cursor - 1];
    const f = span > 0 ? (target - arc[cursor - 1]) / span : 0;
    out.push({
      x: xs[cursor - 1] + (xs[cursor] - xs[cursor - 1]) * f,
      y: ys[cursor - 1] + (ys[cursor] - ys[cursor - 1]) * f,
    });
  }
  return out;
}

/** 累计弧长（贴图 UV 用：让混凝土贴图沿拱面均匀铺，不在尖点处挤成一团） */
export function arcLengths(profile: Pt[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < profile.length; i += 1) {
    out.push(out[i - 1] + Math.hypot(profile[i].x - profile[i - 1].x, profile[i].y - profile[i - 1].y));
  }
  return out;
}

/**
 * 沿 x = ±half 把断面切成两半：这就是天窗缝那一刀。
 * 切口处插值出一个精确落在 ±half 上的点，缝宽才准。
 */
export function splitAtSlot(profile: Pt[], half: number): [Pt[], Pt[]] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (const p of profile) {
    if (p.x <= -half) left.push(p);
    if (p.x >= half) right.push(p);
  }

  /** 断面从「在墙一侧」跨到「在缝里」的那一段：插值出精确落在 ±half 上的切口点 */
  const edge = (sign: -1 | 1): Pt | null => {
    const inside = (v: Pt): boolean => (sign === -1 ? v.x <= -half : v.x >= half);
    for (let i = 1; i < profile.length; i += 1) {
      const a = profile[i - 1];
      const b = profile[i];
      if (inside(a) && !inside(b)) {
        const dx = b.x - a.x;
        const f = dx === 0 ? 0 : (sign * half - a.x) / dx;
        return { x: sign * half, y: a.y + (b.y - a.y) * f };
      }
    }
    return null;
  };

  const leftEdge = edge(-1);
  const rightEdge = edge(1);
  if (leftEdge) left.push(leftEdge);
  if (rightEdge) right.unshift(rightEdge);
  return [left, right];
}

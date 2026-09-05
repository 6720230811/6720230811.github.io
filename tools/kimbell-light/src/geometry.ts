/**
 * 几何：把断面沿拱长挤出成壳（拱壳）或柱体（反射器翼型）。
 *
 * 全部手写 BufferGeometry，理由：
 * - 需要自己控制 UV：拱面的 u 走**弧长**（尖点处不挤），反射器的 u/v 走
 *   **世界坐标**（穿孔图案才不会被拉伸）
 * - 需要内表面法线朝室内：ExtrudeGeometry 非索引、绕序不可控
 */
import * as THREE from 'three';
import { RISE, SPRING_H, type Pt } from './cycloid';

/** 断面一点的外法线：切线逆时针转 90°（摆线起拱点切线竖直，外法线正好水平） */
function outwardNormal(points: Pt[], index: number): Pt {
  const prev = points[Math.max(index - 1, 0)];
  const next = points[Math.min(index + 1, points.length - 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/**
 * 把一条开放断面沿 z 挤成一层有厚度的壳（拱壳用它）。
 * 内表面（朝室内）法线朝 −n，外表面朝 +n；两条侧边（起拱处、天窗缝处）
 * 各补一条窄面，壳体看着是实心的，不会露出纸片边。
 *
 * @param uScale u 方向一个贴图循环代表多少米（传弧长数组则按弧长铺）
 */
export function loftShell(
  profile: Pt[],
  length: number,
  thickness: number,
  lengthSegments: number,
  uScale = 1,
): THREE.BufferGeometry {
  const count = profile.length;
  const half = length / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const arc: number[] = [0];
  for (let i = 1; i < count; i += 1) {
    arc.push(arc[i - 1] + Math.hypot(profile[i].x - profile[i - 1].x, profile[i].y - profile[i - 1].y));
  }

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  // 顶点：每个 (长度段, 断面点) 一对 —— 内表面一个、外表面一个
  for (let s = 0; s <= lengthSegments; s += 1) {
    const z = -half + (s / lengthSegments) * length;
    for (let i = 0; i < count; i += 1) {
      const p = profile[i];
      const n = outwardNormal(profile, i);
      const u = arc[i] / uScale;
      const v = (z + half) / uScale;
      const outer = { x: p.x + n.x * thickness, y: p.y + n.y * thickness };
      push(p.x, p.y, z, -n.x, -n.y, 0, u, v);
      push(outer.x, outer.y, z, n.x, n.y, 0, u, v);
    }
  }

  const at = (s: number, i: number, outer: 0 | 1): number => (s * count + i) * 2 + outer;

  // 索引：内表面朝室内（绕序取 t × z 的方向），外表面反过来
  for (let s = 0; s < lengthSegments; s += 1) {
    for (let i = 0; i < count - 1; i += 1) {
      const a = at(s, i, 0);
      const b = at(s, i + 1, 0);
      const c = at(s + 1, i, 0);
      const d = at(s + 1, i + 1, 0);
      indices.push(a, b, d, a, d, c); // 内
      indices.push(at(s, i, 1), at(s + 1, i + 1, 1), at(s, i + 1, 1), at(s, i, 1), at(s + 1, i, 1), at(s + 1, i + 1, 1)); // 外
    }
  }

  // 两侧边（起拱处、天窗缝处）：内→外补一条窄面，壳体看着是实心的
  for (const i of [0, count - 1]) {
    const n = outwardNormal(profile, i);
    const p = profile[i];
    const outer = { x: p.x + n.x * thickness, y: p.y + n.y * thickness };
    for (let s = 0; s < lengthSegments; s += 1) {
      const z0 = -half + (s / lengthSegments) * length;
      const z1 = -half + ((s + 1) / lengthSegments) * length;
      const base = positions.length / 3;
      push(p.x, p.y, z0, -n.y, n.x, 0, 0, z0);
      push(outer.x, outer.y, z0, -n.y, n.x, 0, thickness, z0);
      push(p.x, p.y, z1, -n.y, n.x, 0, 0, z1);
      push(outer.x, outer.y, z1, -n.y, n.x, 0, thickness, z1);
      indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 把一条闭合断面沿 z 挤成柱体（反射器翼型用它）。
 * UV 按世界坐标给（uvScale 一个循环多少米），穿孔图案因此不会被拉伸。
 */
export function loftTube(
  loop: Pt[],
  length: number,
  lengthSegments: number,
  uvScale = 0.12,
): THREE.BufferGeometry {
  const count = loop.length;
  const half = length / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s <= lengthSegments; s += 1) {
    const z = -half + (s / lengthSegments) * length;
    for (let i = 0; i < count; i += 1) {
      const p = loop[i];
      const prev = loop[(i - 1 + count) % count];
      const next = loop[(i + 1) % count];
      // 闭合断面的外法线：相邻两边法线的平均，转 90°
      const e1 = { x: p.x - prev.x, y: p.y - prev.y };
      const e2 = { x: next.x - p.x, y: next.y - p.y };
      const l1 = Math.hypot(e1.x, e1.y) || 1;
      const l2 = Math.hypot(e2.x, e2.y) || 1;
      const nx = -(e1.y / l1 + e2.y / l2) / 2;
      const ny = (e1.x / l1 + e2.x / l2) / 2;
      const nl = Math.hypot(nx, ny) || 1;
      positions.push(p.x, p.y, z);
      normals.push(nx / nl, ny / nl, 0);
      uvs.push(p.x / uvScale, z / uvScale);
    }
  }

  for (let s = 0; s < lengthSegments; s += 1) {
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count;
      const a = s * count + i;
      const b = s * count + j;
      const c = (s + 1) * count + i;
      const d = (s + 1) * count + j;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 翼型（机翼）闭合断面：中间高、两端低的对称翼型。
 *
 * 厚度分布用 NACA 00xx 的解析式，最大厚度在弦长 30% 处；
 * 中弧线是一条两端下垂的抛物线 —— 这就是「两端低中间高」。
 */
export function wingLoop(opts: {
  span: number;
  centerY: number;
  drop: number;
  /** 相对厚度 t/c */
  thickness: number;
  segments: number;
}): Pt[] {
  const { span, centerY, drop, thickness, segments } = opts;
  const chord = span;
  const halfThickness = (s: number): number =>
    5 * thickness * chord * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4);

  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const s = i / segments;
    const x = -span / 2 + span * s;
    const camber = centerY - drop * (Math.abs(x) / (span / 2)) ** 2;
    const t = halfThickness(s);
    upper.push({ x, y: camber + t });
    lower.push({ x, y: camber - t });
  }
  // 闭合断面：上表面从头到尾，下表面从尾回头
  return [...upper, ...lower.reverse().slice(1, -1)];
}

/**
 * 端墙：矩形 + 摆线拱形封口（手工拼三角形）。
 *
 * ShapeGeometry 会用 earcut 加 Steiner 点，端墙上就会看到三角网；改成从角点
 * 发散的扇形，端墙只有矩形与拱形的轮廓线，看着像一面清水混凝土板。
 */
export function buildEndWallGeometry(profile: Pt[], spring = SPRING_H): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const halfSpan = -profile[0].x; // SPAN/2

  // 顶点顺序：BL → BR → 摆线从 TL（=archTop[0]）出发一路到 TR（=archTop[end]）
  // archTop[0] 与 archTop[end] 在 spring 高度（y=0 时 + spring），也就是矩形顶边两端
  const push = (x: number, y: number, u: number, v: number): void => {
    positions.push(x, y, 0, 0);
    uvs.push(u, v);
  };

  push(-halfSpan, 0, 0, 0); // BL
  push(halfSpan, 0, 1, 0); // BR
  const height = spring + RISE;
  for (let i = 0; i < profile.length; i += 1) {
    const p = profile[i];
    push(p.x, spring + p.y, 0.5 + p.x / (2 * halfSpan), (spring + p.y) / height);
  }

  // 从 BL 发散的扇形：BL → v[i] → v[i+1]
  // 第一个 i=2：BL → archTop[0]=TL → archTop[1]
  // ...
  // 最后一个 i=end：BL → archTop[end-1] → archTop[end]=TR
  // 关上：BL → TR → BR
  const last = positions.length / 4 - 1; // TR = archTop[end]
  for (let i = 2; i < last; i += 1) indices.push(0, i, i + 1);
  indices.push(0, last, 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 一间厅的顶棚与装饰：筒拱、穹顶、平顶、木格栅、钢网格，以及各自的那一套
 * 家具（枝形灯、宫灯、镜面、拱窗、玻璃墙、盘旋坡道、地上的光）。
 *
 * 墙、门、画框与拾取在 floor.ts；这里只管「顶棚以下、墙以上」的那一圈东西，
 * 按 styles.ts 的形制摆出来。所有几何都用 floor.ts 传进来的单位几何
 * （一个 1×1 的平面与一个 1×1×1 的方块）缩放而成 —— 除了拱壳、穹顶、
 * 拱形窗与坡道这几样没法拿方块拼的，现建现用。
 *
 * 观感上的两条取舍：
 * - 拱顶的明暗是**画**出来的（渐变同时当 map 与 emissiveMap），不靠模拟
 * - 天光落在地上的那道光也是画在地上的：没开阴影，投影算不出来，而天光
 *   本来就该在地上留一道
 */
import * as THREE from 'three';
import { archProfile, type CeilingSpec, type ProfilePoint, type Rect } from './plan';
import type { HallStyle } from './styles';
import {
  concreteTexture,
  floorPoolTexture,
  frescoTexture,
  radialTexture,
  vaultLightTexture,
} from './surfaces';

/** 一间厅的材质；由 floor.ts 按形制生成一份，同一形制的多间厅共用 */
export interface HallMaterials {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  /** 地面中轴的石材带 */
  runner: THREE.MeshStandardMaterial;
  /** 沿墙的深色走边 */
  border: THREE.MeshStandardMaterial;
  /** 檐口、踢脚 */
  trim: THREE.MeshStandardMaterial;
  /** 出挑色：金饰 / 朱漆 / 黑钢 */
  accent: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  /** 顶棚本体：混凝土 / 抹灰 / 彩画 / 深色钢顶 */
  ceiling: THREE.MeshStandardMaterial;
  /** 发光面：天光缝、灯板、糊纸、玻璃外的天光 */
  glow: THREE.MeshBasicMaterial;
  /** 暖光：纸灯、宫灯、灯罩 */
  glowWarm: THREE.MeshBasicMaterial;
  mirror: THREE.MeshStandardMaterial;
  bench: THREE.MeshStandardMaterial;
  /** 画框与卡纸：金框 / 黑框 / 朱漆框 */
  frame: THREE.MeshStandardMaterial;
  matboard: THREE.MeshStandardMaterial;
}

export interface HallBuildContext {
  ceiling: CeilingSpec;
  style: HallStyle;
  mats: HallMaterials;
  /** 厅的地面矩形（含墙厚，与 SpaceSpec.rect 一致） */
  rect: Rect;
  unitPlane: THREE.PlaneGeometry;
  unitBox: THREE.BoxGeometry;
  scene: THREE.Scene;
  /** 需要挡住拾取的实体（柱子、灯具……） */
  blockers: THREE.Object3D[];
  track: <T extends { dispose(): void }>(item: T) => T;
}

/** 拱壳与反光翼的厚度 */
const SHELL_T = 0.12;
const WING_T = 0.02;
/** 天光缝两端各留这么长，别顶到端墙 */
const SLOT_INSET = 0.6;
/** 天光缝下那道细格栅的条数 */
const BAR_COUNT = 7;
/** 反光翼比天光缝低多少 */
const WING_DROP = 0.32;
/** 天光落在地上那道光比缝宽出多少 */
const POOL_PAD = 1.9;
/** 地面中轴石材带的宽度与沿墙走边的宽度 */
const RUNNER_W = 1.3;
const BORDER_W = 0.3;
/** 一片墙的厚度（两片背靠背拼成一整堵墙） */
const PANEL_T = 0.07;

/** 断面上一点的外法线：切线逆时针转 90°（摆线在起拱点是竖直的，正好朝外） */
export function outwardNormal(
  points: ProfilePoint[],
  index: number,
): { x: number; y: number } {
  const prev = points[Math.max(index - 1, 0)];
  const next = points[Math.min(index + 1, points.length - 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

/**
 * 把一条断面沿 z 挤成一层薄壳（拱壳、反光翼都用它）。
 *
 * 内表面法线朝 -n（朝室内/朝下），外表面朝 +n；UV 的 u 按断面弧长归一
 * （0 与 1 是两端，0.5 附近是拱顶，正好对上明暗渐变），v 沿长度归一。
 */
export function buildShell(
  profile: ProfilePoint[],
  length: number,
  thickness: number,
): THREE.BufferGeometry {
  const count = profile.length;
  const half = length / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 累计弧长，u 按弧长归一（顶点密度已经是弧长等距的，这里只是归一）
  const arc: number[] = [0];
  for (let i = 1; i < count; i += 1) {
    arc.push(arc[i - 1] + Math.hypot(profile[i].x - profile[i - 1].x, profile[i].y - profile[i - 1].y));
  }
  const total = arc[count - 1] || 1;

  const push = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    u: number,
    v: number,
  ): number => {
    positions.push(x, y, z);
    // 断面在 xy 平面、挤出沿 z，所以断面的法线 (nx, ny) 就是世界法线的前两维
    normals.push(nx, ny, 0);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  for (let i = 0; i < count; i += 1) {
    const point = profile[i];
    const normal = outwardNormal(profile, i);
    const u = arc[i] / total;
    const outer = { x: point.x + normal.x * thickness, y: point.y + normal.y * thickness };

    // 每个断面点在 z 的两端各生成一对（内 / 外）顶点
    const back = -half;
    const front = half;
    const innerBack = push(point.x, point.y, back, -normal.x, -normal.y, u, 0);
    const innerFront = push(point.x, point.y, front, -normal.x, -normal.y, u, 1);
    const outerBack = push(outer.x, outer.y, back, normal.x, normal.y, u, 0);
    const outerFront = push(outer.x, outer.y, front, normal.x, normal.y, u, 1);

    if (i > 0) {
      const step = 4;
      const prevInnerBack = innerBack - step;
      const prevInnerFront = innerFront - step;
      const prevOuterBack = outerBack - step;
      const prevOuterFront = outerFront - step;
      // 内表面：绕序保证法线朝室内（拱顶处是朝下）
      indices.push(prevInnerBack, innerBack, innerFront);
      indices.push(prevInnerBack, innerFront, prevInnerFront);
      // 外表面：朝室外
      indices.push(prevOuterBack, outerFront, outerBack);
      indices.push(prevOuterBack, prevOuterFront, outerFront);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * 拱顶两端的封口：起拱线以上的拱形墙面。
 * 用外扩后的断面（盖住拱壳的厚度），免得端墙与壳体之间露出一条缝。
 */
export function buildEndArch(profile: ProfilePoint[], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const first = profile[0];
  const outerFirst = (() => {
    const normal = outwardNormal(profile, 0);
    return { x: first.x + normal.x * thickness, y: first.y + normal.y * thickness };
  })();
  shape.moveTo(outerFirst.x, outerFirst.y);
  profile.forEach((point, index) => {
    const normal = outwardNormal(profile, index);
    shape.lineTo(point.x + normal.x * thickness, point.y + normal.y * thickness);
  });
  shape.lineTo(-outerFirst.x, outerFirst.y);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** 一个拱形（上圆下方）：半月窗、拱窗、镜面都用它 */
export function archShape(width: number, height: number, spring = 0.55): THREE.ShapeGeometry {
  const r = width / 2;
  const straight = height * spring;
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(-r, straight);
  shape.absarc(0, straight, r, Math.PI, 0, true);
  shape.lineTo(r, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/** 拱的矢高：形制给的是「跨度 × 多少」 */
function riseOf(style: HallStyle, width: number): number {
  return width * (style.ceiling.rise ?? 1 / Math.PI);
}

export function buildHall(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const slotLength = Math.max(1, ceiling.length - SLOT_INSET * 2);

  // ---- 顶棚 ----
  switch (style.ceiling.kind) {
    case 'vault':
      buildVault(ctx);
      break;
    case 'dome':
      buildDome(ctx);
      break;
    case 'flat':
      buildFlat(ctx);
      break;
    case 'lattice':
      buildFlat(ctx);
      buildLattice(ctx);
      break;
    case 'grid':
      buildFlat(ctx);
      buildSteelGrid(ctx);
      break;
  }

  // ---- 地面：中轴石材带、沿墙走边、天光落地的那道光 ----
  const midX = (ctx.rect.x1 + ctx.rect.x2) / 2;
  const midZ = (ctx.rect.z1 + ctx.rect.z2) / 2;
  const innerW = ctx.rect.x2 - ctx.rect.x1 - PANEL_T * 2;

  if (style.features.runner) {
    const runnerLength = Math.max(1, ceiling.length - 1.6);
    const runner = new THREE.Mesh(
      ctx.track(new THREE.PlaneGeometry(RUNNER_W, runnerLength)),
      mats.runner,
    );
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(midX, 0.008, midZ);
    scene.add(runner);

    const borderLength = Math.max(1, ceiling.length - 0.2);
    for (const side of [-1, 1] as (-1 | 1)[]) {
      const border = new THREE.Mesh(
        ctx.track(new THREE.PlaneGeometry(BORDER_W, borderLength)),
        mats.border,
      );
      border.rotation.x = -Math.PI / 2;
      border.position.set(midX + side * (innerW / 2 - BORDER_W / 2), 0.008, midZ);
      scene.add(border);
    }
  }

  if (style.light.pool > 0) {
    const poolMap = ctx.track(floorPoolTexture());
    const poolMaterial = ctx.track(
      new THREE.MeshBasicMaterial({
        map: poolMap,
        color: style.light.areaColor,
        transparent: true,
        opacity: style.light.pool,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    const wide = style.ceiling.kind === 'dome' ? 3.2 : (style.ceiling.slot ?? 1.1) + POOL_PAD;
    const pool = new THREE.Mesh(ctx.unitPlane, poolMaterial);
    pool.position.set(ceiling.x, 0.016, 0);
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(wide, slotLength, 1);
    scene.add(pool);
  }

  // ---- 侧墙上部：拱窗 / 镜面 ----
  if (style.features.windows || style.features.mirrors) {
    buildUpperWall(ctx);
  }

  // ---- 端墙：整片通高玻璃 ----
  if (style.features.glazing) {
    buildGlazing(ctx);
  }

  // ---- 吊灯 ----
  if (style.features.chandeliers > 0) buildChandeliers(ctx);
  if (style.features.lanterns > 0) buildLanterns(ctx);

  // ---- 顶光：每间厅一盏面光 ----
  // 筒拱的天光缝是线状光源，面光的软衰减才是对的；其余贴着顶棚挂一片
  const areaColor = new THREE.Color(style.light.areaColor);
  const light =
    style.ceiling.kind === 'vault'
      ? new THREE.RectAreaLight(
          areaColor,
          style.light.area,
          style.ceiling.slot ?? 1.1,
          slotLength,
        )
      : style.ceiling.kind === 'dome'
        ? new THREE.RectAreaLight(areaColor, style.light.area * 0.8, 1.6, 1.6)
        : new THREE.RectAreaLight(
            areaColor,
            style.light.area * 0.8,
            ceiling.width * 0.82,
            slotLength * 0.9,
          );
  const rise = riseOf(style, ceiling.width);
  light.position.set(
    ceiling.x,
    style.ceiling.kind === 'vault'
      ? ceiling.height + rise - 0.45
      : style.ceiling.kind === 'dome'
        ? ceiling.height + rise * 0.55
        : ceiling.height - 0.18,
    0,
  );
  // 朝正下方时 lookAt 是退化情形（视线与 up 平行），直接转：+π/2 让出光面朝下
  light.rotation.set(Math.PI / 2, 0, 0);
  scene.add(light);
}

/** 筒拱：壳体 + 横向肋 + 天光缝（反光翼 / 格栅）+ 半月窗 */
function buildVault(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const rise = riseOf(style, ceiling.width);
  const profile = archProfile(ceiling.width, rise);
  const apexY = ceiling.height + rise;
  const slotLength = Math.max(1, ceiling.length - SLOT_INSET * 2);

  const shell = new THREE.Mesh(buildShell(profile, ceiling.length, SHELL_T), mats.ceiling);
  shell.position.set(ceiling.x, ceiling.height, 0);
  scene.add(shell);
  ctx.track(shell.geometry);

  // 横向肋：一道道横跨拱顶的线脚（卢浮宫、乌菲齐、西斯廷都有）
  if (style.ceiling.ribs) {
    const count = Math.max(3, Math.round(ceiling.length / 1.9));
    const ribGeometry = ctx.track(buildShell(profile, 0.16, SHELL_T + 0.055));
    for (let i = 0; i < count; i += 1) {
      const z = -ceiling.length / 2 + ((i + 0.5) / count) * ceiling.length;
      const rib = new THREE.Mesh(ribGeometry, mats.trim);
      rib.position.set(ceiling.x, ceiling.height, z);
      scene.add(rib);
    }
  }

  // 天光缝：贴在拱顶下沿的一条亮面（不用在壳上开洞，看不出区别）
  if (style.ceiling.slot) {
    const slot = new THREE.Mesh(ctx.unitPlane, mats.glow);
    slot.position.set(ceiling.x, apexY - 0.06, 0);
    slot.rotation.x = Math.PI / 2;
    slot.scale.set(style.ceiling.slot, slotLength, 1);
    scene.add(slot);

    // 缝下的细格栅：金贝尔天光最标志性的那一片穿孔铝
    const barMaterial = ctx.track(
      new THREE.MeshStandardMaterial({ color: '#6f747a', roughness: 0.42, metalness: 0.6 }),
    );
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const z = -slotLength / 2 + ((i + 0.5) / BAR_COUNT) * slotLength;
      const bar = new THREE.Mesh(ctx.unitBox, barMaterial);
      bar.position.set(ceiling.x, apexY - 0.12, z);
      bar.scale.set(style.ceiling.slot + 0.08, 0.022, 0.024);
      scene.add(bar);
    }

    // 反光翼：从缝的两侧向外、向下弯出去的浅弧
    if (style.ceiling.wing) {
      for (const side of [-1, 1] as (-1 | 1)[]) {
        const wing = buildShell(wingProfile(side, rise, style), slotLength, WING_T);
        const mesh = new THREE.Mesh(wing, mats.metal);
        mesh.position.set(ceiling.x, ceiling.height, 0);
        scene.add(mesh);
        ctx.track(wing);
      }
    }
  }

  // 半月窗：起拱线下一排拱形窗，从拱脚把光带进来
  if (style.ceiling.lunettes) buildLunettes(ctx);
}

/** 一侧反光翼的断面：从天光缝边上向外向下弯出去 */
function wingProfile(side: -1 | 1, rise: number, style: HallStyle): ProfilePoint[] {
  const slot = style.ceiling.slot ?? 0.7;
  const wing = style.ceiling.wing ?? 0.9;
  const points: ProfilePoint[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({
      x: side * (slot / 2 + wing * t),
      // 起拱线往上算：贴着拱顶走，再慢慢离开
      y: rise - 0.1 - WING_DROP * t * t,
    });
  }
  return points;
}

/** 半月窗：两侧长墙上部一排拱形窗（西斯廷 / 卢浮宫的高窗） */
function buildLunettes(ctx: HallBuildContext): void {
  const { ceiling, mats, scene } = ctx;
  const count = Math.max(3, Math.round(ceiling.length / 2.3));
  const winW = 0.9;
  const winH = Math.min(1.5, ceiling.height * 0.3);
  const geometry = ctx.track(archShape(winW, winH, 0.5));
  const frameGeometry = ctx.track(archShape(winW + 0.16, winH + 0.16, 0.5));

  for (let i = 0; i < count; i += 1) {
    const z = -ceiling.length / 2 + ((i + 0.5) / count) * ceiling.length;
    const y = ceiling.height - winH - 0.16;
    for (const side of [-1, 1] as (-1 | 1)[]) {
      const x = ceiling.x + side * (ceiling.width / 2 - PANEL_T - 0.03);
      const frame = new THREE.Mesh(frameGeometry, mats.trim);
      frame.position.set(x - side * 0.01, y - 0.08, z);
      frame.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(frame);

      const pane = new THREE.Mesh(geometry, mats.glow);
      pane.position.set(x, y, z);
      pane.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(pane);
    }
  }
  // 窗子坐在起拱线那一圈的檐口上，光才有来源
}

/** 穹顶 + 天眼（古根海姆中庭）：平顶开椭圆洞，洞上一顶穹，中间留天眼 */
function buildDome(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const dome = style.ceiling.dome ?? { oculus: 1.6, ribs: 24, ramp: false };
  const rx = ceiling.width * 0.42;
  const rz = ceiling.length * 0.42;
  const rise = riseOf(style, ceiling.width) + ceiling.width * 0.16;

  // 平顶：矩形挖一个椭圆洞（ShapeGeometry 的洞用 absellipse 给路径）
  const shape = new THREE.Shape();
  const halfW = ceiling.width / 2;
  const halfL = ceiling.length / 2;
  shape.moveTo(-halfW, -halfL);
  shape.lineTo(halfW, -halfL);
  shape.lineTo(halfW, halfL);
  shape.lineTo(-halfW, halfL);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0, 0, rx, rz, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const flat = new THREE.Mesh(ctx.track(new THREE.ShapeGeometry(shape)), mats.ceiling);
  flat.rotation.x = Math.PI / 2;
  flat.position.set(ceiling.x, ceiling.height, 0);
  scene.add(flat);

  // 穹顶：半球压成椭球，内表面朝下（BackSide 就不用翻法线）
  const domeGeometry = ctx.track(
    new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
  );
  const shell = new THREE.Mesh(domeGeometry, mats.ceiling);
  shell.scale.set(rx, rise, rz);
  shell.position.set(ceiling.x, ceiling.height, 0);
  scene.add(shell);

  // 环向肋：几道水平的圈，穹顶看着是一圈圈砌上去的
  for (const t of [0.34, 0.64, 0.87]) {
    const rScale = Math.sqrt(Math.max(0, 1 - t * t));
    const ring = ctx.track(new THREE.TorusGeometry(1, 0.018, 6, 48));
    const mesh = new THREE.Mesh(ring, mats.trim);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.set(rx * rScale, rz * rScale, 1);
    // TorusGeometry 建在 xy 平面，绕 x 转 90° 后 scale 的 z 落在世界的 y 上
    mesh.scale.z = 1;
    mesh.position.set(ceiling.x, ceiling.height + rise * t, 0);
    scene.add(mesh);
  }

  // 天眼：一圈压顶的环 + 一片天光
  const oculus = Math.min(dome.oculus, rx * 0.9);
  const ring = new THREE.Mesh(
    ctx.track(new THREE.TorusGeometry(oculus / 2, 0.06, 8, 40)),
    mats.accent,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(ceiling.x, ceiling.height + rise - 0.02, 0);
  scene.add(ring);

  const sky = new THREE.Mesh(ctx.unitPlane, mats.glow);
  sky.position.set(ceiling.x, ceiling.height + rise + 0.02, 0);
  sky.rotation.x = Math.PI / 2;
  sky.scale.set(oculus, oculus, 1);
  scene.add(sky);

  // 沿墙盘一圈的坡道：古根海姆的那条螺旋，摆着看（走不上去）
  if (dome.ramp) {
    const ramp = new THREE.Mesh(buildRampBand(ctx.rect, ceiling.height * 0.52), mats.floor);
    scene.add(ramp);
    ctx.track(ramp.geometry);
  }
}

/** 平顶：一整片 + 轨道灯（白盒子） */
function buildFlat(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const flat = new THREE.Mesh(ctx.unitPlane, mats.ceiling);
  flat.position.set(ceiling.x, ceiling.height, 0);
  flat.rotation.x = Math.PI / 2;
  flat.scale.set(ceiling.width, ceiling.length, 1);
  scene.add(flat);

  if (style.ceiling.kind !== 'flat') return;

  // 轨道灯：几条轨道，上面一颗颗小筒灯（发光的小面 + 一圈黑壳）
  const tracks = style.ceiling.tracks ?? 2;
  const lampCount = Math.max(3, Math.round(ceiling.length / 1.6));
  const lampMaterial = ctx.track(
    new THREE.MeshBasicMaterial({ color: '#fffaf0', toneMapped: false, fog: false }),
  );
  for (let t = 0; t < tracks; t += 1) {
    const x = ceiling.x + (tracks === 1 ? 0 : (t / (tracks - 1) - 0.5) * ceiling.width * 0.5);
    const rail = new THREE.Mesh(ctx.unitBox, mats.accent);
    rail.position.set(x, ceiling.height - 0.05, 0);
    rail.scale.set(0.05, 0.05, ceiling.length * 0.94);
    scene.add(rail);

    for (let i = 0; i < lampCount; i += 1) {
      const z = -ceiling.length / 2 + ((i + 0.5) / lampCount) * ceiling.length;
      const can = new THREE.Mesh(ctx.unitBox, mats.accent);
      can.position.set(x, ceiling.height - 0.14, z);
      can.scale.set(0.09, 0.12, 0.09);
      scene.add(can);

      const lamp = new THREE.Mesh(ctx.unitPlane, lampMaterial);
      lamp.position.set(x, ceiling.height - 0.2, z);
      lamp.rotation.x = Math.PI / 2;
      lamp.scale.set(0.07, 0.07, 1);
      scene.add(lamp);
    }
  }
}

/**
 * 木格栅天花（东方厅堂）：格栅下面糊一层纸，纸是暖的发光面，
 * 格栅压在纸上，光从格子里透出来。
 */
function buildLattice(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const cells = style.ceiling.lattice ?? 5;
  const stepX = ceiling.width / cells;
  const stepZ = Math.max(1, Math.round((ceiling.length / ceiling.width) * cells));
  const beam = 0.07;

  // 纸：一整片暖光，压在格栅下面
  const paper = new THREE.Mesh(ctx.unitPlane, mats.glowWarm);
  paper.position.set(ceiling.x, ceiling.height - 0.05, 0);
  paper.rotation.x = Math.PI / 2;
  paper.scale.set(ceiling.width - 0.1, ceiling.length - 0.1, 1);
  scene.add(paper);

  for (let i = 0; i <= cells; i += 1) {
    const x = ceiling.x - ceiling.width / 2 + i * stepX;
    const bar = new THREE.Mesh(ctx.unitBox, mats.accent);
    bar.position.set(x, ceiling.height - 0.075, 0);
    bar.scale.set(beam, 0.05, ceiling.length - 0.1);
    scene.add(bar);
  }
  const stepZLen = ceiling.length / stepZ;
  for (let i = 0; i <= stepZ; i += 1) {
    const z = -ceiling.length / 2 + i * stepZLen;
    const bar = new THREE.Mesh(ctx.unitBox, mats.accent);
    bar.position.set(ceiling.x, ceiling.height - 0.075, z);
    bar.scale.set(ceiling.width - 0.1, 0.05, beam);
    scene.add(bar);
  }

  // 沿墙一圈的压条：格栅落在墙上得有个交代
  for (const side of [-1, 1] as (-1 | 1)[]) {
    const beam2 = new THREE.Mesh(ctx.unitBox, mats.accent);
    beam2.position.set(ceiling.x + side * (ceiling.width / 2 - PANEL_T - 0.06), ceiling.height - 0.1, 0);
    beam2.scale.set(0.12, 0.14, ceiling.length);
    scene.add(beam2);
  }
}

/** 钢网格玻璃顶（新国家美术馆）：黑色井格梁 + 一格格发光板 */
function buildSteelGrid(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const panels = style.ceiling.panels ?? 3;
  const cols = Math.max(2, Math.round((ceiling.length / ceiling.width) * panels));
  const stepX = ceiling.width / panels;
  const stepZ = ceiling.length / cols;

  for (let i = 0; i <= panels; i += 1) {
    const x = ceiling.x - ceiling.width / 2 + i * stepX;
    const beam = new THREE.Mesh(ctx.unitBox, mats.accent);
    beam.position.set(x, ceiling.height - 0.12, 0);
    beam.scale.set(0.09, 0.24, ceiling.length);
    scene.add(beam);
  }
  for (let i = 0; i <= cols; i += 1) {
    const z = -ceiling.length / 2 + i * stepZ;
    const beam = new THREE.Mesh(ctx.unitBox, mats.accent);
    beam.position.set(ceiling.x, ceiling.height - 0.12, z);
    beam.scale.set(ceiling.width, 0.24, 0.09);
    scene.add(beam);
  }

  // 发光板：填在格子里，比格子小一圈，像一块块灯箱
  const panelMaterial = ctx.track(
    new THREE.MeshBasicMaterial({
      color: '#f4f8ff',
      toneMapped: false,
      fog: false,
      transparent: true,
      opacity: 0.92,
    }),
  );
  for (let i = 0; i < panels; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const x = ceiling.x - ceiling.width / 2 + (i + 0.5) * stepX;
      const z = -ceiling.length / 2 + (j + 0.5) * stepZ;
      const panel = new THREE.Mesh(ctx.unitPlane, panelMaterial);
      panel.position.set(x, ceiling.height - 0.02, z);
      panel.rotation.x = Math.PI / 2;
      panel.scale.set(stepX - 0.16, stepZ - 0.16, 1);
      scene.add(panel);
    }
  }
}

/**
 * 侧墙上部：一侧满镜（镜厅），另一侧一排拱窗。
 * 画挂在眼高，这两样都在画框上方，谁也不挡谁。
 */
function buildUpperWall(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const count = Math.max(3, Math.round(ceiling.length / 2.1));
  const winW = Math.min(1.1, (ceiling.length / count) * 0.62);
  const winH = Math.min(1.9, ceiling.height * 0.42);
  const y = ceiling.height - winH - 0.2;

  const paneGeometry = ctx.track(archShape(winW, winH, 0.62));
  const frameGeometry = ctx.track(archShape(winW + 0.14, winH + 0.14, 0.62));

  for (let i = 0; i < count; i += 1) {
    const z = -ceiling.length / 2 + ((i + 0.5) / count) * ceiling.length;
    // 镜面在左墙（-x 那面），拱窗在右墙
    for (const side of [-1, 1] as (-1 | 1)[]) {
      const mirror = side === -1;
      if (mirror && !style.features.mirrors) continue;
      if (!mirror && !style.features.windows) continue;
      const x = ceiling.x + side * (ceiling.width / 2 - PANEL_T - 0.03);
      const frame = new THREE.Mesh(frameGeometry, mats.trim);
      frame.position.set(x - side * 0.012, y - 0.07, z);
      frame.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(frame);

      const pane = new THREE.Mesh(paneGeometry, mirror ? mats.mirror : mats.glow);
      pane.position.set(x, y, z);
      pane.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(pane);
    }
  }
}

/** 端墙整片通高玻璃（新国家美术馆）：天光 + 竖向分格的钢框 */
function buildGlazing(ctx: HallBuildContext): void {
  const { ceiling, mats, scene } = ctx;
  const half = ceiling.length / 2;
  for (const [z, normal] of [
    [-half, 1],
    [half, -1],
  ] as [number, 1 | -1][]) {
    const pane = new THREE.Mesh(ctx.unitPlane, mats.glow);
    pane.position.set(ceiling.x, ceiling.height * 0.52, z + normal * (PANEL_T + 0.03));
    pane.rotation.y = normal === 1 ? 0 : Math.PI;
    pane.scale.set(ceiling.width - 0.3, ceiling.height * 0.86, 1);
    scene.add(pane);

    // 竖挺：每 1.1m 一根，玻璃墙没有竖挺就只是一块亮面
    const mullions = Math.max(2, Math.round(ceiling.width / 1.1));
    for (let i = 0; i <= mullions; i += 1) {
      const x = ceiling.x - (ceiling.width - 0.3) / 2 + (i / mullions) * (ceiling.width - 0.3);
      const bar = new THREE.Mesh(ctx.unitBox, mats.accent);
      bar.position.set(x, ceiling.height * 0.52, z + normal * (PANEL_T + 0.05));
      bar.scale.set(0.05, ceiling.height * 0.86, 0.05);
      scene.add(bar);
    }
  }
}

/** 枝形灯：一圈小亮点 + 一片光晕，吊在顶棚下（卢浮宫、凡尔赛） */
function buildChandeliers(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const count = style.features.chandeliers;
  const glowMap = ctx.track(radialTexture('255,236,196'));
  const glowMaterial = ctx.track(
    new THREE.MeshBasicMaterial({
      map: glowMap,
      color: '#ffe9bd',
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const bulbMaterial = ctx.track(
    new THREE.MeshBasicMaterial({ color: '#fff4d8', toneMapped: false, fog: false }),
  );

  for (let i = 0; i < count; i += 1) {
    const z = -ceiling.length / 2 + ((i + 0.5) / count) * ceiling.length;
    const drop = 0.75;
    const y = ceiling.height - drop;

    const rod = new THREE.Mesh(ctx.unitBox, mats.metal);
    rod.position.set(ceiling.x, ceiling.height - drop / 2, z);
    rod.scale.set(0.03, drop, 0.03);
    scene.add(rod);

    // 一圈灯臂：环上均匀挂若干小亮点
    const arms = 8;
    const radius = 0.34;
    for (let a = 0; a < arms; a += 1) {
      const angle = (a / arms) * Math.PI * 2;
      const bulb = new THREE.Mesh(ctx.unitPlane, bulbMaterial);
      bulb.position.set(
        ceiling.x + Math.cos(angle) * radius,
        y - 0.06,
        z + Math.sin(angle) * radius,
      );
      bulb.scale.set(0.09, 0.09, 1);
      scene.add(bulb);
    }
    const ring = new THREE.Mesh(ctx.track(new THREE.TorusGeometry(radius, 0.022, 6, 24)), mats.metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(ceiling.x, y - 0.06, z);
    scene.add(ring);

    // 光晕：一片朝向相机的加色面（相机总在水平面上，立着放就够了）
    const halo = new THREE.Mesh(ctx.unitPlane, glowMaterial);
    halo.position.set(ceiling.x, y - 0.1, z);
    halo.scale.set(1.5, 1.5, 1);
    scene.add(halo);
  }
}

/** 宫灯：纸灯笼，暖光从纸里透出来（东方厅堂） */
function buildLanterns(ctx: HallBuildContext): void {
  const { ceiling, style, mats, scene } = ctx;
  const glowMap = ctx.track(radialTexture('255,214,150'));
  const haloMaterial = ctx.track(
    new THREE.MeshBasicMaterial({
      map: glowMap,
      color: '#ffd79a',
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );

  for (let i = 0; i < style.features.lanterns; i += 1) {
    const z = -ceiling.length / 2 + ((i + 0.5) / style.features.lanterns) * ceiling.length;
    const y = ceiling.height - 0.62;
    const body = new THREE.Mesh(ctx.unitBox, mats.glowWarm);
    body.position.set(ceiling.x, y, z);
    body.scale.set(0.42, 0.5, 0.42);
    scene.add(body);
    ctx.blockers.push(body);

    // 上下两根箍
    for (const dy of [-0.26, 0.26]) {
      const cap = new THREE.Mesh(ctx.unitBox, mats.accent);
      cap.position.set(ceiling.x, y + dy, z);
      cap.scale.set(0.2, 0.04, 0.2);
      scene.add(cap);
    }
    const cord = new THREE.Mesh(ctx.unitBox, mats.accent);
    cord.position.set(ceiling.x, ceiling.height - 0.31, z);
    cord.scale.set(0.02, 0.62, 0.02);
    scene.add(cord);

    const halo = new THREE.Mesh(ctx.unitPlane, haloMaterial);
    halo.position.set(ceiling.x, y, z);
    halo.scale.set(1.4, 1.4, 1);
    scene.add(halo);
  }
}

/**
 * 沿墙盘一圈的坡道（古根海姆）：一条内低外高慢慢爬升的带子。
 * 摆着看的 —— 可行走区还是平的。
 */
function buildRampBand(rect: Rect, climb: number): THREE.BufferGeometry {
  const samples = 96;
  const band = 1.5;
  const inset = 0.55;
  const inner = perimeterPoints(rect, inset + band, samples);
  const outer = perimeterPoints(rect, inset, samples);
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const k = i % samples;
    // 从门口（z 最小处）起，绕一圈爬到 climb
    const t = k / samples;
    const y = 0.18 + t * climb;
    positions.push(outer[k].x, y, outer[k].z);
    positions.push(inner[k].x, y + 0.06, inner[k].z);
  }
  for (let i = 0; i < samples; i += 1) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** 沿矩形边界走一圈的采样点；inset 是向房间内缩的距离 */
function perimeterPoints(
  rect: Rect,
  inset: number,
  samples: number,
): { x: number; z: number }[] {
  const cx = (rect.x1 + rect.x2) / 2;
  const cz = (rect.z1 + rect.z2) / 2;
  const hw = Math.max(0.2, (rect.x2 - rect.x1) / 2 - inset);
  const hl = Math.max(0.2, (rect.z2 - rect.z1) / 2 - inset);
  const corners: [number, number][] = [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ];
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * 4;
    const edge = Math.floor(t);
    const f = t - edge;
    const from = corners[edge % 4];
    const to = corners[(edge + 1) % 4];
    points.push({
      x: cx + from[0] + (to[0] - from[0]) * f,
      z: cz + from[1] + (to[1] - from[1]) * f,
    });
  }
  return points;
}

/** 顶棚材质：彩画的用湿壁画，其余是混凝土 + 画出来的明暗渐变 */
export function ceilingMaterial(
  style: HallStyle,
  track: <T extends { dispose(): void }>(item: T) => T,
): THREE.MeshStandardMaterial {
  if (style.ceiling.paint) {
    return track(
      new THREE.MeshStandardMaterial({
        map: track(frescoTexture(style.colors.ceiling, style.colors.trim)),
        roughness: 0.86,
        metalness: 0.04,
      }),
    );
  }
  return track(
    new THREE.MeshStandardMaterial({
      map: track(concreteTexture(style.colors.ceiling)),
      emissive: 0xffffff,
      emissiveMap: track(vaultLightTexture()),
      emissiveIntensity: 0.3,
      roughness: 0.95,
      metalness: 0,
    }),
  );
}

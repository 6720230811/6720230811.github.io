/**
 * 3D 展厅场景：夜行折廊。
 *
 *  建筑的数据在 blueprint.ts / walls.ts / plan.ts，这里只负责按分区把它摆出来：
 *  - 墙：按分区上色（基础暖灰 + 每区 20–30% 的主题墙），InstancedMesh
 *  - 天花：长廊按「段 + 转角」铺 3.6 m 的平整顶面，房间按自己的净高单独一块
 *    （规格明确禁掉全场统一的方格吊顶）
 *  - 地面：1.2×2.4 / 2×2 的大模块，铺缝只比底色暗一点点；拼缝方向跟着长廊走
 *  - 灯槽：沿长廊中心线一条连续 emissive 光带，向主墙偏 0.7 m，每 10 m 断一次
 *  - 门套：矩形门洞 + 中央大厅/沉浸展厅的浅拱券，顶上补齐门楣
 *  - 房间道具：凳子、装置占位、可移动展墙（展墙在 plan.walls 里当墙画）
 *
 *  交互接口（FloorHandle）与原来一致：pickables / pictures / viewpoint /
 *  setHover / setPicture / setSize / render / dispose。
 */
import * as THREE from 'three';
import {
  BRANCHES,
  CORRIDOR,
  CORRIDOR_PATH,
  DOOR,
  ROOMS,
  zone as zoneSpec,
  type Rect,
  type Vec2,
  type ZoneId,
} from './blueprint';
import { nearestArc } from './walls';
import {
  ceilingTexture,
  environmentTexture,
  floorModuleTexture,
  mineralTexture,
  placeholderFrameTexture,
  thresholdTexture,
  wallLabelTexture,
} from './surfaces';
import type { FloorPlan, Placement, WallSegment } from './plan';

/** 踢脚线：高 0.075 m、厚 0.025 m、颜色 #3F413E（规格） */
const TRIM = { height: 0.075, thickness: 0.025, color: '#3F413E' } as const;
/** 门套：深 0.22 m（拱券 0.25）、宽 0.12 m、颜色 #3E4140 */
const JAMB = { width: 0.12, color: '#3E4140' } as const;
/** 灯槽：宽 0.2 m，向主挂画墙偏 0.7 m，每 10 m 断 1.5 m（规格 8–12 m） */
const LIGHT = {
  width: 0.2,
  offset: 0.7,
  run: 10,
  gap: 1.5,
  /** 洗墙灯离作品墙的距离（规格 0.8–1.1） */
  washerDistance: 0.95,
} as const;
/**
 * 灯光：3500 K 的环境、3800–4200 K 的作品灯。
 *  环境压得比上一版暗（0.42 / 0.55），好让作品灯的 1.8–2.5 倍对比读得出来 ——
 *  「夜间叙事感」靠明暗对比，不靠把整间厅调暗。
 */
const LIGHTING = {
  /** 半球光：天光暖白（3500 K 那一档），地面反弹取深暖灰 */
  sky: 0xffd9b0,
  ground: 0x3a3733,
  ambient: 0.42,
  /** 作品灯：只有相机附近这几盏是真的 SpotLight，全都不投影 */
  spots: { high: 6, low: 3 },
} as const;
/** 主题墙占比（规格 20–30%） */
const ACCENT_RATIO = 0.26;
/**
 * 画质档：手机/平板（粗指针）或 CPU 核少的机器直接按低配起 ——
 * 少一半真实光源、像素比封到 1.5。之后还有一档：跑不动了再降到 1.0。
 */
function isLowPower(): boolean {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || (navigator.hardwareConcurrency ?? 8) <= 4;
}

export interface CreateFloorOptions {
  canvas: HTMLCanvasElement;
  plan: FloorPlan;
}

export type PickResult =
  | { kind: 'art'; id: string; slot: number }
  | { kind: 'floor'; x: number; z: number };

/** 一个挂画位：画布（可点）与它背后的光晕（悬停时整块换材质，不每处留一份） */
interface Slot {
  picture: THREE.Mesh;
  halo: THREE.Mesh;
}

export interface FloorHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  pickables: THREE.Object3D[];
  blockers: THREE.Object3D[];
  /** 展品 id → 它的全部挂画位（同一件会挂很多次，纹理要挨个换） */
  pictures: Map<string, THREE.Mesh[]>;
  setPicture(id: string, texture: THREE.Texture): void;
  pick(clientX: number, clientY: number): PickResult | null;
  viewpoint(id: string): { x: number; z: number; yaw: number } | null;
  /** slot 是 pick 回来的挂画位下标；null 取消高亮 */
  setHover(slot: number | null): void;
  /** 人在 (x, z)：把那几盏作品灯挪到附近的画上（内部按位移节流） */
  updateLighting(x: number, z: number): void;
  setSize(width: number, height: number): void;
  /** 跑不动了先降分辨率（1 = 一个 CSS 像素一个设备像素），比整块降级温和 */
  setPixelRatio(ratio: number): void;
  render(): void;
  dispose(): void;
}

interface Disposable {
  dispose(): void;
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

export function loadTexture(
  url: string,
): Promise<{ texture: THREE.Texture; aspect: number | null }> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        const image = texture.image as { width?: number; height?: number } | undefined;
        const aspect = image?.width && image?.height ? image.width / image.height : null;
        resolve({ texture, aspect });
      },
      undefined,
      () => reject(new Error(`纹理加载失败：${url}`)),
    );
  });
}

function placeholderTexture(): THREE.DataTexture {
  const data = new Uint8Array([230, 228, 222, 255]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
/** 一段矩形区域（地面 / 天花都按它铺） */
interface Band {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  zone: ZoneId;
  /** 铺装方向：模块长边顺着它 */
  along: 'x' | 'z';
}

function rectOf(a: Vec2, b: Vec2): Rect {
  return {
    x1: Math.min(a.x, b.x),
    z1: Math.min(a.z, b.z),
    x2: Math.max(a.x, b.x),
    z2: Math.max(a.z, b.z),
  };
}

/**
 * 长廊的矩形分解：每段一块（沿段方向 4 m 宽），每个转角再补一块 4×4 的方块。
 *
 *  转角方块必须先定下来、再从各段里挖掉：段与转角方块一样高、一样平，
 *  叠在一起就是两片共面的面 —— 章节交界处两块颜色不同，会 z-fighting
 *  （天花与地面在转角处整片闪色）。挖掉之后只剩边贴边，不再重叠。
 *
 *  转角方块用「进来那一段」的颜色：章节在转角之后才换，拐弯时颜色是渐的，
 *  不会在转身的地方突然跳一下。
 */
function corridorBands(): Band[] {
  const half = CORRIDOR.width / 2;
  const out: Band[] = [];
  const corners: Rect[] = [];
  for (let i = 1; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const p = CORRIDOR_PATH[i];
    corners.push({ x1: p.x - half, z1: p.z - half, x2: p.x + half, z2: p.z + half });
  }

  for (let i = 0; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const a = CORRIDOR_PATH[i];
    const b = CORRIDOR_PATH[i + 1];
    const horizontal = Math.abs(a.z - b.z) < 1e-6;
    const zone = corridorZone(nearestArc((a.x + b.x) / 2, (a.z + b.z) / 2));
    const along: Band['along'] = horizontal ? 'x' : 'z';
    let pieces: Rect[] = [
      {
        x1: horizontal ? Math.min(a.x, b.x) : a.x - half,
        x2: horizontal ? Math.max(a.x, b.x) : a.x + half,
        z1: horizontal ? a.z - half : Math.min(a.z, b.z),
        z2: horizontal ? a.z + half : Math.max(a.z, b.z),
      },
    ];
    for (const corner of corners) {
      pieces = pieces.flatMap((piece) => subtract(piece, corner));
    }
    for (const piece of pieces) {
      out.push({ x1: piece.x1, z1: piece.z1, x2: piece.x2, z2: piece.z2, zone, along });
    }
  }

  // 转角：补一块 4×4，把两段之间的方角填上
  for (let i = 1; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const p = CORRIDOR_PATH[i];
    const prev = CORRIDOR_PATH[i - 1];
    out.push({
      x1: p.x - half,
      z1: p.z - half,
      x2: p.x + half,
      z2: p.z + half,
      zone: corridorZone(nearestArc((p.x + prev.x) / 2, (p.z + prev.z) / 2)),
      along: Math.abs(p.x - prev.x) < 1e-6 ? 'z' : 'x',
    });
  }
  return out;
}

function corridorZone(arc: number): ZoneId {
  for (const item of planZones) {
    if (item.kind === 'corridor' && item.span && arc >= item.span[0] && arc <= item.span[1]) {
      return item.id;
    }
  }
  return 'final';
}

/** 模块级：plan.zones 的缓存（corridorZone 用） */
let planZones: FloorPlan['zones'] = [];

/** 矩形相减：从 r 里挖掉 hole，剩下最多 4 块 */
function subtract(r: Rect, hole: Rect): Rect[] {
  const overlapX = Math.min(r.x2, hole.x2) - Math.max(r.x1, hole.x1);
  const overlapZ = Math.min(r.z2, hole.z2) - Math.max(r.z1, hole.z1);
  if (overlapX <= 0 || overlapZ <= 0) return [r];
  const out: Rect[] = [];
  if (hole.z1 > r.z1) out.push({ x1: r.x1, z1: r.z1, x2: r.x2, z2: hole.z1 });
  if (hole.z2 < r.z2) out.push({ x1: r.x1, z1: hole.z2, x2: r.x2, z2: r.z2 });
  const z1 = Math.max(r.z1, hole.z1);
  const z2 = Math.min(r.z2, hole.z2);
  if (hole.x1 > r.x1) out.push({ x1: r.x1, z1, x2: hole.x1, z2 });
  if (hole.x2 < r.x2) out.push({ x1: hole.x2, z1, x2: r.x2, z2 });
  return out.filter((piece) => piece.x2 - piece.x1 > 0.05 && piece.z2 - piece.z1 > 0.05);
}

/**
 * 挑主题墙：每个分区里挑出占墙面长度 ~26% 的墙刷主题色。
 *  优先挑「尽端墙」（与长廊走向垂直的那面）—— 规格要深色墙放在视觉终点、
 *  区域入口和重点作品背后；不够再按长度从长到短补。
 */
function pickAccentWalls(walls: WallSegment[], zones: FloorPlan['zones']): Set<number> {
  const out = new Set<number>();
  const byZone = new Map<ZoneId, number[]>();
  walls.forEach((wall, index) => {
    const list = byZone.get(wall.zone);
    if (list) list.push(index);
    else byZone.set(wall.zone, [index]);
  });

  for (const [zoneId, indices] of byZone) {
    const spec = zones.find((item) => item.id === zoneId);
    if (!spec?.accent) continue;
    const total = indices.reduce((sum, i) => sum + walls[i].length, 0);
    let budget = total * ACCENT_RATIO;

    // 尽端墙：与长廊走向垂直
    const scored = indices.map((index) => {
      const wall = walls[index];
      const mid = { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.z + wall.b.z) / 2 };
      const dir = corridorDirection(nearestArc(mid.x, mid.z));
      const wallDir = { x: wall.b.x - wall.a.x, z: wall.b.z - wall.a.z };
      const len = Math.hypot(wallDir.x, wallDir.z) || 1;
      const dot = Math.abs((wallDir.x / len) * dir.x + (wallDir.z / len) * dir.z);
      return { index, end: dot < 0.35, length: wall.length };
    });
    scored.sort((a, b) => Number(b.end) - Number(a.end) || b.length - a.length);

    for (const item of scored) {
      if (budget <= 0) break;
      out.add(item.index);
      budget -= item.length;
    }
  }
  return out;
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

/** 浅拱券：起拱 2.35、总高 3.4、跨度 3.0 → 矢高 1.05 的圆弧环 */
function archGeometry(halfSpan: number, rise: number, thickness: number, depth: number): THREE.ExtrudeGeometry {
  const radius = (halfSpan * halfSpan + rise * rise) / (2 * rise);
  const dy = Math.sqrt(Math.max(radius * radius - halfSpan * halfSpan, 0.0001));
  const outer = Math.asin(Math.min(halfSpan / (radius + thickness), 1));
  const shape = new THREE.Shape();
  shape.absarc(0, -dy, radius + thickness, Math.PI / 2 - outer, Math.PI / 2 + outer, false);
  shape.absarc(0, -dy, radius, Math.PI / 2 + outer, Math.PI / 2 - outer, true);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
}

export function createFloor({ canvas, plan }: CreateFloorOptions): FloorHandle {
  planZones = plan.zones;

  const lowPower = isLowPower();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const diagonal = Math.hypot(spanX, spanZ);

  const scene = new THREE.Scene();
  // 馆外是夜色：背景与雾都压到深灰蓝，入口那点暖光才有戏剧性
  scene.fog = new THREE.FogExp2(new THREE.Color('#202528'), 0.008);
  scene.background = new THREE.Color('#191D20');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.25, diagonal * 2 + 60);

  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 材质库：每个分区一套墙 / 主题墙 / 天花 / 地面 ----
  const zoneMats = new Map<
    ZoneId,
    {
      wall: THREE.MeshStandardMaterial;
      accent: THREE.MeshStandardMaterial;
      ceiling: THREE.MeshStandardMaterial;
      floor: THREE.MeshStandardMaterial;
      floorMap: THREE.Texture;
    }
  >();
  for (const item of plan.zones) {
    const wall = track(
      new THREE.MeshStandardMaterial({
        map: track(mineralTexture(item.wall)),
        roughness: 0.92,
        metalness: 0,
        envMapIntensity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    const accent = item.accent
      ? track(
          new THREE.MeshStandardMaterial({
            map: track(mineralTexture(item.accent)),
            roughness: 0.9,
            metalness: 0,
            envMapIntensity: 0.45,
            side: THREE.DoubleSide,
          }),
        )
      : wall;
    const ceiling = track(
      new THREE.MeshStandardMaterial({
        map: track(ceilingTexture(item.ceilingColor)),
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    const floorMap = track(floorModuleTexture(item.floorColor));
    const floor = track(
      new THREE.MeshStandardMaterial({
        map: floorMap,
        roughness: 0.74,
        metalness: 0,
        envMapIntensity: 0.45,
      }),
    );
    zoneMats.set(item.id, { wall, accent, ceiling, floor, floorMap });
  }
  const fallback = zoneMats.get('night') ?? [...zoneMats.values()][0];

  const trimMat = track(
    new THREE.MeshStandardMaterial({ color: TRIM.color, roughness: 0.65, metalness: 0 }),
  );
  const jambMat = track(
    new THREE.MeshStandardMaterial({ color: JAMB.color, roughness: 0.6, metalness: 0 }),
  );
  const placeholder = track(placeholderTexture());
  // 数据暂缺时挂的统一中性画框（不是某张作品的复制品）
  const placeholderFrame = track(placeholderFrameTexture());

  // ---- 墙：按 (分区, 类型) 分组，每组一个 InstancedMesh ----
  const accentSet = pickAccentWalls(plan.walls, plan.zones);
  const groups = new Map<
    string,
    { material: THREE.MeshStandardMaterial; walls: { wall: WallSegment; index: number }[] }
  >();
  plan.walls.forEach((wall, index) => {
    const mats = zoneMats.get(wall.zone) ?? fallback;
    const kind = wall.kind === 'partition' ? 'partition' : accentSet.has(index) ? 'accent' : 'base';
    const material = kind === 'accent' ? mats.accent : kind === 'partition' ? mats.wall : mats.wall;
    const key = `${wall.zone}|${kind}`;
    const group = groups.get(key);
    if (group) group.walls.push({ wall, index });
    else groups.set(key, { material, walls: [{ wall, index }] });
  });

  const wallGeo = track(new THREE.PlaneGeometry(1, 1));
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const euler = new THREE.Euler();
  const blockers: THREE.Object3D[] = [];

  for (const group of groups.values()) {
    const mesh = new THREE.InstancedMesh(wallGeo, group.material, group.walls.length);
    group.walls.forEach(({ wall }, i) => {
      pos.set((wall.a.x + wall.b.x) / 2, wall.height / 2, (wall.a.z + wall.b.z) / 2);
      // 墙的正面朝 -normal（人站的那一侧）
      euler.set(0, Math.atan2(-wall.normal.x, -wall.normal.z), 0);
      quat.setFromEuler(euler);
      mesh.setMatrixAt(i, matrix.compose(pos, quat, scale.set(wall.length, wall.height, 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.isWall = true;
    scene.add(mesh);
    disposables.push(mesh);
    blockers.push(mesh);
  }

  // ---- 踢脚线：骑在墙面上，两侧都看得见 ----
  const baseGeo = track(new THREE.BoxGeometry(1, TRIM.height, TRIM.thickness));
  const baseboards = new THREE.InstancedMesh(baseGeo, trimMat, plan.walls.length);
  plan.walls.forEach((wall, i) => {
    pos.set((wall.a.x + wall.b.x) / 2, TRIM.height / 2, (wall.a.z + wall.b.z) / 2);
    euler.set(0, Math.atan2(wall.normal.x, wall.normal.z), 0);
    quat.setFromEuler(euler);
    baseboards.setMatrixAt(i, matrix.compose(pos, quat, scale.set(wall.length, 1, 1)));
  });
  baseboards.instanceMatrix.needsUpdate = true;
  baseboards.userData.isWall = true;
  scene.add(baseboards);
  disposables.push(baseboards);
  blockers.push(baseboards);

  // ---- 地面与天花：长廊按「段 + 转角」铺，房间各铺一块 ----
  const roomHoles = ROOMS.map((room) => room.rect);
  const corridor = corridorBands();
  const branchBands: Band[] = BRANCHES.map((branch) => {
    const half = branch.width / 2;
    const rect = rectOf(branch.from, branch.to);
    return {
      x1: rect.x1 - half,
      x2: rect.x2 + half,
      z1: rect.z1 - half,
      z2: rect.z2 + half,
      zone: branch.zone,
      along: Math.abs(branch.to.x - branch.from.x) > Math.abs(branch.to.z - branch.from.z) ? 'x' : 'z',
    };
  });

  /**
   * 地面材质按「分区 + 重复次数」缓存：长廊每一段的宽高都一样，
   *  所以几十块地面最后只留下两三种材质、一张共用的一平米 plane。
   *  （贴图 clone 出来的每一份都会单独占一份显存，能合并就合并）
   */
  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const floorMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const floorMaterial = (band: Band, width: number, depth: number): THREE.MeshStandardMaterial => {
    const [mx, mz] = zoneSpec(band.zone).floorModule;
    const rx = Math.max(1, Math.round((band.along === 'x' ? width : depth) / mx));
    const rz = Math.max(1, Math.round((band.along === 'x' ? depth : width) / mz));
    const key = `${band.zone}|${rx}|${rz}`;
    const cached = floorMatCache.get(key);
    if (cached) return cached;
    const mats = zoneMats.get(band.zone) ?? fallback;
    const map = track(mats.floorMap.clone());
    map.needsUpdate = true;
    map.repeat.set(rx, rz);
    const material = track(
      new THREE.MeshStandardMaterial({ map, roughness: 0.74, metalness: 0, envMapIntensity: 0.45 }),
    );
    floorMatCache.set(key, material);
    return material;
  };

  /** 所有地面块：点地面走过去要对它们整体做射线检测 */
  const floorMeshes: THREE.Mesh[] = [];

  /** 铺一块地面：共用的 1×1 plane，靠 scale 撑到实际尺寸 */
  const addFloor = (band: Band, y: number): void => {
    const width = band.x2 - band.x1;
    const depth = band.z2 - band.z1;
    const mesh = new THREE.Mesh(unitPlane, floorMaterial(band, width, depth));
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(width, depth, 1);
    mesh.position.set((band.x1 + band.x2) / 2, y, (band.z1 + band.z2) / 2);
    mesh.userData.isFloor = true;
    scene.add(mesh);
    // 每一块都收进「点地面走过去」的射线目标：只收其中一块的话，
    // 点到别的段落就没反应（房间地面、支廊都得能点）
    floorMeshes.push(mesh);
  };

  for (const band of corridor) addFloor(band, 0);
  for (const band of branchBands) addFloor(band, 0.005);
  /**
   * 房间：各铺一块。中央大厅与潮汐之间的矩形有 1×2 m 的一小块重叠，
   *  两块地面同高会闪、两块天花高度不同会在厅里压出一块低顶 ——
   *  后铺的把重叠处让给先铺的，谁也不叠谁。
   */
  const roomPieces: Rect[] = [];
  const roomRects = (rect: Rect): Rect[] => {
    let pieces = [rect];
    for (const taken of roomPieces) pieces = pieces.flatMap((piece) => subtract(piece, taken));
    return pieces;
  };
  for (const room of ROOMS) {
    const pieces = roomRects(room.rect);
    roomPieces.push(room.rect);
    for (const piece of pieces) {
      addFloor(
        { x1: piece.x1, z1: piece.z1, x2: piece.x2, z2: piece.z2, zone: room.id, along: 'x' },
        0.01,
      );
    }
  }

  /** 铺一块天花：长廊的要先挖掉房间（房间的顶比长廊高）和支廊（支廊顶与长廊
   *  同高 3.6 m，两片共面照样会闪，长廊把那块让给支廊） */
  const ceilingHoles: Rect[] = [
    ...roomHoles,
    ...branchBands.map((band) => ({ x1: band.x1, z1: band.z1, x2: band.x2, z2: band.z2 })),
  ];
  const addCeiling = (band: Band): void => {
    const mats = zoneMats.get(band.zone) ?? fallback;
    let pieces: Rect[] = [{ x1: band.x1, z1: band.z1, x2: band.x2, z2: band.z2 }];
    for (const hole of ceilingHoles) {
      pieces = pieces.flatMap((piece) => subtract(piece, hole));
    }
    for (const piece of pieces) {
      const mesh = new THREE.Mesh(unitPlane, mats.ceiling);
      mesh.rotation.x = Math.PI / 2; // 朝下
      mesh.scale.set(piece.x2 - piece.x1, piece.z2 - piece.z1, 1);
      mesh.position.set((piece.x1 + piece.x2) / 2, CORRIDOR.height, (piece.z1 + piece.z2) / 2);
      scene.add(mesh);
    }
  };
  for (const band of corridor) addCeiling(band);
  for (const band of branchBands) addCeiling(band);
  // 房间：各按自己的净高铺一块（比长廊高，是空间层次的主要来源）
  const ceilingPieces: Rect[] = [];
  for (const room of ROOMS) {
    const mats = zoneMats.get(room.id) ?? fallback;
    let pieces = [room.rect];
    for (const taken of ceilingPieces) pieces = pieces.flatMap((piece) => subtract(piece, taken));
    ceilingPieces.push(room.rect);
    for (const piece of pieces) {
      const mesh = new THREE.Mesh(unitPlane, mats.ceiling);
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.set(piece.x2 - piece.x1, piece.z2 - piece.z1, 1);
      mesh.position.set(
        (piece.x1 + piece.x2) / 2,
        zoneSpec(room.id).ceiling,
        (piece.z1 + piece.z2) / 2,
      );
      scene.add(mesh);
    }
  }

  // ---- 章节分界的铜灰嵌条：只放在分区交界那一线，不铺满地面 ----
  const thresholdGeo = track(new THREE.PlaneGeometry(1, 1));
  const thresholdMat = track(
    new THREE.MeshBasicMaterial({
      map: track(thresholdTexture()),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  for (const item of plan.zones) {
    if (item.kind !== 'corridor' || !item.span) continue;
    const arc = item.span[0];
    if (arc <= 0) continue;
    const at = pointAtArc(arc);
    if (!at) continue;
    const mesh = new THREE.Mesh(thresholdGeo, thresholdMat);
    mesh.rotation.x = -Math.PI / 2;
    // 嵌条横跨长廊（4 m），厚 0.1 m
    const horizontal = Math.abs(at.dir.x) > Math.abs(at.dir.z);
    mesh.scale.set(horizontal ? 0.1 : CORRIDOR.width, horizontal ? CORRIDOR.width : 0.1, 1);
    mesh.position.set(at.point.x, 0.02, at.point.z);
    scene.add(mesh);
  }

  // ---- 灯槽：emissive 材质表达，不占真实光源 ----
  const slotMat = track(
    new THREE.MeshStandardMaterial({
      color: '#FFF8EC',
      emissive: new THREE.Color('#FFE7C2'),
      emissiveIntensity: 1.8,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  const slotGeo = track(new THREE.PlaneGeometry(1, 1));
  const slotSpots: { x: number; z: number; yaw: number; length: number }[] = [];
  let travelled = 0;
  for (let i = 0; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const a = CORRIDOR_PATH[i];
    const b = CORRIDOR_PATH[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    // 法线：朝左手侧（与主挂画墙同侧）
    const nx = -dir.z;
    const nz = dir.x;
    // 这一段按 10 m 一段、1.5 m 断口切开
    for (let start = 0; start < length; start += LIGHT.run + LIGHT.gap) {
      const end = Math.min(start + LIGHT.run, length);
      if (end - start < 1) continue;
      slotSpots.push({
        x: a.x + dir.x * (start + end) / 2 + nx * LIGHT.offset,
        z: a.z + dir.z * (start + end) / 2 + nz * LIGHT.offset,
        yaw: Math.atan2(dir.x, dir.z),
        length: end - start,
      });
    }
    travelled += length;
  }
  void travelled;
  if (slotSpots.length > 0) {
    const slots = new THREE.InstancedMesh(slotGeo, slotMat, slotSpots.length);
    const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    slotSpots.forEach((spot, i) => {
      pos.set(spot.x, CORRIDOR.height - 0.03, spot.z);
      quat.setFromEuler(euler.set(0, spot.yaw, 0)).multiply(flatQuat);
      slots.setMatrixAt(i, matrix.compose(pos, quat, scale.set(LIGHT.width, spot.length, 1)));
    });
    slots.instanceMatrix.needsUpdate = true;
    scene.add(slots);
    disposables.push(slots);
  }

  // ---- 门洞：门楣（墙材质）+ 门套（深色）+ 中央/沉浸的浅拱券 ----
  // 十几道门、每道 4 个体块，逐个建 Mesh 就是几十个 draw call 和几十份
  // BoxGeometry。这里只把变换记下来，最后按材质各合成一个 InstancedMesh。
  interface BoxJob {
    material: THREE.MeshStandardMaterial;
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    yaw: number;
  }
  const boxJobs: BoxJob[] = [];
  /** 拱券尺寸就那么两三种，按「跨度|矢高」共用一份几何 */
  const archCache = new Map<string, THREE.ExtrudeGeometry>();

  for (const door of plan.doors) {
    const mats = zoneMats.get(door.zone) ?? fallback;
    const ceiling = zoneSpec(door.zone).ceiling;
    const horizontal = Math.abs(door.ry) < 1e-6;
    const yaw = door.ry;
    const depth = door.arch ? 0.25 : DOOR.depth;
    /** 沿门洞宽度方向偏出去（horizontal 的门洞沿 x 展开，否则沿 z） */
    const along = (at: number): { x: number; z: number } =>
      horizontal ? { x: door.x + at, z: door.z } : { x: door.x, z: door.z + at };

    // 门楣：门洞是整层高的口子，门楣把门顶到天花之间那截补成墙。
    //  顶端故意顶过天花 5 cm：墙材质是 DoubleSide，门楣顶面要是正好落在天花
    //  平面上，两个面共面会 z-fighting —— 天花色与墙色交替闪。顶过头的那截
    //  被天花挡在后面，看不见。
    // 底面也要让开：序厅那道 3.4 m 的门正好等于它的净高，门楣底面会与天花共面
    const lintelBottom = Math.min(door.height, ceiling - 0.03);
    const lintelHeight = Math.max(0.1, ceiling + 0.05 - lintelBottom);
    boxJobs.push({
      material: mats.wall,
      x: door.x,
      y: lintelBottom + lintelHeight / 2,
      z: door.z,
      w: door.width + 0.4,
      h: lintelHeight,
      d: CORRIDOR.wallT,
      yaw,
    });

    // 门套：两侧立框 + 门头顶框（拱券门的立框一路到拱脚上方，不留断口）
    for (const side of [-1, 1]) {
      const at = along(side * (door.width / 2 + JAMB.width / 2));
      boxJobs.push({
        material: jambMat,
        x: at.x,
        y: door.height / 2,
        z: at.z,
        w: JAMB.width,
        h: door.height,
        d: depth,
        yaw,
      });
    }
    // 底面比门楣低 1 cm：两个底面同高同样会闪，让门套的底面压在下面
    boxJobs.push({
      material: jambMat,
      x: door.x,
      y: door.height + JAMB.width / 2 - 0.01,
      z: door.z,
      w: door.width + JAMB.width * 2,
      h: JAMB.width,
      d: depth,
      yaw,
    });

    if (door.arch) {
      // 浅拱券：起拱 2.35、总高 3.4（矢高 = 3.4 − 2.35）
      const rise = door.height - DOOR.archSpring;
      const key = `${door.width}|${rise}`;
      let geometry = archCache.get(key);
      if (!geometry) {
        geometry = track(archGeometry(door.width / 2, rise, JAMB.width, depth));
        archCache.set(key, geometry);
      }
      const arch = new THREE.Mesh(geometry, jambMat);
      arch.position.set(door.x, DOOR.archSpring, door.z);
      arch.rotation.y = yaw;
      // 拱券是沿 +Z 挤出的，往回推一半让它骑在门洞中线上
      arch.translateZ(-depth / 2);
      scene.add(arch);
    }
  }

  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const boxesByMaterial = new Map<THREE.MeshStandardMaterial, BoxJob[]>();
  for (const job of boxJobs) {
    const list = boxesByMaterial.get(job.material);
    if (list) list.push(job);
    else boxesByMaterial.set(job.material, [job]);
  }
  for (const [material, jobs] of boxesByMaterial) {
    const mesh = new THREE.InstancedMesh(unitBox, material, jobs.length);
    jobs.forEach((job, i) => {
      pos.set(job.x, job.y, job.z);
      quat.setFromEuler(euler.set(0, job.yaw, 0));
      mesh.setMatrixAt(i, matrix.compose(pos, quat, scale.set(job.w, job.h, job.d)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    disposables.push(mesh);
  }

  // ---- 房间道具：凳子、装置占位 ----
  const benchMat = track(
    new THREE.MeshStandardMaterial({ color: '#6B645B', roughness: 0.8, metalness: 0 }),
  );
  const artMat = track(
    new THREE.MeshStandardMaterial({ color: '#8C867C', roughness: 0.7, metalness: 0 }),
  );
  for (const room of ROOMS) {
    for (const prop of room.props) {
      if (prop.kind === 'bench') {
        const bench = new THREE.Mesh(
          track(new THREE.BoxGeometry(prop.w, 0.42, prop.d)),
          benchMat,
        );
        bench.position.set(prop.x, 0.21, prop.z);
        bench.rotation.y = prop.ry;
        scene.add(bench);
      } else if (prop.kind === 'sculpture') {
        // 装置占位：矮台 + 上面一块 neutral 的体块，等着换成真作品
        const plinth = new THREE.Mesh(
          track(new THREE.CylinderGeometry(prop.r, prop.r * 1.05, 0.25, 24)),
          benchMat,
        );
        plinth.position.set(prop.x, 0.125, prop.z);
        scene.add(plinth);
        const body = new THREE.Mesh(
          track(new THREE.BoxGeometry(prop.r * 1.2, prop.r * 1.8, prop.r * 1.2)),
          artMat,
        );
        body.position.set(prop.x, 0.25 + (prop.r * 1.8) / 2, prop.z);
        body.rotation.y = Math.PI / 5;
        scene.add(body);
      }
    }
  }

  // ---- 灯光：3500 K 环境 + 作品的 3800–4200 K 洗墙灯 ----
  // 环境压暗（对比上一版 0.8 / 0.85）：作品灯的 1.8–2.5 倍对比要读得出来，
  // 「夜间叙事感」是明暗对比造出来的，不是把整间厅调暗。
  const hemi = new THREE.HemisphereLight(LIGHTING.sky, LIGHTING.ground, LIGHTING.ambient);
  scene.add(hemi);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = track(environmentTexture('#f6f3ec', '#8b877f'));
  const environment = pmrem.fromEquirectangular(equirect).texture;
  scene.environment = environment;
  pmrem.dispose();

  // 作品灯：一小池 SpotLight，永远只照相机附近那几张画。
  // 全都不投影 —— 规格允许 2–3 盏，但动态阴影在这个尺度上收益很小、代价很大，
  // 空间层次靠天花高度和墙色做，不靠阴影。
  const spotPool: THREE.SpotLight[] = [];
  const spotCount = lowPower ? LIGHTING.spots.low : LIGHTING.spots.high;
  for (let i = 0; i < spotCount; i += 1) {
    const spot = new THREE.SpotLight(0xfff1de, 0, 7.5, 0.58, 0.55, 1.3);
    spot.castShadow = false;
    spot.visible = false;
    scene.add(spot);
    scene.add(spot.target);
    spotPool.push(spot);
  }

  // 中央大厅：3×3 m 的柔光顶棚（模拟天窗）+ 周边两条隐藏轨道灯槽。
  // 顶棚本身是 emissive 面片，不点真实光源；厅里补一盏很弱的顶光让它不闷。
  const atrium = ROOMS.find((room) => room.id === 'atrium');
  if (atrium) {
    const ceiling = zoneSpec('atrium').ceiling;
    const cx = (atrium.rect.x1 + atrium.rect.x2) / 2;
    const cz = (atrium.rect.z1 + atrium.rect.z2) / 2;
    const panel = new THREE.Mesh(
      track(new THREE.PlaneGeometry(3, 3)),
      track(
        new THREE.MeshStandardMaterial({
          color: '#FFFCF4',
          emissive: new THREE.Color('#FFF3DC'),
          emissiveIntensity: 1.5,
          roughness: 1,
          metalness: 0,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
    );
    panel.rotation.x = Math.PI / 2;
    panel.position.set(cx, ceiling - 0.03, cz);
    scene.add(panel);

    // 两侧隐藏轨道灯槽：顶棚边上一线，暗示光从这儿来
    for (const side of [-1, 1]) {
      const track1 = new THREE.Mesh(
        track(new THREE.PlaneGeometry(0.12, 8)),
        slotMat,
      );
      track1.rotation.x = Math.PI / 2;
      track1.position.set(cx + side * 2.2, ceiling - 0.03, cz);
      scene.add(track1);
    }

    const fill = new THREE.PointLight(0xfff1de, 6, 14, 1.4);
    fill.position.set(cx, ceiling - 0.6, cz);
    scene.add(fill);
  }

  // 大型作品厅：净高 5.5 m，顶上两条平行轨道灯（规格：保留悬挂大型装置的视觉高度）
  const large = ROOMS.find((room) => room.id === 'large');
  if (large) {
    const ceiling = zoneSpec('large').ceiling;
    const cz = (large.rect.z1 + large.rect.z2) / 2;
    for (const dx of [-1.6, 1.6]) {
      const track1 = new THREE.Mesh(track(new THREE.PlaneGeometry(0.1, large.rect.z2 - large.rect.z1 - 1.4)), slotMat);
      track1.rotation.x = Math.PI / 2;
      track1.position.set((large.rect.x1 + large.rect.x2) / 2 + dx, ceiling - 0.03, cz);
      scene.add(track1);
    }
  }

  // 沉浸展厅：不设大面积环境照明，只在墙脚留几点地脚灯（作品灯等 S4 有作品再补）
  const immersion = ROOMS.find((room) => room.id === 'immersion');
  if (immersion) {
    const { x1, z1, x2, z2 } = immersion.rect;
    const spots: { x: number; z: number }[] = [
      { x: x1 + 0.6, z: z1 + 1.4 },
      { x: x1 + 0.6, z: z2 - 1.4 },
      { x: x2 - 0.6, z: (z1 + z2) / 2 },
      { x: (x1 + x2) / 2, z: z1 + 0.6 },
    ];
    for (const spot of spots) {
      const lamp = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.16, 0.1, 0.16)),
        track(
          new THREE.MeshStandardMaterial({
            color: '#3A3F42',
            emissive: new THREE.Color('#F0C48A'),
            emissiveIntensity: 2.2,
            roughness: 1,
            metalness: 0,
            toneMapped: false,
          }),
        ),
      );
      lamp.position.set(spot.x, 0.05, spot.z);
      scene.add(lamp);
    }
  }

  // ---- 挂画：光晕 + 画布 + 墙签 ----
  // 同一件作品会挂很多处（数据不够时是占位画框），所以按 id 收成数组：
  // 纹理到了要挨个换。
  const pictures = new Map<string, THREE.Mesh[]>();
  const slots: Slot[] = [];
  const pickables: THREE.Object3D[] = [];
  /** 展签纹理按「标题 + 作者」缓存：同一件作品挂几十处，只画一张 */
  const labelCache = new Map<string, THREE.CanvasTexture>();

  const canvasMat = track(
    new THREE.MeshStandardMaterial({ color: '#EDE9E1', roughness: 0.85, metalness: 0 }),
  );
  /** 光晕只有「常态 / 指着」两种状态，两份材质共用，别给每处挂画各留一份 */
  const HALO_BASE = 0.3;
  const HALO_HOVER = 0.62;
  /** 光晕 / 画布 / 展签都是同一张 1×1 的面片，靠 scale 撑开 */
  const quadGeo = track(new THREE.PlaneGeometry(1, 1));
  const haloGlow = track(makeSoftGlow());
  const haloMaterial = (opacity: number): THREE.MeshBasicMaterial =>
    track(
      new THREE.MeshBasicMaterial({
        map: haloGlow,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
  const haloBase = haloMaterial(HALO_BASE);
  const haloHover = haloMaterial(HALO_HOVER);

  for (const placement of plan.placements) {
    const group = new THREE.Group();
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.ry;

    const aspect = placement.fw / placement.fh;
    const art = fitArt(placement.fw, placement.fh, aspect);

    // 层间距别太小：0.004 m 在几米外深度精度不够，会跟墙 z-fighting
    const halo = new THREE.Mesh(quadGeo, haloBase);
    halo.position.z = 0.02;
    halo.scale.set(art.w * 2.3, art.h * 2.3, 1);
    group.add(halo);

    // 画布：真作品等纹理来了替换；占位画框直接给中性框面（没有内容也像「留着
    // 等作品」的一块空框，不是某张图的复制品）
    const pictureMaterial = track(
      new THREE.MeshBasicMaterial({
        map: placement.kind === 'placeholder' ? placeholderFrame : placeholder,
        toneMapped: false,
      }),
    );
    const picture = new THREE.Mesh(quadGeo, pictureMaterial);
    picture.userData.id = placement.id;
    picture.position.z = 0.05;
    group.add(picture);

    // 展签（标题 + 作者）：占位画框不挂展签
    if (placement.kind !== 'placeholder' && (placement.title || placement.author)) {
      const labelKey = `${placement.title} ${placement.author}`;
      let labelMap = labelCache.get(labelKey);
      if (!labelMap) {
        labelMap = track(wallLabelTexture(placement.title, placement.author));
        labelCache.set(labelKey, labelMap);
      }
      const label = new THREE.Mesh(
        quadGeo,
        track(
          new THREE.MeshBasicMaterial({ map: labelMap, transparent: true, toneMapped: false }),
        ),
      );
      label.position.set(0, -art.h / 2 - 0.07, 0.05);
      label.scale.set(0.34, 0.06, 1);
      group.add(label);
    }

    picture.userData.slot = slots.length;
    slots.push({ picture, halo });
    const list = pictures.get(placement.id);
    if (list) list.push(picture);
    else pictures.set(placement.id, [picture]);
    pickables.push(picture);
    scene.add(group);
  }
  void canvasMat;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const quaternion = new THREE.Quaternion();
  const scratch = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();

  let hoveredSlot = -1;

  /**
   * 作品灯重新指派：相机走一段（>1.5 m）才重算一次。
   *  规格要求「只照亮相机附近那几盏是真的灯，远处的靠模拟光晕」——
   *  70 多个挂画位不可能各配一盏 SpotLight。
   */
  let aimedAt = { x: -999, z: -999 };
  const aimSpots = (cx: number, cz: number): void => {
    const near: { placement: Placement; dist: number }[] = [];
    for (const placement of plan.placements) {
      const dist = (placement.x - cx) ** 2 + (placement.z - cz) ** 2;
      if (dist < 18 * 18) near.push({ placement, dist });
    }
    near.sort((a, b) => a.dist - b.dist);
    spotPool.forEach((spot, index) => {
      const hit = near[index];
      if (!hit) {
        spot.visible = false;
        return;
      }
      const item = hit.placement;
      // 墙面法线：画朝 -normal，所以灯的偏移方向就是 (sin ry, cos ry)
      const nx = Math.sin(item.ry);
      const nz = Math.cos(item.ry);
      const ceiling = zoneSpec(item.zone).ceiling;
      const hero = item.kind === 'hero';
      spot.position.set(
        item.x + nx * LIGHT.washerDistance,
        Math.min(3.05, ceiling - 0.4),
        item.z + nz * LIGHT.washerDistance,
      );
      spot.target.position.set(item.x, item.y, item.z);
      spot.angle = hero ? 0.42 : 0.58; // 重点 24°，普通 ~33°
      spot.intensity = hero ? 26 : 18;
      spot.visible = true;
    });
  };

  return {
    scene,
    camera,
    renderer,
    pickables,
    blockers,
    pictures,

    setPicture(id, texture) {
      const list = pictures.get(id);
      if (!list) return;
      for (const picture of list) {
        const material = picture.material as THREE.MeshBasicMaterial;
        const previous = material.map;
        material.map = texture;
        material.needsUpdate = true;
        if (previous && previous !== placeholder && previous !== placeholderFrame) {
          previous.dispose();
        }
      }
    },

    pick(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      const artHit = raycaster.intersectObjects(pickables, false)[0];
      if (artHit) {
        return {
          kind: 'art',
          id: String(artHit.object.userData.id),
          slot: Number(artHit.object.userData.slot ?? -1),
        };
      }
      if (floorMeshes.length > 0) {
        const floorHit = raycaster.intersectObjects(floorMeshes, false)[0];
        if (floorHit) return { kind: 'floor', x: floorHit.point.x, z: floorHit.point.z };
      }
      return null;
    },

    viewpoint(id) {
      const list = pictures.get(id);
      if (!list?.length) return null;
      // 同一件挂了很多处：站到离人最近的那一张前面，别横穿整座建筑
      let mesh = list[0];
      let bestDist = Infinity;
      for (const candidate of list) {
        candidate.getWorldPosition(worldPosition);
        const d =
          (worldPosition.x - camera.position.x) ** 2 + (worldPosition.z - camera.position.z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          mesh = candidate;
        }
      }
      mesh.getWorldQuaternion(quaternion);
      const normal = scratch.set(0, 0, 1).applyQuaternion(quaternion);
      mesh.getWorldPosition(worldPosition);
      return {
        x: worldPosition.x + normal.x * 1.4,
        z: worldPosition.z + normal.z * 1.4,
        yaw: Math.atan2(normal.x, normal.z),
      };
    },

    setHover(slot) {
      const next = slot ?? -1;
      if (next === hoveredSlot) return;
      if (slots[hoveredSlot]) slots[hoveredSlot].halo.material = haloBase;
      hoveredSlot = next;
      if (slots[hoveredSlot]) slots[hoveredSlot].halo.material = haloHover;
    },

    updateLighting(x, z) {
      // 走够 1.5 m 才重排一次灯，别每帧都算
      if ((x - aimedAt.x) ** 2 + (z - aimedAt.z) ** 2 < 1.5 * 1.5) return;
      aimedAt = { x, z };
      aimSpots(x, z);
    },

    setSize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    setPixelRatio(ratio) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
    },

    render() {
      renderer.render(scene, camera);
    },

    dispose() {
      for (const item of disposables) item.dispose();
      for (const list of pictures.values()) {
        for (const picture of list) {
          const map = (picture.material as THREE.MeshBasicMaterial).map;
          if (map && map !== placeholder && map !== placeholderFrame) map.dispose();
        }
      }
      environment.dispose();
      renderer.dispose();
    },
  };
}

/** 折线上弧长 s 处的点与走向 */
function pointAtArc(arc: number): { point: Vec2; dir: Vec2 } | null {
  let travelled = 0;
  for (let i = 0; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const a = CORRIDOR_PATH[i];
    const b = CORRIDOR_PATH[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (arc <= travelled + length) {
      const t = (arc - travelled) / length;
      return {
        point: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t },
        dir: { x: (b.x - a.x) / length, z: (b.z - a.z) / length },
      };
    }
    travelled += length;
  }
  return null;
}

/** 画的软光晕：中心亮的径向渐变 */
function makeSoftGlow(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,252,242,0.50)');
    g.addColorStop(0.3, 'rgba(255,250,236,0.22)');
    g.addColorStop(0.65, 'rgba(255,248,232,0.07)');
    g.addColorStop(1, 'rgba(255,248,232,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fitArt(fw: number, fh: number, aspect: number): { w: number; h: number } {
  const long = Math.max(fw, fh);
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}

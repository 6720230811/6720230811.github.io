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
import { nearestArc, zoneAt } from './walls';
import {
  ceilingTexture,
  environmentTexture,
  floorModuleTexture,
  microCementTexture,
  mineralTexture,
  placeholderFrameTexture,
  planPanelTexture,
  thresholdTexture,
  wallLabelTexture,
  wallTextTexture,
} from './surfaces';
import type { FloorPlan, Placement, WallSegment } from './plan';

/**
 * 墙脚 / 墙顶的阴影缝。规格不要凸出的粗踢脚线：
 *  墙脚 50 mm 内凹暗缝（沉浸厅 20 mm、不设踢脚），深色天花那一圈再留 30 mm 顶缝。
 *  缝是画在墙面前的暗色面片（离墙 12 mm，不反光），不是凸出来的板。
 */
const TRIM = { base: 0.05, gap: 0.012, color: '#232726' } as const;
/** 门套：深 0.22 m（拱券 0.25）、宽 0.12 m、颜色 #3E4140 */
const JAMB = { width: 0.12, color: '#3E4140' } as const;
/** 做旧青铜：门洞压边、地面嵌条、序厅那张平面图都用这一支（禁止大面积金色） */
const BRONZE = { color: '#896A47', edge: 0.008 } as const;
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

/** 墙上要写的字（由页面按语言给，场景不认得 i18n） */
export interface FloorCopy {
  /** 序厅主视觉墙：展览标题 */
  title?: string;
  /** 西墙：展览介绍 / 策展文字 */
  intro?: string;
  /** 短隔墙：一句话 */
  curator?: string;
  /** 东墙平面图旁：操作说明 */
  hint?: string;
}

export interface CreateFloorOptions {
  canvas: HTMLCanvasElement;
  plan: FloorPlan;
  copy?: FloorCopy;
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
  /** 天花高度：转角那一块要压低（见 corridorBands），不写就按分区净高 */
  ceiling?: number;
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
function corridorBands(cornerCeiling: (arc: number) => number): Band[] {
  const half = CORRIDOR.width / 2;
  const out: Band[] = [];
  const corners: Rect[] = [];
  for (let i = 1; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const p = CORRIDOR_PATH[i];
    corners.push({ x1: p.x - half, z1: p.z - half, x2: p.x + half, z2: p.z + half });
  }

  /** 每个折点处的累计弧长 */
  const arcAt: number[] = [0];
  for (let i = 0; i + 1 < CORRIDOR_PATH.length; i += 1) {
    const a = CORRIDOR_PATH[i];
    const b = CORRIDOR_PATH[i + 1];
    arcAt.push(arcAt[i] + Math.hypot(b.x - a.x, b.z - a.z));
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
      // 转角横跨前后各 2 m，压到两边较低的那一档：墙是一段一个高度，
      // 天花不能高过它，否则墙顶与天花之间会露出一条缝
      ceiling: cornerCeiling(arcAt[i]),
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

export function createFloor({ canvas, plan, copy = {} }: CreateFloorOptions): FloorHandle {
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
    const ceilingMap = track(ceilingTexture(item.ceilingColor, item.ceilingRipple === true));
    const ceiling = track(
      new THREE.MeshStandardMaterial({
        map: ceilingMap,
        // 发光的顶棚（潮汐之间的大面积漫射柔光）：复用同一张贴图当 emissiveMap，
        //  S11 烘进去那道波纹照样调制发光 —— 于是顶不是一块死板的白，是"水面"
        ...(item.glow
          ? {
              emissive: new THREE.Color(item.glow.color),
              emissiveMap: ceilingMap,
              emissiveIntensity: item.glow.intensity,
            }
          : {}),
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

  /**
   * 墙色：每面墙可能是分区墙色，也可能自带一个色（序厅四面各一色、
   * 可移动展墙有自己的色）。按「分区 + 色」缓存，同一色只画一张肌理。
   */
  const wallMats = new Map<string, THREE.MeshStandardMaterial>();
  const wallMaterial = (zoneId: ZoneId, tint?: string): THREE.MeshStandardMaterial => {
    const key = `${zoneId}|${tint ?? ''}`;
    const cached = wallMats.get(key);
    if (cached) return cached;
    const color = tint ?? zoneSpec(zoneId).wall;
    // 左墙（sideWalls.left）走微水泥：更细腻、roughness 0.87；其余是矿物灰泥
    const cement = tint !== undefined && tint === zoneSpec(zoneId).sideWalls?.left;
    const material = track(
      new THREE.MeshStandardMaterial({
        map: track(cement ? microCementTexture(color) : mineralTexture(color)),
        roughness: cement ? 0.87 : 0.92,
        metalness: 0,
        envMapIntensity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    wallMats.set(key, material);
    return material;
  };

  /** 阴影缝的暗色材质：按颜色共用一份（内凹的缝不反光，用 basic 材质） */
  const gapMats = new Map<string, THREE.MeshBasicMaterial>();
  const gapMaterial = (color: string): THREE.MeshBasicMaterial => {
    const cached = gapMats.get(color);
    if (cached) return cached;
    const material = track(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    gapMats.set(color, material);
    return material;
  };
  const jambMat = track(
    new THREE.MeshStandardMaterial({ color: JAMB.color, roughness: 0.6, metalness: 0 }),
  );
  const bronzeMat = track(
    new THREE.MeshStandardMaterial({
      color: BRONZE.color,
      roughness: 0.48,
      metalness: 0.38,
    }),
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
    // 可移动展墙（临展厅）有自己正 / 反 / 主题三色，不走这里
    if (wall.kind === 'partition' && zoneSpec(wall.zone).screen) return;
    const mats = zoneMats.get(wall.zone) ?? fallback;
    const kind = wall.kind === 'partition' ? 'partition' : accentSet.has(index) ? 'accent' : 'base';
    const material =
      kind === 'accent' ? mats.accent : wallMaterial(wall.zone, wall.tint);
    const key = `${wall.zone}|${kind}|${wall.tint ?? ''}`;
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

  // ---- 墙面竖向阴影缝 ----
  //  一片细长的暗色面片。往人这一侧推开 12 mm —— 贴在墙面上会与墙共面闪色，
  //  上下也各留一截，让开踢脚与天花。
  interface Reveal {
    x: number;
    z: number;
    yaw: number;
    width: number;
    height: number;
    color: string;
  }
  const REVEAL_GAP = 0.012;
  const REVEAL_BOTTOM = 0.13;
  const REVEAL_TOP = 0.09;
  /** 固定但看着没规律的抖动：同一面墙每次来都一样，左右墙也不会对齐 */
  const jitter = (seed: number): number => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  const reveals: Reveal[] = [];

  plan.walls.forEach((wall, index) => {
    if (wall.kind === 'partition') return;
    const spec = zoneSpec(wall.zone).reveal;
    if (!spec) return;
    const dir = { x: (wall.b.x - wall.a.x) / wall.length, z: (wall.b.z - wall.a.z) / wall.length };
    /** 朝人这一侧（作品挂的那一面） */
    const inward = { x: -wall.normal.x, z: -wall.normal.z };
    const height = Math.max(0.4, wall.height - REVEAL_BOTTOM - REVEAL_TOP);
    const at = (t: number): void => {
      reveals.push({
        x: wall.a.x + dir.x * t + inward.x * REVEAL_GAP,
        z: wall.a.z + dir.z * t + inward.z * REVEAL_GAP,
        yaw: Math.atan2(inward.x, inward.z),
        width: spec.width,
        height,
        color: spec.color,
      });
    };

    if (!spec.spacing) {
      // 没给间距 → 只画在主题墙两端（自然长廊：蓝绿与中性墙之间那道缝）
      if (!accentSet.has(index)) return;
      at(REVEAL_GAP);
      at(wall.length - REVEAL_GAP);
      return;
    }

    if (spec.side) {
      // 只做单侧墙：右墙朝内的那一面，正对着行走方向的左手边
      const mid = { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.z + wall.b.z) / 2 };
      const forward = corridorDirection(nearestArc(mid.x, mid.z));
      const dot = inward.x * -forward.z + inward.z * forward.x;
      if (spec.side === 'right' ? dot < 0.5 : dot > -0.5) return;
    }

    let seed = index + 1;
    let t = spec.spacing[0] * (0.5 + jitter(seed));
    while (t < wall.length - 0.6) {
      at(t);
      seed += 1;
      t += spec.spacing[0] + jitter(seed) * (spec.spacing[1] - spec.spacing[0]);
    }
  });

  const revealGeo = track(new THREE.PlaneGeometry(1, 1));
  const revealByColor = new Map<string, Reveal[]>();
  for (const job of reveals) {
    const list = revealByColor.get(job.color);
    if (list) list.push(job);
    else revealByColor.set(job.color, [job]);
  }
  for (const [color, jobs] of revealByColor) {
    const material = gapMaterial(color);
    const mesh = new THREE.InstancedMesh(revealGeo, material, jobs.length);
    jobs.forEach((job, i) => {
      pos.set(job.x, REVEAL_BOTTOM + job.height / 2, job.z);
      quat.setFromEuler(euler.set(0, job.yaw, 0));
      mesh.setMatrixAt(i, matrix.compose(pos, quat, scale.set(job.width, job.height, 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    disposables.push(mesh);
  }

  // ---- 可移动展墙：正面 / 背面 / 本期主题色（临展厅） ----
  //  两面各自一块（正反颜色不同），其中一面换成本期主题色 ——
  //  规格：同一时期只能出现一种主题色。
  const screenMats = new Map<
    ZoneId,
    { front: THREE.MeshStandardMaterial; back: THREE.MeshStandardMaterial; theme: THREE.MeshStandardMaterial }
  >();
  const themedZones = new Set<ZoneId>();
  for (const wall of plan.walls) {
    if (wall.kind !== 'partition') continue;
    const palette = zoneSpec(wall.zone).screen;
    if (!palette) continue;

    let mats = screenMats.get(wall.zone);
    if (!mats) {
      const make = (color: string): THREE.MeshStandardMaterial =>
        track(
          new THREE.MeshStandardMaterial({
            map: track(mineralTexture(color)),
            roughness: 0.92,
            metalness: 0,
            envMapIntensity: 0.45,
            side: THREE.DoubleSide,
          }),
        );
      mats = {
        front: make(palette.front),
        back: make(palette.back),
        theme: make(plan.screenTheme ?? palette.theme),
      };
      screenMats.set(wall.zone, mats);
    }

    const half = 0.03;
    const mid = { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.z + wall.b.z) / 2 };
    for (const sign of [1, -1]) {
      const material = sign === 1 && !themedZones.has(wall.zone) ? mats.theme : sign === 1 ? mats.front : mats.back;
      const mesh = new THREE.Mesh(wallGeo, material);
      mesh.position.set(
        mid.x - wall.normal.x * half * sign,
        wall.height / 2,
        mid.z - wall.normal.z * half * sign,
      );
      mesh.rotation.y = Math.atan2(-wall.normal.x * sign, -wall.normal.z * sign);
      mesh.scale.set(wall.length, wall.height, 1);
      scene.add(mesh);
      blockers.push(mesh);
    }
    themedZones.add(wall.zone);
  }

  // ---- 墙脚 / 墙顶的横向阴影缝 ----
  //  墙段本来就在门洞处断开（walls.ts 的 splitByGaps），所以缝不会跨过门洞 ——
  //  规格特意交代了这一条。
  interface TrimGap {
    x: number;
    z: number;
    yaw: number;
    length: number;
    y: number;
    height: number;
  }
  const trims: TrimGap[] = [];
  for (const wall of plan.walls) {
    // 可移动展墙自己有正反面，不在这儿加缝
    if (wall.kind === 'partition' && zoneSpec(wall.zone).screen) continue;
    const own = zoneSpec(wall.zone).trim;
    const base = own?.base ?? TRIM.base;
    const top = own?.top ?? 0;
    if (base <= 0 && top <= 0) continue;

    const inward = { x: -wall.normal.x, z: -wall.normal.z };
    const x = (wall.a.x + wall.b.x) / 2 + inward.x * TRIM.gap;
    const z = (wall.a.z + wall.b.z) / 2 + inward.z * TRIM.gap;
    const yaw = Math.atan2(inward.x, inward.z);
    if (base > 0) trims.push({ x, z, yaw, length: wall.length, y: base / 2, height: base });
    if (top > 0) {
      trims.push({ x, z, yaw, length: wall.length, y: wall.height - top / 2, height: top });
    }
  }
  if (trims.length > 0) {
    const mesh = new THREE.InstancedMesh(revealGeo, gapMaterial(TRIM.color), trims.length);
    trims.forEach((job, i) => {
      pos.set(job.x, job.y, job.z);
      quat.setFromEuler(euler.set(0, job.yaw, 0));
      mesh.setMatrixAt(i, matrix.compose(pos, quat, scale.set(job.length, job.height, 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    disposables.push(mesh);
  }

  // ---- 地面与天花：长廊按「段 + 转角」铺，房间各铺一块 ----
  const roomHoles = ROOMS.map((room) => room.rect);
  /**
   * 长廊沿折线的天花高度：章节各有一档（自然 3.8、光影 4.0），
   *  转角那块 4×4 横跨前后各 2 m，压到两边较低的那一档 ——
   *  墙是一段一个高度，天花高过它就漏光。
   */
  const cornerCeilings = new Map<number, number>();
  {
    let travelled = 0;
    for (let i = 1; i + 1 < CORRIDOR_PATH.length; i += 1) {
      const a = CORRIDOR_PATH[i - 1];
      const b = CORRIDOR_PATH[i];
      const c = CORRIDOR_PATH[i + 1];
      travelled += Math.hypot(b.x - a.x, b.z - a.z);
      const incoming = zoneSpec(corridorZone(nearestArc((a.x + b.x) / 2, (a.z + b.z) / 2))).ceiling;
      const outgoing = zoneSpec(corridorZone(nearestArc((b.x + c.x) / 2, (b.z + c.z) / 2))).ceiling;
      cornerCeilings.set(travelled, Math.min(incoming, outgoing));
    }
  }
  const ceilingAtArc = (arc: number): number => {
    let height = zoneSpec(corridorZone(arc)).ceiling;
    for (const [corner, value] of cornerCeilings) {
      if (Math.abs(arc - corner) <= CORRIDOR.width / 2) height = Math.min(height, value);
    }
    return height;
  };
  const corridor = corridorBands(ceilingAtArc);
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
   *  同高，两片共面照样会闪，长廊把那块让给支廊） */
  const ceilingHoles: Rect[] = [
    ...roomHoles,
    ...branchBands.map((band) => ({ x1: band.x1, z1: band.z1, x2: band.x2, z2: band.z2 })),
  ];
  /** 天花高度跟分区走（自然 3.8、光影 4.0）；支廊不是章节，仍按长廊标准高 */
  const ceilingY = (band: Band): number =>
    band.ceiling ??
    (zoneSpec(band.zone).kind === 'corridor' ? zoneSpec(band.zone).ceiling : CORRIDOR.height);
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
      mesh.position.set((piece.x1 + piece.x2) / 2, ceilingY(band), (piece.z1 + piece.z2) / 2);
      scene.add(mesh);
    }
  };
  for (const band of corridor) addCeiling(band);
  for (const band of branchBands) addCeiling(band);

  /**
   * 天花高度变化的收口：转角那块 4×4 压低之后，前后各留一道竖向的面。
   *  章节的分界正好都落在折点上（span 是按折点切的），所以收口就在
   *  转角前后 2 m、垂直于长廊方向 —— 不补的话两段顶之间会露出一条通到外面的缝。
   */
  for (const [arc, corner] of cornerCeilings) {
    const at = pointAtArc(arc);
    if (!at) continue;
    const half = CORRIDOR.width / 2;
    const incoming = ceilingAtArc(arc - half - 0.5);
    const outgoing = ceilingAtArc(arc + half + 0.5);
    const mats = zoneMats.get(corridorZone(arc - 0.5)) ?? fallback;
    for (const [distance, from, to] of [
      [-half, incoming, corner],
      [half, corner, outgoing],
    ] as [number, number, number][]) {
      if (Math.abs(to - from) < 0.01) continue;
      const mesh = new THREE.Mesh(unitPlane, mats.wall);
      mesh.position.set(
        at.point.x + at.dir.x * distance,
        (from + to) / 2,
        at.point.z + at.dir.z * distance,
      );
      // 面朝来向：从矮的一侧走过来，先看见这道收口
      mesh.rotation.y = Math.atan2(-at.dir.x, -at.dir.z);
      mesh.scale.set(CORRIDOR.width, Math.abs(to - from), 1);
      scene.add(mesh);
    }
  }
  /**
   * 一块多边形天花：房间的顶按它自己的形状铺（矩形就是四点多边形）。
   *  ShapeGeometry 的 uv 是形状的坐标（米），直接用会把贴图拉爆 ——
   *  这里把 uv 归一到包围盒，跟原来那张 1×1 plane 拉出来的效果一致。
   */
  const addCeilingPolygon = (
    points: Vec2[],
    y: number,
    material: THREE.MeshStandardMaterial,
  ): void => {
    const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.z)));
    const geometry = track(new THREE.ShapeGeometry(shape));
    const uv = geometry.getAttribute('uv');
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, (uv.getX(i) - minX) / spanX, (uv.getY(i) - minZ) / spanZ);
    }
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2; // 朝下（+Z 转到 -Y）
    mesh.position.set(0, y, 0);
    scene.add(mesh);
  };

  // 房间：各按自己的净高铺一块（比长廊高，是空间层次的主要来源）
  const ceilingPieces: Rect[] = [];
  for (const room of ROOMS) {
    const mats = zoneMats.get(room.id) ?? fallback;
    let pieces = [room.rect];
    for (const taken of ceilingPieces) pieces = pieces.flatMap((piece) => subtract(piece, taken));
    ceilingPieces.push(room.rect);
    for (const piece of pieces) {
      addCeilingPolygon(
        [
          { x: piece.x1, z: piece.z1 },
          { x: piece.x2, z: piece.z1 },
          { x: piece.x2, z: piece.z2 },
          { x: piece.x1, z: piece.z2 },
        ],
        zoneSpec(room.id).ceiling,
        mats.ceiling,
      );
    }
  }

  // ---- 入口序厅：主视觉墙标题 / 策展文字 / 嵌墙平面图 / 短隔墙上一句话 ----
  //  规格四面墙各有各的性格：北墙深酒红 + 展览标题（只做柔和背光，不要强光立体字）、
  //  西墙浅米 + 策展文字、东墙青灰 + 嵌墙式平面图（青铜线，不是电子屏）、
  //  短隔墙朝入口那一面写一句。
  const entry = ROOMS.find((room) => room.id === 'entry');
  if (entry && (copy.title || copy.intro || copy.curator || copy.hint)) {
    const { x1, z1, x2, z2 } = entry.rect;
    const midX = (x1 + x2) / 2;
    /** 贴墙挂一块：离墙 2 cm，朝房间内 */
    const plate = (
      texture: THREE.Texture,
      x: number,
      y: number,
      z: number,
      yaw: number,
      w: number,
      h: number,
    ): void => {
      const material = track(
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
      );
      const mesh = new THREE.Mesh(wallGeo, material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      mesh.scale.set(w, h, 1);
      scene.add(mesh);
    };

    if (copy.title) {
      // 标题背光：先铺一层很淡的暖光，字才不像贴纸
      const glow = new THREE.Mesh(
        wallGeo,
        track(
          new THREE.MeshBasicMaterial({
            map: track(makeSoftGlow()),
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          }),
        ),
      );
      glow.position.set(midX, 2.05, z2 - 0.015);
      glow.rotation.y = Math.PI;
      glow.scale.set(5.2, 1.7, 1);
      scene.add(glow);

      plate(
        track(
          wallTextTexture(copy.title, {
            color: '#E6E0D6',
            size: 108,
            weight: 600,
            align: 'center',
            lineHeight: 1.2,
            maxLines: 2,
          }),
        ),
        midX,
        2.05,
        z2 - 0.02,
        Math.PI,
        4.6,
        1.15,
      );
    }

    if (copy.intro) {
      plate(
        track(
          wallTextTexture(copy.intro, {
            color: '#343432',
            size: 46,
            width: 1024,
            height: 512,
            maxLines: 9,
          }),
        ),
        x1 + 0.02,
        1.75,
        (z1 + z2) / 2,
        Math.PI / 2,
        4.2,
        2.1,
      );
    }

    // 东墙：平面图 + 下面一行操作说明。东墙被 4 m 的门洞切得只剩 z 0–3 那一截，
    // 图就挂在那截上。
    plate(
      track(
        planPanelTexture(
          plan.walls,
          plan.bounds,
          ROOMS.map((room) => room.rect),
        ),
      ),
      x2 - 0.02,
      1.95,
      1.5,
      -Math.PI / 2,
      2.6,
      1.3,
    );
    if (copy.hint) {
      plate(
        track(wallTextTexture(copy.hint, { color: '#C7C2B6', size: 34, maxLines: 3 })),
        x2 - 0.02,
        0.78,
        1.5,
        -Math.PI / 2,
        2.4,
        0.5,
      );
    }

    if (copy.curator) {
      // 短隔墙朝入口那一面（西面）
      plate(
        track(
          wallTextTexture(copy.curator, {
            color: '#343432',
            size: 42,
            align: 'center',
            maxLines: 4,
          }),
        ),
        7.5 - 0.02,
        1.85,
        1.5,
        -Math.PI / 2,
        2.5,
        0.9,
      );
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
  //  宽度与色温跟章节走：夜行 3000 K、城市 3200 K 两段错位、自然 3500 K、
  //  光影暖琥珀白、慢门 3700 K 且更窄、终章再暗一档。
  const slotGeo = track(new THREE.PlaneGeometry(1, 1));
  const slotMats = new Map<ZoneId, THREE.MeshStandardMaterial>();
  const slotMaterial = (zoneId: ZoneId): THREE.MeshStandardMaterial => {
    const cached = slotMats.get(zoneId);
    if (cached) return cached;
    const own = zoneSpec(zoneId).slot;
    const material = track(
      new THREE.MeshStandardMaterial({
        color: '#FFF8EC',
        emissive: own?.color ? new THREE.Color(own.color) : kelvinColor(own?.kelvin ?? 3200),
        emissiveIntensity: own?.intensity ?? 1.8,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    slotMats.set(zoneId, material);
    return material;
  };

  interface SlotRun {
    x: number;
    z: number;
    yaw: number;
    length: number;
    width: number;
    zone: ZoneId;
    y: number;
  }
  const slotRuns: SlotRun[] = [];
  let travelled = 0;
  let runIndex = 0;
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
      const arc = travelled + (start + end) / 2;
      const zoneId = corridorZone(arc);
      const own = zoneSpec(zoneId).slot;
      // 城市长廊那种「两段错位」：相邻两段左右换边，走起来有节奏
      const offset = own?.stagger && runIndex % 2 === 1 ? -LIGHT.offset : LIGHT.offset;
      runIndex += 1;
      slotRuns.push({
        x: a.x + dir.x * (start + end) / 2 + nx * offset,
        z: a.z + dir.z * (start + end) / 2 + nz * offset,
        yaw: Math.atan2(dir.x, dir.z),
        length: end - start,
        width: own?.width ?? LIGHT.width,
        zone: zoneId,
        y: ceilingAtArc(arc),
      });
    }
    travelled += length;
  }

  const runsByZone = new Map<ZoneId, SlotRun[]>();
  for (const run of slotRuns) {
    const list = runsByZone.get(run.zone);
    if (list) list.push(run);
    else runsByZone.set(run.zone, [run]);
  }
  const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  for (const [zoneId, runs] of runsByZone) {
    const slots = new THREE.InstancedMesh(slotGeo, slotMaterial(zoneId), runs.length);
    runs.forEach((run, i) => {
      pos.set(run.x, run.y - 0.03, run.z);
      quat.setFromEuler(euler.set(0, run.yaw, 0)).multiply(flatQuat);
      slots.setMatrixAt(i, matrix.compose(pos, quat, scale.set(run.width, run.length, 1)));
    });
    slots.instanceMatrix.needsUpdate = true;
    scene.add(slots);
    disposables.push(slots);
  }

  // ---- 端景墙顶部的隐藏式洗墙灯槽（城市、慢门） ----
  //  贴着天花、离墙 0.95 m 的一条窄光带（规格：洗墙灯离墙 0.9–1.1 m），
  //  光落在端景墙那件主作品上，槽本身藏在视线之上。
  for (const index of accentSet) {
    const wall = plan.walls[index];
    if (wall.kind === 'partition' || !zoneSpec(wall.zone).wash) continue;
    const inward = { x: -wall.normal.x, z: -wall.normal.z };
    const dir = { x: (wall.b.x - wall.a.x) / wall.length, z: (wall.b.z - wall.a.z) / wall.length };
    const mesh = new THREE.Mesh(slotGeo, slotMaterial(wall.zone));
    mesh.position.set(
      (wall.a.x + wall.b.x) / 2 + inward.x * LIGHT.washerDistance,
      zoneSpec(wall.zone).ceiling - 0.06,
      (wall.a.z + wall.b.z) / 2 + inward.z * LIGHT.washerDistance,
    );
    quat.setFromEuler(euler.set(0, Math.atan2(dir.x, dir.z), 0)).multiply(flatQuat);
    mesh.quaternion.copy(quat);
    mesh.scale.set(0.1, wall.length, 1);
    scene.add(mesh);
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
    // 门洞内侧那道 8 mm 做旧青铜压边（规格：正面边缘加一道，不许发出金色强反光）
    for (const side of [-1, 1]) {
      const at = along(side * (door.width / 2 - BRONZE.edge / 2 - 0.001));
      boxJobs.push({
        material: bronzeMat,
        x: at.x,
        y: door.height / 2,
        z: at.z,
        w: BRONZE.edge,
        // 上下各短 2 cm：不与门套的顶面、地面共面（又是会闪的那种）
        h: door.height - 0.04,
        d: Math.min(0.02, depth),
        yaw,
      });
    }

    // 底面也要让开：序厅那道 3.4 m 的门正好等于它的净高，门楣底面会与天花共面
    const lintelBottom = Math.min(door.height, ceiling - 0.03);
    const lintelHeight = Math.max(0.1, ceiling + 0.05 - lintelBottom);
    // 门楣颜色跟着它所在那面墙（序厅与大型作品厅四面各一色，门楣得是同一面墙
    //  的延续 —— 不然深色重点墙旁边会竖一道浅色带）
    boxJobs.push({
      material: wallMaterial(door.zone, door.tint),
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

  // ---- 临展厅的规则轨道灯：几条平行轨 + 间距均匀的灯具，颜色 #363938 ----
  //  规格要「规则但简洁」—— 轨道贴在天花下，灯具是深色小方块，不发光
  //  （照亮作品是作品灯的活儿）。
  if (ROOMS.some((room) => zoneSpec(room.id).tracks)) {
    const fixtureMat = track(
      new THREE.MeshStandardMaterial({ color: '#363938', roughness: 0.7, metalness: 0 }),
    );
    for (const room of ROOMS) {
      const spec = zoneSpec(room.id).tracks;
      if (!spec) continue;
      const { x1, z1, x2, z2 } = room.rect;
      const ceiling = zoneSpec(room.id).ceiling;
      const alongX = x2 - x1 >= z2 - z1;
      const length = (alongX ? x2 - x1 : z2 - z1) - 1.2;
      const begin = (alongX ? (x1 + x2) / 2 : (z1 + z2) / 2) - length / 2;
      for (let row = 0; row < spec.rows; row += 1) {
        // 轨道均分房间进深，两端各留出一截
        const across =
          (alongX ? z1 : x1) + ((alongX ? z2 - z1 : x2 - x1) * (row + 1)) / (spec.rows + 1);
        const railX = alongX ? (x1 + x2) / 2 : across;
        const railZ = alongX ? across : (z1 + z2) / 2;
        boxJobs.push({
          material: fixtureMat,
          x: railX,
          y: ceiling - 0.05,
          z: railZ,
          w: alongX ? length : 0.05,
          h: 0.05,
          d: alongX ? 0.05 : length,
          yaw: 0,
        });
        const count = Math.max(2, Math.round(length / spec.spacing));
        for (let i = 0; i < count; i += 1) {
          const at = begin + (length * (i + 0.5)) / count;
          boxJobs.push({
            material: fixtureMat,
            x: alongX ? at : railX,
            y: ceiling - 0.12,
            z: alongX ? railZ : at,
            w: 0.18,
            h: 0.12,
            d: 0.18,
            yaw: 0,
          });
        }
      }
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

  /**
   * 分区环境光：序厅压到 0.3，于是"进门先暗、往里走才放开"。
   *  环境是全场一份（半球光 + environment），所以是跟着人走的整体曝光，
   *  不是给某个房间单独点灯。跨门洞时插值一点点（每帧 6% ≈ 半秒），
   *  免得一步跨过去整屏跳一下。
   */
  let ambientNow = zoneSpec(zoneAt(plan.spawn.x, plan.spawn.z)).ambient ?? 1;
  let ambientTarget = ambientNow;
  const applyAmbient = (level: number): void => {
    hemi.intensity = LIGHTING.ambient * level;
    scene.environmentIntensity = level;
  };
  // 出生点在序厅：第一帧就得是压暗后的样子，不能等走出 1.5 m 才变
  applyAmbient(ambientNow);

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
        slotMaterial('atrium'),
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
      const track1 = new THREE.Mesh(
        track(new THREE.PlaneGeometry(0.1, large.rect.z2 - large.rect.z1 - 1.4)),
        slotMaterial('large'),
      );
      track1.rotation.x = Math.PI / 2;
      track1.position.set((large.rect.x1 + large.rect.x2) / 2 + dx, ceiling - 0.03, cz);
      scene.add(track1);
    }
  }

  // 潮汐之间：顶棚整体发光（规格的"大面积漫射柔光"）已经在材质上，
  //  这里只补一盏很弱的顶光 —— emissive 面片自己不照亮任何东西，
  //  不给它一点真实的光，厅里就只剩环境光，顶看着像贴上去的。
  const tide = ROOMS.find((room) => room.id === 'tide');
  const tideGlow = zoneSpec('tide').glow;
  if (tide && tideGlow?.fill) {
    const fill = new THREE.PointLight(
      new THREE.Color(tideGlow.color),
      tideGlow.fill,
      20,
      1.6,
    );
    fill.position.set(
      (tide.rect.x1 + tide.rect.x2) / 2,
      zoneSpec('tide').ceiling - 0.7,
      (tide.rect.z1 + tide.rect.z2) / 2,
    );
    scene.add(fill);
  }

  // 沉浸展厅：结构与灯具一律藏起来，只在地面边缘留几点低亮度安全引导光，
  //  门内再压一条贴地的引导线（规格：仅在入口和地面边缘设低亮度引导光）
  const immersion = ROOMS.find((room) => room.id === 'immersion');
  if (immersion) {
    const { x1, z1, x2, z2 } = immersion.rect;
    const guideMat = track(
      new THREE.MeshStandardMaterial({
        color: '#2A2E30',
        emissive: new THREE.Color('#B98A57'),
        emissiveIntensity: 0.85,
        roughness: 1,
        metalness: 0,
        toneMapped: false,
      }),
    );
    const spots: { x: number; z: number }[] = [
      { x: x1 + 0.6, z: z1 + 1.4 },
      { x: x1 + 0.6, z: z2 - 1.4 },
      { x: x2 - 0.6, z: (z1 + z2) / 2 },
      { x: (x1 + x2) / 2, z: z1 + 0.6 },
    ];
    for (const spot of spots) {
      const lamp = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.1, 0.16)), guideMat);
      lamp.position.set(spot.x, 0.05, spot.z);
      scene.add(lamp);
    }

    // 门内那条引导线：从门洞往房间里 0.5 m，宽度跟门洞走
    const door = plan.doors.find((item) => item.zone === 'immersion');
    if (door) {
      const inward = {
        x: Math.sign((x1 + x2) / 2 - door.x),
        z: Math.sign((z1 + z2) / 2 - door.z),
      };
      const strip = new THREE.Mesh(wallGeo, guideMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(door.x + inward.x * 0.5, 0.02, door.z + inward.z * 0.5);
      // 门洞沿 x 展开就横着铺，沿 z 展开就竖着铺
      const alongX = Math.abs(door.ry) < 1e-6;
      strip.scale.set(alongX ? door.width : 0.08, alongX ? 0.08 : door.width, 1);
      scene.add(strip);
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
      ambientTarget = zoneSpec(zoneAt(x, z)).ambient ?? 1;
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
      // 分区环境光插值：站着不动时 |target - now| 是 0，什么也不做
      if (Math.abs(ambientTarget - ambientNow) > 0.002) {
        ambientNow += (ambientTarget - ambientNow) * 0.06;
        applyAmbient(ambientNow);
      }
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

/**
 * 色温 → 颜色（黑体辐射的近似，量程只覆盖灯具那一段）。
 *  规格给的是 K 值（长廊 3000–3300 K、作品灯 3900–4200 K），
 *  灯槽的发光面要按它上色，不能一律暖黄。
 */
function kelvinColor(kelvin: number): THREE.Color {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
  } else {
    r = 329.7 * (t - 60) ** -0.1332;
    g = 288.12 * (t - 60) ** -0.0755;
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.52 * Math.log(t - 10) - 305.04;
  const clamp = (value: number): number => Math.min(255, Math.max(0, value)) / 255;
  return new THREE.Color().setRGB(clamp(r), clamp(g), clamp(b), THREE.SRGBColorSpace);
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

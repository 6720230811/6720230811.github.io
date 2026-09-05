/**
 * 3D 展厅：three.js 场景的搭建与拾取。
 *
 * 只在 mountGallery 确认设备能跑 WebGL 之后才被动态 import —— 不支持的设备
 * 连这个 chunk 都不会下载。交互与 DOM 逻辑在 index.ts，这里只管「展厅长什么样」。
 *
 * 一层里并排放着好几间厅，每间照着一座真实艺术厅的形制来（见 styles.ts）：
 * 尺寸、顶棚做法、材质、灯光、装饰各不一样。这一层只做三件事：
 * 1. 按形制生成一套材质（同一形制的多间厅共用一份）
 * 2. 把 plan.ts 给出的墙、门、地面、画框摆出来
 * 3. 顶棚与那一套装饰（拱、穹顶、轨道灯、镜面、枝形灯……）交给 halls.ts
 *
 * 观感上的几条取舍：
 * - 材质、灯光都是**按形制**给的：深红的卢浮宫长廊与纯白的白盒子不该共用
 *   一个环境光，所以全局那两盏灯（环境光、半球光）取各间厅的平均值
 * - 天光用 RectAreaLight（线光源的正确软衰减）+ PMREM 环境贴图；没有 envMap
 *   时 metalness 0.8 的铝翼会近似全黑
 * - 墙是「两片背靠背」拼的（每片属于一间厅、用各自的层高与材质），共享墙开
 *   拱门后两侧各自留面，层高不同的两间也能拼在一起
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { archProfile, type FloorPlan, type WallFace } from './plan';
import { hallStyle, type HallStyle, type HallStyleId, type SurfaceKind } from './styles';
import {
  buildEndArch,
  buildHall,
  ceilingMaterial,
  type HallBuildContext,
  type HallMaterials,
} from './halls';
import {
  concreteTexture,
  damaskTexture,
  environmentTexture,
  graniteTexture,
  labelTexture,
  marbleTexture,
  oakTexture,
  parquetTexture,
  plasterTexture,
  radialTexture,
  skyTexture,
  tatamiTexture,
  terrazzoTexture,
  travertineTexture,
  wallLabelTexture,
} from './surfaces';

export interface CreateFloorOptions {
  canvas: HTMLCanvasElement;
  plan: FloorPlan;
}

/** 射线拾取的结果：点到了画、点到了地面，或者打在墙上（不响应） */
export type PickResult =
  | { kind: 'art'; id: string }
  | { kind: 'floor'; x: number; z: number };

export interface FloorHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** 画框（拾取目标），userData.id 是展品 id */
  pickables: THREE.Object3D[];
  /** 墙（拾取时的遮挡物：隔着墙不能点地面走过去） */
  blockers: THREE.Object3D[];
  /** 画心网格，按 id 换纹理 */
  pictures: Map<string, THREE.Mesh>;
  /** 换图：先上缩略图，原图到了再替换，并按真实比例校正画框 */
  setPicture(id: string, texture: THREE.Texture, aspect: number | null): void;
  /** 屏幕坐标拾取；打在墙上或没打中返回 null */
  pick(clientX: number, clientY: number): PickResult | null;
  /**
   * 站到某件作品正前方 1.5m 的位置（世界坐标 x/z），由调用方夹回可行走区。
   * yaw 是站在那儿正对画心该有的视线角（相机绕 y 轴转，0 面朝 -z）。
   */
  viewpoint(id: string): { x: number; z: number; yaw: number } | null;
  /** 悬停高亮：传 id 点亮那件作品的画框，传 null 全部熄灭 */
  setHover(id: string | null): void;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

/** 卡纸（画心四周那圈留白）的宽度 */
const MAT_WIDTH = 0.07;
/** 画框木条压住卡纸的宽度，剩下的才是露出来的卡纸 */
const FRAME_LIP = 0.03;
const FRAME_DEPTH = 0.05;
/** 洗墙光比画框大出多少 */
const WASH_PAD = 0.66;
/** 画框在墙上的投影比画框大出多少 */
const SHADOW_PAD = 0.34;
/** 踢脚线高度 */
const BASEBOARD_H = 0.08;
/** 展签宽度（高是一半）：要走近了能读清，比真实展签大一圈 */
const LABEL_W = 0.24;
/** 一片墙的厚度（两片背靠背拼成一整堵墙） */
const PANEL_T = 0.07;
/** 壁柱：长墙上分展位的竖挺；比檐口再出挑一点，免得两者共面打架 */
const PILASTER_W = 0.18;
const PILASTER_T = 0.062;
/** 起拱线下的檐口：出挑的横线 + 上面留一条暗缝 */
const CORNICE_H = 0.1;
const CORNICE_T = 0.05;
/** 拱门门套：门洞两侧的竖挺与顶上的横楣 */
const PORTAL_W = 0.16;
const PORTAL_T = 0.035;
/** 长凳：座面高度、座面厚度、支墩宽度 */
const BENCH_H = 0.42;
const BENCH_T = 0.09;
const BENCH_LEG = 0.1;
/** 拱壳的厚度：端墙的拱形封口要盖住它 */
const ARCH_T = 0.12;
/** 端墙上的名牌尺寸 */
const PLAQUE_W = 1.5;
/** 中轴石材带的平铺次数：跟它自己的尺寸走 */
const RUNNER_REPEAT: [number, number] = [0.8, 6];

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

/** 一张还没加载的纹理：给个中灰占位，避免白花花一片闪 */
function placeholderTexture(): THREE.DataTexture {
  const data = new Uint8Array([48, 48, 52, 255]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 载入纹理，顺带返回图片真实比例（用来校正画框） */
export function loadTexture(
  url: string,
): Promise<{ texture: THREE.Texture; aspect: number | null }> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        // 不要 mipmap 的额外内存：画都是正对着看的，最多斜一点
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

/** 每种材质该平铺几遍：墙板、地板、石材各自的尺度不一样 */
const REPEAT: Record<SurfaceKind, [number, number]> = {
  travertine: [3, 1.2],
  plaster: [2, 1.2],
  damask: [3, 1.4],
  marble: [1.6, 1.2],
  oak: [2, 3],
  parquet: [2, 3],
  terrazzo: [3, 4],
  concrete: [2, 2],
  granite: [3, 4],
  tatami: [1.5, 3],
};

/** 地面的粗糙度：抛光石材与哑光席面差得远 */
const FLOOR_ROUGHNESS: Record<SurfaceKind, number> = {
  travertine: 0.5,
  plaster: 0.8,
  damask: 0.9,
  marble: 0.24,
  oak: 0.42,
  parquet: 0.36,
  terrazzo: 0.5,
  concrete: 0.72,
  granite: 0.34,
  tatami: 0.88,
};

/** 一种表面做法 → 一张贴图（底色由形制给） */
function surfaceTexture(kind: SurfaceKind, color: string): THREE.CanvasTexture {
  const texture = ((): THREE.CanvasTexture => {
    switch (kind) {
      case 'travertine':
        return travertineTexture(color);
      case 'plaster':
        return plasterTexture(color);
      case 'damask':
        return damaskTexture(color);
      case 'marble':
        return marbleTexture(color);
      case 'oak':
        return oakTexture(color);
      case 'parquet':
        return parquetTexture(color);
      case 'terrazzo':
        return terrazzoTexture(color);
      case 'concrete':
        return concreteTexture(color);
      case 'granite':
        return graniteTexture(color);
      case 'tatami':
        return tatamiTexture(color);
    }
  })();
  texture.repeat.set(REPEAT[kind][0], REPEAT[kind][1]);
  return texture;
}

/** 深色：把某个颜色压暗，用来做走边、暗缝那一类「比主色深一号」的东西 */
function darken(hex: string, amount = 0.45): string {
  const color = new THREE.Color(hex);
  color.multiplyScalar(1 - amount);
  return `#${color.getHexString()}`;
}

/** 一套材质：一间厅的墙面、地面、线脚、顶棚、灯光面、画框…… */
function buildStyleMaterials(
  style: HallStyle,
  track: <T extends Disposable>(item: T) => T,
): HallMaterials {
  const wallMap = track(surfaceTexture(style.surfaces.wall, style.colors.wall));
  const floorMap = track(surfaceTexture(style.surfaces.floor, style.colors.floor));
  const benchBase = style.surfaces.floor === 'oak' || style.surfaces.floor === 'parquet'
    ? style.colors.floor
    : '#cbb494';
  const benchMap = track(oakTexture(benchBase));
  benchMap.repeat.set(3, 1);

  return {
    wall: track(
      new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.78, metalness: 0.02 }),
    ),
    floor: track(
      new THREE.MeshStandardMaterial({
        map: floorMap,
        roughness: FLOOR_ROUGHNESS[style.surfaces.floor],
        metalness: style.surfaces.floor === 'marble' ? 0.12 : 0.06,
        envMapIntensity: 0.7,
      }),
    ),
    // 中轴的浅色石材带：浅一号的地面色，给地面一个方向
    runner: track(
      new THREE.MeshStandardMaterial({
        map: track(
          ((): THREE.CanvasTexture => {
            const texture = travertineTexture(style.colors.ceiling);
            texture.repeat.set(RUNNER_REPEAT[0], RUNNER_REPEAT[1]);
            return texture;
          })(),
        ),
        roughness: 0.42,
        metalness: 0.03,
      }),
    ),
    border: track(
      new THREE.MeshStandardMaterial({
        color: darken(style.colors.trim, 0.55),
        roughness: 0.46,
        metalness: 0.08,
      }),
    ),
    trim: track(
      new THREE.MeshStandardMaterial({
        color: style.colors.trim,
        roughness: 0.6,
        metalness: 0.3,
      }),
    ),
    accent: track(
      new THREE.MeshStandardMaterial({
        color: style.colors.accent,
        roughness: 0.45,
        metalness: 0.4,
      }),
    ),
    metal: track(
      new THREE.MeshStandardMaterial({
        color: style.colors.metal,
        roughness: 0.34,
        metalness: 0.82,
      }),
    ),
    ceiling: ceilingMaterial(style, track),
    glow: track(
      new THREE.MeshBasicMaterial({
        map: track(skyTexture()),
        toneMapped: false,
        fog: false,
      }),
    ),
    glowWarm: track(
      new THREE.MeshBasicMaterial({
        color: style.light.areaColor,
        toneMapped: false,
        fog: false,
        transparent: true,
        opacity: 0.96,
      }),
    ),
    mirror: track(
      new THREE.MeshStandardMaterial({
        color: '#e6ecf1',
        roughness: 0.05,
        metalness: 1,
        envMapIntensity: 1.6,
      }),
    ),
    bench: track(
      new THREE.MeshStandardMaterial({ map: benchMap, roughness: 0.5, metalness: 0.04 }),
    ),
    frame: track(
      new THREE.MeshStandardMaterial({
        color: style.colors.frame,
        roughness: 0.42,
        metalness: 0.35,
      }),
    ),
    matboard: track(
      new THREE.MeshStandardMaterial({ color: style.colors.mat, roughness: 0.9 }),
    ),
  };
}

export function createFloor({ canvas, plan }: CreateFloorOptions): FloorHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const diagonal = Math.hypot(spanX, spanZ);

  const scene = new THREE.Scene();
  // 筒拱里广角会把弧面拉变形，也会让边上的画透视失真
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, diagonal * 2 + 6);

  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 这一层用到了哪几种形制，就生成几套材质；同形制的多间厅共用 ----
  const styleIds = [...new Set(plan.spaces.map((space) => space.styleId))];
  const materials = new Map<HallStyleId, HallMaterials>();
  for (const id of styleIds) materials.set(id, buildStyleMaterials(hallStyle(id), track));
  const matsOf = (styleId: HallStyleId): HallMaterials =>
    materials.get(styleId) ?? (materials.get('kimbell') as HallMaterials);

  const styles = styleIds.map((id) => hallStyle(id));
  // 背景与全局那两盏灯取各间厅的平均：一层是连通的，光不该在门口断掉
  const mean = (pick: (style: HallStyle) => number): number =>
    styles.reduce((sum, style) => sum + pick(style), 0) / Math.max(styles.length, 1);
  const mixColor = (pick: (style: HallStyle) => string): THREE.Color => {
    const out = new THREE.Color(0, 0, 0);
    for (const style of styles) out.add(new THREE.Color(pick(style)));
    return out.multiplyScalar(1 / Math.max(styles.length, 1));
  };
  scene.background = mixColor((style) => style.light.bg);

  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const glowMap = track(radialTexture('255,255,255'));
  const shadowMap = track(radialTexture('0,0,0'));
  const placeholder = track(placeholderTexture());

  /** 洗墙光 / 画框投影：一件作品一片，加色混合压得很淡 */
  const washMaterial = track(
    new THREE.MeshBasicMaterial({
      map: glowMap,
      color: '#fff6e8',
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      map: shadowMap,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );

  const pickables: THREE.Object3D[] = [];
  const blockers: THREE.Object3D[] = [];
  const floors: THREE.Object3D[] = [];
  const pictures = new Map<string, THREE.Mesh>();
  const parts = new Map<string, FrameParts>();

  // ---- 地面：每间厅一片，用自己那套地板 ----
  for (const space of plan.spaces) {
    const width = space.rect.x2 - space.rect.x1;
    const depth = space.rect.z2 - space.rect.z1;
    const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(width, depth)), matsOf(space.styleId).floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((space.rect.x1 + space.rect.x2) / 2, 0, (space.rect.z1 + space.rect.z2) / 2);
    floor.userData.isFloor = true;
    scene.add(floor);
    floors.push(floor);
  }

  // ---- 墙（顶棚以下）----
  /** 在墙上贴一块板（墙面 / 门楣）：沿墙方向 [a,b]，竖直方向 [y0,y1] */
  function addPanel(face: WallFace, a: number, b: number, y0: number, y1: number): void {
    const length = b - a;
    const height = y1 - y0;
    const along = (a + b) / 2;
    const mesh = new THREE.Mesh(unitBox, matsOf(face.styleId).wall);
    if (face.axis === 'x') {
      mesh.position.set(along, (y0 + y1) / 2, face.at + face.normal * (PANEL_T / 2));
      mesh.scale.set(length, height, PANEL_T);
    } else {
      mesh.position.set(face.at + face.normal * (PANEL_T / 2), (y0 + y1) / 2, along);
      mesh.scale.set(PANEL_T, height, length);
    }
    mesh.userData.isWall = true;
    scene.add(mesh);
    blockers.push(mesh);
  }

  /** 贴着墙面的一条细板：踢脚线、起拱线那道凹槽、檐口 */
  function addTrim(
    face: WallFace,
    a: number,
    b: number,
    height: number,
    thickness: number,
    y: number,
    material: THREE.Material,
  ): void {
    const length = b - a;
    const along = (a + b) / 2;
    const mesh = new THREE.Mesh(unitBox, material);
    if (face.axis === 'x') {
      mesh.position.set(along, y, face.at + face.normal * (PANEL_T + thickness / 2));
      mesh.scale.set(length, height, thickness);
    } else {
      mesh.position.set(face.at + face.normal * (PANEL_T + thickness / 2), y, along);
      mesh.scale.set(thickness, height, length);
    }
    scene.add(mesh);
  }

  for (const face of plan.walls) {
    const style = hallStyle(face.styleId);
    const mats = matsOf(face.styleId);
    const spans: [number, number][] = face.door
      ? [
          [face.a, face.door.center - face.door.width / 2],
          [face.door.center + face.door.width / 2, face.b],
        ]
      : [[face.a, face.b]];
    const solid = spans.filter(([a, b]) => b - a > 0.02);

    for (const [a, b] of solid) addPanel(face, a, b, 0, face.height);
    if (face.door) {
      addPanel(
        face,
        face.door.center - face.door.width / 2,
        face.door.center + face.door.width / 2,
        face.door.height,
        face.height,
      );
    }
    // 踢脚线遇到拱门就断开
    for (const [a, b] of solid) {
      addTrim(face, a, b, BASEBOARD_H, 0.024, BASEBOARD_H / 2, mats.trim);
    }
    // 起拱线下的檐口：一道出挑的横线，上面留一条暗缝 —— 顶棚看着是「落」在
    // 檐口上的，不是糊在墙上的。壁柱比檐口更出挑一点，檐口就绕着壁柱转
    if (style.features.cornice) {
      addTrim(face, face.a, face.b, CORNICE_H, CORNICE_T, face.height - CORNICE_H / 2 - 0.014, mats.wall);
      addTrim(face, face.a, face.b, 0.016, CORNICE_T * 0.6, face.height - 0.008, mats.border);
    }
  }

  // ---- 拱门：门套（竖挺 + 横楣或拱券）与门槛石 ----
  const styleOfSpace = new Map(plan.spaces.map((space) => [space.id, space.styleId]));

  for (const door of plan.doors) {
    // 门两侧各是一间厅，各自的门套做法（石门套 / 拱券 / 月洞门）
    for (const [spaceId, normal] of [
      [door.a, -1],
      [door.b, 1],
    ] as [string, 1 | -1][]) {
      const style = hallStyle(styleOfSpace.get(spaceId) ?? 'kimbell');
      const mats = matsOf(style.id);
      const x = door.x + normal * (PANEL_T + PORTAL_T / 2);

      for (const side of [-1, 1] as (-1 | 1)[]) {
        const jamb = new THREE.Mesh(unitBox, mats.trim);
        jamb.position.set(
          x,
          (door.height + PORTAL_W) / 2,
          door.z + side * (door.width / 2 + PORTAL_W / 2),
        );
        jamb.scale.set(PORTAL_T, door.height + PORTAL_W, PORTAL_W);
        scene.add(jamb);
        blockers.push(jamb);
      }

      if (style.door.shape === 'arch' || style.door.shape === 'moon') {
        // 拱券 / 月洞门：一个半圆（月洞是整圈，门洞仍是方的，走路照旧）
        const radius = door.width / 2;
        const torus = new THREE.Mesh(
          track(
            new THREE.TorusGeometry(
              radius,
              PORTAL_W / 2,
              8,
              24,
              style.door.shape === 'moon' ? Math.PI * 2 : Math.PI,
            ),
          ),
          mats.trim,
        );
        // Torus 建在 xy 平面：绕 y 转 90° 让它立在门所在的墙上
        torus.rotation.y = Math.PI / 2;
        torus.position.set(x, door.height, door.z);
        scene.add(torus);
        blockers.push(torus);
      } else {
        const head = new THREE.Mesh(unitBox, mats.trim);
        head.position.set(x, door.height + PORTAL_W / 2, door.z);
        head.scale.set(PORTAL_T, PORTAL_W, door.width + PORTAL_W * 2);
        scene.add(head);
        blockers.push(head);
      }
    }

    // 门槛石：门洞地面上一块深色石材，两间厅在这里分界
    const sill = new THREE.Mesh(unitBox, matsOf(styleOfSpace.get(door.a) ?? 'kimbell').border);
    sill.position.set(door.x, 0.012, door.z);
    sill.scale.set(0.42, 0.024, door.width + PORTAL_W * 2);
    scene.add(sill);
  }

  // ---- 壁柱：长墙按展位分间，画挂在开间里 ----
  for (const pilaster of plan.pilasters) {
    const mats = matsOf(pilaster.styleId);
    const mesh = new THREE.Mesh(unitBox, mats.wall);
    mesh.position.set(
      pilaster.x + pilaster.normal * (PANEL_T + PILASTER_T / 2),
      pilaster.height / 2,
      pilaster.z,
    );
    mesh.scale.set(PILASTER_T, pilaster.height, PILASTER_W);
    scene.add(mesh);
    blockers.push(mesh);
  }

  // ---- 长凳：端墙前一条，坐下来正好回望整条厅 ----
  for (const bench of plan.benches) {
    const mats = matsOf(bench.styleId);
    const seat = new THREE.Mesh(unitBox, mats.bench);
    seat.position.set(bench.x, BENCH_H, bench.z);
    seat.scale.set(bench.width, BENCH_T, bench.depth);
    scene.add(seat);
    blockers.push(seat);

    for (const side of [-1, 1] as (-1 | 1)[]) {
      const leg = new THREE.Mesh(unitBox, mats.accent);
      leg.position.set(bench.x + side * (bench.width / 2 - 0.26), BENCH_H / 2, bench.z);
      leg.scale.set(BENCH_LEG, BENCH_H, bench.depth * 0.72);
      scene.add(leg);
      blockers.push(leg);
    }
  }

  // ---- 顶棚与装饰：照着形制来（halls.ts）----
  for (const ceiling of plan.ceilings) {
    const space = plan.spaces.find((item) => item.id === ceiling.spaceId);
    if (!space) continue;
    const style = hallStyle(ceiling.styleId);
    const ctx: HallBuildContext = {
      ceiling,
      style,
      mats: matsOf(ceiling.styleId),
      rect: space.rect,
      unitPlane,
      unitBox,
      scene,
      blockers,
      track,
    };
    buildHall(ctx);
  }

  // ---- 端墙的封口：筒拱是拱形，平顶是一整片到顶 ----
  const archGeometries = new Map<HallStyleId, THREE.BufferGeometry>();
  for (const end of plan.ends) {
    const style = hallStyle(end.styleId);
    const mats = matsOf(end.styleId);
    if (!end.arch) continue;

    const key = end.styleId;
    let geometry = archGeometries.get(key);
    if (!geometry) {
      const rise = end.width * (style.ceiling.rise ?? 1 / Math.PI);
      geometry = track(buildEndArch(archProfile(end.width, rise), ARCH_T));
      archGeometries.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, mats.wall);
    mesh.position.set(end.x, end.height, end.z);
    // ShapeGeometry 建在 xy 平面、朝 +z；normal 为 -1 时转过去朝 -z
    mesh.rotation.y = end.normal === 1 ? 0 : Math.PI;
    if (end.normal === 1) mesh.position.z += 0.02;
    else mesh.position.z -= 0.02;
    mesh.userData.isWall = true;
    scene.add(mesh);
    blockers.push(mesh);
  }

  // ---- 端墙内侧挂展厅名：走进一间厅时抬眼就能看到这是哪间 ----
  for (const end of plan.ends) {
    if (end.normal !== 1) continue; // 只在 z 最小那一端挂，免得两头的字打架
    const space = plan.spaces.find((item) => item.id === end.spaceId);
    const label = space?.label ?? '';
    const plaque = new THREE.Mesh(
      unitPlane,
      track(
        new THREE.MeshBasicMaterial({
          map: track(labelTexture(label)),
          color: '#d8d8d8',
          fog: false,
          toneMapped: false,
        }),
      ),
    );
    plaque.position.set(end.x, end.height - 0.75, end.z + end.normal * 0.06);
    plaque.rotation.y = end.normal === 1 ? 0 : Math.PI;
    plaque.scale.set(PLAQUE_W, PLAQUE_W / 4, 1);
    scene.add(plaque);
  }

  // ---- 灯光：全局的环境光 + 半球光，加上每间厅自己那盏顶光 ----
  RectAreaLightUniformsLib.init();
  scene.add(new THREE.AmbientLight(0xffffff, mean((style) => style.light.ambient)));
  const hemi = new THREE.HemisphereLight(
    mixColor((style) => style.light.hemiSky),
    mixColor((style) => style.light.hemiGround),
    mean((style) => style.light.hemi),
  );
  scene.add(hemi);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = environmentTexture(
    `#${mixColor((style) => style.light.envTop).getHexString()}`,
    `#${mixColor((style) => style.light.envBottom).getHexString()}`,
  );
  const environment = pmrem.fromEquirectangular(equirect).texture;
  scene.environment = environment;
  scene.environmentIntensity = 1;
  pmrem.dispose();
  equirect.dispose();
  disposables.push(environment);

  // ---- 画 ----
  for (const placement of plan.placements) {
    const styleId =
      plan.spaces.find((space) => space.id === placement.spaceId)?.styleId ?? 'kimbell';
    const mats = matsOf(styleId);

    const group = new THREE.Group();
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.ry;

    const art = fitArt(placement.fw, placement.fh, placement.fw / placement.fh);
    const outer = { w: art.w + MAT_WIDTH * 2, h: art.h + MAT_WIDTH * 2 };

    // 洗墙光：画框背后的墙上晕开一片，画就像被单独打了光
    const wash = new THREE.Mesh(unitPlane, washMaterial);
    wash.position.z = -0.035;
    group.add(wash);

    // 画框在墙上的投影：稍微往下偏一点，画就「挂」在墙上了
    const shadow = new THREE.Mesh(unitPlane, shadowMaterial);
    shadow.position.set(0.035, -0.045, -0.045);
    group.add(shadow);

    // 画框：卡纸四周再压一圈木条。材质是逐件 clone 的 —— 悬停要点亮
    // 单独一件，shared material 会让整层展厅一起亮
    const frameMaterialForArt = track(mats.frame.clone());
    const frame = new THREE.Mesh(unitBox, frameMaterialForArt);
    frame.userData.id = placement.id;
    group.add(frame);

    // 卡纸（留白），画心贴在它上面
    const mat = new THREE.Mesh(unitPlane, mats.matboard);
    mat.position.z = FRAME_DEPTH / 2 + 0.001;
    group.add(mat);

    // 画心：Basic 材质 + 关色调映射，保证展品是展厅里最亮的东西
    const picture = new THREE.Mesh(
      unitPlane,
      new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false, fog: false }),
    );
    picture.position.z = FRAME_DEPTH / 2 + 0.003;
    group.add(picture);

    // 墙上的作品标签：标题 + 器材，字画进贴图
    const labelMap = track(wallLabelTexture(placement.title, placement.camera));
    const labelMaterialForArt = track(
      new THREE.MeshStandardMaterial({ map: labelMap, roughness: 0.85 }),
    );
    const label = new THREE.Mesh(unitBox, labelMaterialForArt);
    group.add(label);

    const entry: FrameParts = {
      frame,
      frameMaterial: frameMaterialForArt,
      mat,
      picture,
      wash,
      shadow,
      label,
    };
    applySize(entry, art.w, art.h, outer.w, outer.h);

    pictures.set(placement.id, picture);
    parts.set(placement.id, entry);
    pickables.push(frame);
    disposables.push(picture.material as THREE.Material);
    scene.add(group);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const quaternion = new THREE.Quaternion();
  const scratch = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();

  /** 按画心尺寸摆好一件作品的所有零件 */
  function applySize(
    entry: FrameParts,
    artW: number,
    artH: number,
    outerW: number,
    outerH: number,
  ): void {
    entry.picture.scale.set(artW, artH, 1);
    entry.mat.scale.set(outerW - FRAME_LIP * 2, outerH - FRAME_LIP * 2, 1);
    entry.frame.scale.set(outerW, outerH, FRAME_DEPTH);
    entry.wash.scale.set(outerW + WASH_PAD, outerH + WASH_PAD * 0.8, 1);
    entry.shadow.scale.set(outerW + SHADOW_PAD, outerH + SHADOW_PAD, 1);
    // 标签贴着画框右下角外侧，底边与画框底边齐平。比例跟着贴图走（2:1）
    entry.label.scale.set(LABEL_W, LABEL_W / 2, 0.008);
    entry.label.position.set(outerW / 2 + LABEL_W / 2 + 0.06, -outerH / 2 + 0.08, -0.05);
  }

  /** 长边不变，只按真实比例重排宽高：卡纸、画框、洗墙光都跟着画心走 */
  function resizeFrame(id: string, aspect: number): void {
    const entry = parts.get(id);
    const placement = plan.placements.find((item) => item.id === id);
    if (!entry || !placement) return;

    const art = fitArt(placement.fw, placement.fh, aspect);
    applySize(entry, art.w, art.h, art.w + MAT_WIDTH * 2, art.h + MAT_WIDTH * 2);
  }

  return {
    scene,
    camera,
    renderer,
    pickables,
    blockers,
    pictures,

    setPicture(id, texture, aspect) {
      const picture = pictures.get(id);
      if (!picture) return;
      const material = picture.material as THREE.MeshBasicMaterial;
      const previous = material.map;
      material.map = texture;
      material.needsUpdate = true;
      if (previous && previous !== placeholder) previous.dispose();
      if (aspect) resizeFrame(id, aspect);
    },

    pick(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      const hit = raycaster.intersectObjects([...pickables, ...blockers, ...floors], false)[0];
      if (!hit) return null;
      if (hit.object.userData.id) return { kind: 'art', id: String(hit.object.userData.id) };
      if (hit.object.userData.isFloor) return { kind: 'floor', x: hit.point.x, z: hit.point.z };
      // 打在墙上（或者隔着墙打到了别处的地面）：当作没点
      return null;
    },

    viewpoint(id) {
      const frame = pickables.find((mesh) => mesh.userData.id === id);
      if (!frame) return null;
      // 画框正面朝向是本地 +z，转到世界坐标后往前 1.5m 就是站位
      frame.getWorldQuaternion(quaternion);
      const normal = scratch.set(0, 0, 1).applyQuaternion(quaternion);
      frame.getWorldPosition(worldPosition);
      // 站定后要正对画心：相机朝 -z 看是 yaw=0，即 forward = (-sin yaw, -cos yaw)，
      // 令它等于「从站位指回画心」的 -normal，解出 yaw = atan2(n.x, n.z)
      return {
        x: worldPosition.x + normal.x * 1.5,
        z: worldPosition.z + normal.z * 1.5,
        yaw: Math.atan2(normal.x, normal.z),
      };
    },

    setHover(id) {
      for (const [key, entry] of parts) {
        const on = key === id;
        // 一点暖光从画框里透出来：比描边含蓄，也不改几何
        entry.frameMaterial.emissive.setHex(on ? 0x3a2f1c : 0x000000);
      }
    },

    setSize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    render() {
      renderer.render(scene, camera);
    },

    dispose() {
      for (const item of disposables) item.dispose();
      for (const picture of pictures.values()) {
        const map = (picture.material as THREE.MeshBasicMaterial).map;
        if (map && map !== placeholder) map.dispose();
      }
      renderer.dispose();
    },
  };
}

/** 一件作品的全部零件；换图时按真实比例一起缩放 */
interface FrameParts {
  frame: THREE.Mesh;
  /** 逐件 clone 出来的画框材质，悬停时单独点亮 */
  frameMaterial: THREE.MeshStandardMaterial;
  mat: THREE.Mesh;
  picture: THREE.Mesh;
  wash: THREE.Mesh;
  shadow: THREE.Mesh;
  label: THREE.Mesh;
}

/** 按比例求画心尺寸：长边保持不变，短边跟着比例缩 */
function fitArt(fw: number, fh: number, aspect: number): { w: number; h: number } {
  const long = Math.max(fw, fh);
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}

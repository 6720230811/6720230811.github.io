/**
 * 3D 展厅：three.js 场景的搭建与拾取。
 *
 * 只在 mountGallery 确认设备能跑 WebGL 之后才被动态 import —— 不支持的设备
 * 连这个 chunk 都不会下载。交互与 DOM 逻辑在 index.ts，这里只管「展厅长什么样」。
 *
 * 现在的展厅就是整座金贝尔美术馆：16 个摆线筒拱分三排（6+4+6）落在一个平台
 * 上，每个拱挂一种策展。这一层做四件事：
 * 1. 用 light/building.ts 把建筑本体（拱壳、天窗缝、反射器、填充墙、柱、
 *    平台、庭院、树廊）建出来，并打开门洞让各拱连通
 * 2. 按每个拱挂的策展形制取墙面做法（九种形制只体现在墙面与画框上，
 *    建筑本身的几何与构造是一样的 —— 它得先是那座建筑）
 * 3. 把 plan.ts 给出的挂画位摆上画（画框、卡纸、画心、墙上的展签）
 * 4. 提供拾取（画 / 地面）与站位推算，交给 index.ts 去走、去看
 *
 * 灯光走的是建筑自己的那套叙事：太阳 → 天窗缝 → 反射器 → 拱面漫反射。
 * 这里不额外打灯到画上：直射光到不了画作与地面，是数据卡的要求。
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { APEX, BUILDING_X, BUILDING_Z, PLATFORM_H, VAULTS } from '../light/layout';
import { buildBuilding } from '../light/building';
import { environmentTexture, labelTexture, wallLabelTexture } from './surfaces';
import { hallStyle, type HallStyle, type HallStyleId, type SurfaceKind } from './styles';
import type { FloorPlan } from './plan';

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
const FRAME_LIP = 0.03;
const FRAME_DEPTH = 0.05;
/** 洗墙光比画框大出多少 */
const WASH_PAD = 0.66;
const SHADOW_PAD = 0.34;
/** 展签宽度（高是一半） */
const LABEL_W = 0.24;

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

/** 一张还没加载的纹理：给个浅米色占位，免得白花花一片闪 */
function placeholderTexture(): THREE.DataTexture {
  const data = new Uint8Array([226, 220, 208, 255]);
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

/** 每种表面做法贴图的平铺次数 */
const REPEAT: Record<SurfaceKind, [number, number]> = {
  travertine: [3, 1.6],
  plaster: [2, 1.6],
  damask: [3, 1.8],
  marble: [1.6, 1.6],
  oak: [1, 6],
  parquet: [2, 3],
  terrazzo: [3, 4],
  concrete: [4, 4],
  granite: [3, 4],
  tatami: [1.5, 3],
};

/** 形制的墙面做法 → 贴图（底色由形制给） */
function wallTexture(kind: SurfaceKind, color: string): THREE.CanvasTexture {
  const texture = surface(kind, color);
  texture.repeat.set(REPEAT[kind][0], REPEAT[kind][1]);
  return texture;
}

export function createFloor({ canvas, plan }: CreateFloorOptions): FloorHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const diagonal = Math.hypot(spanX, spanZ);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cdd6de');
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, diagonal * 2 + 60);

  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 这一层用到了哪几种形制，就生成几套墙面材质 ----
  const styleIds = [...new Set(plan.spaces.map((space) => space.styleId))];
  const wallMaterials = new Map<HallStyleId, THREE.MeshStandardMaterial>();
  const frameMaterials = new Map<HallStyleId, THREE.MeshStandardMaterial>();
  const matMaterials = new Map<HallStyleId, THREE.MeshStandardMaterial>();
  for (const id of styleIds) {
    const style = hallStyle(id);
    wallMaterials.set(
      id,
      track(
        new THREE.MeshStandardMaterial({
          map: track(wallTexture(style.surfaces.wall, style.colors.wall)),
          roughness: 0.9,
          metalness: 0,
          envMapIntensity: 0.45,
        }),
      ),
    );
    frameMaterials.set(
      id,
      track(
        new THREE.MeshStandardMaterial({
          color: style.colors.frame,
          roughness: 0.42,
          metalness: 0.35,
        }),
      ),
    );
    matMaterials.set(
      id,
      track(
        new THREE.MeshStandardMaterial({ color: style.colors.mat, roughness: 0.9 }),
      ),
    );
  }
  const wallOf = (id: HallStyleId): THREE.Material =>
    wallMaterials.get(id) ?? (wallMaterials.get('kimbell') as THREE.Material);

  // ---- 建筑本体：开门洞（要走人）+ 按拱取墙面材质 ----
  const vaultWalls = VAULTS.map((_, index) => {
    const space = plan.spaces[index];
    return space ? wallOf(space.styleId) : undefined;
  });
  const building = buildBuilding({ doorways: true, vaultWalls });
  building.group.position.y = PLATFORM_H;
  scene.add(building.group);

  const pickables: THREE.Object3D[] = [];
  const blockers: THREE.Object3D[] = [];
  const floors: THREE.Object3D[] = [];
  building.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.isFloor) floors.push(mesh);
    else blockers.push(mesh);
  });

  const placeholder = track(placeholderTexture());
  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const glowMap = track(radial('255,255,255'));
  const shadowMap = track(radial('0,0,0'));
  const washMaterial = track(
    new THREE.MeshBasicMaterial({
      map: glowMap,
      color: '#fff6e8',
      transparent: true,
      opacity: 0.22,
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
      opacity: 0.24,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );

  // ---- 挂画 ----
  const pictures = new Map<string, THREE.Mesh>();
  const parts = new Map<string, FrameParts>();

  for (const placement of plan.placements) {
    const space = plan.spaces.find((item) => item.id === placement.spaceId);
    const styleId = space?.styleId ?? 'kimbell';
    const frameMaterial = frameMaterials.get(styleId) as THREE.MeshStandardMaterial;
    const matMaterial = matMaterials.get(styleId) as THREE.MeshStandardMaterial;

    const group = new THREE.Group();
    group.position.set(placement.x, PLATFORM_H + placement.y, placement.z);
    group.rotation.y = placement.ry;

    const art = fitArt(placement.fw, placement.fh, placement.fw / placement.fh);
    const outer = { w: art.w + MAT_WIDTH * 2, h: art.h + MAT_WIDTH * 2 };

    // 洗墙光：画框背后晕开一片，画就像被单独打了光（不是真光源，只是一张加色面）
    const wash = new THREE.Mesh(unitPlane, washMaterial);
    wash.position.z = -0.035;
    group.add(wash);

    const shade = new THREE.Mesh(unitPlane, shadowMaterial);
    shade.position.set(0.03, -0.04, -0.04);
    group.add(shade);

    // 画框逐件 clone：悬停要点亮单独一件，共享材质会让整座建筑一起亮
    const frameMaterialForArt = track(frameMaterial.clone());
    const frame = new THREE.Mesh(unitBox, frameMaterialForArt);
    frame.userData.id = placement.id;
    group.add(frame);

    const mat = new THREE.Mesh(unitPlane, matMaterial);
    mat.position.z = FRAME_DEPTH / 2 + 0.001;
    group.add(mat);

    const picture = new THREE.Mesh(
      unitPlane,
      new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false, fog: false }),
    );
    picture.position.z = FRAME_DEPTH / 2 + 0.003;
    group.add(picture);

    // 墙上的展签：标题 + 器材
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
      shade,
      label,
    };
    applySize(entry, art.w, art.h, outer.w, outer.h);

    pictures.set(placement.id, picture);
    parts.set(placement.id, entry);
    pickables.push(frame);
    disposables.push(picture.material as THREE.Material);
    scene.add(group);
  }

  // ---- 房间名牌：挂在每排最西那个拱的西端墙上（走进去抬眼能看到这是哪种策展）----
  const plaques: { x: number; z: number; ry: number; label: string }[] = [];
  const seenRow = new Set<string>();
  plan.spaces.forEach((space, index) => {
    const vault = VAULTS[index];
    if (!vault || seenRow.has(vault.row)) return;
    seenRow.add(vault.row);
    plaques.push({
      x: vault.x - 15.24 + 0.12,
      z: vault.z,
      ry: -Math.PI / 2,
      label: space.label,
    });
  });
  for (const plaque of plaques) {
    const mesh = new THREE.Mesh(
      unitPlane,
      track(
        new THREE.MeshBasicMaterial({
          map: track(labelTexture(plaque.label)),
          color: '#d8d8d8',
          fog: false,
          toneMapped: false,
        }),
      ),
    );
    mesh.position.set(plaque.x, PLATFORM_H + APEX * 0.62, plaque.z);
    mesh.rotation.y = plaque.ry;
    mesh.scale.set(1.6, 0.4, 1);
    scene.add(mesh);
  }

  // ---- 环境：PMREM + 半球光（拱面漫反射的那一份）----
  RectAreaLightUniformsLib.init();
  const hemi = new THREE.HemisphereLight(0xdfe9f7, 0x8a7c66, 0.55);
  scene.add(hemi);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = track(environmentTexture('#e8f0fa', '#8a7c66'));
  const environment = pmrem.fromEquirectangular(equirect).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

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
    entry.shade.scale.set(outerW + SHADOW_PAD, outerH + SHADOW_PAD, 1);
    entry.label.scale.set(LABEL_W, LABEL_W / 2, 0.008);
    entry.label.position.set(outerW / 2 + LABEL_W / 2 + 0.06, -outerH / 2 + 0.08, -0.05);
  }

  /** 长边不变，只按真实比例重排宽高 */
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
      frame.getWorldQuaternion(quaternion);
      const normal = scratch.set(0, 0, 1).applyQuaternion(quaternion);
      frame.getWorldPosition(worldPosition);
      return {
        x: worldPosition.x + normal.x * 1.5,
        z: worldPosition.z + normal.z * 1.5,
        yaw: Math.atan2(normal.x, normal.z),
      };
    },

    setHover(id) {
      for (const [key, entry] of parts) {
        entry.frameMaterial.emissive.setHex(key === id ? 0x3a2f1c : 0x000000);
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
      building.dispose();
      environment.dispose();
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
  shade: THREE.Mesh;
  label: THREE.Mesh;
}

/** 按比例求画心尺寸：长边保持不变，短边跟着比例缩 */
function fitArt(fw: number, fh: number, aspect: number): { w: number; h: number } {
  const long = Math.max(fw, fh);
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}

/** 径向渐变（洗墙光 / 画框投影共用） */
function radial(rgb: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, `rgba(${rgb},0.95)`);
    gradient.addColorStop(0.45, `rgba(${rgb},0.42)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 按表面做法生成贴图：与 light/textures.ts 同一套画法，这里只取墙面那几种 */
function surface(kind: SurfaceKind, color: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    // 层理：一道道深浅不一的波浪（洞石、木纹、抹灰共用）
    const lines = kind === 'damask' ? 14 : 26;
    for (let i = 0; i < lines; i += 1) {
      const y = Math.random() * size;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,252,244' : '150,140,120'},0.14)`;
      ctx.lineWidth = 1 + Math.random() * 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 24) {
        ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 5);
      }
      ctx.stroke();
    }
    // 锦缎：菱形骨架 + 椭圆花心的暗花
    if (kind === 'damask') {
      for (const [cx, cy] of [[0.5, 0.5], [0, 0], [1, 1], [1, 0], [0, 1]]) {
        ctx.strokeStyle = 'rgba(255,236,214,0.13)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx * size, cy * size, 26, 40, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,236,214,0.10)';
        ctx.beginPath();
        ctx.ellipse(cx * size, cy * size, 12, 20, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 洞石的孔洞
    if (kind === 'travertine' || kind === 'marble') {
      for (let i = 0; i < 700; i += 1) {
        ctx.fillStyle = `rgba(150,136,110,${0.06 + Math.random() * 0.18})`;
        ctx.beginPath();
        ctx.ellipse(
          Math.random() * size,
          Math.random() * size,
          1 + Math.random() * 3,
          0.6 + Math.random(),
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    // 水磨石/花岗岩的骨料
    if (kind === 'terrazzo' || kind === 'granite') {
      const chips = ['#8d8578', '#efe9dc', '#b3a58c', '#6f6a60'];
      for (let i = 0; i < 600; i += 1) {
        ctx.fillStyle = chips[Math.floor(Math.random() * chips.length)];
        ctx.globalAlpha = 0.5 + Math.random() * 0.4;
        const r = 1 + Math.random() * 3;
        ctx.beginPath();
        ctx.ellipse(Math.random() * size, Math.random() * size, r, r * 0.7, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // 席面的草纹
    if (kind === 'tatami') {
      for (let y = 0; y < size; y += 2) {
        ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,246,214' : '150,132,86'},${
          0.1 + Math.random() * 0.1
        })`;
        ctx.fillRect(0, y, size, 1);
      }
    }
    // 混凝土的气孔
    if (kind === 'concrete') {
      for (let i = 0; i < 900; i += 1) {
        ctx.fillStyle = `rgba(120,118,112,${0.05 + Math.random() * 0.12})`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, Math.random() * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** 场景尺寸（页面要显示） */
export const BUILDING_EXTENT = {
  x: BUILDING_X.max - BUILDING_X.min,
  z: BUILDING_Z.max - BUILDING_Z.min,
};

export type { HallStyle };

/**
 * 3D 展厅：白色展墙美术馆（参考 ClementCariou/virtual-art-gallery）
 *
 *  白墙、反光大理石地面、平顶、细黑框 + 画心 + 小标签 —— 全靠 HemisphereLight +
 *  PMREM 环境贴图的烘焙式柔光，没有直射阳光。走廊是一条 Hilbert 曲线围成的迷宫。
 *
 *  与之前「并排的厅」不同的是：现在 16 段墙都是同一座连续建筑的一部分，每
 *  段墙直接由 Hilbert 数据生成。画心被吸到墙的内侧（走廊一侧），离地 1.55 m。
 *
 *  画面的关键三件：
 *  - 墙壁纯白 #ECECEC 哑光，让展品本身（照片）成为视觉重心
 *  - 地面是高反射的浅灰大理石（envMapIntensity 1.4，roughness 0.18），画的倒
 *    影落在地上，参考项目的「贵」气主要从这来
 *  - 灯光零直射：HemisphereLight + PMREM 烘焙环境贴图，混凝土墙与石材的反
 *    射自然柔和
 *
 *  交互层 index.ts 不变：plan 提供 obstacles（迷宫里的墙），containsPoint
 *  守住碰撞；space.id = `room-<roomId>`，换房间时 URL 不变（这建筑没门）。
 */
import * as THREE from 'three';
import { hallStyle, type HallStyleId, type SurfaceKind } from './styles';
import { environmentTexture, wallLabelTexture } from './surfaces';
import type { FloorPlan } from './plan';

export interface CreateFloorOptions {
  canvas: HTMLCanvasElement;
  plan: FloorPlan;
}

export type PickResult =
  | { kind: 'art'; id: string }
  | { kind: 'floor'; x: number; z: number };

export interface FloorHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  pickables: THREE.Object3D[];
  blockers: THREE.Object3D[];
  pictures: Map<string, THREE.Mesh>;
  setPicture(id: string, texture: THREE.Texture): void;
  pick(clientX: number, clientY: number): PickResult | null;
  viewpoint(id: string): { x: number; z: number; yaw: number } | null;
  setHover(id: string | null): void;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

const MAT_W = 0.06; // 画布与画框之间留一点边距（其实现在不用外框了，保留常量防 import 报错）
const FRAME_LIP = 0.025;
const FRAME_DEPTH = 0.04;
const LABEL_W = 0.22;
void MAT_W; void FRAME_LIP; void FRAME_DEPTH; void LABEL_W;

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

function wallTexture(kind: SurfaceKind, color: string): THREE.CanvasTexture {
  const texture = surface(kind, color);
  texture.repeat.set(REPEAT[kind][0], REPEAT[kind][1]);
  return texture;
}

export function createFloor({ canvas, plan }: CreateFloorOptions): FloorHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const diagonal = Math.hypot(spanX, spanZ);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dadde2');
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, diagonal * 2 + 60);

  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 白墙偏冷一点（参考那种带蓝灰调的展墙），平顶压暗天花板 ----
  // 参考的展墙不是纯白：略微偏蓝灰 + 顶光从天花板下来把墙打亮
  const white = track(
    new THREE.MeshStandardMaterial({
      color: '#E8EAEE',
      roughness: 0.55,
      metalness: 0,
      envMapIntensity: 0.85,
    }),
  );
  const ceilingMat = track(
    new THREE.MeshStandardMaterial({
      color: '#9098A0',
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.3,
    }),
  );
  // 地面：浅灰大理石 + 拼缝（参考那种 1.5 m 左右的方格）—— canvas 现画
  const floorMat = track(
    new THREE.MeshStandardMaterial({
      map: track(makeTiledMarble()),
      color: '#D8DAE0',
      roughness: 0.15,
      metalness: 0.0,
      envMapIntensity: 1.7,
    }),
  );
  const baseboardMat = track(
    new THREE.MeshStandardMaterial({ color: '#8A8E94', roughness: 0.55 }),
  );
  const placeholder = track(placeholderTexture());

  // 画直接挂：没有外框、没有卡纸（参考的做法）—— 白画布直贴墙面、墙在画
  // 周围被顶光打亮一圈光晕。这里用三件东西合成这个效果：
  //   1) canvas 面：1.55 × 1.1 的白画布
  //   2) 阴影面：画布背后略大一点的加色减淡面（凹进墙里的小阴影）
  //   3) 光晕面：画布后更大的加色亮面（让墙在画周围被「照亮」）
  // 不再用形制给的画框与卡纸颜色 —— 那套是金贝尔美术馆的，跟这白色展墙冲突。
  const canvasMat = track(
    new THREE.MeshStandardMaterial({
      color: '#F0F0F0',
      roughness: 0.85,
      metalness: 0,
    }),
  );
  const shadowMat = track(
    new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const haloMat = track(
    new THREE.MeshBasicMaterial({
      color: '#FFFAEC',
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const haloGeo = track(new THREE.PlaneGeometry(1, 1));
  const canvasGeo = track(new THREE.PlaneGeometry(1, 1));
  const shadowGeo = track(new THREE.PlaneGeometry(1, 1));

  // ---- 白墙：每段 Hilbert 墙一个 InstancedMesh ----
  // 墙面用矩形面片：宽 = 墙长，高 = 4 m，挂在 y=2（半高）处
  const wallGeo = track(new THREE.PlaneGeometry(1, 1));
  const walls = new THREE.InstancedMesh(wallGeo, white, plan.walls.length);
  walls.receiveShadow = true;
  walls.castShadow = false;
  walls.userData.isWall = true;
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const wallHeight = 4.0;
  plan.walls.forEach((wall, i) => {
    const cx = (wall.a.x + wall.b.x) / 2;
    const cz = (wall.a.z + wall.b.z) / 2;
    pos.set(cx, wallHeight / 2, cz);
    // 墙的正面（+Z 面）朝走廊内侧 = -normal（normal 是朝外的）
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.atan2(-wall.normal.x, -wall.normal.z), 0),
    );
    walls.setMatrixAt(i, matrix.compose(pos, rotation, scale.set(wall.length, wallHeight, 1)));
  });
  walls.instanceMatrix.needsUpdate = true;
  scene.add(walls);

  // ---- 踢脚线（深灰窄条，紧贴地面）----
  const baseGeo = track(new THREE.BoxGeometry(1, 0.12, 0.04));
  const baseboards = new THREE.InstancedMesh(baseGeo, baseboardMat, plan.walls.length);
  for (let i = 0; i < plan.walls.length; i += 1) {
    const wall = plan.walls[i];
    const cx = (wall.a.x + wall.b.x) / 2;
    const cz = (wall.a.z + wall.b.z) / 2;
    // 踢脚线贴在墙的走廊那一侧：从墙中心线往里挪半墙厚
    pos.set(
      cx - wall.normal.x * (0.1 + 0.02),
      0.06,
      cz - wall.normal.z * (0.1 + 0.02),
    );
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.atan2(-wall.normal.x, -wall.normal.z), 0),
    );
    baseboards.setMatrixAt(i, matrix.compose(pos, rotation, scale.set(wall.length, 1, 1)));
  }
  baseboards.instanceMatrix.needsUpdate = true;
  baseboards.userData.isWall = true;
  scene.add(baseboards);

  // ---- 反光大理石地面：一整片大平面，跨越整个建筑（被墙挡也无所谓，墙就在它上面）----
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(plan.bounds.x2 - plan.bounds.x1, plan.bounds.z2 - plan.bounds.z1)),
    floorMat,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(
    (plan.bounds.x1 + plan.bounds.x2) / 2,
    0,
    (plan.bounds.z1 + plan.bounds.z2) / 2,
  );
  floor.receiveShadow = true;
  floor.userData.isFloor = true;
  scene.add(floor);

  // ---- 平顶 ----
  const ceiling = new THREE.Mesh(
    track(
      new THREE.PlaneGeometry(plan.bounds.x2 - plan.bounds.x1, plan.bounds.z2 - plan.bounds.z1),
    ),
    ceilingMat,
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(
    (plan.bounds.x1 + plan.bounds.x2) / 2,
    wallHeight,
    (plan.bounds.z1 + plan.bounds.z2) / 2,
  );
  scene.add(ceiling);

  // ---- 灯光：纯烘焙式柔光 ----
  // 上下天光用浅灰（不要偏暖的米色，不然拱面偏黄），环境贴图用白底
  const hemi = new THREE.HemisphereLight(0xffffff, 0xc0c0c0, 0.75);
  scene.add(hemi);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = track(environmentTexture('#fafafa', '#b0b0b0'));
  const environment = pmrem.fromEquirectangular(equirect).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();

  // ---- 挂画：细黑框 + 浅米卡纸 + 画心 + 墙签 ----
  const pictures = new Map<string, THREE.Mesh>();
  const pickables: THREE.Object3D[] = [];
  const parts = new Map<string, FrameParts>();

  for (const placement of plan.placements) {
    const group = new THREE.Group();
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.ry;

    const aspect = placement.fw / placement.fh;
    const art = fitArt(placement.fw, placement.fh, aspect);

    // 1) 光晕（additive）：挂在墙上，比画大一圈
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.z = -0.06;
    halo.scale.set(art.w * 2.6, art.h * 2.6, 1);
    group.add(halo);

    // 2) 阴影：紧贴墙面、画布外一圈
    const shade = new THREE.Mesh(shadowGeo, shadowMat);
    shade.position.z = -0.02;
    shade.scale.set(art.w + 0.05, art.h + 0.05, 1);
    group.add(shade);

    // 3) 画布：白底（纹理到达后被替换）
    const picture = new THREE.Mesh(
      canvasGeo,
      new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false, fog: false }),
    );
    picture.userData.id = placement.id;
    picture.position.z = 0.01;
    group.add(picture);

    // 4) 标签（标题 + 作者）—— 画在纹理上、贴在画下面
    const labelMap = track(wallLabelTexture(placement.title, placement.author));
    const labelMaterialForArt = track(
      new THREE.MeshBasicMaterial({ map: labelMap, transparent: true, toneMapped: false }),
    );
    const labelGeo = track(new THREE.PlaneGeometry(1, 1));
    const label = new THREE.Mesh(labelGeo, labelMaterialForArt);
    label.position.set(0, -art.h / 2 - 0.06, 0.01);
    label.scale.set(0.34, 0.06, 1);
    group.add(label);

    pictures.set(placement.id, picture);
    pickables.push(picture);
    disposables.push(picture.material as THREE.Material);
    scene.add(group);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const quaternion = new THREE.Quaternion();
  const scratch = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();

  /** hover 时把对应画的光晕亮一档 —— 没有外框可高亮，就亮光晕 */
  const originalHaloOpacity = haloMat.opacity;

  return {
    scene,
    camera,
    renderer,
    pickables,
    blockers: [walls, baseboards],
    pictures,

    setPicture(id, texture) {
      const picture = pictures.get(id);
      if (!picture) return;
      const material = picture.material as THREE.MeshBasicMaterial;
      const previous = material.map;
      material.map = texture;
      material.needsUpdate = true;
      if (previous && previous !== placeholder) previous.dispose();
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
      if (artHit) return { kind: 'art', id: String(artHit.object.userData.id) };
      const floorHit = raycaster.intersectObject(floor, false)[0];
      if (floorHit) return { kind: 'floor', x: floorHit.point.x, z: floorHit.point.z };
      return null;
    },

    viewpoint(id) {
      const mesh = pickables.find((m) => m.userData.id === id);
      if (!mesh) return null;
      mesh.getWorldQuaternion(quaternion);
      const normal = scratch.set(0, 0, 1).applyQuaternion(quaternion);
      mesh.getWorldPosition(worldPosition);
      return {
        x: worldPosition.x + normal.x * 1.4,
        z: worldPosition.z + normal.z * 1.4,
        yaw: Math.atan2(normal.x, normal.z),
      };
    },

    setHover(id) {
      haloMat.opacity = id ? 0.32 : originalHaloOpacity;
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
      environment.dispose();
      renderer.dispose();
    },
  };
}

/** 浅灰大理石地面，1.5 m 方格拼缝（参考那种带线缝的反射地面） */
function makeTiledMarble(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // 底色 + 噪点
    ctx.fillStyle = '#D8DAE0';
    ctx.fillRect(0, 0, size, size);
    const base = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < base.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      base.data[i] = Math.max(0, Math.min(255, base.data[i] + n));
      base.data[i + 1] = Math.max(0, Math.min(255, base.data[i + 1] + n));
      base.data[i + 2] = Math.max(0, Math.min(255, base.data[i + 2] + n + 2));
    }
    ctx.putImageData(base, 0, 0);
    // 拼缝：每 1/4 画一条暗灰线
    ctx.strokeStyle = 'rgba(60,64,70,0.22)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, (i / 4) * size);
      ctx.lineTo(size, (i / 4) * size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo((i / 4) * size, 0);
      ctx.lineTo((i / 4) * size, size);
      ctx.stroke();
    }
    // 缝内更深的阴影
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, (i / 4) * size + 1);
      ctx.lineTo(size, (i / 4) * size + 1);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // 1.5 m 一格 → 48 m 边长需要 32 个 repeat
  tex.repeat.set(32, 32);
  tex.anisotropy = 4;
  return tex;
}

interface FrameParts {
  frame: THREE.Mesh;
  frameMaterial: THREE.MeshStandardMaterial;
  mat: THREE.Mesh;
  picture: THREE.Mesh;
  label: THREE.Mesh;
}

function fitArt(fw: number, fh: number, aspect: number): { w: number; h: number } {
  const long = Math.max(fw, fh);
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}

function surface(kind: SurfaceKind, color: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 26; i += 1) {
      const y = Math.random() * size;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '160,155,148'},0.10)`;
      ctx.lineWidth = 1 + Math.random() * 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 24) {
        ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 4);
      }
      ctx.stroke();
    }
    if (kind === 'marble' || kind === 'travertine') {
      for (let i = 0; i < 500; i += 1) {
        ctx.fillStyle = `rgba(150,140,120,${0.05 + Math.random() * 0.18})`;
        ctx.beginPath();
        ctx.ellipse(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 0.6, 0, 0, Math.PI * 2);
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

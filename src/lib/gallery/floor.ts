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
  setPicture(id: string, texture: THREE.Texture, aspect: number | null): void;
  pick(clientX: number, clientY: number): PickResult | null;
  viewpoint(id: string): { x: number; z: number; yaw: number } | null;
  setHover(id: string | null): void;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

const MAT_W = 0.06; // 卡纸宽
const FRAME_LIP = 0.025;
const FRAME_DEPTH = 0.04;
const LABEL_W = 0.22; // 墙签宽

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

  // ---- 白墙材质（偏亮一点，靠 PMREM + Hemisphere 把拱面打匀）----
  const white = track(
    new THREE.MeshStandardMaterial({
      color: '#F0F0F0',
      roughness: 0.62,
      metalness: 0,
      envMapIntensity: 0.9,
    }),
  );
  const ceilingMat = track(
    new THREE.MeshStandardMaterial({
      color: '#F8F8F8',
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.7,
    }),
  );
  const floorMat = track(
    new THREE.MeshStandardMaterial({
      color: '#D6D6D6',
      roughness: 0.16,
      metalness: 0.0,
      envMapIntensity: 1.6,
    }),
  );
  const baseboardMat = track(
    new THREE.MeshStandardMaterial({ color: '#9A9A9A', roughness: 0.55 }),
  );

  // 形制不同 → 不同的画框与卡纸颜色
  const styleIds = [...new Set(plan.spaces.map((space) => space.styleId))];
  const frameMaterials = new Map<HallStyleId, THREE.MeshStandardMaterial>();
  const matMaterials = new Map<HallStyleId, THREE.MeshStandardMaterial>();
  for (const id of styleIds) {
    const style = hallStyle(id);
    frameMaterials.set(
      id,
      track(
        new THREE.MeshStandardMaterial({
          color: style.colors.frame,
          roughness: 0.42,
          metalness: 0.25,
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
  const frameOf = (id: HallStyleId): THREE.MeshStandardMaterial =>
    frameMaterials.get(id) ?? (frameMaterials.get('kimbell') as THREE.MeshStandardMaterial);
  const matOf = (id: HallStyleId): THREE.MeshStandardMaterial =>
    matMaterials.get(id) ?? (matMaterials.get('kimbell') as THREE.MeshStandardMaterial);

  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const placeholder = track(placeholderTexture());

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
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.atan2(wall.normal.x, wall.normal.z), 0),
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
    pos.set(cx, 0.06, cz);
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.atan2(wall.normal.x, wall.normal.z), 0),
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
    const space = plan.spaces.find((item) => item.id === placement.spaceId);
    const styleId = space?.styleId ?? 'kimbell';
    const frameMaterial = frameOf(styleId);
    const matMaterial = matOf(styleId);

    const group = new THREE.Group();
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.ry;

    const aspect = placement.fw / placement.fh;
    const art = fitArt(placement.fw, placement.fh, aspect);
    const outer = { w: art.w + MAT_W * 2, h: art.h + MAT_W * 2 };

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

    // 墙签：标题 + 作者，画在纹理上
    const labelMap = track(wallLabelTexture(placement.title, placement.author));
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
    entry.label.scale.set(LABEL_W, LABEL_W / 5, 0.008);
    entry.label.position.set(0, -outerH / 2 - LABEL_W / 10 - 0.05, -FRAME_DEPTH / 2);
  }

  function resizeFrame(id: string, aspect: number): void {
    const entry = parts.get(id);
    const placement = plan.placements.find((item) => item.id === id);
    if (!entry || !placement) return;
    const art = fitArt(placement.fw, placement.fh, aspect);
    applySize(entry, art.w, art.h, art.w + MAT_W * 2, art.h + MAT_W * 2);
  }

  return {
    scene,
    camera,
    renderer,
    pickables,
    blockers: [walls, baseboards],
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

      // 拾取顺序：画 → 墙 → 地面。地面在最末（要走过去）。
      const artHit = raycaster.intersectObjects(pickables, false)[0];
      if (artHit) return { kind: 'art', id: String(artHit.object.userData.id) };
      const floorHit = raycaster.intersectObject(floor, false)[0];
      if (floorHit) return { kind: 'floor', x: floorHit.point.x, z: floorHit.point.z };
      // 打到墙上（含踢脚线）→ 不响应
      return null;
    },

    viewpoint(id) {
      const frame = pickables.find((mesh) => mesh.userData.id === id);
      if (!frame) return null;
      frame.getWorldQuaternion(quaternion);
      const normal = scratch.set(0, 0, 1).applyQuaternion(quaternion);
      frame.getWorldPosition(worldPosition);
      return {
        x: worldPosition.x + normal.x * 1.2,
        z: worldPosition.z + normal.z * 1.2,
        yaw: Math.atan2(normal.x, normal.z),
      };
    },

    setHover(id) {
      for (const [key, entry] of parts) {
        entry.frameMaterial.emissive.setHex(key === id ? 0x303030 : 0x000000);
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
      environment.dispose();
      renderer.dispose();
    },
  };
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

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
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { hallStyle, type HallStyleId, type SurfaceKind } from './styles';
import { environmentTexture, wallLabelTexture } from './surfaces';
import { curvePoints } from './hilbert';
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
  // 雾：参考那种远处轻轻晕开的感觉。浅冷灰，密度别大 —— 走廊只有 2.6 m 宽，
  // 太浓会把近处也糊掉。MeshBasicMaterial 默认吃雾，所以远处的画也会跟着淡。
  scene.fog = new THREE.FogExp2(0xd7dbe0, 0.028);
  scene.background = new THREE.Color('#d7dbe0');
  // near 不能太小：0.05 配 195 的 far 是 ~3900:1 的近远比，深度缓冲精度不够，
  // 接近共面的面会逐帧翻转 → 墙在闪。0.25 的近远比约 800:1，稳定得多。
  // （碰撞系统保证人离墙 ≥ 0.35 m，near=0.25 不会穿帮）
  const camera = new THREE.PerspectiveCamera(70, 1, 0.25, diagonal * 2 + 60);

  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 白墙参考那种带蓝灰调的展墙；平顶压暗（参考是「展墙亮、天花板暗」）----
  // side 必须是 DoubleSide：墙是无厚度的平面，站在隔壁那条走廊看到的是它的
  // 背面 —— 单面材质会被背面剔除，整面墙消失、能看穿到隔壁，一走动就忽隐忽现
  // （之前「墙一直在闪」就是这个）。迷宫的墙两面都得是墙。
  const white = track(
    new THREE.MeshStandardMaterial({
      color: '#E0E4E8',
      roughness: 0.55,
      metalness: 0,
      envMapIntensity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  const ceilingMat = track(
    new THREE.MeshStandardMaterial({
      color: '#7E848B',
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.25,
      side: THREE.DoubleSide,
    }),
  );
  const baseboardMat = track(
    new THREE.MeshStandardMaterial({ color: '#8A8E94', roughness: 0.55 }),
  );
  const placeholder = track(placeholderTexture());

  // 画直接挂：没有外框、没有卡纸（参考的做法）—— 白画布直贴墙面、墙在画
  // 周围被顶光打亮一圈光晕。用两件东西合成：
  //   1) 光晕面：径向渐变（软边，参考那种），additive 混合，比画大一圈
  //   2) 画布面：白底（纹理到达后被替换）
  //
  // 两层的 z 偏移都必须是**正的**（朝走廊一侧）：墙是一张无厚度的平面，
  // 负 z 的层会落到墙平面上跟墙 z-fighting（之前就是这么闪的）。
  const canvasMat = track(
    new THREE.MeshStandardMaterial({
      color: '#F0F0F0',
      roughness: 0.85,
      metalness: 0,
    }),
  );
  const haloMat = track(
    new THREE.MeshBasicMaterial({
      map: track(makeSoftGlow()),
      transparent: true,
      // 别太亮：参考里画周围那圈光是「墙被照亮一点」，不是发光的。
      // 0.75 会把画周边烧成一块白斑，0.3 才对
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  const haloGeo = track(new THREE.PlaneGeometry(1, 1));
  const canvasGeo = track(new THREE.PlaneGeometry(1, 1));

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
  // 踢脚线：**居中在墙面上**（不是偏一侧）。墙是无厚度平面、且双面可见 ——
  // 相邻两条走廊都要看到踢脚，所以让它骑在墙面上、两侧各凸出 2 cm。
  // （之前按「墙有 0.2 m 厚」算偏移 0.12，结果整条踢脚悬在走廊里 10 cm）
  const baseGeo = track(new THREE.BoxGeometry(1, 0.14, 0.04));
  const baseboards = new THREE.InstancedMesh(baseGeo, baseboardMat, plan.walls.length);
  for (let i = 0; i < plan.walls.length; i += 1) {
    const wall = plan.walls[i];
    const cx = (wall.a.x + wall.b.x) / 2;
    const cz = (wall.a.z + wall.b.z) / 2;
    pos.set(cx, 0.07, cz);
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.atan2(wall.normal.x, wall.normal.z), 0),
    );
    baseboards.setMatrixAt(i, matrix.compose(pos, rotation, scale.set(wall.length, 1, 1)));
  }
  baseboards.instanceMatrix.needsUpdate = true;
  baseboards.userData.isWall = true;
  scene.add(baseboards);

  // ---- 地面：Reflector 真反射（参考那种「画在地上能看见倒影」）----
  // Reflector 会用镜像相机把场景再渲一遍 —— 一帧渲两次，所以贴图别开太大
  // （512² 够用），地面也只此一处用它。
  const plateGeo = new THREE.PlaneGeometry(spanX, spanZ);
  const mirror = new Reflector(plateGeo, {
    clipBias: 0.003,
    textureWidth: 512,
    textureHeight: 512,
    color: 0xc6cad0, // 反射色调：越暗反射越弱，抛光石材不是完美镜子
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.set((plan.bounds.x1 + plan.bounds.x2) / 2, 0, (plan.bounds.z1 + plan.bounds.z2) / 2);
  mirror.userData.isFloor = true;
  scene.add(mirror);
  disposables.push(plateGeo, mirror);

  // 砖缝盖在反射上：透明底 + 暗缝线，只有缝挡住反射，其余透出倒影 ——
  // 这就是抛光大理石拼砖的观感
  const groutMat = track(
    new THREE.MeshBasicMaterial({
      map: track(makeTileGrouts()),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const groutGeo = track(new THREE.PlaneGeometry(spanX, spanZ));
  const grout = new THREE.Mesh(groutGeo, groutMat);
  grout.rotation.x = -Math.PI / 2;
  // 离镜面 1 cm：太近会 z-fighting（尤其在贴近地面的掠射角上）
  grout.position.set((plan.bounds.x1 + plan.bounds.x2) / 2, 0.01, (plan.bounds.z1 + plan.bounds.z2) / 2);
  scene.add(grout);

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

  // ---- 天花板的两样东西（之前只有一整块平板，太空）----
  // 1) 吊顶分缝：跟地面同一套砖缝画法，让天花板能看出是一块块板材铺的
  const ceilGroutMat = track(
    new THREE.MeshBasicMaterial({
      map: track(makeTileGrouts()),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const ceilGroutGeo = track(new THREE.PlaneGeometry(spanX, spanZ));
  const ceilGrout = new THREE.Mesh(ceilGroutGeo, ceilGroutMat);
  ceilGrout.rotation.x = Math.PI / 2; // 朝下
  ceilGrout.position.set(
    (plan.bounds.x1 + plan.bounds.x2) / 2,
    wallHeight - 0.012,
    (plan.bounds.z1 + plan.bounds.z2) / 2,
  );
  scene.add(ceilGrout);

  // 2) 嵌入式灯带：顺走廊每隔一段一条，装在天花板上。
  //    既是装饰（天花板不再是一整块），也把「顶光从哪来」交代清楚。
  const curve = curvePoints();
  const trofferSpots: { x: number; z: number; yaw: number; length: number }[] = [];
  for (let i = 0; i < curve.length - 1; i += 2) {
    const a = curve[i];
    const b = curve[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    trofferSpots.push({
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      yaw: Math.atan2(dx, dz),
      // 灯带比段短一点，段与段之间留出「暗格」，节奏更好看
      length: length * 0.72,
    });
  }
  if (trofferSpots.length > 0) {
    const trofferMat = track(
      new THREE.MeshBasicMaterial({
        color: '#FFF8EA',
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    const trofferGeo = track(new THREE.PlaneGeometry(1, 1));
    const troffers = new THREE.InstancedMesh(trofferGeo, trofferMat, trofferSpots.length);
    // 先把平面放平朝下（绕 X 转 +90° 让法线朝 −Y），再绕世界 Y 转到段的方向。
    // 四元数要按「先 flat 后 yaw」的顺序乘，直接用 Euler(π/2, yaw, 0) 会转歪。
    const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    for (let i = 0; i < trofferSpots.length; i += 1) {
      const spot = trofferSpots[i];
      pos.set(spot.x, wallHeight - 0.05, spot.z);
      const rotation = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(0, spot.yaw, 0))
        .multiply(flatQuat);
      troffers.setMatrixAt(i, matrix.compose(pos, rotation, scale.set(0.34, spot.length, 1)));
    }
    troffers.instanceMatrix.needsUpdate = true;
    scene.add(troffers);
    disposables.push(troffers);
  }

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

    // 层间距别太小：0.004 m 在几米外深度精度不够，会跟墙 z-fighting
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.z = 0.02;
    halo.scale.set(art.w * 2.3, art.h * 2.3, 1);
    group.add(halo);

    // 2) 画布：白底（纹理到达后被替换）。
    //    参考里画**没有任何外框** —— 之前那圈 1.5 cm 暗边是画蛇添足，
    //    而且冷深灰压在冷灰蓝墙 + 暖白光晕上，三种色调打架。现在只留
    //    光晕把画布从墙里托出来，画布本身不带边框。
    //    不带 fog:false —— 远处也要跟着雾淡下去
    const picture = new THREE.Mesh(
      canvasGeo,
      new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false }),
    );
    picture.userData.id = placement.id;
    picture.position.z = 0.05;
    group.add(picture);

    // 3) 标签（标题 + 作者）—— 画在纹理上、贴在画下面
    const labelMap = track(wallLabelTexture(placement.title, placement.author));
    const labelMaterialForArt = track(
      new THREE.MeshBasicMaterial({ map: labelMap, transparent: true, toneMapped: false }),
    );
    const labelGeo = track(new THREE.PlaneGeometry(1, 1));
    const label = new THREE.Mesh(labelGeo, labelMaterialForArt);
    label.position.set(0, -art.h / 2 - 0.07, 0.05);
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
      const floorHit = raycaster.intersectObject(mirror, false)[0];
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

/**
 * 砖缝贴图：**透明底 + 暗缝线**，盖在 Reflector 上用。
 * 只有缝那一线会挡住反射，缝与缝之间透出倒影 —— 抛光大理石拼砖的观感。
 * （之前那版是不透明的大理石底 + 线，地面就没有倒影了）
 */
function makeTileGrouts(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    // 缝：1.5 m 一格（贴图 repeat 与地面尺寸对齐，见下方 repeat）
    ctx.strokeStyle = 'rgba(46,50,56,0.85)';
    ctx.lineWidth = 3;
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
    // 缝边高光：石材拼缝边上会亮一点
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, (i / 4) * size - 3);
      ctx.lineTo(size, (i / 4) * size - 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo((i / 4) * size - 3, 0);
      ctx.lineTo((i / 4) * size - 3, size);
      ctx.stroke();
    }
    // 交叉处压深一点，格子才有「块」的感觉
    ctx.fillStyle = 'rgba(40,44,50,0.75)';
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        ctx.fillRect((i / 4) * size - 2, (j / 4) * size - 2, 4, 4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // 1.5 m 一格：48 m 的地面 → 32 个 repeat
  tex.repeat.set(32, 32);
  tex.anisotropy = 4;
  return tex;
}

/** 画的软光晕：中心亮的径向渐变（参考那种「画周围一圈光」，软边） */
function makeSoftGlow(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // 中心别压满：0.95 会在画正后方堆出一块死白，0.5 才是「墙被照亮一点」
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

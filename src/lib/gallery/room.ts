/**
 * 3D 房间：three.js 场景的搭建与拾取。
 *
 * 只在 mountGallery 确认设备能跑 WebGL 之后才被动态 import —— 不支持的设备
 * 连这个 chunk 都不会下载。交互与 DOM 逻辑在 index.ts，这里只管「房间长什么样」。
 *
 * 观感上的几条取舍：
 * - 建筑面（墙/地/顶/踢脚/画框）用 Standard 材质吃光，画心用 Basic 材质且关掉
 *   色调映射 —— 展品的亮度不该被房间灯光吃掉，这样画永远是房间里最亮的。
 * - 墙面/地面用画布现画一张程序化纹理（细颗粒 + 大块晕染），大片纯色在
 *   透视里会发平，有了纹理才有材质感。
 * - 洗墙光、灯罩是纯贴图/自发光，不额外点灯：灯越多 shader 越贵，而这些
 *   效果本来就是「看起来亮」，不需要真的参与光照计算。
 */
import * as THREE from 'three';
import { ROOM_HEIGHT, wallPoint, type Placement, type RoomLayout } from './layout';

export interface RoomColors {
  wall: string;
  floor: string;
  light: string;
}

export interface CreateRoomOptions {
  canvas: HTMLCanvasElement;
  layout: RoomLayout;
  colors: RoomColors;
}

/** 射线拾取的结果：点到了画，或者点到了地面 */
export type PickResult =
  | { kind: 'art'; id: string }
  | { kind: 'floor'; x: number; z: number };

export interface RoomHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** 画框（拾取目标），userData.id 是展品 id */
  pickables: THREE.Object3D[];
  /** 地面（点地走过去） */
  floor: THREE.Object3D;
  /** 画心网格，按 id 换纹理 */
  pictures: Map<string, THREE.Mesh>;
  /** 换图：先上缩略图，原图到了再替换，并按真实比例校正画框 */
  setPicture(id: string, texture: THREE.Texture, aspect: number | null): void;
  /** 屏幕坐标拾取；没打中返回 null */
  pick(clientX: number, clientY: number): PickResult | null;
  /** 站到某件作品正前方 1.5m 的位置（世界坐标 x/z），由调用方夹回房间内 */
  viewpoint(id: string): { x: number; z: number } | null;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

/** 每面墙的朝向：画框默认面向 +z，转到贴墙且朝内 */
const WALL_ROTATION: Record<Placement['wall'], number> = {
  n: 0,
  e: -Math.PI / 2,
  s: Math.PI,
  w: Math.PI / 2,
};

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
const BASEBOARD_H = 0.1;
/** 墙顶的檐口（灯槽的实体部分） */
const CORNICE_H = 0.055;

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
export function loadTexture(url: string): Promise<{ texture: THREE.Texture; aspect: number | null }> {
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

/**
 * 现画一张纹理。房间只有几张小图，比打包贴图省事，也不会多一次网络请求。
 * 纹理都以白为底（只带明暗细节），房间配色仍由材质的 color 决定 ——
 * 否则贴图颜色会和材质颜色相乘，墙/地会暗掉一截。
 */
function paint(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** 撒一层 1px 的噪点：破掉大色块的渐变色带 */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  const dots = Math.floor((w * h) / 42);
  for (let i = 0; i < dots; i += 1) {
    const light = Math.random() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

/** 墙面：上亮下暗的一点渐变 + 细颗粒，平涂会显得像纸盒子 */
function wallTexture(): THREE.CanvasTexture {
  return paint(128, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#e4e4e4');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.03);
  });
}

/** 地面：抛光水磨石——大块的深浅晕染 + 细骨料颗粒 */
function floorTexture(): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i += 1) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 18 + Math.random() * 54;
      const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tint = Math.random() > 0.5 ? '255,255,255' : '0,0,0';
      blob.addColorStop(0, `rgba(${tint},0.07)`);
      blob.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = blob;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    grain(ctx, w, h, 0.05);
  });
}

/** 洗墙光 / 画框投影共用的径向渐变（一个亮心，一个暗心） */
function radialTexture(rgb: string): THREE.CanvasTexture {
  return paint(128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, `rgba(${rgb},0.95)`);
    gradient.addColorStop(0.45, `rgba(${rgb},0.42)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

/** 灯槽往下洒在墙上的光：顶边最亮，往下淡出 */
function coveTexture(): THREE.CanvasTexture {
  return paint(8, 128, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.34)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

/** 一件作品的全部零件；换图时按真实比例一起缩放 */
interface FrameParts {
  frame: THREE.Mesh;
  mat: THREE.Mesh;
  picture: THREE.Mesh;
  wash: THREE.Mesh;
  shadow: THREE.Mesh;
  label: THREE.Mesh;
  /** 标签挂哪边：靠墙心那侧，免得探出墙角 */
  side: number;
}

export function createRoom({ canvas, layout, colors }: CreateRoomOptions): RoomHandle {
  const { side, placements } = layout;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 电影感的色调映射：灯泡与洗墙光不再直接烧成一片死白
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const wallColor = new THREE.Color(colors.wall);
  const floorColor = new THREE.Color(colors.floor);
  const lightColor = new THREE.Color(colors.light);

  // 背景比墙色再暗一档：房间开口（画框背面、天花板方向）看着像阴影
  const background = wallColor.clone().multiplyScalar(0.85);
  const scene = new THREE.Scene();
  scene.background = background;
  // 一点雾：远处的墙稍微退后，房间显得更深
  scene.fog = new THREE.Fog(background, side * 0.7, side * 2.4);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, side * 4);
  camera.position.set(0, 1.6, side / 2 - 1.1);

  // 所有要回收的东西统一登记，dispose 时一次性走完
  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 房间外壳 ----
  const floorMap = track(floorTexture());
  floorMap.repeat.set(side / 2, side / 2);
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(side, side)),
    track(
      new THREE.MeshStandardMaterial({
        color: floorColor,
        map: floorMap,
        roughness: 0.55,
        metalness: 0.06,
      }),
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.userData.isFloor = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    track(new THREE.PlaneGeometry(side, side)),
    track(
      new THREE.MeshStandardMaterial({
        color: wallColor.clone().multiplyScalar(1.12),
        roughness: 0.95,
      }),
    ),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_HEIGHT;
  scene.add(ceiling);

  const wallMap = track(wallTexture());
  wallMap.repeat.set(side / 2.5, ROOM_HEIGHT / 2.5);
  const wallMaterial = track(
    new THREE.MeshStandardMaterial({ color: wallColor, map: wallMap, roughness: 0.92 }),
  );
  const wallGeometry = track(new THREE.PlaneGeometry(side, ROOM_HEIGHT));

  /** 四面墙：位置 + 朝向。踢脚线、檐口、灯槽都照这张表摆一遍 */
  const wallList: { key: Placement['wall']; x: number; z: number; ry: number }[] = [
    { key: 'n', x: 0, z: -side / 2, ry: 0 },
    { key: 's', x: 0, z: side / 2, ry: Math.PI },
    { key: 'e', x: side / 2, z: 0, ry: -Math.PI / 2 },
    { key: 'w', x: -side / 2, z: 0, ry: Math.PI / 2 },
  ];

  const trimMaterial = track(
    new THREE.MeshStandardMaterial({
      color: floorColor.clone().multiplyScalar(0.42),
      roughness: 0.5,
      metalness: 0.1,
    }),
  );
  const corniceMaterial = track(
    new THREE.MeshStandardMaterial({ color: wallColor.clone().multiplyScalar(0.9), roughness: 0.8 }),
  );
  const coveMaterial = track(
    new THREE.MeshBasicMaterial({
      map: track(coveTexture()),
      color: lightColor,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));

  for (const { x, z, ry } of wallList) {
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(x, ROOM_HEIGHT / 2, z);
    wall.rotation.y = ry;
    scene.add(wall);

    // 墙面朝向房间中心的法线：踢脚、檐口都往里让一点，别啃进墙里
    const inward = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));

    const baseboard = new THREE.Mesh(unitBox, trimMaterial);
    baseboard.position.set(x + inward.x * 0.014, BASEBOARD_H / 2, z + inward.z * 0.014);
    baseboard.rotation.y = ry;
    baseboard.scale.set(side, BASEBOARD_H, 0.028);
    scene.add(baseboard);

    const cornice = new THREE.Mesh(unitBox, corniceMaterial);
    cornice.position.set(
      x + inward.x * 0.026,
      ROOM_HEIGHT - CORNICE_H / 2,
      z + inward.z * 0.026,
    );
    cornice.rotation.y = ry;
    cornice.scale.set(side, CORNICE_H, 0.05);
    scene.add(cornice);

    // 灯槽洒下来的光：贴在墙上的一片渐变，上亮下淡
    const cove = new THREE.Mesh(unitPlane, coveMaterial);
    cove.position.set(
      x + inward.x * 0.02,
      ROOM_HEIGHT - CORNICE_H - 0.36,
      z + inward.z * 0.02,
    );
    cove.rotation.y = ry;
    cove.scale.set(side, 0.72, 1);
    scene.add(cove);
  }

  // ---- 地面镶边：一圈细细的金属线，把地面收个口 ----
  const inlayMaterial = track(
    new THREE.MeshStandardMaterial({
      color: lightColor.clone().multiplyScalar(0.78),
      roughness: 0.32,
      metalness: 0.35,
    }),
  );
  const inlayOffset = side / 2 - 0.55;
  for (const [ix, iz, sx, sz] of [
    [0, -inlayOffset, side - 1.1, 0.026],
    [0, inlayOffset, side - 1.1, 0.026],
    [-inlayOffset, 0, 0.026, side - 1.1],
    [inlayOffset, 0, 0.026, side - 1.1],
  ] as [number, number, number, number][]) {
    const inlay = new THREE.Mesh(unitBox, inlayMaterial);
    inlay.position.set(ix, 0.004, iz);
    inlay.scale.set(sx, 0.006, sz);
    scene.add(inlay);
  }

  // ---- 灯光 ----
  // 环境 + 半球光打底（地面色反弹上来一点），两盏吊灯定房间氛围
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  scene.add(new THREE.HemisphereLight(lightColor.getHex(), floorColor.getHex(), 0.65));

  const shadeMaterial = track(
    new THREE.MeshStandardMaterial({
      color: '#2b2e34',
      roughness: 0.38,
      metalness: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  const rodMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#3a3e45', roughness: 0.35, metalness: 0.6 }),
  );
  const glowMaterial = track(
    new THREE.MeshBasicMaterial({ color: lightColor, fog: false, toneMapped: false }),
  );
  const rodGeometry = track(new THREE.CylinderGeometry(0.008, 0.008, 1, 6));
  const shadeGeometry = track(new THREE.CylinderGeometry(0.13, 0.16, 0.18, 24, 1, true));
  const discGeometry = track(new THREE.CircleGeometry(1, 24));

  for (const z of [-side * 0.22, side * 0.22]) {
    const lampY = ROOM_HEIGHT - 0.5;

    const rod = new THREE.Mesh(rodGeometry, rodMaterial);
    rod.position.set(0, (ROOM_HEIGHT + lampY) / 2, z);
    rod.scale.y = ROOM_HEIGHT - lampY;
    scene.add(rod);

    const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
    shade.position.set(0, lampY, z);
    scene.add(shade);

    // 灯罩口那片亮：不用点光源也知道灯是开着的
    const disc = new THREE.Mesh(discGeometry, glowMaterial);
    disc.position.set(0, lampY - 0.088, z);
    disc.rotation.x = Math.PI / 2;
    disc.scale.setScalar(0.154);
    scene.add(disc);

    const lamp = new THREE.PointLight(lightColor, 18, 0, 1.6);
    lamp.position.set(0, lampY - 0.1, z);
    scene.add(lamp);
  }

  // 房间正中吊一圈发光环：往上看时有个视觉中心
  const ringGeometry = track(new THREE.TorusGeometry(0.52, 0.017, 8, 56));
  const ring = new THREE.Mesh(ringGeometry, glowMaterial);
  ring.position.set(0, ROOM_HEIGHT - 0.78, 0);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  // 三根吊筋从天花板垂到环上
  for (const [rx, rz] of [
    [0, 0.52],
    [0.45, -0.26],
    [-0.45, -0.26],
  ]) {
    const wire = new THREE.Mesh(rodGeometry, rodMaterial);
    wire.position.set(rx, ROOM_HEIGHT - 0.39, rz);
    wire.scale.y = 0.78;
    scene.add(wire);
  }

  // ---- 画 ----
  const frameMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#1f2329', roughness: 0.42, metalness: 0.28 }),
  );
  const matMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#efece4', roughness: 0.9 }),
  );
  const labelMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#e6e2d9', roughness: 0.7 }),
  );
  const washMaterial = track(
    new THREE.MeshBasicMaterial({
      map: track(radialTexture('255,255,255')),
      color: lightColor,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      map: track(radialTexture('0,0,0')),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const placeholder = track(placeholderTexture());
  const pictures = new Map<string, THREE.Mesh>();
  const parts = new Map<string, FrameParts>();
  const pickables: THREE.Object3D[] = [];

  for (const placement of placements) {
    const group = new THREE.Group();
    const point = wallPoint(placement, side);
    group.position.set(point.x, point.y, point.z);
    group.rotation.y = WALL_ROTATION[placement.wall];

    const art = fitArt(placement.fw, placement.fh, placement.fw / placement.fh);
    const outer = { w: art.w + MAT_WIDTH * 2, h: art.h + MAT_WIDTH * 2 };

    // 洗墙光：画框背后的墙上晕开一片，画就像被单独打了光
    const wash = new THREE.Mesh(unitPlane, washMaterial);
    wash.position.z = -0.042;
    group.add(wash);

    // 画框在墙上的投影：稍微往下偏一点，画就「挂」在墙上了
    const shadow = new THREE.Mesh(unitPlane, shadowMaterial);
    shadow.position.set(0.035, -0.045, -0.05);
    group.add(shadow);

    // 画框：卡纸四周再压一圈木条
    const frame = new THREE.Mesh(unitBox, frameMaterial);
    frame.userData.id = placement.id;
    group.add(frame);

    // 卡纸（留白），画心贴在它上面
    const mat = new THREE.Mesh(unitPlane, matMaterial);
    mat.position.z = FRAME_DEPTH / 2 + 0.001;
    group.add(mat);

    // 画心：Basic 材质 + 关色调映射，保证展品是房间里最亮的东西
    const picture = new THREE.Mesh(
      unitPlane,
      new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false, fog: false }),
    );
    picture.position.z = FRAME_DEPTH / 2 + 0.003;
    group.add(picture);

    // 墙上的作品标签：朝墙心那侧挂，免得探出墙角。z 收到贴近墙的位置，
    // 不然标签会浮在半空
    const label = new THREE.Mesh(unitBox, labelMaterial);
    label.scale.set(0.14, 0.09, 0.008);
    label.position.z = -0.05;
    group.add(label);

    const entry: FrameParts = {
      frame,
      mat,
      picture,
      wash,
      shadow,
      label,
      side: placement.u > 0.5 ? -1 : 1,
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
    // 标签贴着画框右下（左下）角，与画框底边齐平
    entry.label.position.x = entry.side * (outerW / 2 + 0.13);
    entry.label.position.y = -outerH / 2 + 0.07;
  }

  /** 长边不变，只按真实比例重排宽高：卡纸、画框、洗墙光都跟着画心走 */
  function resizeFrame(id: string, aspect: number): void {
    const entry = parts.get(id);
    const placement = placements.find((p) => p.id === id);
    if (!entry || !placement) return;

    const art = fitArt(placement.fw, placement.fh, aspect);
    applySize(entry, art.w, art.h, art.w + MAT_WIDTH * 2, art.h + MAT_WIDTH * 2);
  }

  return {
    scene,
    camera,
    renderer,
    pickables,
    floor,
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

      const onArt = raycaster.intersectObjects(pickables, false)[0];
      if (onArt) return { kind: 'art', id: String(onArt.object.userData.id) };

      const onFloor = raycaster.intersectObject(floor, false)[0];
      if (onFloor) return { kind: 'floor', x: onFloor.point.x, z: onFloor.point.z };

      return null;
    },

    viewpoint(id) {
      const frame = pickables.find((mesh) => mesh.userData.id === id);
      if (!frame) return null;
      // 画框正面朝向是本地 +z，转到世界坐标后往前 1.5m 就是站位
      frame.getWorldQuaternion(quaternion);
      const normal = scratch.set(0, 0, 1).applyQuaternion(quaternion);
      frame.getWorldPosition(worldPosition);
      return {
        x: worldPosition.x + normal.x * 1.5,
        z: worldPosition.z + normal.z * 1.5,
      };
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

/** 按比例求画心尺寸：长边保持不变，短边跟着比例缩 */
function fitArt(fw: number, fh: number, aspect: number): { w: number; h: number } {
  const long = Math.max(fw, fh);
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}

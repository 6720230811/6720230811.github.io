/**
 * 3D 展厅：three.js 场景的搭建与拾取。
 *
 * 只在 mountGallery 确认设备能跑 WebGL 之后才被动态 import —— 不支持的设备
 * 连这个 chunk 都不会下载。交互与 DOM 逻辑在 index.ts，这里只管「展厅长什么样」。
 *
 * 观感上的几条取舍：
 * - 建筑面（墙/地/顶/踢脚/画框）用 Standard 材质吃光，画心用 Basic 材质且关掉
 *   色调映射 —— 展品的亮度不该被房间灯光吃掉，这样画永远是展厅里最亮的。
 * - 墙面/地面用画布现画一张程序化纹理（细颗粒 + 大块晕染），大片纯色在
 *   透视里会发平，有了纹理才有材质感。
 * - 洗墙光、灯罩是纯贴图/自发光，不额外点灯：灯越多 shader 越贵，而这些
 *   效果本来就是「看起来亮」，不需要真的参与光照计算。
 * - 墙是「两片背靠背」拼的（每片属于一个空间），所以门洞两侧可以是两种颜色
 *   两种层高：走廊压低到 2.6m，穿过矮门洞进到 3.2m 的高展厅，空间才有节奏。
 */
import * as THREE from 'three';
import {
  CORRIDOR_HEIGHT,
  CORRIDOR_ID,
  ROOM_HEIGHT,
  type FloorPlan,
  type SpaceSpec,
  type WallFace,
} from './plan';

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
  /** 站到某件作品正前方 1.5m 的位置（世界坐标 x/z），由调用方夹回可行走区 */
  viewpoint(id: string): { x: number; z: number } | null;
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
const BASEBOARD_H = 0.1;
/** 墙顶的檐口（灯槽的实体部分） */
const CORNICE_H = 0.055;
/** 一片墙的厚度（两片背靠背拼成一整堵墙） */
const PANEL_T = 0.07;
/** 门洞宽度，与 plan.ts 的 DOOR_W 一致（门高由 plan 直接给到墙的 door 上） */
const DOOR_W = 1.8;

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

/** 现画一张纹理。展厅只有几张小图，比打包贴图省事，也不会多一次网络请求 */
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

/**
 * 墙面细节贴图。以白为底（只带明暗细节），真正的颜色由材质的 color 决定 ——
 * 否则贴图颜色会和材质颜色相乘，墙/地会暗掉一截。
 */
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

/**
 * 门旁的房间名牌 / 走廊尽头的策展名牌。
 * 文字直接画进贴图：3D 里放文字网格要么糊要么贵，一块小牌子最省事。
 */
function labelTexture(text: string): THREE.CanvasTexture {
  return paint(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#efece4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(35,38,43,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    // 字多了就缩，别溢出牌子
    let size = 64;
    ctx.fillStyle = '#23262b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    do {
      ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      if (ctx.measureText(text).width <= w - 56) break;
      size -= 4;
    } while (size > 20);
    ctx.fillText(text, w / 2, h / 2 + 2);
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
}

/** 一个空间（房间或走廊）自己的一套材质 */
interface SpaceMats {
  wall: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  cornice: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  /** 檐口灯槽洒在墙上的光 */
  cove: THREE.MeshBasicMaterial;
  /** 画背后的洗墙光 */
  wash: THREE.MeshBasicMaterial;
  /** 灯罩亮盘、走廊灯带这类自发光面 */
  glow: THREE.MeshBasicMaterial;
  light: THREE.Color;
}

/** 一片墙的朝向转成绕 y 的旋转：画框/光晕的正面默认朝 +z */
function facingRotation(axis: WallFace['axis'], normal: 1 | -1): number {
  if (axis === 'x') return normal === 1 ? 0 : Math.PI;
  return normal === 1 ? Math.PI / 2 : -Math.PI / 2;
}

export function createFloor({ canvas, plan }: CreateFloorOptions): FloorHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 电影感的色调映射：灯泡与洗墙光不再直接烧成一片死白
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const diagonal = Math.hypot(spanX, spanZ);

  // 背景用走廊的墙色再暗一档：万一哪里漏出去，看着也像阴影
  const corridorColors =
    plan.spaces.find((space) => space.id === CORRIDOR_ID)?.colors ??
    plan.spaces[0].colors;
  const background = new THREE.Color(corridorColors.wall).multiplyScalar(0.8);
  const scene = new THREE.Scene();
  scene.background = background;
  // 一点雾：远处稍微退后，展厅显得更深
  scene.fog = new THREE.Fog(background, diagonal * 0.4, diagonal * 1.4);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, diagonal * 2 + 6);

  // 所有要回收的东西统一登记，dispose 时一次性走完
  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 全展厅共用的一份贴图与单位几何 ----
  const wallDetail = track(wallTexture());
  wallDetail.repeat.set(3, 1.3);
  const floorDetail = track(floorTexture());
  const coveMap = track(coveTexture());
  const glowMap = track(radialTexture('255,255,255'));
  const shadowMap = track(radialTexture('0,0,0'));
  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));

  const frameMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#1f2329', roughness: 0.42, metalness: 0.28 }),
  );
  const matMaterial = track(new THREE.MeshStandardMaterial({ color: '#efece4', roughness: 0.9 }));
  const labelMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#e6e2d9', roughness: 0.7 }),
  );
  // 画框在墙上的投影：全展厅一个色（就是一片暗），不用按空间分
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      map: shadowMap,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const placeholder = track(placeholderTexture());

  const pickables: THREE.Object3D[] = [];
  const blockers: THREE.Object3D[] = [];
  const floors: THREE.Object3D[] = [];
  const pictures = new Map<string, THREE.Mesh>();
  const parts = new Map<string, FrameParts>();

  /** 每个空间一套材质：墙/地/顶/踢脚/檐口各有自己的颜色 */
  function materialsFor(space: SpaceSpec): SpaceMats {
    const wall = new THREE.Color(space.colors.wall);
    const floor = new THREE.Color(space.colors.floor);
    const light = new THREE.Color(space.colors.light);
    return {
      wall: track(
        new THREE.MeshStandardMaterial({ color: wall, map: wallDetail, roughness: 0.92 }),
      ),
      trim: track(
        new THREE.MeshStandardMaterial({
          color: floor.clone().multiplyScalar(0.42),
          roughness: 0.5,
          metalness: 0.1,
        }),
      ),
      cornice: track(
        new THREE.MeshStandardMaterial({ color: wall.clone().multiplyScalar(0.9), roughness: 0.8 }),
      ),
      ceiling: track(
        new THREE.MeshStandardMaterial({ color: wall.clone().multiplyScalar(1.12), roughness: 0.95 }),
      ),
      floor: track(new THREE.MeshStandardMaterial({ color: floor, roughness: 0.55, metalness: 0.06 })),
      cove: track(
        new THREE.MeshBasicMaterial({
          map: coveMap,
          color: light,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
          toneMapped: false,
        }),
      ),
      // 画背后的洗墙光跟着这间房的灯光色走：暖光房和冷光房看得出差别
      wash: track(
        new THREE.MeshBasicMaterial({
          map: glowMap,
          color: light,
          transparent: true,
          opacity: 0.34,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
          toneMapped: false,
        }),
      ),
      glow: track(new THREE.MeshBasicMaterial({ color: light, fog: false, toneMapped: false })),
      light,
    };
  }

  const spaceMats = new Map<string, SpaceMats>();
  for (const space of plan.spaces) spaceMats.set(space.id, materialsFor(space));

  // ---- 地面与天花板 ----
  for (const space of plan.spaces) {
    const mats = spaceMats.get(space.id) as SpaceMats;
    const width = space.rect.x2 - space.rect.x1;
    const depth = space.rect.z2 - space.rect.z1;
    const cx = (space.rect.x1 + space.rect.x2) / 2;
    const cz = (space.rect.z1 + space.rect.z2) / 2;

    // 地面贴图按空间大小重复，免得小房间和大房间的骨料差一截
    const floorMap = track(floorDetail.clone());
    floorMap.repeat.set(width / 2, depth / 2);
    floorMap.needsUpdate = true;
    mats.floor.map = floorMap;

    const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(width, depth)), mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.userData.isFloor = true;
    scene.add(floor);
    floors.push(floor);

    const ceiling = new THREE.Mesh(
      track(new THREE.PlaneGeometry(width, depth)),
      mats.ceiling,
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, space.height, cz);
    scene.add(ceiling);
  }

  // ---- 墙 ----
  /** 在墙上贴一块板（墙面 / 门楣）：沿墙方向 [a,b]，竖直方向 [y0,y1] */
  function addPanel(face: WallFace, a: number, b: number, y0: number, y1: number): THREE.Mesh {
    const length = b - a;
    const height = y1 - y0;
    const along = (a + b) / 2;
    const offset = PANEL_T / 2;
    const mesh = new THREE.Mesh(unitBox, matsOf(face.spaceId).wall);
    if (face.axis === 'x') {
      mesh.position.set(along, (y0 + y1) / 2, face.at + face.normal * offset);
      mesh.scale.set(length, height, PANEL_T);
    } else {
      mesh.position.set(face.at + face.normal * offset, (y0 + y1) / 2, along);
      mesh.scale.set(PANEL_T, height, length);
    }
    mesh.userData.isWall = true;
    scene.add(mesh);
    blockers.push(mesh);
    return mesh;
  }

  /** 踢脚线 / 檐口：贴着墙面的一条细板 */
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

  /** 檐口下洒在墙上的一片光 */
  function addCove(face: WallFace, a: number, b: number): void {
    const mats = matsOf(face.spaceId);
    const mesh = new THREE.Mesh(unitPlane, mats.cove);
    const along = (a + b) / 2;
    if (face.axis === 'x') {
      mesh.position.set(along, face.height - CORNICE_H - 0.36, face.at + face.normal * (PANEL_T + 0.02));
    } else {
      mesh.position.set(face.at + face.normal * (PANEL_T + 0.02), face.height - CORNICE_H - 0.36, along);
    }
    mesh.rotation.y = facingRotation(face.axis, face.normal);
    mesh.scale.set(b - a, 0.72, 1);
    scene.add(mesh);
  }

  /** 一片墙 / 一间房自己的那套材质 */
  function matsOf(spaceId: string): SpaceMats {
    return spaceMats.get(spaceId) ?? (spaceMats.values().next().value as SpaceMats);
  }

  for (const face of plan.walls) {
    const mats = matsOf(face.spaceId);
    // 门洞把墙切成左右两段，门楣单独补一块
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
    // 踢脚线遇到门洞就断开（门口没有踢脚线）
    for (const [a, b] of solid) {
      addTrim(face, a, b, BASEBOARD_H, 0.028, BASEBOARD_H / 2, mats.trim);
    }
    addTrim(face, face.a, face.b, CORNICE_H, 0.05, face.height - CORNICE_H / 2, mats.cornice);
    // 洗墙光同理：门洞上方是空的，别糊一片光在门口
    for (const [a, b] of solid) addCove(face, a, b);
  }

  // ---- 门旁的房间名牌 ----
  for (const door of plan.doors) {
    const space = plan.spaces.find((item) => item.id === door.spaceId);
    if (!space) continue;
    // 门开在房间的哪一侧走廊墙：z 为负是北侧房间，牌子朝 +z
    const normal: 1 | -1 = door.z < 0 ? 1 : -1;
    const plaque = new THREE.Mesh(
      unitPlane,
      track(
        new THREE.MeshBasicMaterial({
          map: track(labelTexture(space.label)),
          color: '#d8d8d8',
          fog: false,
          toneMapped: false,
        }),
      ),
    );
    plaque.position.set(
      door.x + DOOR_W / 2 + 0.34,
      1.55,
      door.z + normal * (PANEL_T + 0.02),
    );
    plaque.rotation.y = normal === 1 ? 0 : Math.PI;
    plaque.scale.set(0.56, 0.14, 1);
    scene.add(plaque);
  }

  // ---- 走廊：灯带 + 尽头的策展名牌 ----
  const corridor = plan.spaces.find((space) => space.id === CORRIDOR_ID);
  if (corridor) {
    const mats = matsOf(CORRIDOR_ID);
    const length = corridor.rect.x2 - corridor.rect.x1;
    const cx = (corridor.rect.x1 + corridor.rect.x2) / 2;

    // 顶上两条灯带（自发光，不点灯）
    for (const z of [-0.55, 0.55]) {
      const strip = new THREE.Mesh(unitPlane, mats.glow);
      strip.position.set(cx, CORRIDOR_HEIGHT - 0.015, z);
      strip.rotation.x = Math.PI / 2;
      strip.scale.set(length - 0.6, 0.1, 1);
      scene.add(strip);
    }

    // 灯带本身只照亮自己，补两盏小灯让走廊两头也不至于太暗
    for (const dx of [-length * 0.26, length * 0.26]) {
      const lamp = new THREE.PointLight(new THREE.Color(corridor.colors.light), 11, 0, 1.7);
      lamp.position.set(cx + dx, CORRIDOR_HEIGHT - 0.25, 0);
      scene.add(lamp);
    }

    // 走廊尽头写策展名
    for (const [x, ry] of [
      [corridor.rect.x1 + PANEL_T + 0.02, Math.PI / 2],
      [corridor.rect.x2 - PANEL_T - 0.02, -Math.PI / 2],
    ] as [number, number][]) {
      const plaque = new THREE.Mesh(
        unitPlane,
        track(
          new THREE.MeshBasicMaterial({
            map: track(labelTexture(corridor.label)),
            color: '#d8d8d8',
            fog: false,
            toneMapped: false,
          }),
        ),
      );
      plaque.position.set(x, 1.7, 0);
      plaque.rotation.y = ry;
      plaque.scale.set(1.1, 0.275, 1);
      scene.add(plaque);
    }
  }

  // ---- 灯光 ----
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const ground = new THREE.Color(corridor?.colors.floor ?? '#1a1d21');
  scene.add(new THREE.HemisphereLight(new THREE.Color(corridorColors.light).getHex(), ground.getHex(), 0.65));

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
  const rodGeometry = track(new THREE.CylinderGeometry(0.008, 0.008, 1, 6));
  const shadeGeometry = track(new THREE.CylinderGeometry(0.13, 0.16, 0.18, 24, 1, true));
  const discGeometry = track(new THREE.CircleGeometry(1, 24));
  const ringGeometry = track(new THREE.TorusGeometry(0.52, 0.017, 8, 56));

  // 每间房两盏吊灯 + 正中一圈发光吊环
  for (const space of plan.spaces) {
    if (space.kind !== 'room') continue;
    const mats = matsOf(space.id);
    const cx = (space.rect.x1 + space.rect.x2) / 2;
    const cz = (space.rect.z1 + space.rect.z2) / 2;
    const side = Math.min(space.rect.x2 - space.rect.x1, space.rect.z2 - space.rect.z1);
    const lampY = ROOM_HEIGHT - 0.5;

    for (const dz of [-side * 0.22, side * 0.22]) {
      const rod = new THREE.Mesh(rodGeometry, rodMaterial);
      rod.position.set(cx, (ROOM_HEIGHT + lampY) / 2, cz + dz);
      rod.scale.y = ROOM_HEIGHT - lampY;
      scene.add(rod);

      const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
      shade.position.set(cx, lampY, cz + dz);
      scene.add(shade);

      // 灯罩口那片亮：不用点光源也知道灯是开着的
      const disc = new THREE.Mesh(discGeometry, mats.glow);
      disc.position.set(cx, lampY - 0.088, cz + dz);
      disc.rotation.x = Math.PI / 2;
      disc.scale.setScalar(0.154);
      scene.add(disc);

      const lamp = new THREE.PointLight(mats.light, 18, 0, 1.6);
      lamp.position.set(cx, lampY - 0.1, cz + dz);
      scene.add(lamp);
    }

    const ring = new THREE.Mesh(ringGeometry, mats.glow);
    ring.position.set(cx, ROOM_HEIGHT - 0.78, cz);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);
    for (const [rx, rz] of [
      [0, 0.52],
      [0.45, -0.26],
      [-0.45, -0.26],
    ]) {
      const wire = new THREE.Mesh(rodGeometry, rodMaterial);
      wire.position.set(cx + rx, ROOM_HEIGHT - 0.39, cz + rz);
      wire.scale.y = 0.78;
      scene.add(wire);
    }
  }

  // ---- 画 ----
  for (const placement of plan.placements) {
    const group = new THREE.Group();
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.ry;

    const art = fitArt(placement.fw, placement.fh, placement.fw / placement.fh);
    const outer = { w: art.w + MAT_WIDTH * 2, h: art.h + MAT_WIDTH * 2 };

    // 洗墙光：画框背后的墙上晕开一片，画就像被单独打了光
    const wash = new THREE.Mesh(unitPlane, matsOf(placement.spaceId).wash);
    wash.position.z = -0.035;
    group.add(wash);

    // 画框在墙上的投影：稍微往下偏一点，画就「挂」在墙上了
    const shadow = new THREE.Mesh(unitPlane, shadowMaterial);
    shadow.position.set(0.035, -0.045, -0.045);
    group.add(shadow);

    // 画框：卡纸四周再压一圈木条
    const frame = new THREE.Mesh(unitBox, frameMaterial);
    frame.userData.id = placement.id;
    group.add(frame);

    // 卡纸（留白），画心贴在它上面
    const mat = new THREE.Mesh(unitPlane, matMaterial);
    mat.position.z = FRAME_DEPTH / 2 + 0.001;
    group.add(mat);

    // 画心：Basic 材质 + 关色调映射，保证展品是展厅里最亮的东西
    const picture = new THREE.Mesh(
      unitPlane,
      new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false, fog: false }),
    );
    picture.position.z = FRAME_DEPTH / 2 + 0.003;
    group.add(picture);

    // 墙上的作品标签：朝房间中心那侧挂，免得探出墙角。z 收到贴近墙的位置，
    // 不然标签会浮在半空
    const label = new THREE.Mesh(unitBox, labelMaterial);
    label.scale.set(0.14, 0.09, 0.008);
    label.position.z = -0.05;
    group.add(label);

    const entry: FrameParts = { frame, mat, picture, wash, shadow, label };
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
    // 标签贴着画框右下角，与画框底边齐平
    entry.label.position.x = outerW / 2 + 0.13;
    entry.label.position.y = -outerH / 2 + 0.07;
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

/**
 * 3D 房间：three.js 场景的搭建与拾取。
 *
 * 只在 mountGallery 确认设备能跑 WebGL 之后才被动态 import —— 不支持的设备
 * 连这个 chunk 都不会下载。交互与 DOM 逻辑在 index.ts，这里只管「房间长什么样」。
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

export function createRoom({ canvas, layout, colors }: CreateRoomOptions): RoomHandle {
  const { side, placements } = layout;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // 背景比墙色再暗一档：房间开口（画框背面、天花板方向）看着像阴影
  const background = new THREE.Color(colors.wall).multiplyScalar(0.85);
  const scene = new THREE.Scene();
  scene.background = background;
  // 一点雾：远处的墙稍微退后，房间显得更深
  scene.fog = new THREE.Fog(background, side * 0.7, side * 2.4);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, side * 4);
  camera.position.set(0, 1.6, side / 2 - 1.1);

  // ---- 房间外壳 ----
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(side, side),
    new THREE.MeshLambertMaterial({ color: colors.floor }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.userData.isFloor = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(side, side),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(colors.wall).multiplyScalar(1.15) }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_HEIGHT;
  scene.add(ceiling);

  const wallMaterial = new THREE.MeshLambertMaterial({ color: colors.wall });
  const wallGeometry = new THREE.PlaneGeometry(side, ROOM_HEIGHT);
  const walls: [Placement['wall'], number, number, number, number][] = [
    ['n', 0, ROOM_HEIGHT / 2, -side / 2, 0],
    ['s', 0, ROOM_HEIGHT / 2, side / 2, Math.PI],
    ['e', side / 2, ROOM_HEIGHT / 2, 0, -Math.PI / 2],
    ['w', -side / 2, ROOM_HEIGHT / 2, 0, Math.PI / 2],
  ];
  for (const [, x, y, z, rotationY] of walls) {
    const mesh = new THREE.Mesh(wallGeometry, wallMaterial);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY;
    scene.add(mesh);
  }

  // ---- 灯光 ----
  // 环境光打底，两盏暖/冷色的吊灯定房间氛围（moods 里的 light）
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const lampMaterial = new THREE.MeshBasicMaterial({ color: colors.light });
  const lampGeometry = new THREE.SphereGeometry(0.09, 12, 8);
  for (const z of [-side * 0.22, side * 0.22]) {
    const lamp = new THREE.PointLight(colors.light, 14, 0, 1.7);
    lamp.position.set(0, ROOM_HEIGHT - 0.35, z);
    scene.add(lamp);

    const bulb = new THREE.Mesh(lampGeometry, lampMaterial);
    bulb.position.copy(lamp.position);
    scene.add(bulb);
  }

  // ---- 画 ----
  const frameMaterial = new THREE.MeshLambertMaterial({ color: '#22252a' });
  const placeholder = placeholderTexture();
  const pictures = new Map<string, THREE.Mesh>();
  const pickables: THREE.Object3D[] = [];
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [
    wallGeometry,
    wallMaterial,
    frameMaterial,
    lampGeometry,
    lampMaterial,
    placeholder,
  ];

  for (const placement of placements) {
    const group = new THREE.Group();
    const point = wallPoint(placement, side);
    group.position.set(point.x, point.y, point.z);
    group.rotation.y = WALL_ROTATION[placement.wall];

    // 画框：比画心四周各多 3.5cm，厚 5cm
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(placement.fw + 0.07, placement.fh + 0.07, 0.05),
      frameMaterial,
    );
    frame.userData.id = placement.id;
    group.add(frame);

    // 画心：贴着画框正面，稍微前一点免得 z-fighting
    const picture = new THREE.Mesh(
      new THREE.PlaneGeometry(placement.fw, placement.fh),
      new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false }),
    );
    picture.position.z = 0.031;
    group.add(picture);

    pictures.set(placement.id, picture);
    pickables.push(frame);
    disposables.push(frame.geometry, picture.geometry, picture.material as THREE.Material);
    scene.add(group);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const quaternion = new THREE.Quaternion();
  const scratch = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();

  /** 长边不变，只按真实比例重排宽高：画框跟着缩放，画心永远贴着框 */
  function resizeFrame(id: string, aspect: number): void {
    const picture = pictures.get(id);
    const placement = placements.find((p) => p.id === id);
    if (!picture || !placement) return;

    const long = Math.max(placement.fw, placement.fh);
    const fw = aspect >= 1 ? long : long * aspect;
    const fh = aspect >= 1 ? long / aspect : long;
    picture.scale.set(fw / placement.fw, fh / placement.fh, 1);

    const frame = pickables.find((mesh) => mesh.userData.id === id);
    if (frame) {
      frame.scale.set((fw + 0.07) / (placement.fw + 0.07), (fh + 0.07) / (placement.fh + 0.07), 1);
    }
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
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      ceiling.geometry.dispose();
      (ceiling.material as THREE.Material).dispose();
      for (const picture of pictures.values()) {
        const map = (picture.material as THREE.MeshBasicMaterial).map;
        if (map && map !== placeholder) map.dispose();
      }
      renderer.dispose();
    },
  };
}

/**
 * 场景：整座金贝尔美术馆（16 拱 + 庭院 + 树廊）+ 采光 + 四个验收视角。
 *
 * 光的路径（数据卡第三节，本场景唯一的照明叙事）：
 *   太阳（方向光，带阴影，光只从 0.61 m 天窗缝进来）
 *   → 打在翼形穿孔铝反射器上（反射器自发光）
 *   → 每拱一盏朝上的聚光灯模拟第一次反射，把光送回摆线拱面
 *   → 拱面漫反射（用环境贴图 + 半球光近似）均匀照亮室内与画作
 * 直射光到不了画作与地面：拱壳、填充墙、反射器、楔形缝的玻璃都投影，
 * 反射器还特意用不带 alphaMap 的 customDepthMaterial，孔不漏光。
 *
 * 性能上的三处取舍：
 * - 阴影图只在时间变化时重算（shadow.autoUpdate = false + needsUpdate）：
 *   场景里没有会动的东西，一帧一帧重算纯属浪费
 * - 阴影图 4096²：建筑 184 m 长，2048² 下天窗缝只剩 7 个像素宽，光斑会碎
 * - 16 盏朝上聚光灯都不投影：它就是「第一次反射」的近似，不该被挡住
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { APEX_H, LENGTH, PROFILE_SEGMENTS, SPAN } from './cycloid';
import { BUILDING_X, BUILDING_Z, PLATFORM_H, VAULTS, selfCheck } from './layout';
import { buildBuilding } from './building';
import { buildHanging, type HangItem } from './hang';
import { environmentTexture } from './textures';
import { sunAt, type SunState } from './sun';

/** 四个验收视角 */
export type ViewKey = 'plan' | 'section' | 'longitudinal' | 'eye';

export interface LightStudy {
  setTime(hour: number): SunState;
  setView(view: ViewKey): void;
  setSize(width: number, height: number): void;
  render(): void;
  stats(): { segments: number; vertices: number; triangles: number };
  calls(): number;
  /** 尺寸自检（数据核对用） */
  check(): string[];
  /** 挂画：要载入纹理的展品 id，以及换纹理的口子（纹理由 index.ts 载入） */
  hangings: {
    ids: string[];
    setPicture(id: string, texture: THREE.Texture, aspect: number | null): void;
  };
  dispose(): void;
}

/** 载入一张纹理，顺带返回图片真实比例（用来校正画心） */
export function loadTexture(
  url: string,
): Promise<{ texture: THREE.Texture; aspect: number | null }> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const image = texture.image as { width?: number; height?: number } | undefined;
        const aspect = image?.width && image?.height ? image.width / image.height : null;
        resolve({ texture, aspect });
      },
      undefined,
      () => reject(new Error(`纹理加载失败：${url}`)),
    );
  });
}

export interface LightStudyOptions {
  canvas: HTMLCanvasElement;
  /** 展品（画由数据层提供） */
  items: readonly HangItem[];
}

export function createLightStudy({ canvas, items }: LightStudyOptions): LightStudy | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#DCE3EA');

  const centerX = (BUILDING_X.min + BUILDING_X.max) / 2;
  const centerZ = (BUILDING_Z.min + BUILDING_Z.max) / 2;

  // ---------- 建筑（室内地面在 y=0，整个 group 抬到平台面上）----------
  const building = buildBuilding();
  building.group.position.y = PLATFORM_H;
  scene.add(building.group);

  const hanging = buildHanging(items);
  hanging.group.position.y = PLATFORM_H;
  scene.add(hanging.group);

  // ---------- 太阳：方向光 + 阴影（阴影只在时间变化时重算）----------
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.autoUpdate = false;
  scene.add(sun);
  scene.add(sun.target);

  // ---------- 第一次反射：每拱一盏朝上的聚光灯 ----------
  const bounces: THREE.SpotLight[] = VAULTS.map((vault) => {
    const light = new THREE.SpotLight(0xfff1dc, 4, 0, 1.35, 1, 0);
    light.position.set(vault.x, PLATFORM_H + 0.12, vault.z);
    light.target.position.set(vault.x, PLATFORM_H + APEX_H, vault.z);
    light.castShadow = false; // 故意不投影：这就是「第一次反射」的近似
    scene.add(light);
    scene.add(light.target);
    return light;
  });

  // ---------- 环境：天空漫射 + PMREM（拱面漫反射的那一份）----------
  const hemi = new THREE.HemisphereLight(0xdfe9f7, 0x8a7c66, 0.2);
  scene.add(hemi);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = environmentTexture('#dfe9f7', '#8a7c66');
  const envMap = pmrem.fromEquirectangular(equirect).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  equirect.dispose();

  // ---------- 相机与四个视角 ----------
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 400;

  const views: Record<ViewKey, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
    // 俯视：数据卡要求从 Y=50 向下看，能数出 6+4+6
    plan: {
      pos: new THREE.Vector3(centerX, 50, centerZ + 0.01),
      target: new THREE.Vector3(centerX, PLATFORM_H, centerZ),
    },
    // 横剖面：站在中排一个拱里沿拱长看，摆线断面 + 反射器 + 楔形收口缝
    section: {
      pos: new THREE.Vector3(VAULTS[8].x - LENGTH / 2 + 1.5, PLATFORM_H + 1.62, VAULTS[8].z),
      target: new THREE.Vector3(VAULTS[8].x + LENGTH / 2, PLATFORM_H + APEX_H * 0.5, VAULTS[8].z),
    },
    // 纵剖面：贴着南排一排拱看过去，天窗缝通长、反射器分 10 段、地面 20:10
    longitudinal: {
      pos: new THREE.Vector3(VAULTS[0].x - 8, PLATFORM_H + 2.4, VAULTS[0].z + SPAN * 0.45),
      target: new THREE.Vector3(VAULTS[5].x + 8, PLATFORM_H + APEX_H * 0.6, VAULTS[0].z - SPAN * 0.15),
    },
    // 人视：站在西侧入口前看中庭与门厅
    eye: {
      pos: new THREE.Vector3(BUILDING_X.min - 6, PLATFORM_H + 1.62, VAULTS[6].z),
      target: new THREE.Vector3(VAULTS[6].x, PLATFORM_H + 2.6, VAULTS[6].z),
    },
  };

  function setView(view: ViewKey): void {
    const preset = views[view];
    camera.position.copy(preset.pos);
    controls.target.copy(preset.target);
    controls.update();
  }
  setView('eye');

  // ---------- 时间 → 光 ----------
  function setTime(hour: number): SunState {
    const state = sunAt(hour);
    sun.position.copy(state.direction).multiplyScalar(180);
    sun.target.position.set(centerX, PLATFORM_H, centerZ);
    sun.target.updateMatrixWorld();
    sun.color.copy(state.color);
    sun.intensity = state.intensity;
    // 场景里没有会动的东西：阴影只在太阳挪了之后重算一次
    sun.shadow.needsUpdate = true;

    building.reflectorMaterial.emissive.copy(state.color);
    building.reflectorMaterial.emissiveIntensity = state.emissive;
    for (const bounce of bounces) {
      bounce.color.copy(state.color);
      bounce.intensity = state.bounce;
    }

    hemi.color.copy(state.sky);
    hemi.groundColor.copy(state.ground);
    hemi.intensity = state.ambient;
    scene.environmentIntensity = 0.3 + 0.45 * (state.intensity / 3);
    scene.background = state.sky.clone().lerp(new THREE.Color('#ffffff'), 0.4);
    return state;
  }

  function stats(): { segments: number; vertices: number; triangles: number } {
    let vertices = 0;
    let triangles = 0;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const instances = (mesh as THREE.InstancedMesh).count ?? 1;
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      vertices += (position ? position.count : 0) * instances;
      triangles += ((index ? index.count : (position?.count ?? 0)) / 3) * instances;
    });
    return {
      segments: PROFILE_SEGMENTS,
      vertices: Math.round(vertices),
      triangles: Math.round(triangles),
    };
  }

  return {
    setTime,
    setView,
    setSize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
    stats,
    calls: () => renderer.info.render.calls,
    check: selfCheck,
    hangings: {
      ids: [...new Set(items.map((item) => item.id))],
      setPicture: (id, texture, aspect) => hanging.setPicture(id, texture, aspect),
    },
    dispose() {
      controls.dispose();
      building.dispose();
      hanging.dispose();
      envMap.dispose();
      renderer.dispose();
    },
  };
}

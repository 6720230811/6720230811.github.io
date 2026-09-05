/**
 * 场景搭建：一间摆线拱展厅，只为验证采光。
 *
 * 光的路径（数据卡指定，是本场景唯一的照明叙事）：
 *   太阳（方向光）→ 只从 0.6 m 天窗缝进来
 *   → 打在翼形穿孔铝反射器上（反射器自发光 + 一盏朝上聚光灯模拟第一次反射）
 *   → 拱面漫反射照亮室内
 * 关键实现手段：拱壳与侧墙都 castShadow，阳光进不了室内别处；
 * 反射器也投影（用不带 alphaMap 的 customDepthMaterial → 影子是实心的），
 * 所以地面与「画」上都拿不到直射光，只有反射器漏下来的那一点。
 *
 * 红线：场景内不放任何家具、雕塑、logo、文字招牌；贴图全部程序化生成。
 */
import * as THREE from 'three';
import {
  APEX_H,
  LENGTH,
  LENGTH_SEGMENTS,
  PROFILE_SEGMENTS,
  R,
  RISE,
  SLOT_W,
  SHELL_T,
  SPAN,
  SPRING_H,
  WALL_T,
  archProfile,
  splitAtSlot,
} from './cycloid';
import { loftShell, loftTube, wingLoop, buildEndWallGeometry } from './geometry';
import {
  brushedAluminiumTexture,
  concreteTexture,
  environmentTexture,
  oakTexture,
  perforationTexture,
  travertineTexture,
} from './textures';
import { sunAt, type SunState } from './sun';

/** 反射器：挂在拱顶下方 1.5 m，翼展 3 m，两端低中间高 */
const REFLECTOR = {
  span: 3.0,
  centerY: APEX_H - 1.5,
  drop: 0.42, // 两端比中间低
  thickness: 0.05, // 相对厚度 t/c
  segments: 160,
};

export interface Gallery {
  scene: THREE.Scene;
  /** 拖动时间滑块：更新太阳、反射器与补光 */
  setTime(hour: number): SunState;
  /** 几何统计（验收用） */
  stats(): { segments: number; vertices: number; triangles: number };
  dispose(): void;
}

export function buildGallery(renderer: THREE.WebGLRenderer): Gallery {
  const scene = new THREE.Scene();

  // ---- 贴图（全部程序化）----
  const concreteMap = concreteTexture();
  concreteMap.repeat.set(1, 1); // 拱面 UV 已按米给，这里不再乘
  const oakMap = oakTexture();
  oakMap.repeat.set(1, 8);
  const travertineMap = travertineTexture();
  travertineMap.repeat.set(1, 8);
  const perfMap = perforationTexture();
  const aluMap = brushedAluminiumTexture();
  aluMap.repeat.set(1, 1);

  // ---- 材质 ----
  // 主材：清水混凝土（灰白、哑光）
  const concrete = new THREE.MeshStandardMaterial({
    map: concreteMap,
    color: '#ffffff',
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.6,
  });
  const oak = new THREE.MeshStandardMaterial({ map: oakMap, roughness: 0.55, metalness: 0.04 });
  const travertine = new THREE.MeshStandardMaterial({
    map: travertineMap,
    roughness: 0.62,
    metalness: 0.02,
  });
  // 反射器：穿孔铝，自发光由太阳驱动
  const reflectorMat = new THREE.MeshStandardMaterial({
    map: aluMap,
    alphaMap: perfMap,
    transparent: true,
    alphaTest: 0.5,
    color: '#d7d9db',
    roughness: 0.3,
    metalness: 0.86,
    emissive: new THREE.Color('#ffe9c8'),
    emissiveIntensity: 0.6,
    side: THREE.DoubleSide,
  });
  // 天窗缝的有机玻璃：半透明，不投影（阳光要穿过去）
  const plexiglass = new THREE.MeshStandardMaterial({
    color: '#eaf3ff',
    transparent: true,
    opacity: 0.28,
    roughness: 0.12,
    metalness: 0,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // ---- 拱壳：沿天窗缝切成两半，各自挤出 ----
  const profile = archProfile(PROFILE_SEGMENTS);
  const [leftProfile, rightProfile] = splitAtSlot(profile, SLOT_W / 2);
  const shellGroup = new THREE.Group();
  for (const half of [leftProfile, rightProfile]) {
    const geometry = loftShell(half, LENGTH, SHELL_T, LENGTH_SEGMENTS, 1);
    const mesh = new THREE.Mesh(geometry, concrete);
    mesh.position.y = SPRING_H;
    mesh.castShadow = true; // 阳光只能从缝里进来
    mesh.receiveShadow = true;
    shellGroup.add(mesh);
  }
  scene.add(shellGroup);

  // ---- 侧墙（起拱线以下）----
  for (const sign of [-1, 1] as (-1 | 1)[]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, SPRING_H, LENGTH), concrete);
    wall.position.set(sign * (SPAN / 2 + WALL_T / 2), SPRING_H / 2, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  // ---- 端墙：矩形 + 摆线拱形封口（手工拼三角形，避开 ShapeGeometry 的 earcut
  //  Steiner 点；端墙上不该看到三角网，只有弧线）----
  const endGeometry = buildEndWallGeometry(profile);
  for (const sign of [-1, 1] as (-1 | 1)[]) {
    const end = new THREE.Mesh(endGeometry, concrete);
    end.position.z = sign * (LENGTH / 2);
    end.rotation.y = sign === -1 ? 0 : Math.PI;
    if (sign === -1) end.position.z += 0.01;
    else end.position.z -= 0.01;
    end.castShadow = true;
    end.receiveShadow = true;
    scene.add(end);
  }

  // ---- 地面：白橡木 : 洞石 = 20 : 10，沿跨度交替铺 ----
  const OAK_W = 0.2;
  const STONE_W = 0.1;
  let cursor = -SPAN / 2;
  let useStone = false;
  while (cursor < SPAN / 2 - 1e-6) {
    const width = Math.min(useStone ? STONE_W : OAK_W, SPAN / 2 - cursor);
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(width, LENGTH),
      useStone ? travertine : oak,
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(cursor + width / 2, 0, 0);
    strip.receiveShadow = true;
    scene.add(strip);
    cursor += width;
    useStone = !useStone;
  }

  // ---- 天窗缝：一条通长的有机玻璃 ----
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(SLOT_W, LENGTH), plexiglass);
  slot.rotation.x = -Math.PI / 2;
  slot.position.set(0, APEX_H - 0.02, 0);
  scene.add(slot);

  // ---- 反射器：翼形穿孔铝，独立网格 ----
  const wing = wingLoop(REFLECTOR);
  const reflectorGeometry = loftTube(wing, LENGTH, 8, 0.12);
  const reflector = new THREE.Mesh(reflectorGeometry, reflectorMat);
  reflector.castShadow = true;
  reflector.receiveShadow = true;
  // 投影用实心深度材质：铝板上的孔不该把直射光漏到地面上
  reflector.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  scene.add(reflector);

  // ---- 灯 ----
  // 1) 太阳：方向光 + 阴影（阴影是「光只能从缝里进来」的唯一实现手段）
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // 2) 反射器自发光（材质上）+ 一盏朝上的聚光灯模拟第一次反射
  //    放在地面附近朝上打：锥体掠过反射器把拱面照亮，地面不在锥内
  const bounce = new THREE.SpotLight(0xfff1dc, 6, 0, 1.35, 1, 0);
  bounce.position.set(0, 0.12, 0);
  bounce.target.position.set(0, APEX_H, 0);
  bounce.castShadow = false; // 故意不投影：这就是「第一次反射」的近似
  scene.add(bounce);
  scene.add(bounce.target);

  // 3) 环境：一点点天空漫射 + PMREM，别让背光面死黑
  const hemi = new THREE.HemisphereLight(0xdfe9f7, 0x8a7c66, 0.2);
  scene.add(hemi);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = environmentTexture('#dfe9f7', '#8a7c66');
  const envMap = pmrem.fromEquirectangular(equirect).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  equirect.dispose();

  scene.background = new THREE.Color('#0d0f12');

  // ---- 时间 → 灯光 ----
  function setTime(hour: number): SunState {
    const state = sunAt(hour);
    sun.position.copy(state.direction).multiplyScalar(45);
    sun.target.position.set(0, 0, 0);
    sun.color.copy(state.color);
    sun.intensity = state.intensity;

    reflectorMat.emissive.copy(state.color);
    reflectorMat.emissiveIntensity = state.emissive;
    bounce.color.copy(state.color);
    bounce.intensity = state.bounce;

    hemi.color.copy(state.sky);
    hemi.groundColor.copy(state.ground);
    hemi.intensity = state.ambient;
    scene.environmentIntensity = 0.35 + 0.35 * state.intensity / 3.5;

    plexiglass.color.copy(state.sky);
    plexiglass.emissive.copy(state.sky);
    plexiglass.emissiveIntensity = 0.35 + 0.5 * (state.intensity / 3.5);

    return state;
  }

  function stats(): { segments: number; vertices: number; triangles: number } {
    let vertices = 0;
    let triangles = 0;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute('position');
      vertices += position ? position.count : 0;
      const index = mesh.geometry.getIndex();
      triangles += index ? index.count / 3 : (position ? position.count / 3 : 0);
    });
    return { segments: PROFILE_SEGMENTS, vertices, triangles: Math.round(triangles) };
  }

  function dispose(): void {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    for (const material of [concrete, oak, travertine, reflectorMat, plexiglass]) material.dispose();
    for (const map of [concreteMap, oakMap, travertineMap, perfMap, aluMap]) map.dispose();
    envMap.dispose();
  }

  return { scene, setTime, stats, dispose };
}

/** 断面数据（调试/验收时可打印）：摆线矢高与起拱线 */
export const METRICS = {
  r: R,
  rise: RISE,
  spring: SPRING_H,
  apex: APEX_H,
  span: SPAN,
  length: LENGTH,
  slot: SLOT_W,
};

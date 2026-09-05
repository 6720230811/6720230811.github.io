/**
 * 入口：npm run dev
 *
 * 一间摆线拱展厅（30.48 × 6.1 × 6.1 m，天窗缝 0.6 m，翼形穿孔铝反射器），
 * 拖时间滑块看一天里采光怎么变。场景内没有任何装饰物，只有建筑与光。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { APEX_H, LENGTH, SPAN } from './cycloid';
import { buildGallery } from './scene';
import { createHud } from './hud';

const canvas = document.getElementById('app') as HTMLCanvasElement | null;
if (!canvas) throw new Error('缺少 #app 画布');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const gallery = buildGallery(renderer);
const scene = gallery.scene;

// 相机：站在拱的一头、人眼高度，朝另一头看整条天光缝
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0.15, 1.62, -LENGTH / 2 + 2.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, APEX_H * 0.45, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.2;
controls.maxDistance = SPAN * 6;
controls.maxPolarAngle = Math.PI * 0.92;
controls.update();

let hour = 12;
const hud = createHud(hour, (next) => {
  hour = next;
  hud.setSun(gallery.setTime(hour));
});
hud.setSun(gallery.setTime(hour));

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---- 帧率：最近 30 帧的平均 ----
const samples: number[] = [];
let last = performance.now();
let hudClock = 0;

function frame(now: number): void {
  const dt = now - last;
  last = now;
  if (dt > 0) {
    samples.push(dt);
    if (samples.length > 30) samples.shift();
  }

  controls.update();
  renderer.render(scene, camera);

  // HUD 每 0.25 s 刷一次，读数才看得清
  hudClock += dt;
  if (hudClock > 250) {
    hudClock = 0;
    const mean = samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1);
    const info = renderer.info.render;
    hud.setStats({
      fps: mean > 0 ? 1000 / mean : 0,
      ...gallery.stats(),
      calls: info.calls,
    });
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 时间也暴露到 window，方便外部脚本/截图流程直接设
Object.assign(window as unknown as Record<string, unknown>, {
  setGalleryHour: (next: number) => {
    hour = next;
    hud.setHour(next);
    hud.setSun(gallery.setTime(hour));
  },
});

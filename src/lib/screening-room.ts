import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

type MachineState = 'off' | 'starting' | 'ready' | 'playing' | 'paused' | 'cooling';
type ViewMode = 'seat' | 'projector';
type Action = 'projector' | 'power' | 'source' | 'play' | 'prev' | 'next' | 'focus';

interface GalleryItem {
  id: string;
  src: string;
  title: string;
}

interface ImageSource {
  kind: 'images';
  items: { src: string; title: string; local?: boolean }[];
}

interface VideoSource {
  kind: 'video';
  src: string;
  title: string;
  local?: boolean;
}

type MediaSource = ImageSource | VideoSource;

interface PendingImage {
  texture: THREE.Texture;
  width: number;
  height: number;
  index: number;
  title: string;
}

interface Labels {
  standby: string;
  starting: string;
  ready: string;
  playing: string;
  paused: string;
  cooling: string;
  play: string;
  pause: string;
  selected: string;
  noSource: string;
  uploadFailed: string;
}

const SCREEN_ASPECT = 16 / 9;
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function smoothstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}

function readItems(root: HTMLElement): GalleryItem[] {
  try {
    const value: unknown = JSON.parse(root.dataset.items ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is GalleryItem =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as GalleryItem).src === 'string' &&
        typeof (item as GalleryItem).title === 'string',
    );
  } catch {
    return [];
  }
}

function makeCarpetTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#272321';
    ctx.fillRect(0, 0, 256, 256);
    const image = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < image.data.length; i += 4) {
      const grain = ((i * 17) % 23) - 11;
      image.data[i] = clamp(image.data[i] + grain, 0, 255);
      image.data[i + 1] = clamp(image.data[i + 1] + grain * 0.72, 0, 255);
      image.data[i + 2] = clamp(image.data[i + 2] + grain * 0.55, 0, 255);
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 9);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeDisplayTexture(): { texture: THREE.CanvasTexture; draw: (state: string, detail: string) => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const draw = (state: string, detail: string) => {
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(0, 0, 640, 240);
    gradient.addColorStop(0, '#090d0f');
    gradient.addColorStop(1, '#10191b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 240);
    ctx.fillStyle = '#d8b482';
    ctx.fillRect(34, 38, 5, 70);
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillText(state.toUpperCase(), 60, 69);
    ctx.fillStyle = '#e9e6dd';
    ctx.font = '500 36px system-ui, sans-serif';
    const shown = detail.length > 24 ? `${detail.slice(0, 23)}…` : detail;
    ctx.fillText(shown, 34, 158);
    ctx.fillStyle = 'rgba(233,230,221,.48)';
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText('LASER  ·  4K  ·  LENS SHIFT', 34, 205);
    texture.needsUpdate = true;
  };
  draw('OFF', 'NO SIGNAL');
  return { texture, draw };
}

function makeStandbyTexture(title: string): { texture: THREE.CanvasTexture; draw: (headline: string, detail: string) => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const draw = (headline: string, detail: string) => {
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
    gradient.addColorStop(0, '#221c24');
    gradient.addColorStop(0.52, '#182329');
    gradient.addColorStop(1, '#10262c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = 'rgba(231,224,213,.18)';
    for (let x = 0; x < 1280; x += 4) {
      const y = 370 + Math.sin(x * 0.017) * 23 + Math.sin(x * 0.005) * 34;
      ctx.fillRect(x, y, 2, 1);
    }
    ctx.fillStyle = '#e8e0d6';
    ctx.font = '500 56px system-ui, sans-serif';
    ctx.fillText(title, 86, 118);
    ctx.fillStyle = 'rgba(232,224,214,.64)';
    ctx.font = '400 25px system-ui, sans-serif';
    ctx.fillText(headline, 88, 167);
    ctx.fillStyle = 'rgba(232,224,214,.48)';
    ctx.font = '400 22px system-ui, sans-serif';
    ctx.fillText(detail, 88, 646);
    texture.needsUpdate = true;
  };
  draw('PRIVATE SCREENING ROOM', 'NO SIGNAL');
  return { texture, draw };
}

function createBeam(origin: THREE.Vector3): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const corners = [
    new THREE.Vector3(-2.6, 3.51, -4.76),
    new THREE.Vector3(2.6, 3.51, -4.76),
    new THREE.Vector3(2.6, 0.59, -4.76),
    new THREE.Vector3(-2.6, 0.59, -4.76),
  ];
  const positions: number[] = [];
  const progress: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    positions.push(origin.x, origin.y, origin.z, a.x, a.y, a.z, b.x, b.y, b.z);
    progress.push(0, 1, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('beamProgress', new THREE.Float32BufferAttribute(progress, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color('#e6d6bc') },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float beamProgress;
      varying float vProgress;
      varying vec3 vWorld;
      void main() {
        vProgress = beamProgress;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform float uTime;
      varying float vProgress;
      varying vec3 vWorld;
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + .1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      void main() {
        float grain = mix(.82, 1.0, hash(floor(vWorld * 7.0 + uTime * .12)));
        float edge = smoothstep(0.0, .08, vProgress) * (1.0 - smoothstep(.78, 1.0, vProgress) * .5);
        gl_FragColor = vec4(uColor, uOpacity * edge * grain * mix(.95, .18, vProgress));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return { mesh: new THREE.Mesh(geometry, material), material };
}

function createScreenMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: texture },
      uBrightness: { value: 0.025 },
      uFocus: { value: 0.18 },
      uMediaAspect: { value: SCREEN_ASPECT },
      uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tMap;
      uniform float uBrightness;
      uniform float uFocus;
      uniform float uMediaAspect;
      uniform vec2 uTexel;
      varying vec2 vUv;

      void main() {
        const float screenAspect = 1.7777778;
        vec2 uv = vUv;
        float inside = 1.0;
        if (uMediaAspect > screenAspect) {
          float h = screenAspect / uMediaAspect;
          inside *= step((1.0 - h) * .5, uv.y) * step(uv.y, (1.0 + h) * .5);
          uv.y = (uv.y - .5) / h + .5;
        } else {
          float w = uMediaAspect / screenAspect;
          inside *= step((1.0 - w) * .5, uv.x) * step(uv.x, (1.0 + w) * .5);
          uv.x = (uv.x - .5) / w + .5;
        }
        float radius = uFocus * 6.0;
        vec2 d = uTexel * radius;
        vec3 color = texture2D(tMap, uv).rgb * .28;
        color += texture2D(tMap, uv + vec2(d.x, 0.0)).rgb * .12;
        color += texture2D(tMap, uv - vec2(d.x, 0.0)).rgb * .12;
        color += texture2D(tMap, uv + vec2(0.0, d.y)).rgb * .12;
        color += texture2D(tMap, uv - vec2(0.0, d.y)).rgb * .12;
        color += texture2D(tMap, uv + d).rgb * .06;
        color += texture2D(tMap, uv - d).rgb * .06;
        color += texture2D(tMap, uv + vec2(d.x, -d.y)).rgb * .06;
        color += texture2D(tMap, uv + vec2(-d.x, d.y)).rgb * .06;
        vec3 projected = color * inside + vec3(.012) * (1.0 - inside);
        vec3 unlitCloth = vec3(.17, .162, .148);
        color = mix(unlitCloth, projected, clamp(uBrightness, 0.0, 1.0));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function makePose(position: THREE.Vector3, target: THREE.Vector3): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const helper = new THREE.PerspectiveCamera();
  helper.position.copy(position);
  helper.lookAt(target);
  return { position: position.clone(), quaternion: helper.quaternion.clone() };
}

export function mountScreeningRoom(rootEl: HTMLElement | null): void {
  if (!rootEl) return;
  const root = rootEl;
  const canvasEl = root.querySelector<HTMLCanvasElement>('#screening-canvas');
  const fallback = root.querySelector<HTMLElement>('#screening-fallback');
  if (!canvasEl || !isWebGLAvailable()) {
    if (fallback) fallback.hidden = false;
    return;
  }
  // Keep the non-null value stable inside event/render closures.
  const canvas: HTMLCanvasElement = canvasEl;

  const labels: Labels = {
    standby: root.dataset.labelStandby ?? 'Projector off',
    starting: root.dataset.labelStarting ?? 'Starting',
    ready: root.dataset.labelReady ?? 'Ready',
    playing: root.dataset.labelPlaying ?? 'Playing',
    paused: root.dataset.labelPaused ?? 'Paused',
    cooling: root.dataset.labelCooling ?? 'Cooling',
    play: root.dataset.labelPlay ?? 'Play',
    pause: root.dataset.labelPause ?? 'Pause',
    selected: root.dataset.labelSelected ?? 'Selected',
    noSource: root.dataset.labelNoSource ?? 'Choose a source',
    uploadFailed: root.dataset.labelUploadFailed ?? 'Cannot read file',
  };
  const locale = root.dataset.locale === 'en' ? 'en' : 'zh';
  const galleryItems = readItems(root);
  const defaultHint = root.dataset.labelHint ?? '';

  const stateEl = root.querySelector<HTMLElement>('#screening-state');
  const tooltip = root.querySelector<HTMLElement>('#screening-tooltip');
  const hint = root.querySelector<HTMLElement>('#screening-hint');
  const viewButton = root.querySelector<HTMLButtonElement>('#screening-view');
  const sourceButton = root.querySelector<HTMLButtonElement>('#screening-source');
  const playButton = root.querySelector<HTMLButtonElement>('#screening-play');
  const immersiveButton = root.querySelector<HTMLButtonElement>('#screening-immersive');
  const sourceDialog = root.querySelector<HTMLDialogElement>('#screening-source-dialog');
  const gallerySeriesButton = root.querySelector<HTMLButtonElement>('#screening-gallery-series');
  const imageInput = root.querySelector<HTMLInputElement>('#screening-image-input');
  const videoInput = root.querySelector<HTMLInputElement>('#screening-video-input');
  const intervalInput = root.querySelector<HTMLSelectElement>('#screening-interval');
  const focusPanel = root.querySelector<HTMLElement>('#screening-focus');
  const focusInput = root.querySelector<HTMLInputElement>('#screening-focus-range');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || window.matchMedia?.('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.35 : 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#100e0d');
  scene.fog = new THREE.FogExp2('#171310', 0.024);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 40);
  const seatPose = makePose(new THREE.Vector3(0, 1.2, 1.72), new THREE.Vector3(0, 2.03, -4.86));
  const projectorPose = makePose(new THREE.Vector3(3.15, 2.24, 2.15), new THREE.Vector3(2.35, 1.42, 0.42));
  camera.position.copy(seatPose.position);
  camera.quaternion.copy(seatPose.quaternion);

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const addBox = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    parent: THREE.Object3D = scene,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(...size)), material);
    mesh.position.set(...position);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const addRoundedBox = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    parent: THREE.Object3D,
    radius = 0.12,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(new RoundedBoxGeometry(...size, 4, radius)), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const wallMaterial = track(new THREE.MeshStandardMaterial({ color: '#211f1d', roughness: 0.96 }));
  const warmWallMaterial = track(new THREE.MeshStandardMaterial({ color: '#2b2520', roughness: 0.98 }));
  const ceilingMaterial = track(new THREE.MeshStandardMaterial({ color: '#151412', roughness: 0.98 }));
  const trimMaterial = track(new THREE.MeshStandardMaterial({ color: '#12100f', roughness: 0.9 }));
  const woodMaterial = track(new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.76 }));
  const metalMaterial = track(new THREE.MeshStandardMaterial({ color: '#34312f', roughness: 0.5, metalness: 0.52 }));
  const blackMetalMaterial = track(new THREE.MeshStandardMaterial({ color: '#171615', roughness: 0.4, metalness: 0.68 }));
  const sofaMaterial = track(new THREE.MeshStandardMaterial({ color: '#81766b', roughness: 1 }));
  const sofaBaseMaterial = track(new THREE.MeshStandardMaterial({ color: '#5f5148', roughness: 0.98 }));
  const cushionMaterial = track(new THREE.MeshStandardMaterial({ color: '#4f5848', roughness: 1 }));
  const accentMaterial = track(new THREE.MeshStandardMaterial({ color: '#35372f', roughness: 0.98 }));
  const carpetTexture = track(makeCarpetTexture(renderer));
  const floorMaterial = track(new THREE.MeshStandardMaterial({ map: carpetTexture, color: '#504a45', roughness: 1 }));

  // Room shell: 9.6 × 8.5 × 3.8 m, with a floating acoustic ceiling.
  addBox([9.6, 0.12, 8.5], [0, -0.06, -0.75], floorMaterial);
  addBox([9.6, 3.8, 0.2], [0, 1.9, -5], wallMaterial);
  addBox([0.2, 3.8, 8.5], [-4.8, 1.9, -0.75], warmWallMaterial);
  addBox([0.2, 3.8, 8.5], [4.8, 1.9, -0.75], wallMaterial);
  addBox([9.6, 3.8, 0.2], [0, 1.9, 3.5], warmWallMaterial);
  addBox([9.6, 0.14, 8.5], [0, 3.87, -0.75], ceilingMaterial);
  addBox([7.5, 0.18, 6.7], [0, 3.63, -0.85], ceilingMaterial);
  addBox([9.25, 0.08, 0.06], [0, 0.08, -4.86], trimMaterial);
  addBox([0.06, 0.08, 8.1], [-4.66, 0.08, -0.75], trimMaterial);
  addBox([0.06, 0.08, 8.1], [4.66, 0.08, -0.75], trimMaterial);

  // Acoustic panels and partial walnut slats keep both side walls legible in low light.
  for (const z of [-2.8, -1.15, 0.5, 2.15]) addBox([0.09, 1.55, 1.18], [-4.66, 1.92, z], accentMaterial);
  for (let z = 0.5; z <= 3; z += 0.22) addBox([0.09, 2.5, 0.08], [4.66, 1.75, z], woodMaterial);

  const screenStandby = makeStandbyTexture(locale === 'zh' ? '暮色放映室' : 'Twilight Screening Room');
  track(screenStandby.texture);
  const screenMaterial = track(createScreenMaterial(screenStandby.texture));
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(5.2, 2.925)), screenMaterial);
  screen.position.set(0, 2.05, -4.86);
  scene.add(screen);
  addBox([5.5, 0.12, 0.12], [0, 3.59, -4.88], trimMaterial);
  addBox([5.5, 0.12, 0.12], [0, 0.51, -4.88], trimMaterial);
  addBox([0.12, 3.2, 0.12], [-2.69, 2.05, -4.88], trimMaterial);
  addBox([0.12, 3.2, 0.12], [2.69, 2.05, -4.88], trimMaterial);

  // Low, softly rounded lounge sofa; split cushions and a raked back keep it from reading as a rigid block.
  const sofa = new THREE.Group();
  sofa.position.set(-0.15, 0, 2.05);
  scene.add(sofa);
  addRoundedBox([3.42, 0.3, 1.24], [0, 0.38, 0], sofaBaseMaterial, sofa, 0.14);
  const sofaBack = addRoundedBox([3.28, 0.82, 0.38], [0, 0.93, 0.43], sofaBaseMaterial, sofa, 0.17);
  sofaBack.rotation.x = -0.08;
  addRoundedBox([0.5, 0.64, 1.18], [-1.47, 0.69, -0.02], sofaMaterial, sofa, 0.2);
  addRoundedBox([0.5, 0.64, 1.18], [1.47, 0.69, -0.02], sofaMaterial, sofa, 0.2);

  const seat = new THREE.Group();
  sofa.add(seat);
  addRoundedBox([1.42, 0.25, 1.02], [-0.75, 0.65, -0.1], sofaMaterial, seat, 0.11);
  addRoundedBox([1.42, 0.25, 1.02], [0.75, 0.65, -0.1], sofaMaterial, seat, 0.11);
  const leftBackCushion = addRoundedBox([1.4, 0.68, 0.3], [-0.73, 1.08, 0.2], sofaMaterial, sofa, 0.13);
  const rightBackCushion = addRoundedBox([1.4, 0.68, 0.3], [0.73, 1.08, 0.2], sofaMaterial, sofa, 0.13);
  leftBackCushion.rotation.x = -0.1;
  rightBackCushion.rotation.x = -0.1;
  const leftPillow = addRoundedBox([0.46, 0.48, 0.22], [-1.2, 1.02, -0.08], cushionMaterial, sofa, 0.1);
  const rightPillow = addRoundedBox([0.46, 0.48, 0.22], [1.2, 1.02, -0.08], cushionMaterial, sofa, 0.1);
  leftPillow.rotation.x = -0.14;
  rightPillow.rotation.x = -0.14;
  leftPillow.rotation.z = -0.18;
  rightPillow.rotation.z = 0.18;
  for (const x of [-1.28, 1.28]) {
    for (const z of [-0.38, 0.38]) addBox([0.12, 0.18, 0.12], [x, 0.16, z], woodMaterial, sofa);
  }

  // Projector pedestal and procedural device, separated into genuinely movable controls.
  addBox([1.22, 0.08, 0.92], [2.85, 1.05, 0.62], blackMetalMaterial);
  addBox([0.72, 1.04, 0.62], [2.85, 0.52, 0.62], metalMaterial);
  const projector = new THREE.Group();
  projector.position.set(2.85, 1.09, 0.62);
  projector.rotation.y = 0.4;
  scene.add(projector);
  const projectorBody = addBox([1.05, 0.3, 0.72], [0, 0.18, 0], metalMaterial, projector);
  projectorBody.castShadow = true;
  projectorBody.userData.action = 'projector' satisfies Action;

  const lensMaterial = track(new THREE.MeshStandardMaterial({ color: '#111719', roughness: 0.2, metalness: 0.7 }));
  const lensGlassMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#23343a', emissive: '#d8b482', emissiveIntensity: 0, roughness: 0.08, metalness: 0.35 }),
  );
  const lensBarrel = new THREE.Mesh(track(new THREE.CylinderGeometry(0.125, 0.125, 0.18, 32)), lensMaterial);
  lensBarrel.rotation.x = Math.PI / 2;
  lensBarrel.position.set(-0.22, 0.19, -0.42);
  lensBarrel.userData.action = 'focus' satisfies Action;
  projector.add(lensBarrel);
  const lensGlass = new THREE.Mesh(track(new THREE.CircleGeometry(0.105, 32)), lensGlassMaterial);
  lensGlass.position.set(-0.22, 0.19, -0.515);
  lensGlass.rotation.y = Math.PI;
  projector.add(lensGlass);
  const lensCover = addBox([0.29, 0.27, 0.035], [-0.22, 0.19, -0.54], blackMetalMaterial, projector);

  const display = makeDisplayTexture();
  track(display.texture);
  const displayMaterial = track(new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false }));
  const displayMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(0.36, 0.14)), displayMaterial);
  displayMesh.rotation.x = -Math.PI / 2;
  displayMesh.position.set(0.24, 0.337, 0.11);
  projector.add(displayMesh);

  const indicatorMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#481f27', emissive: '#8f3544', emissiveIntensity: 0.18, roughness: 0.35 }),
  );
  const buttonMaterial = track(new THREE.MeshStandardMaterial({ color: '#181d1f', roughness: 0.55, metalness: 0.25 }));
  const hitMaterial = track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  const buttons: THREE.Mesh[] = [];
  const buttonHitAreas: THREE.Mesh[] = [];
  const addButton = (action: Action, x: number, z: number, power = false) => {
    const mesh = new THREE.Mesh(track(new THREE.CylinderGeometry(0.047, 0.047, 0.024, 24)), power ? indicatorMaterial : buttonMaterial);
    mesh.position.set(x, 0.345, z);
    mesh.userData.action = action;
    mesh.userData.baseY = mesh.position.y;
    mesh.userData.press = 0;
    projector.add(mesh);
    buttons.push(mesh);
    const hitArea = new THREE.Mesh(track(new THREE.CylinderGeometry(0.085, 0.085, 0.045, 16)), hitMaterial);
    hitArea.position.set(x, 0.39, z);
    hitArea.userData.action = action;
    projector.add(hitArea);
    buttonHitAreas.push(hitArea);
    return mesh;
  };
  addButton('power', -0.39, -0.04, true);
  addButton('source', -0.2, 0.07);
  addButton('prev', -0.07, -0.07);
  addButton('play', 0.08, -0.07);
  addButton('next', 0.23, -0.07);

  projector.updateMatrixWorld(true);
  const lensOrigin = lensGlass.getWorldPosition(new THREE.Vector3());
  const beam = createBeam(lensOrigin);
  scene.add(beam.mesh);
  track(beam.mesh.geometry);
  track(beam.material);

  const dustGeometry = track(new THREE.BufferGeometry());
  const dustCount = lowPower || reducedMotion ? 0 : 150;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    const t = 0.08 + Math.random() * 0.82;
    const center = lensOrigin.clone().lerp(new THREE.Vector3(0, 2.05, -4.76), t);
    dustPositions[i * 3] = center.x + (Math.random() - 0.5) * 4.6 * t;
    dustPositions[i * 3 + 1] = center.y + (Math.random() - 0.5) * 2.45 * t;
    dustPositions[i * 3 + 2] = center.z;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = track(
    new THREE.PointsMaterial({ color: '#e7d8c2', size: 0.012, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dust);

  const ambient = new THREE.AmbientLight(0xbdb7b0, 0.44);
  scene.add(ambient);
  const hemisphere = new THREE.HemisphereLight(0xffe1c7, 0x211d1a, 0.86);
  scene.add(hemisphere);
  const ceilingLight = new THREE.PointLight(0xffd7b5, 76, 11, 2);
  ceilingLight.position.set(-1.6, 3.3, 0.2);
  ceilingLight.castShadow = !lowPower;
  ceilingLight.shadow.mapSize.set(512, 512);
  scene.add(ceilingLight);
  const sideLight = new THREE.PointLight(0xe1b18a, 30, 7, 2);
  sideLight.position.set(4.15, 1.4, 2.1);
  scene.add(sideLight);
  const screenLight = new THREE.RectAreaLight('#e8e0d6', 0, 5.2, 2.9);
  screenLight.position.set(0, 2.05, -4.55);
  screenLight.lookAt(0, 1.6, 2);
  scene.add(screenLight);

  const pickables: THREE.Object3D[] = [projectorBody, lensBarrel, ...buttonHitAreas];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map<string, THREE.Texture>();
  let machine: MachineState = 'off';
  let machineChangedAt = performance.now();
  let view: ViewMode = 'seat';
  let source: MediaSource | null = null;
  let imageIndex = 0;
  let imageRequest = 0;
  let pendingImage: PendingImage | null = null;
  let imageTransition: 'idle' | 'out' | 'in' = 'idle';
  let imageFade = 1;
  let slideChangedAt = performance.now();
  let slideInterval = 5;
  let currentTexture: THREE.Texture = screenStandby.texture;
  let video: HTMLVideoElement | null = null;
  let videoTexture: THREE.VideoTexture | null = null;
  let pendingVideo = false;
  let videoLoaded = false;
  let autoplayWhenReady = false;
  let screenBrightness = 0.025;
  let focusValue = Number(focusInput?.value ?? 0.82);
  let beamOpacity = 0;
  let roomLevel = 1;
  let averageColor = new THREE.Color('#dbe3df');
  let averageLuma = 0.45;
  let lastColorSample = 0;
  let cameraTransitioning = false;
  let lookYaw = 0;
  let lookPitch = -0.02;
  let dragging = false;
  let focusDragging = false;
  let dragDistance = 0;
  let lastX = 0;
  let lastY = 0;
  let hovered: Action | null = null;
  let raf = 0;
  let lastFrame = performance.now();
  let disposed = false;
  let audioContext: AudioContext | null = null;
  let fanGain: GainNode | null = null;
  let fanOscillator: OscillatorNode | null = null;
  const colorSampleCanvas = document.createElement('canvas');
  colorSampleCanvas.width = 8;
  colorSampleCanvas.height = 8;
  const colorSampleContext = colorSampleCanvas.getContext('2d', { willReadFrequently: true });
  const indicatorOffColor = new THREE.Color('#481f27');
  const indicatorOnColor = new THREE.Color('#d7d6c7');
  const indicatorOffGlow = new THREE.Color('#8f3544');
  const indicatorOnGlow = new THREE.Color('#eee6cf');

  const actionNames: Record<Action, string> = {
    projector: root.dataset.labelProjector ?? 'Projector',
    power: root.dataset.labelPower ?? 'Power',
    source: root.dataset.labelSource ?? 'Source',
    play: `${labels.play} / ${labels.pause}`,
    prev: root.dataset.labelPrev ?? 'Previous',
    next: root.dataset.labelNext ?? 'Next',
    focus: root.dataset.labelFocus ?? 'Focus',
  };

  function setMachine(next: MachineState): void {
    machine = next;
    machineChangedAt = performance.now();
    root.dataset.machine = next;
    const status = labels[next === 'off' ? 'standby' : next];
    if (stateEl) stateEl.textContent = status;
    if (playButton) playButton.textContent = next === 'playing' ? labels.pause : labels.play;
    const detail = source
      ? source.kind === 'images'
        ? `${source.items.length} ${locale === 'zh' ? '张图片' : 'images'}`
        : source.title
      : labels.noSource;
    display.draw(next, detail);
  }

  function ensureAudio(): AudioContext | null {
    if (audioContext) {
      void audioContext.resume();
      return audioContext;
    }
    const AudioCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioContext = new AudioCtor();
    return audioContext;
  }

  function clickSound(frequency = 110, duration = 0.08): void {
    const ctx = ensureAudio();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0.045, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }

  function startFan(): void {
    const ctx = ensureAudio();
    if (!ctx || fanOscillator) return;
    fanOscillator = ctx.createOscillator();
    fanGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const pan = ctx.createStereoPanner();
    fanOscillator.type = 'sawtooth';
    fanOscillator.frequency.value = 58;
    filter.type = 'lowpass';
    filter.frequency.value = 145;
    pan.pan.value = 0.62;
    fanGain.gain.value = 0.0001;
    fanOscillator.connect(filter).connect(pan).connect(fanGain).connect(ctx.destination);
    fanOscillator.start();
    fanGain.gain.exponentialRampToValueAtTime(0.018, ctx.currentTime + 1.1);
  }

  function stopFan(): void {
    if (!audioContext || !fanGain || !fanOscillator) return;
    const oscillator = fanOscillator;
    fanGain.gain.cancelScheduledValues(audioContext.currentTime);
    fanGain.gain.setValueAtTime(Math.max(fanGain.gain.value, 0.0001), audioContext.currentTime);
    fanGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 1.3);
    oscillator.stop(audioContext.currentTime + 1.35);
    fanGain = null;
    fanOscillator = null;
  }

  function showHint(message: string): void {
    if (!hint) return;
    hint.textContent = message;
    window.setTimeout(() => {
      if (hint) hint.textContent = defaultHint;
    }, 2200);
  }

  function pressButton(action: Action): void {
    const mesh = buttons.find((button) => button.userData.action === action);
    if (mesh) mesh.userData.press = 1;
    clickSound(action === 'power' ? 82 : 132, action === 'power' ? 0.13 : 0.075);
  }

  function powerOn(autoplay = false): void {
    if (machine !== 'off') return;
    autoplayWhenReady = autoplay;
    pressButton('power');
    clickSound(64, 0.18);
    startFan();
    screenStandby.draw(labels.starting, source ? `${labels.selected}: ${source.kind === 'video' ? source.title : source.items[0]?.title ?? ''}` : labels.noSource);
    screenMaterial.uniforms.tMap.value = screenStandby.texture;
    screenMaterial.uniforms.uMediaAspect.value = SCREEN_ASPECT;
    setMachine('starting');
  }

  function powerOff(): void {
    if (machine === 'off' || machine === 'cooling') return;
    pressButton('power');
    video?.pause();
    setMachine('cooling');
  }

  function clearVideo(): void {
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    videoTexture?.dispose();
    video = null;
    videoTexture = null;
    pendingVideo = false;
    videoLoaded = false;
  }

  function clearLocalSource(): void {
    if (!source) return;
    if (source.kind === 'images') {
      for (const item of source.items) {
        if (!item.local) continue;
        textureCache.get(item.src)?.dispose();
        textureCache.delete(item.src);
        URL.revokeObjectURL(item.src);
      }
    } else if (source.local) URL.revokeObjectURL(source.src);
  }

  async function showImage(index: number): Promise<void> {
    if (!source || source.kind !== 'images' || source.items.length === 0) return;
    const requestedSource = source;
    const requestedIndex = (index + source.items.length) % source.items.length;
    const item = source.items[requestedIndex];
    const request = ++imageRequest;
    try {
      let texture = textureCache.get(item.src);
      if (!texture) {
        texture = await textureLoader.loadAsync(item.src);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        textureCache.set(item.src, texture);
      }
      if (request !== imageRequest || source !== requestedSource) return;
      const image = texture.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined;
      const width = image?.naturalWidth ?? image?.width ?? 16;
      const height = image?.naturalHeight ?? image?.height ?? 9;
      pendingImage = { texture, width, height, index: requestedIndex, title: item.title };
      imageTransition = 'out';
    } catch {
      showHint(labels.uploadFailed);
    }
  }

  function prepareVideo(selected: VideoSource): void {
    clearVideo();
    video = document.createElement('video');
    video.src = selected.src;
    video.preload = 'metadata';
    video.playsInline = true;
    video.loop = false;
    video.crossOrigin = 'anonymous';
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoLoaded = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    video.addEventListener('loadeddata', () => {
      videoLoaded = true;
    });
    video.addEventListener('loadedmetadata', () => {
      if (!video) return;
      screenMaterial.uniforms.uMediaAspect.value = video.videoWidth / Math.max(video.videoHeight, 1);
      screenMaterial.uniforms.uTexel.value.set(1 / Math.max(video.videoWidth, 1), 1 / Math.max(video.videoHeight, 1));
    });
    video.addEventListener('ended', () => setMachine('paused'));
  }

  function setSource(next: MediaSource): void {
    const wasPlaying = machine === 'playing';
    imageRequest += 1;
    pendingImage = null;
    imageTransition = 'idle';
    imageFade = 1;
    clearLocalSource();
    clearVideo();
    source = next;
    imageIndex = 0;
    if (next.kind === 'images') void showImage(0);
    else {
      prepareVideo(next);
      if (wasPlaying) {
        pendingVideo = true;
        imageTransition = 'out';
        void video?.play().catch(() => {
          pendingVideo = false;
          imageTransition = 'in';
          showHint(labels.uploadFailed);
        });
      }
    }
    const description = next.kind === 'images'
      ? `${next.items.length} ${locale === 'zh' ? '张图片' : 'images'}`
      : next.title;
    display.draw(machine, description);
    showHint(`${labels.selected}: ${description}`);
    sourceDialog?.close();
  }

  async function startPlayback(): Promise<void> {
    if (!source) {
      showHint(labels.noSource);
      sourceDialog?.showModal();
      return;
    }
    if (machine === 'off') {
      powerOn(true);
      return;
    }
    if (machine === 'starting' || machine === 'cooling') return;
    if (machine === 'playing') {
      video?.pause();
      setMachine('paused');
      return;
    }
    if (source.kind === 'video') {
      if (!video) prepareVideo(source);
      pendingVideo = true;
      videoLoaded = (video?.readyState ?? 0) >= HTMLMediaElement.HAVE_CURRENT_DATA;
      imageTransition = 'out';
      try {
        await video?.play();
      } catch {
        pendingVideo = false;
        imageTransition = 'in';
        showHint(labels.uploadFailed);
        return;
      }
    } else if (currentTexture === screenStandby.texture) {
      await showImage(imageIndex);
    }
    slideChangedAt = performance.now();
    setMachine('playing');
  }

  function changeSlide(direction: number): void {
    if (!source) return;
    if (source.kind === 'images') void showImage(imageIndex + direction);
    else if (video) video.currentTime = clamp(video.currentTime + direction * 10, 0, video.duration || Infinity);
  }

  function openSource(): void {
    pressButton('source');
    sourceDialog?.showModal();
  }

  function triggerAction(action: Action): void {
    if (action === 'projector') {
      setView('projector');
      return;
    }
    if (action === 'power') {
      machine === 'off' ? powerOn() : powerOff();
      return;
    }
    if (action === 'source') {
      openSource();
      return;
    }
    pressButton(action);
    if (action === 'play') void startPlayback();
    if (action === 'prev') changeSlide(-1);
    if (action === 'next') changeSlide(1);
    if (action === 'focus' && focusPanel) focusPanel.hidden = false;
  }

  function setView(next: ViewMode): void {
    view = next;
    cameraTransitioning = true;
    lookYaw = 0;
    lookPitch = next === 'seat' ? -0.02 : -0.08;
    if (focusPanel) focusPanel.hidden = next !== 'projector';
    if (viewButton) {
      viewButton.dataset.view = next;
      viewButton.textContent = next === 'seat'
        ? root.dataset.labelProjector ?? 'Projector'
        : root.dataset.labelSeat ?? 'Seat';
    }
  }

  function setPointer(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickAction(event: PointerEvent): Action | null {
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    // In close-up the body sits immediately under the controls; prefer a control
    // hit so the large body target cannot steal a deliberate button press.
    const hit = view === 'projector'
      ? hits.find((item) => item.object.userData.action !== 'projector') ?? hits[0]
      : hits[0];
    return (hit?.object.userData.action as Action | undefined) ?? null;
  }

  function sampleAverageColor(now: number): void {
    if (now - lastColorSample < 120 || machine !== 'playing') return;
    lastColorSample = now;
    const image = currentTexture.image as CanvasImageSource | undefined;
    if (!image) return;
    const ctx = colorSampleContext;
    if (!ctx) return;
    try {
      ctx.drawImage(image, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      const count = data.length / 4;
      r /= count * 255;
      g /= count * 255;
      b /= count * 255;
      averageColor.setRGB(r, g, b).lerp(new THREE.Color('#d9d4ca'), 0.22);
      averageLuma = clamp(r * 0.2126 + g * 0.7152 + b * 0.0722, 0.08, 0.78);
    } catch {
      averageColor.set('#dbe3df');
      averageLuma = 0.42;
    }
  }

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  canvas.addEventListener('pointerdown', (event) => {
    ensureAudio();
    if (view === 'projector' && pickAction(event) === 'focus') {
      focusDragging = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
      if (focusPanel) focusPanel.hidden = false;
      return;
    }
    dragging = true;
    dragDistance = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (focusDragging) {
      focusValue = clamp(focusValue + (event.clientX - lastX) * 0.004, 0, 1);
      lastX = event.clientX;
      lensBarrel.rotation.z = (focusValue - 0.5) * 0.7;
      if (focusInput) focusInput.value = String(focusValue);
      return;
    }
    if (dragging) {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      dragDistance += Math.abs(dx) + Math.abs(dy);
      lookYaw = clamp(lookYaw - dx * 0.003, view === 'seat' ? -0.72 : -0.26, view === 'seat' ? 0.72 : 0.26);
      lookPitch = clamp(lookPitch - dy * 0.0025, -0.35, 0.25);
      lastX = event.clientX;
      lastY = event.clientY;
      cameraTransitioning = false;
      hovered = null;
      if (tooltip) tooltip.hidden = true;
      return;
    }
    hovered = pickAction(event);
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
    if (tooltip) {
      tooltip.hidden = !hovered;
      if (hovered) {
        tooltip.textContent = actionNames[hovered];
        const rect = root.getBoundingClientRect();
        tooltip.style.left = `${event.clientX - rect.left}px`;
        tooltip.style.top = `${event.clientY - rect.top}px`;
      }
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (focusDragging) {
      focusDragging = false;
      return;
    }
    dragging = false;
    if (dragDistance < 8) {
      const action = pickAction(event);
      if (action) triggerAction(view === 'seat' ? 'projector' : action);
    }
  });
  canvas.addEventListener('pointerleave', () => {
    dragging = false;
    focusDragging = false;
    hovered = null;
    if (tooltip) tooltip.hidden = true;
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.fov = clamp(camera.fov + event.deltaY * 0.015, 50, 66);
    camera.updateProjectionMatrix();
  }, { passive: false });

  viewButton?.addEventListener('click', () => setView(view === 'seat' ? 'projector' : 'seat'));
  sourceButton?.addEventListener('click', openSource);
  playButton?.addEventListener('click', () => void startPlayback());
  gallerySeriesButton?.addEventListener('click', () => {
    if (galleryItems.length === 0) return;
    setSource({ kind: 'images', items: galleryItems.map((item) => ({ src: item.src, title: item.title })) });
  });
  imageInput?.addEventListener('change', () => {
    const files = Array.from(imageInput.files ?? []);
    if (files.length === 0) return;
    setSource({
      kind: 'images',
      items: files.map((file) => ({ src: URL.createObjectURL(file), title: file.name, local: true })),
    });
    imageInput.value = '';
  });
  videoInput?.addEventListener('change', () => {
    const file = videoInput.files?.[0];
    if (!file) return;
    setSource({ kind: 'video', src: URL.createObjectURL(file), title: file.name, local: true });
    videoInput.value = '';
  });
  intervalInput?.addEventListener('change', () => {
    slideInterval = Number(intervalInput.value) || 5;
  });
  focusInput?.addEventListener('input', () => {
    focusValue = Number(focusInput.value);
    lensBarrel.rotation.z = (focusValue - 0.5) * 0.7;
  });
  immersiveButton?.addEventListener('click', () => {
    const immersive = !document.body.classList.contains('is-screening-immersive');
    document.body.classList.toggle('is-screening-immersive', immersive);
    immersiveButton.setAttribute('aria-pressed', String(immersive));
    immersiveButton.textContent = immersive
      ? root.dataset.labelExit ?? 'Exit'
      : root.dataset.labelImmersive ?? 'Immersive';
    resize();
  });
  window.addEventListener('keydown', (event) => {
    if (sourceDialog?.open) return;
    if (event.code === 'Space') {
      event.preventDefault();
      void startPlayback();
    }
    if (event.key === 'ArrowLeft') changeSlide(-1);
    if (event.key === 'ArrowRight') changeSlide(1);
    if (event.key.toLowerCase() === 'p') setView(view === 'seat' ? 'projector' : 'seat');
    if (event.key === 'Escape' && document.body.classList.contains('is-screening-immersive')) {
      document.body.classList.remove('is-screening-immersive');
      immersiveButton?.setAttribute('aria-pressed', 'false');
      if (immersiveButton) immersiveButton.textContent = root.dataset.labelImmersive ?? 'Immersive';
      resize();
    }
  });

  function animate(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    const elapsed = (now - machineChangedAt) / 1000;

    if (machine === 'starting' && elapsed >= (reducedMotion ? 0.3 : 2.8)) {
      setMachine('ready');
      if (source?.kind === 'images') void showImage(imageIndex);
      if (autoplayWhenReady) {
        autoplayWhenReady = false;
        void startPlayback();
      }
    }
    if (machine === 'cooling' && elapsed >= (reducedMotion ? 0.3 : 3.2)) {
      stopFan();
      screenStandby.draw(labels.standby, 'NO SIGNAL');
      screenMaterial.uniforms.tMap.value = screenStandby.texture;
      screenMaterial.uniforms.uMediaAspect.value = SCREEN_ASPECT;
      setMachine('off');
    }
    if (
      machine === 'playing' &&
      source?.kind === 'images' &&
      imageTransition === 'idle' &&
      now - slideChangedAt >= slideInterval * 1000
    ) {
      void showImage(imageIndex + 1);
    }

    if (imageTransition === 'out') {
      imageFade = damp(imageFade, 0, reducedMotion ? 30 : 10, dt);
      if (imageFade < 0.035 && pendingImage && source?.kind === 'images') {
        const next = pendingImage;
        pendingImage = null;
        imageIndex = next.index;
        currentTexture = next.texture;
        screenMaterial.uniforms.tMap.value = next.texture;
        screenMaterial.uniforms.uMediaAspect.value = next.width / Math.max(next.height, 1);
        screenMaterial.uniforms.uTexel.value.set(1 / Math.max(next.width, 1), 1 / Math.max(next.height, 1));
        display.draw(machine, `${imageIndex + 1}/${source.items.length} · ${next.title}`);
        slideChangedAt = now;
        imageTransition = 'in';
      } else if (imageFade < 0.035 && pendingVideo && videoLoaded && videoTexture && source?.kind === 'video') {
        currentTexture = videoTexture;
        screenMaterial.uniforms.tMap.value = videoTexture;
        pendingVideo = false;
        imageTransition = 'in';
      }
    } else if (imageTransition === 'in') {
      imageFade = damp(imageFade, 1, reducedMotion ? 30 : 6, dt);
      if (imageFade > 0.985) {
        imageFade = 1;
        imageTransition = 'idle';
      }
    }

    const startup = machine === 'starting' ? smoothstep(elapsed / 2.2) : 0;
    const cooling = machine === 'cooling' ? 1 - smoothstep(elapsed / 1.25) : 1;
    const powered = machine === 'off' ? 0 : machine === 'starting' ? startup : machine === 'cooling' ? cooling : 1;
    const isPlaying = machine === 'playing' ? 1 : 0;
    const targetBrightness = powered * (isPlaying ? 1 : machine === 'ready' || machine === 'paused' ? 0.68 : 0.42) * imageFade;
    screenBrightness = damp(screenBrightness, Math.max(0.012, targetBrightness), 5, dt);
    screenMaterial.uniforms.uBrightness.value = screenBrightness;
    screenMaterial.uniforms.uFocus.value = Math.abs(focusValue - 0.82) * 1.35;

    const targetBeam = powered * (isPlaying ? 0.16 + averageLuma * 0.16 : 0.075);
    beamOpacity = damp(beamOpacity, targetBeam, 3.5, dt);
    beam.material.uniforms.uOpacity.value = beamOpacity;
    beam.material.uniforms.uTime.value = now / 1000;
    beam.material.uniforms.uColor.value.lerp(averageColor, 0.04);
    dustMaterial.opacity = damp(dustMaterial.opacity, beamOpacity * 0.7, 3, dt);
    dust.rotation.y += dt * 0.002;

    roomLevel = damp(roomLevel, machine === 'playing' ? 0.18 : machine === 'paused' ? 0.28 : powered ? 0.45 : 1, 2.4, dt);
    ambient.intensity = 0.16 + roomLevel * 0.3;
    hemisphere.intensity = 0.24 + roomLevel * 0.68;
    ceilingLight.intensity = 14 + roomLevel * 82;
    sideLight.intensity = 8 + roomLevel * 38;
    screenLight.intensity = damp(screenLight.intensity, isPlaying ? 6 + averageLuma * 18 : powered * 2.2, 3.5, dt);
    screenLight.color.lerp(averageColor, 0.06);
    lensGlassMaterial.emissiveIntensity = damp(lensGlassMaterial.emissiveIntensity, powered * 2.4, 4, dt);
    indicatorMaterial.emissiveIntensity = damp(indicatorMaterial.emissiveIntensity, machine === 'off' ? 0.18 : 2.2, 5, dt);
    indicatorMaterial.color.lerp(machine === 'off' ? indicatorOffColor : indicatorOnColor, 0.12);
    indicatorMaterial.emissive.lerp(machine === 'off' ? indicatorOffGlow : indicatorOnGlow, 0.12);
    lensCover.position.x = damp(lensCover.position.x, powered ? 0.05 : -0.22, 4.6, dt);
    lensCover.position.y = 0.19;
    lensCover.position.z = -0.54;
    seat.scale.y = damp(seat.scale.y, view === 'seat' ? 0.94 : 1, 3.5, dt);

    for (const button of buttons) {
      button.position.y = damp(button.position.y, button.userData.baseY - button.userData.press * 0.014, 28, dt);
      button.userData.press = damp(button.userData.press, 0, 14, dt);
    }

    const pose = view === 'seat' ? seatPose : projectorPose;
    if (cameraTransitioning) {
      const rate = reducedMotion ? 30 : 3.6;
      camera.position.lerp(pose.position, 1 - Math.exp(-rate * dt));
      camera.quaternion.slerp(pose.quaternion, 1 - Math.exp(-rate * dt));
      if (camera.position.distanceTo(pose.position) < 0.012 && camera.quaternion.angleTo(pose.quaternion) < 0.008) {
        camera.position.copy(pose.position);
        camera.quaternion.copy(pose.quaternion);
        cameraTransitioning = false;
      }
    } else {
      camera.position.lerp(pose.position, 1 - Math.exp(-8 * dt));
      const baseQuaternion = pose.quaternion.clone();
      const lookOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(lookPitch, lookYaw, 0, 'YXZ'));
      camera.quaternion.copy(baseQuaternion).multiply(lookOffset);
    }

    sampleAverageColor(now);
    renderer.render(scene, camera);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    document.body.classList.remove('is-screening-immersive');
    clearLocalSource();
    clearVideo();
    stopFan();
    void audioContext?.close();
    for (const texture of textureCache.values()) texture.dispose();
    for (const item of disposables) item.dispose();
    renderer.dispose();
  }

  root.dataset.ready = 'true';
  setMachine('off');
  raf = requestAnimationFrame(animate);
  window.addEventListener('pagehide', dispose, { once: true });
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * 3D 展厅：three.js 场景的搭建与拾取。
 *
 * 只在 mountGallery 确认设备能跑 WebGL 之后才被动态 import —— 不支持的设备
 * 连这个 chunk 都不会下载。交互与 DOM 逻辑在 index.ts，这里只管「展厅长什么样」。
 *
 * 形制参考金贝尔美术馆（Louis Kahn）：并联的摆线筒拱顶，拱顶中央一条通长的
 * 天光缝，缝下两片曲面铝反光翼。除了墙，室内还有几样把「空房间」撑成展厅的
 * 东西：长墙按展位分间的壁柱、拱门的石门套、起拱线下的檐口、端墙前的长凳，
 * 地上一条中轴石材带、沿墙一圈深色走边，以及天光落在地上的那道光。
 * 观感上的几条取舍：
 * - 拱壳与反光翼都是手写 BufferGeometry：ExtrudeGeometry 非索引（扁拱会看出
 *   棱），侧面 UV 按 |Δy|<|Δx| 二选一，在摆线起拱处会断裂。法线自己算，
 *   绕序保证内表面朝下，省一次翻转。
 * - 拱顶的明暗是**画**出来的（渐变同时当 map 与 emissiveMap），不靠模拟：
 *   在缝下挂点光源会让拱顶过曝、墙上出现一串光斑，而且没开阴影时光会越过
 *   墙顶漏进隔壁拱顶。
 * - 天光用 RectAreaLight（线光源的正确软衰减）+ PMREM 环境贴图；没有 envMap
 *   时 metalness 0.8 的铝翼会近似全黑。
 * - 墙是「两片背靠背」拼的（每片属于一个拱顶），共享墙开拱门后两侧各自留面。
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import {
  SPRING_H,
  VAULT_METRICS,
  vaultProfile,
  vaultRise,
  type FloorPlan,
  type ProfilePoint,
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
  /**
   * 站到某件作品正前方 1.5m 的位置（世界坐标 x/z），由调用方夹回可行走区。
   * yaw 是站在那儿正对画心该有的视线角（相机绕 y 轴转，0 面朝 -z）。
   */
  viewpoint(id: string): { x: number; z: number; yaw: number } | null;
  /** 悬停高亮：传 id 点亮那件作品的画框，传 null 全部熄灭 */
  setHover(id: string | null): void;
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
const BASEBOARD_H = 0.08;
/** 展签宽度（高是一半）：要走近了能读清，比真实展签大一圈 */
const LABEL_W = 0.24;
/** 一片墙的厚度（两片背靠背拼成一整堵墙） */
const PANEL_T = 0.07;
/** 拱壳与反光翼的厚度 */
const SHELL_T = 0.12;
const WING_T = 0.02;
/** 天光缝下那道细格栅的条数与粗细 */
const BAR_COUNT = 7;
/** 反光翼比天光缝低多少、往外出多少 */
const WING_DROP = 0.32;
/** 壁柱：长墙上分展位的竖挺；比檐口再出挑一点，免得两者共面打架 */
const PILASTER_W = 0.18;
const PILASTER_T = 0.062;
/** 起拱线下的檐口：出挑的横线 + 上面留一条暗缝 */
const CORNICE_H = 0.1;
const CORNICE_T = 0.05;
/** 拱门门套：门洞两侧的竖挺与顶上的横楣 */
const PORTAL_W = 0.16;
const PORTAL_T = 0.035;
/** 地面：中轴石材带的宽度、沿墙走边的宽度，以及天光落地那道光比缝宽出多少 */
const RUNNER_W = 1.3;
const BORDER_W = 0.3;
const POOL_PAD = 1.9;
/** 长凳：座面高度、座面厚度、支墩宽度 */
const BENCH_H = 0.42;
const BENCH_T = 0.09;
const BENCH_LEG = 0.1;

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
 * 石灰华：暖米色 + 水平层理 + 竖向分缝（金贝尔的墙是竖板拼的），
 * 再点一些细孔。竖缝按贴图宽度均分，配合 repeat 就是一块块墙板。
 * base 可以调深浅：地面那条中轴石材带要的是更浅一号的石头。
 */
function travertineTexture(base = '#ded5c6'): THREE.CanvasTexture {
  return paint(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // 水平层理：一道道深浅不一的波浪
    for (let i = 0; i < 26; i += 1) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,252,244' : '188,176,156'},0.16)`;
      ctx.lineWidth = 2 + Math.random() * 7;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) {
        ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 2 + i) * 5);
      }
      ctx.stroke();
    }

    // 细孔
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = `rgba(150,138,118,${0.05 + Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1);
    }

    // 竖向分缝：两块板之间的一道暗缝
    for (const x of [w * 0.25, w * 0.5, w * 0.75]) {
      ctx.fillStyle = 'rgba(120,110,94,0.22)';
      ctx.fillRect(x - 1, 0, 2, h);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + 1, 0, 1, h);
    }
  });
}

/** 白橡木地面：板缝沿长轴走，带一点木纹 */
function oakTexture(): THREE.CanvasTexture {
  return paint(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d8c6a8';
    ctx.fillRect(0, 0, w, h);
    // 木纹：细长的深浅丝
    for (let i = 0; i < 260; i += 1) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,246,228' : '166,142,110'},0.14)`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 8);
      ctx.stroke();
    }
    // 板缝：每 1/4 一道
    for (let i = 0; i < 4; i += 1) {
      const y = (i / 4) * h;
      ctx.fillStyle = 'rgba(120,98,70,0.28)';
      ctx.fillRect(0, y, w, 2);
    }
  });
}

/** 混凝土拱顶：很淡的颗粒，明暗交给 emissiveMap 的渐变 */
function concreteTexture(): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e6e4de';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.055);
  });
}

/**
 * 拱顶的明暗：从起拱点（暗）到拱顶（亮）再回到另一侧，横向一条对称渐变。
 * u 沿拱断面（0 与 1 是两侧起拱点，0.5 是拱顶），v 沿长度 —— 明暗是画出来的。
 */
function vaultLightTexture(): THREE.CanvasTexture {
  return paint(256, 8, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#8e9298');
    gradient.addColorStop(0.28, '#c8ccd1');
    gradient.addColorStop(0.5, '#ffffff');
    gradient.addColorStop(0.72, '#c8ccd1');
    gradient.addColorStop(1, '#8e9298');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

/** 天光缝：中间白、两侧偏冷，像被拱顶切了一条的天空 */
function skyTexture(): THREE.CanvasTexture {
  return paint(64, 8, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#cfe0f2');
    gradient.addColorStop(0.5, '#ffffff');
    gradient.addColorStop(1, '#cfe0f2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
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

/**
 * 天光落在地上的那道光：横向是一条中间亮两侧淡的带子，纵向两端淡出。
 * 没开阴影，投影算不出来，这道光是画在地上的 —— 但天光本来就该在地上留一道。
 */
function floorPoolTexture(): THREE.CanvasTexture {
  return paint(64, 64, (ctx, w, h) => {
    const across = ctx.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, w, h);

    // 沿长度两端淡出：destination-in 只留下竖着那段的 alpha
    const along = ctx.createLinearGradient(0, 0, 0, h);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.14, 'rgba(255,255,255,1)');
    along.addColorStop(0.86, 'rgba(255,255,255,1)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, w, h);
  });
}

/** 环境贴图用的 equirect：上半天光、下半地面反弹，只为给金属与石材一点反射 */
function environmentTexture(): THREE.CanvasTexture {
  const texture = paint(64, 32, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#e8f1fb');
    gradient.addColorStop(0.5, '#dcd8d0');
    gradient.addColorStop(1, '#a9a093');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/**
 * 门洞上方（端墙上）的房间名牌 / 端墙上的展厅名。
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

/**
 * 墙上的作品展签：标题 + 一行小字的器材，左对齐、标题下压一道细线。
 * 跟房间名牌分两张画：名牌要边框、要居中，展签是展签的样子。
 */
function wallLabelTexture(title: string, meta: string): THREE.CanvasTexture {
  return paint(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#efece4';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 标题：两行放不下就缩字号（短标题走一遍就过）
    let size = 46;
    let lines = wrap(ctx, title, `600 ${size}px`, w - 72);
    while (lines.length > 2 && size > 28) {
      size -= 6;
      lines = wrap(ctx, title, `600 ${size}px`, w - 72);
    }
    ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

    let y = 92;
    ctx.fillStyle = '#23262b';
    for (const line of lines.slice(0, 3)) {
      ctx.fillText(line, 36, y);
      y += size * 1.18;
    }

    // 标题与器材之间那道细线
    const rule = Math.min(y + 14, h - 62);
    ctx.fillStyle = 'rgba(35,38,43,0.28)';
    ctx.fillRect(36, rule, w - 72, 2);

    if (meta) {
      ctx.font = '400 30px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(35,38,43,0.66)';
      ctx.fillText(ellipsize(ctx, meta, w - 72), 36, rule + 40);
    }
  });
}

/** 一个汉字 / 一串西文单词 / 一段空白：中文按字断行，西文不从单词中间断开 */
const CJK_WORD = /[\u4e00-\u9fff\u3000-\u303f]|[^\s\u4e00-\u9fff\u3000-\u303f]+|\s+/g;

/**
 * 按给定字体把一段文字折成若干行。
 * 中文逐字可断，西文按空格断：切分时不按码点走，按「一个汉字 / 一串西文
 * 单词」取词，英文标题就不会从单词中间断开。
 */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxWidth: number,
): string[] {
  ctx.font = font;
  const lines: string[] = [];
  let line = '';

  // 汉字单独成词，连续的西文/数字算一个词，空格自成一个词（行首不留空格）
  const tokens = text.match(CJK_WORD) ?? [];
  for (const word of tokens) {
    if (/^\s+$/.test(word) && !line) continue;
    if (ctx.measureText(line + word).width > maxWidth && line) {
      lines.push(line.trimEnd());
      line = /^\s+$/.test(word) ? '' : word;
    } else {
      line += word;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** 断面上一点的外法线：切线逆时针转 90°（摆线在起拱点是竖直的，正好朝外） */
function outwardNormal(points: ProfilePoint[], index: number): { x: number; y: number } {
  const prev = points[Math.max(index - 1, 0)];
  const next = points[Math.min(index + 1, points.length - 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

/**
 * 把一条断面沿 z 挤成一层薄壳（拱壳、反光翼都用它）。
 *
 * 内表面法线朝 -n（朝室内/朝下），外表面朝 +n；UV 的 u 按断面弧长归一
 * （0 与 1 是两端，0.5 附近是拱顶，正好对上明暗渐变），v 沿长度归一。
 * 这个函数不碰 DOM，可以在 node 里直接构造做几何断言。
 */
export function buildShell(profile: ProfilePoint[], length: number, thickness: number): THREE.BufferGeometry {
  const count = profile.length;
  const half = length / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 累计弧长，u 按弧长归一（顶点密度已经是弧长等距的，这里只是归一）
  const arc: number[] = [0];
  for (let i = 1; i < count; i += 1) {
    arc.push(arc[i - 1] + Math.hypot(profile[i].x - profile[i - 1].x, profile[i].y - profile[i - 1].y));
  }
  const total = arc[count - 1] || 1;

  const push = (x: number, y: number, z: number, nx: number, ny: number, u: number, v: number): number => {
    positions.push(x, y, z);
    // 断面在 xy 平面、挤出沿 z，所以断面的法线 (nx, ny) 就是世界法线的前两维
    normals.push(nx, ny, 0);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  for (let i = 0; i < count; i += 1) {
    const point = profile[i];
    const normal = outwardNormal(profile, i);
    const u = arc[i] / total;
    const outer = { x: point.x + normal.x * thickness, y: point.y + normal.y * thickness };

    // 每个断面点在 z 的两端各生成一对（内 / 外）顶点
    const back = -half;
    const front = half;
    const innerBack = push(point.x, point.y, back, -normal.x, -normal.y, u, 0);
    const innerFront = push(point.x, point.y, front, -normal.x, -normal.y, u, 1);
    const outerBack = push(outer.x, outer.y, back, normal.x, normal.y, u, 0);
    const outerFront = push(outer.x, outer.y, front, normal.x, normal.y, u, 1);

    if (i > 0) {
      const step = 4;
      const prevInnerBack = innerBack - step;
      const prevInnerFront = innerFront - step;
      const prevOuterBack = outerBack - step;
      const prevOuterFront = outerFront - step;
      // 内表面：绕序保证法线朝室内（拱顶处是朝下）
      indices.push(prevInnerBack, innerBack, innerFront);
      indices.push(prevInnerBack, innerFront, prevInnerFront);
      // 外表面：朝室外
      indices.push(prevOuterBack, outerFront, outerBack);
      indices.push(prevOuterBack, prevOuterFront, outerFront);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * 拱顶两端的封口：起拱线以上的拱形墙面。
 * 用外扩后的断面（盖住拱壳的厚度），免得端墙与壳体之间露出一条缝。
 */
export function buildEndArch(profile: ProfilePoint[], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const first = profile[0];
  const outerFirst = (() => {
    const normal = outwardNormal(profile, 0);
    return { x: first.x + normal.x * thickness, y: first.y + normal.y * thickness };
  })();
  shape.moveTo(outerFirst.x, outerFirst.y);
  profile.forEach((point, index) => {
    const normal = outwardNormal(profile, index);
    shape.lineTo(point.x + normal.x * thickness, point.y + normal.y * thickness);
  });
  shape.lineTo(-outerFirst.x, outerFirst.y);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function createFloor({ canvas, plan }: CreateFloorOptions): FloorHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const diagonal = Math.hypot(spanX, spanZ);
  // 所有拱同长（plan.ts 保证）：地面那几条带子与天光的长度共用这两个数
  const vaultLength = plan.vaults[0]?.length ?? 0;
  const slotLength = Math.max(1, vaultLength - VAULT_METRICS.slotInset * 2);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cbc7c0');
  // 室内是封闭的，也用不着雾把远处糊掉

  // 筒拱里广角会把弧面拉变形，也会让边上的画透视失真
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, diagonal * 2 + 6);

  const disposables: Disposable[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---- 全展厅共用的一份贴图与单位几何 ----
  const travertineMap = track(travertineTexture());
  travertineMap.repeat.set(3, 1.2);
  const oakMap = track(oakTexture());
  oakMap.repeat.set(2, 3);
  const concreteMap = track(concreteTexture());
  concreteMap.repeat.set(7, 9);
  const vaultLightMap = track(vaultLightTexture());
  const skyMap = track(skyTexture());
  const glowMap = track(radialTexture('255,255,255'));
  const shadowMap = track(radialTexture('0,0,0'));
  const poolMap = track(floorPoolTexture());
  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  // 中轴石材带与沿墙走边：所有拱同长，几何做一份就够了
  const runnerLength = Math.max(1, vaultLength - 1.6);
  const runnerGeometry = track(new THREE.PlaneGeometry(RUNNER_W, runnerLength));
  const borderGeometry = track(new THREE.PlaneGeometry(BORDER_W, Math.max(1, vaultLength)));

  // ---- 统一材质：石灰华墙 / 白橡木地 / 混凝土拱 / 拉丝铝 ----
  const wallMaterial = track(
    new THREE.MeshStandardMaterial({ map: travertineMap, roughness: 0.78, metalness: 0.02 }),
  );
  // 抛光到能映出一点天光：展厅的地面不该是哑光的
  const floorMaterial = track(
    new THREE.MeshStandardMaterial({
      map: oakMap,
      roughness: 0.42,
      metalness: 0.06,
      envMapIntensity: 0.7,
    }),
  );
  const vaultMaterial = track(
    new THREE.MeshStandardMaterial({
      map: concreteMap,
      // 明暗画在 emissiveMap 里：拱脚暗、拱顶亮，比用灯照更可控
      emissive: 0xffffff,
      emissiveMap: vaultLightMap,
      emissiveIntensity: 0.3,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  const aluminiumMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#d3d8dc', roughness: 0.34, metalness: 0.82 }),
  );
  const barMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#6f747a', roughness: 0.42, metalness: 0.6 }),
  );
  const skyMaterial = track(
    new THREE.MeshBasicMaterial({ map: skyMap, toneMapped: false, fog: false }),
  );
  const revealMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#8d8578', roughness: 0.7 }),
  );
  const baseMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.5, metalness: 0.1 }),
  );
  /** 深色石材：地面走边、门槛石 */
  const stoneMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#4e4842', roughness: 0.46, metalness: 0.08 }),
  );
  /** 门套石：比墙深一号，门洞才看得出是个「门」 */
  const portalMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#c0b7a4', roughness: 0.6, metalness: 0.04 }),
  );
  // 中轴的浅色石材带：浅一号的石灰华，给地面一个方向
  const runnerMap = track(travertineTexture('#e7e1d3'));
  runnerMap.repeat.set(RUNNER_W / 1.8, runnerLength / 1.8);
  const runnerMaterial = track(
    new THREE.MeshStandardMaterial({ map: runnerMap, roughness: 0.42, metalness: 0.03 }),
  );
  // 长凳：一小块橡木，板缝 11cm 正好是条凳的宽度
  const benchMap = track(oakMap.clone());
  benchMap.repeat.set(3, 1);
  const benchMaterial = track(
    new THREE.MeshStandardMaterial({ map: benchMap, roughness: 0.5, metalness: 0.04 }),
  );
  /** 天光落地那道光：加色混合，压得很淡，只作「天光漏下来」的暗示 */
  const poolMaterial = track(
    new THREE.MeshBasicMaterial({
      map: poolMap,
      color: '#ffeed3',
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const frameMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#1f2329', roughness: 0.42, metalness: 0.28 }),
  );
  const matMaterial = track(new THREE.MeshStandardMaterial({ color: '#efece4', roughness: 0.9 }));
  const washMaterial = track(
    new THREE.MeshBasicMaterial({
      map: glowMap,
      color: '#fff6e8',
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      map: shadowMap,
      transparent: true,
      opacity: 0.28,
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

  // ---- 地面 ----
  for (const space of plan.spaces) {
    const width = space.rect.x2 - space.rect.x1;
    const depth = space.rect.z2 - space.rect.z1;
    const floor = new THREE.Mesh(
      track(new THREE.PlaneGeometry(width, depth)),
      floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((space.rect.x1 + space.rect.x2) / 2, 0, (space.rect.z1 + space.rect.z2) / 2);
    floor.userData.isFloor = true;
    scene.add(floor);
    floors.push(floor);

    // 中轴一条浅色石材带 + 沿墙一圈深色走边：地面就有了方向与边界
    const midX = (space.rect.x1 + space.rect.x2) / 2;
    const midZ = (space.rect.z1 + space.rect.z2) / 2;
    const runner = new THREE.Mesh(runnerGeometry, runnerMaterial);
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(midX, 0.008, midZ);
    scene.add(runner);

    for (const side of [-1, 1] as (-1 | 1)[]) {
      const border = new THREE.Mesh(borderGeometry, stoneMaterial);
      border.rotation.x = -Math.PI / 2;
      // 走边从墙面往房间里铺：墙中心线 PANEL_T 之外才是看得见的地面
      border.position.set(
        midX + side * ((space.rect.x2 - space.rect.x1) / 2 - PANEL_T - BORDER_W / 2),
        0.008,
        midZ,
      );
      scene.add(border);
    }
  }

  // ---- 墙（起拱线以下）----
  /** 在墙上贴一块板（墙面 / 门楣）：沿墙方向 [a,b]，竖直方向 [y0,y1] */
  function addPanel(face: WallFace, a: number, b: number, y0: number, y1: number): void {
    const length = b - a;
    const height = y1 - y0;
    const along = (a + b) / 2;
    const offset = PANEL_T / 2;
    const mesh = new THREE.Mesh(unitBox, wallMaterial);
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
  }

  /** 贴着墙面的一条细板：踢脚线、起拱线那道凹槽 */
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

  for (const face of plan.walls) {
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
    // 踢脚线遇到拱门就断开
    for (const [a, b] of solid) {
      addTrim(face, a, b, BASEBOARD_H, 0.024, BASEBOARD_H / 2, baseMaterial);
    }
    // 起拱线下的檐口：一道出挑的横线，上面留一条暗缝 —— 拱顶看着是「落」在
    // 檐口上的，不是糊在墙上的。壁柱比檐口更出挑一点，檐口就绕着壁柱转
    addTrim(
      face,
      face.a,
      face.b,
      CORNICE_H,
      CORNICE_T,
      face.height - CORNICE_H / 2 - 0.014,
      wallMaterial,
    );
    addTrim(face, face.a, face.b, 0.016, CORNICE_T * 0.6, face.height - 0.008, revealMaterial);
  }

  // ---- 拱门：一圈石门套（两根竖挺 + 一条横楣）与门槛石 ----
  for (const door of plan.doors) {
    for (const normal of [1, -1] as (1 | -1)[]) {
      const x = door.x + normal * (PANEL_T + PORTAL_T / 2);
      for (const side of [-1, 1] as (-1 | 1)[]) {
        const jamb = new THREE.Mesh(unitBox, portalMaterial);
        jamb.position.set(
          x,
          (door.height + PORTAL_W) / 2,
          door.z + side * (door.width / 2 + PORTAL_W / 2),
        );
        jamb.scale.set(PORTAL_T, door.height + PORTAL_W, PORTAL_W);
        scene.add(jamb);
        blockers.push(jamb);
      }
      const head = new THREE.Mesh(unitBox, portalMaterial);
      head.position.set(x, door.height + PORTAL_W / 2, door.z);
      head.scale.set(PORTAL_T, PORTAL_W, door.width + PORTAL_W * 2);
      scene.add(head);
      blockers.push(head);
    }

    // 门槛石：门洞地面上一块深色石材，两个拱顶在这里分界
    const sill = new THREE.Mesh(unitBox, stoneMaterial);
    sill.position.set(door.x, 0.012, door.z);
    sill.scale.set(0.42, 0.024, door.width + PORTAL_W * 2);
    scene.add(sill);
  }

  // ---- 壁柱：长墙按展位分间，画挂在开间里 ----
  for (const pilaster of plan.pilasters) {
    const mesh = new THREE.Mesh(unitBox, wallMaterial);
    mesh.position.set(
      pilaster.x + pilaster.normal * (PANEL_T + PILASTER_T / 2),
      SPRING_H / 2,
      pilaster.z,
    );
    mesh.scale.set(PILASTER_T, SPRING_H, PILASTER_W);
    scene.add(mesh);
    blockers.push(mesh);
  }

  // ---- 长凳：端墙前一条，坐下来正好回望整条天光缝 ----
  for (const bench of plan.benches) {
    const seat = new THREE.Mesh(unitBox, benchMaterial);
    seat.position.set(bench.x, BENCH_H, bench.z);
    seat.scale.set(bench.width, BENCH_T, bench.depth);
    scene.add(seat);
    blockers.push(seat);

    for (const side of [-1, 1] as (-1 | 1)[]) {
      const leg = new THREE.Mesh(unitBox, baseMaterial);
      leg.position.set(bench.x + side * (bench.width / 2 - 0.26), BENCH_H / 2, bench.z);
      leg.scale.set(BENCH_LEG, BENCH_H, bench.depth * 0.72);
      scene.add(leg);
      blockers.push(leg);
    }
  }

  // ---- 拱顶：壳体 + 天光缝 + 反光翼 + 端墙拱形 ----
  // 所有拱同长（plan.ts 保证），天光缝通长、两端各留一点别顶到端墙
  const profile = vaultProfile(VAULT_METRICS.width);
  const rise = vaultRise(VAULT_METRICS.width);

  for (const vault of plan.vaults) {
    const apexY = SPRING_H + rise;

    const shell = new THREE.Mesh(buildShell(profile, vault.length, SHELL_T), vaultMaterial);
    shell.position.set(vault.x, SPRING_H, 0);
    scene.add(shell);
    track(shell.geometry);

    // 天光缝：贴在拱顶下沿的一条亮面（不用在壳上开洞，看不出区别）
    const slot = new THREE.Mesh(unitPlane, skyMaterial);
    slot.position.set(vault.x, apexY - 0.06, 0);
    slot.rotation.x = Math.PI / 2;
    slot.scale.set(VAULT_METRICS.slot, slotLength, 1);
    scene.add(slot);

    // 天光落在地上的那道光。没开阴影，投影算不出来，就把它画在地上 ——
    // 天光本来也该在地上留一道，这道光是「这房子有天窗」最直接的证据
    const pool = new THREE.Mesh(unitPlane, poolMaterial);
    pool.position.set(vault.x, 0.016, 0);
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(VAULT_METRICS.slot + POOL_PAD, slotLength, 1);
    scene.add(pool);

    // 缝下的细格栅：金贝尔天光最标志性的那一片穿孔铝
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const z = -slotLength / 2 + ((i + 0.5) / BAR_COUNT) * slotLength;
      const bar = new THREE.Mesh(unitBox, barMaterial);
      bar.position.set(vault.x, apexY - 0.12, z);
      bar.scale.set(VAULT_METRICS.slot + 0.08, 0.022, 0.024);
      scene.add(bar);
    }

    // 反光翼：从缝的两侧向外、向下弯出去的浅弧
    for (const side of [-1, 1] as (-1 | 1)[]) {
      const wing = buildShell(wingProfile(side), slotLength, WING_T);
      const mesh = new THREE.Mesh(wing, aluminiumMaterial);
      mesh.position.set(vault.x, SPRING_H, 0);
      scene.add(mesh);
      track(wing);
    }
  }

  /** 一侧反光翼的断面：从天光缝边上向外向下弯出去 */
  function wingProfile(side: -1 | 1): ProfilePoint[] {
    const points: ProfilePoint[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      points.push({
        x: side * (VAULT_METRICS.slot / 2 + VAULT_METRICS.wing * t),
        // 起拱线往上算：贴着拱顶走，再慢慢离开
        y: rise - 0.1 - WING_DROP * t * t,
      });
    }
    return points;
  }

  // 端墙的拱形封口
  const archGeometry = track(buildEndArch(profile, SHELL_T));
  for (const arch of plan.arches) {
    const mesh = new THREE.Mesh(archGeometry, wallMaterial);
    mesh.position.set(arch.x, SPRING_H, arch.z);
    // ShapeGeometry 建在 xy 平面、朝 +z；normal 为 -1 时转过去朝 -z
    mesh.rotation.y = arch.normal === 1 ? 0 : Math.PI;
    if (arch.normal === 1) mesh.position.z += 0.02;
    else mesh.position.z -= 0.02;
    mesh.userData.isWall = true;
    scene.add(mesh);
    blockers.push(mesh);

    // 端墙内侧挂展厅名：走进拱顶时抬眼就能看到这是哪间
    const plaque = new THREE.Mesh(
      unitPlane,
      track(
        new THREE.MeshBasicMaterial({
          map: track(labelTexture(spaceLabel(arch.spaceId))),
          color: '#d8d8d8',
          fog: false,
          toneMapped: false,
        }),
      ),
    );
    plaque.position.set(arch.x, SPRING_H - 0.75, arch.z + arch.normal * 0.06);
    plaque.rotation.y = arch.normal === 1 ? 0 : Math.PI;
    plaque.scale.set(1.5, 0.375, 1);
    scene.add(plaque);
  }

  function spaceLabel(spaceId: string): string {
    return plan.spaces.find((space) => space.id === spaceId)?.label ?? '';
  }

  // ---- 灯光：日光的三层（环境 + 面光 + 环境反射）----
  RectAreaLightUniformsLib.init();
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  scene.add(new THREE.HemisphereLight('#dbe8f5', '#e0cdb0', 0.6));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const equirect = environmentTexture();
  const environment = pmrem.fromEquirectangular(equirect).texture;
  scene.environment = environment;
  scene.environmentIntensity = 1;
  pmrem.dispose();
  equirect.dispose();
  disposables.push(environment);

  // 每拱一盏面光，尺寸就是天光缝：线状光源的软衰减才是对的
  for (const vault of plan.vaults) {
    const light = new THREE.RectAreaLight('#fff8ec', 10, VAULT_METRICS.slot, slotLength);
    // 压到反光翼下沿：面光只朝一面发光，挂在缝上就照不到翼的底面了。
    // 拱顶那一圈的亮度由 emissiveMap 的渐变负责，这里只管把光送到墙和地面上
    light.position.set(vault.x, SPRING_H + rise - 0.45, 0);
    // 朝正下方时 lookAt 是退化情形（视线与 up 平行），直接转：+π/2 让出光面朝下，
    // 7.8m 那条边正好落在 z 轴上
    light.rotation.set(Math.PI / 2, 0, 0);
    scene.add(light);
  }

  // ---- 画 ----
  for (const placement of plan.placements) {
    const group = new THREE.Group();
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.ry;

    const art = fitArt(placement.fw, placement.fh, placement.fw / placement.fh);
    const outer = { w: art.w + MAT_WIDTH * 2, h: art.h + MAT_WIDTH * 2 };

    // 洗墙光：画框背后的墙上晕开一片，画就像被单独打了光
    const wash = new THREE.Mesh(unitPlane, washMaterial);
    wash.position.z = -0.035;
    group.add(wash);

    // 画框在墙上的投影：稍微往下偏一点，画就「挂」在墙上了
    const shadow = new THREE.Mesh(unitPlane, shadowMaterial);
    shadow.position.set(0.035, -0.045, -0.045);
    group.add(shadow);

    // 画框：卡纸四周再压一圈木条。材质是逐件 clone 的 —— 悬停要点亮
    // 单独一件，shared material 会让整层展厅一起亮
    const frameMaterialForArt = track(frameMaterial.clone());
    const frame = new THREE.Mesh(unitBox, frameMaterialForArt);
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

    // 墙上的作品标签：标题 + 器材，字画进贴图
    const labelMap = track(wallLabelTexture(placement.title, placement.camera));
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
      wash,
      shadow,
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
    // 标签贴着画框右下角外侧，底边与画框底边齐平。比例跟着贴图走（2:1）
    entry.label.scale.set(LABEL_W, LABEL_W / 2, 0.008);
    entry.label.position.set(outerW / 2 + LABEL_W / 2 + 0.06, -outerH / 2 + 0.08, -0.05);
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
      // 站定后要正对画心：相机朝 -z 看是 yaw=0，即 forward = (-sin yaw, -cos yaw)，
      // 令它等于「从站位指回画心」的 -normal，解出 yaw = atan2(n.x, n.z)
      return {
        x: worldPosition.x + normal.x * 1.5,
        z: worldPosition.z + normal.z * 1.5,
        yaw: Math.atan2(normal.x, normal.z),
      };
    },

    setHover(id) {
      for (const [key, entry] of parts) {
        const on = key === id;
        // 一点暖光从画框里透出来：比描边含蓄，也不改几何
        entry.frameMaterial.emissive.setHex(on ? 0x3a2f1c : 0x000000);
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
      renderer.dispose();
    },
  };
}

/** 一件作品的全部零件；换图时按真实比例一起缩放 */
interface FrameParts {
  frame: THREE.Mesh;
  /** 逐件 clone 出来的画框材质，悬停时单独点亮 */
  frameMaterial: THREE.MeshStandardMaterial;
  mat: THREE.Mesh;
  picture: THREE.Mesh;
  wash: THREE.Mesh;
  shadow: THREE.Mesh;
  label: THREE.Mesh;
}

/** 按比例求画心尺寸：长边保持不变，短边跟着比例缩 */
function fitArt(fw: number, fh: number, aspect: number): { w: number; h: number } {
  const long = Math.max(fw, fh);
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}

/**
 * 贴图：全部用 canvas 程序化生成（红线：不用任何外部/付费素材）。
 * 混凝土的模板缝、白橡木的直纹、洞石的孔洞、反射器的穿孔阵列，都是画出来的。
 */
import * as THREE from 'three';

function make(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat: [number, number] = [1, 1],
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 8;
  return texture;
}

/** 灰度图（粗糙度 / 穿孔 alpha 用）：不能带 sRGB */
function makeGray(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat: [number, number] = [1, 1],
): THREE.CanvasTexture {
  const texture = make(size, draw, repeat);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** 撒一层噪点：破掉大色块的渐变色带 */
function grain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
  dots = (w * h) / 40,
): void {
  for (let i = 0; i < dots; i += 1) {
    const light = Math.random() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

/**
 * 清水混凝土：灰白底 + 板缝（康的拱是木板模浇筑的，拱面有横向模板缝）+ 气孔。
 * roughness 0.85 由材质给，贴图只负责颜色与那一点点脏。
 */
export function concreteTexture(): THREE.CanvasTexture {
  return make(1024, (ctx, w, h) => {
    ctx.fillStyle = '#d9d7d1';
    ctx.fillRect(0, 0, w, h);

    // 模板缝：横向一道道，每 1/6 一条（贴图铺 1 m，缝距约 17 cm）
    for (let i = 0; i < 6; i += 1) {
      const y = (i / 6) * h;
      ctx.fillStyle = 'rgba(120,118,112,0.30)';
      ctx.fillRect(0, y, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.fillRect(0, y + 3, w, 2);
    }

    // 水痕与色差：几片很淡的斑
    for (let i = 0; i < 40; i += 1) {
      const r = 40 + Math.random() * 220;
      const g = ctx.createRadialGradient(Math.random() * w, Math.random() * h, 0, 0, 0, r);
      g.addColorStop(0, `rgba(${Math.random() > 0.5 ? '255,255,255' : '150,148,142'},0.05)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // 气孔
    for (let i = 0; i < 1400; i += 1) {
      ctx.fillStyle = `rgba(120,118,112,${0.05 + Math.random() * 0.16})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, w, h, 0.05);
  });
}

/** 白橡木：浅色 + 顺纹直丝（UV 的 v 沿拱长，纹路因此顺着拱长走） */
export function oakTexture(): THREE.CanvasTexture {
  return make(512, (ctx, w, h) => {
    ctx.fillStyle = '#e3d3b6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i += 1) {
      const x = Math.random() * w;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,246,226' : '176,150,112'},${
        0.06 + Math.random() * 0.16
      })`;
      ctx.lineWidth = 0.6 + Math.random() * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 14, h);
      ctx.stroke();
    }
    // 板缝：每 1/3 一道
    for (let i = 0; i < 3; i += 1) {
      const x = (i / 3) * w;
      ctx.fillStyle = 'rgba(140,116,84,0.30)';
      ctx.fillRect(x, 0, 2, h);
    }
    grain(ctx, w, h, 0.04);
  });
}

/** 洞石：米黄 + 水平层理 + 孔洞 */
export function travertineTexture(): THREE.CanvasTexture {
  return make(512, (ctx, w, h) => {
    ctx.fillStyle = '#ded2b6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i += 1) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,250,236' : '186,172,142'},0.16)`;
      ctx.lineWidth = 2 + Math.random() * 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 24) ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 2 + i) * 4);
      ctx.stroke();
    }
    // 孔洞：拉长的椭圆，顺着层理
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = `rgba(150,136,110,${0.10 + Math.random() * 0.22})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 0.6 + Math.random(), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, w, h, 0.05);
  });
}

/**
 * 反射器的穿孔 alpha：白=铝板，黑=孔。
 * 一个循环 0.12 m（对应 uvScale），里面 2×2 错排的孔，孔径约 2.2 cm。
 */
export function perforationTexture(): THREE.CanvasTexture {
  return makeGray(128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const cells = 2;
    const step = w / cells;
    for (let i = 0; i < cells; i += 1) {
      for (let j = 0; j < cells; j += 1) {
        // 错排：奇数行错开半格
        const off = j % 2 === 0 ? 0 : step / 2;
        const cx = ((i + 0.5) * step + off) % w;
        const cy = (j + 0.5) * step;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(cx, cy, step * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

/** 拉丝铝：沿拱长的细丝（反射器的颜色贴图） */
export function brushedAluminiumTexture(): THREE.CanvasTexture {
  return make(256, (ctx, w, h) => {
    ctx.fillStyle = '#d6d8da';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i += 1) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '150,154,158'},${
        0.05 + Math.random() * 0.14
      })`;
      ctx.lineWidth = 0.5 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 3);
      ctx.stroke();
    }
  });
}

/**
 * 环境贴图（equirect）：上半天光、下半地面反弹。
 * 只给混凝土一点反射与凹处的补光，不参与主照明叙事。
 */
export function environmentTexture(sky: string, ground: string): THREE.CanvasTexture {
  const texture = make(64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, sky);
    g.addColorStop(0.52, sky);
    g.addColorStop(0.53, ground);
    g.addColorStop(1, ground);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

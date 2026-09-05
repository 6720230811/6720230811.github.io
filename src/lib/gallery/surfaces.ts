/**
 * 展厅的贴图：全部用 canvas 现画。
 *
 * 展厅只有几张小图，打包贴图既多一次网络请求、又不好按形制调色，现画最省。
 * 每种材质是一个「底色 + 该有的肌理」的函数：石灰华的水平层理、丝绒的暗花、
 * 大理石的纹路、拼花地板的人字拼……形制（styles.ts）只给底色，肌理由这里画。
 *
 * 这一层 import three（要建 CanvasTexture），但只在 createFloor 之后才会被
 * 动态加载进来 —— 不支持 WebGL 的设备不会下载它。
 */
import * as THREE from 'three';

/** 现画一张纹理 */
export function paint(
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

/** 撒一层噪点：破掉大色块的渐变色带 */
export function grain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
  size = 1,
): void {
  const dots = Math.floor((w * h) / 42);
  for (let i = 0; i < dots; i += 1) {
    const light = Math.random() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

/** 一道道深浅不一的波浪：石灰华的水平层理、木纹都用它 */
function waves(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  count: number,
  light: string,
  dark: string,
  alpha: number,
  width: number,
  amp: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const y = Math.random() * h;
    ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? light : dark},${alpha})`;
    ctx.lineWidth = width * (0.4 + Math.random());
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) {
      ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 2 + i) * amp);
    }
    ctx.stroke();
  }
}

/** 石灰华：暖米色 + 层理 + 竖向板缝（金贝尔的墙是竖板拼的） */
export function travertineTexture(base = '#ded5c6'): THREE.CanvasTexture {
  return paint(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    waves(ctx, w, h, 26, '255,252,244', '188,176,156', 0.16, 6, 5);
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

/** 抹灰：极细的颗粒与几块很淡的批刀痕，白盒子的墙 */
export function plasterTexture(base = '#f4f4f2'): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // 批刀痕：几片比底色差一档的柔和斑块
    for (let i = 0; i < 22; i += 1) {
      const r = 30 + Math.random() * 70;
      const gradient = ctx.createRadialGradient(
        Math.random() * w,
        Math.random() * h,
        0,
        0,
        0,
        r,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0.03)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }
    grain(ctx, w, h, 0.03);
  });
}

/**
 * 锦缎：深红丝绒 + 暗花（卢浮宫那种挂画的墙）。
 * 花纹是菱形骨架里套一个椭圆花心，画一遍平铺即可 —— 丝绒的「暗」来自
 * 亮部比底色只亮一点点，远看看见纹样，近看才看出是花的。
 */
export function damaskTexture(base = '#6d2629'): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // 竖向的织纹
    for (let x = 0; x < w; x += 3) {
      ctx.fillStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.02})`;
      ctx.fillRect(x, 0, 1, h);
    }
    const motif = (cx: number, cy: number): void => {
      ctx.strokeStyle = 'rgba(255,236,214,0.13)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 26, 40, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,236,214,0.10)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 12, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      // 四片小叶
      for (const [dx, dy] of [
        [0, -46],
        [0, 46],
        [-34, 0],
        [34, 0],
      ]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx, cy + dy, 9, 16, dx === 0 ? 0 : Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    motif(w * 0.5, h * 0.5);
    motif(w * 0.0, h * 0.0);
    motif(w * 1.0, h * 1.0);
    motif(w * 1.0, h * 0.0);
    motif(w * 0.0, h * 1.0);
    grain(ctx, w, h, 0.05);
  });
}

/**
 * 湿壁画：奶油底 + 彩画纹样（拱顶用）。
 * 画的是「远看像有画」：一圈圈画框线、里面一个圆章、四角卷草。
 */
export function frescoTexture(base = '#efe2c4', accent = '#b98d55'): THREE.CanvasTexture {
  return paint(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // 墙皮的不匀
    waves(ctx, w, h, 14, '255,250,236', '198,178,140', 0.1, 8, 6);

    // 一格格画框：里面一个圆章 + 四角卷草
    const rows = 2;
    const cols = 2;
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = c * cw;
        const y = r * ch;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 14, y + 14, cw - 28, ch - 28);
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        // 四角卷草：一段小弧
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = accent;
        for (const [sx, sy] of [
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1],
        ]) {
          ctx.beginPath();
          ctx.arc(
            x + cw / 2 + sx * (cw * 0.3),
            y + ch / 2 + sy * (ch * 0.3),
            16,
            0,
            Math.PI * 1.4,
          );
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    grain(ctx, w, h, 0.05);
  });
}

/** 大理石：底色 + 几道分叉的纹路 + 抛光的高光 */
export function marbleTexture(base = '#e3dcc8'): THREE.CanvasTexture {
  return paint(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    waves(ctx, w, h, 8, '255,255,255', '206,196,170', 0.2, 10, 18);
    // 主纹：一道从左上到右下的折线，带分叉
    for (let i = 0; i < 7; i += 1) {
      ctx.strokeStyle = `rgba(${Math.random() > 0.4 ? '150,140,116' : '255,255,255'},${
        0.1 + Math.random() * 0.16
      })`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      let x = Math.random() * w;
      let y = -10;
      ctx.moveTo(x, y);
      while (y < h + 10) {
        x += (Math.random() - 0.45) * 60;
        y += 24 + Math.random() * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    grain(ctx, w, h, 0.03);
  });
}

/** 白橡木地板：板缝沿长轴走，带一点木纹 */
export function oakTexture(base = '#d8c6a8'): THREE.CanvasTexture {
  return paint(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
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

/** 拼花地板：凡尔赛的人字拼（cheveron） */
export function parquetTexture(base = '#b98d55'): THREE.CanvasTexture {
  return paint(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    const rowH = h / rows;
    const plankW = w / 4;
    for (let r = 0; r < rows; r += 1) {
      for (let c = -1; c < 5; c += 1) {
        const x = c * plankW;
        const y = r * rowH;
        // 相邻两排的人字方向相反
        const up = (r + c) % 2 === 0;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, y + (up ? rowH : 0));
        ctx.lineTo(x + plankW, y + (up ? 0 : rowH));
        ctx.lineTo(x + plankW, y + (up ? rowH : rowH * 2));
        ctx.lineTo(x, y + (up ? rowH * 2 : rowH));
        ctx.closePath();
        ctx.clip();
        // 板面：比底色亮半档 + 顺纹
        ctx.fillStyle = `rgba(255,236,204,${0.1 + Math.random() * 0.12})`;
        ctx.fillRect(x, y, plankW, rowH * 2);
        for (let i = 0; i < 6; i += 1) {
          ctx.strokeStyle = `rgba(120,88,48,${0.06 + Math.random() * 0.1})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const yy = y + Math.random() * rowH * 2;
          ctx.moveTo(x, yy);
          ctx.lineTo(x + plankW, yy + (up ? -rowH / 2 : rowH / 2));
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    grain(ctx, w, h, 0.04);
  });
}

/** 水磨石：灰底 + 各色骨料 */
export function terrazzoTexture(base = '#cfc6b4'): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const chips = ['#8d8578', '#efe9dc', '#b3a58c', '#6f6a60', '#d8c9ae'];
    for (let i = 0; i < 700; i += 1) {
      ctx.fillStyle = chips[Math.floor(Math.random() * chips.length)];
      ctx.globalAlpha = 0.5 + Math.random() * 0.4;
      const size = 1 + Math.random() * 4;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * w,
        Math.random() * h,
        size,
        size * (0.5 + Math.random()),
        Math.random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    grain(ctx, w, h, 0.05);
  });
}

/** 水泥：很淡的颗粒，明暗交给灯 */
export function concreteTexture(base = '#e6e4de'): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.055);
  });
}

/** 花岗岩：麻点 */
export function graniteTexture(base = '#a8a6a1'): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i += 1) {
      const roll = Math.random();
      ctx.fillStyle =
        roll > 0.7 ? 'rgba(255,255,255,0.16)' : roll > 0.4 ? 'rgba(0,0,0,0.14)' : 'rgba(60,58,54,0.2)';
      const size = 1 + Math.random() * 2;
      ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
    }
    grain(ctx, w, h, 0.04);
  });
}

/** 榻榻米 / 席面：横向草纹 + 边缘的深色布条 */
export function tatamiTexture(base = '#c9b98a'): THREE.CanvasTexture {
  return paint(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // 草编：细密的横线，间或几根偏色
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,246,214' : '150,132,86'},${
        0.1 + Math.random() * 0.1
      })`;
      ctx.fillRect(0, y, w, 1);
    }
    // 竖向的织线：每隔一段一道
    for (let x = 0; x < w; x += 26) {
      ctx.fillStyle = 'rgba(120,104,66,0.16)';
      ctx.fillRect(x, 0, 2, h);
    }
    // 边缘的布条（一块席子的包边）
    ctx.fillStyle = 'rgba(52,58,66,0.55)';
    ctx.fillRect(0, 0, w, 6);
    ctx.fillRect(0, h - 6, w, 6);
    grain(ctx, w, h, 0.05);
  });
}

/** 朱漆木：近乎均匀的深红，几道顺纹的高光 */
export function lacquerTexture(base = '#7d3b2a'): THREE.CanvasTexture {
  return paint(128, 128, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i += 1) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(255,220,196,${0.03 + Math.random() * 0.07})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
    grain(ctx, w, h, 0.05);
  });
}

/**
 * 拱顶的明暗：从起拱点（暗）到拱顶（亮）再回另一侧，横向一条对称渐变。
 * u 沿拱断面（0 与 1 是两侧起拱点，0.5 是拱顶），v 沿长度 —— 明暗是画出来的，
 * 不靠模拟：在缝下挂点光源会让拱顶过曝、墙上出现一串光斑，没开阴影时光还会
 * 越过墙顶漏进隔壁厅。
 */
export function vaultLightTexture(): THREE.CanvasTexture {
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

/** 天光：中间白、两侧偏冷，像被屋面切了一条的天空（天光缝、拱窗、玻璃墙都用） */
export function skyTexture(): THREE.CanvasTexture {
  return paint(64, 8, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#cfe0f2');
    gradient.addColorStop(0.5, '#ffffff');
    gradient.addColorStop(1, '#cfe0f2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

/** 洗墙光 / 画框投影 / 灯光晕共用的径向渐变（亮心与暗心） */
export function radialTexture(rgb: string): THREE.CanvasTexture {
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
 * 天光落在地上的那道光：横向中间亮两侧淡，纵向两端淡出。
 * 没开阴影，投影算不出来，这道光是画在地上的 —— 但天光本来就该在地上留一道。
 */
export function floorPoolTexture(): THREE.CanvasTexture {
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
export function environmentTexture(top: string, bottom: string): THREE.CanvasTexture {
  const texture = paint(64, 32, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, top);
    gradient.addColorStop(0.5, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/**
 * 端墙上的房间名牌。
 * 文字直接画进贴图：3D 里放文字网格要么糊要么贵，一块小牌子最省事。
 */
export function labelTexture(text: string): THREE.CanvasTexture {
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
export function wallLabelTexture(title: string, meta: string): THREE.CanvasTexture {
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
export function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxWidth: number,
): string[] {
  ctx.font = font;
  const lines: string[] = [];
  let line = '';

  for (const word of text.match(CJK_WORD) ?? []) {
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

export function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

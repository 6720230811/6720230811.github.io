/**
 * 小地图：左上角一张整层平面（48 × 48 m）。
 *
 *  整座展厅是一座连通的 Hilbert 迷宫加一间大厅，走在里面很容易不知道自己
 *  在哪一段、大厅在哪个方向 —— 所以顶上挂一张平面图：墙、大厅、房间出生点
 *  画一次到离屏 canvas（460 段墙不用每帧重描），每帧只把「人在哪儿、朝哪儿
 *  看」盖上去。
 *
 *  朝向跟 index.ts 的 step() 同一套约定：相机 forward = (-sin yaw, -cos yaw)。
 *  （相机默认看 -Z，绕 Y 转 yaw 之后就是这个方向 —— 别照搬 plan.ts 里画框
 *  那套 atan2(nx, nz)，画框的正面是 +Z，跟相机差一个 π。）
 *
 *  纯 2D canvas，不 import three。
 */
import { spaceAt, type FloorPlan } from './plan';

/** 平面图四周留白（CSS px） */
const PAD = 7;
/** 视锥的半径与半张角 */
const CONE_R = 17;
const CONE_HALF = 0.62;

export interface MinimapHandle {
  /** 人在 (x, z)、朝 yaw —— 每帧调用，内部自己判断要不要重画底图 */
  update(x: number, z: number, yaw: number): void;
  dispose(): void;
}

/** 世界坐标 → 画布坐标；平面按最长边等比塞进方框，短边居中 */
function mapper(plan: FloorPlan, size: number) {
  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const span = Math.max(spanX, spanZ) || 1;
  const scale = (size - PAD * 2) / span;
  const offX = PAD + (size - PAD * 2 - spanX * scale) / 2;
  const offZ = PAD + (size - PAD * 2 - spanZ * scale) / 2;
  return {
    x: (value: number): number => offX + (value - plan.bounds.x1) * scale,
    z: (value: number): number => offZ + (value - plan.bounds.z1) * scale,
    len: (value: number): number => value * scale,
  };
}

/** 底图：大厅填一层灰绿，墙一次描完，房间出生点画成小圈 */
function drawBase(ctx: CanvasRenderingContext2D, plan: FloorPlan, size: number): void {
  const m = mapper(plan, size);

  if (plan.hall) {
    const { x1, z1, x2, z2 } = plan.hall.rect;
    ctx.fillStyle = 'rgba(125, 163, 142, 0.45)';
    ctx.fillRect(m.x(x1), m.z(z1), m.len(x2 - x1), m.len(z2 - z1));
    ctx.strokeStyle = 'rgba(158, 200, 176, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(m.x(x1) + 0.5, m.z(z1) + 0.5, m.len(x2 - x1) - 1, m.len(z2 - z1) - 1);
  }

  // 墙：全部合成一条路径再一次描边 —— 460 段墙逐段 stroke 会掉帧
  ctx.strokeStyle = 'rgba(233, 229, 221, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const wall of plan.walls) {
    ctx.moveTo(m.x(wall.a.x), m.z(wall.a.z));
    ctx.lineTo(m.x(wall.b.x), m.z(wall.b.z));
  }
  ctx.stroke();

  // 房间出生点：每一间（按策展切的段）一个小圈
  ctx.lineWidth = 1.2;
  for (const space of plan.spaces) {
    ctx.beginPath();
    ctx.arc(m.x(space.spawn.x), m.z(space.spawn.z), 2.6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.stroke();
  }
}

/** 覆盖层：视锥 + 人这一点；当前所在房间的出生点也跟着点亮 */
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  plan: FloorPlan,
  size: number,
  x: number,
  z: number,
  yaw: number,
): void {
  const m = mapper(plan, size);
  const px = m.x(x);
  const pz = m.z(z);

  const here = spaceAt(plan, x, z);
  if (here) {
    ctx.beginPath();
    ctx.arc(m.x(here.spawn.x), m.z(here.spawn.z), 3.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
  }

  // 相机朝向：(-sin yaw, -cos yaw)
  const angle = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  ctx.beginPath();
  ctx.moveTo(px, pz);
  ctx.arc(px, pz, CONE_R, angle - CONE_HALF, angle + CONE_HALF);
  ctx.closePath();
  ctx.fillStyle = 'rgba(246, 190, 118, 0.3)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, pz, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#F6BE76';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(28, 22, 14, 0.8)';
  ctx.stroke();
}

/**
 * 挂上小地图。底图是懒加载的：网格模式下 .gal 是 display:none，画布量出来
 * 是 0，得等切到 3D 之后第一帧再画。
 */
export function createMinimap(canvas: HTMLCanvasElement, plan: FloorPlan): MinimapHandle {
  const ctx = canvas.getContext('2d');
  let base: HTMLCanvasElement | null = null;
  let size = 0;

  function build(css: number): boolean {
    if (!ctx || css <= 0) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = css;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);

    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const layerCtx = layer.getContext('2d');
    if (!layerCtx) return false;
    layerCtx.scale(dpr, dpr);
    drawBase(layerCtx, plan, css);
    base = layer;
    return true;
  }

  return {
    update(x, z, yaw) {
      if (!ctx) return;
      const css = Math.min(canvas.clientWidth, canvas.clientHeight);
      // 画布尺寸变了（窗口缩放 / 窄屏换了尺寸）就重画底图
      if (!base || css !== size) {
        if (!build(css)) return;
      }
      const dpr = canvas.width / size;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (base) ctx.drawImage(base, 0, 0);
      ctx.scale(dpr, dpr);
      drawPlayer(ctx, plan, size, x, z, yaw);
    },

    dispose() {
      base = null;
    },
  };
}

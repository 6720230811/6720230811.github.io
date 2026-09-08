/**
 * 平面图：左上角的小地图，以及点开之后能传送的大地图。
 *
 *  整座展厅是一条折廊贯穿全馆（夜行折廊），走在里面很容易不知道自己
 *  在哪一段、大厅在哪个方向 —— 所以挂一张平面图：墙画一次到离屏 canvas
 *  （几百段墙不用每帧重描），每帧只把「人在哪儿、朝哪儿看」和「鼠标指着
 *  哪儿」盖上去。
 *
 *  两张图共用一套画法（renderer）：小地图每帧跟着人走；大地图点开才画，
 *  在上面点一下就把人送过去（落点由 plan.nearestWalkable 吸到能站的地方）。
 *
 *  每间厅都在图上标出来：铺一层极淡的底 + 中心一个空心小圈（小地图到此为止，
 *  大地图再挂名字）—— 名字取自 plan.spaces，跟 3D 里 HUD 上的分区名是同一套。
 *
 *  朝向跟 index.ts 的 step() 同一套约定：相机 forward = (-sin yaw, -cos yaw)。
 *  （相机默认看 -Z，绕 Y 转 yaw 之后就是这个方向 —— 别照搬 plan.ts 里画框
 *  那套 atan2(nx, nz)，画框的正面是 +Z，跟相机差一个 π。）
 *
 *  纯 2D canvas，不 import three。
 */
import type { FloorPlan } from './plan';

/** 平面图四周留白（CSS px） */
const PAD = 7;
/** 视锥半张角 */
const CONE_HALF = 0.62;
/** 大地图从这个尺寸起才画房间名（小地图上写字会糊成一团） */
const LABEL_MIN = 260;

export interface Point {
  x: number;
  z: number;
}

export interface MinimapHandle {
  /** 人在 (x, z)、朝 yaw —— 每帧调用，内部自己判断要不要重画底图 */
  update(x: number, z: number, yaw: number): void;
  dispose(): void;
}

export interface BigMapHandle {
  /** 打开并画一帧 */
  show(x: number, z: number, yaw: number): void;
  /** 开着的时候跟着人走（关着就什么都不做） */
  update(x: number, z: number, yaw: number): void;
  hide(): void;
  isOpen(): boolean;
  /** 屏幕坐标 → 世界坐标；点在图上之外返回 null */
  locate(clientX: number, clientY: number): Point | null;
  /** 悬停预览：传落点画一个虚圈，传 null 取消 */
  preview(point: Point | null): void;
  dispose(): void;
}

export interface PlanLabels {
  /** 大厅的名字（房间名来自 plan.spaces[].label，不用传） */
  hall?: string;
  /** 房间名取哪种语言（不传按中文） */
  locale?: 'zh' | 'en';
}

/** 记号的大小随图缩放：小地图上 3 px 的点，放大到 544 px 得按比例长 */
function markerSize(size: number) {
  return {
    cone: Math.max(10, size * 0.11),
    dot: Math.max(2.6, Math.min(size * 0.02, 7)),
    room: Math.max(2.2, Math.min(size * 0.017, 5)),
  };
}

/** 世界坐标 ↔ 画布坐标；平面按最长边等比塞进方框，短边居中 */
function mapper(plan: FloorPlan, size: number) {
  const spanX = plan.bounds.x2 - plan.bounds.x1;
  const spanZ = plan.bounds.z2 - plan.bounds.z1;
  const span = Math.max(spanX, spanZ) || 1;
  const scale = (size - PAD * 2) / span;
  const offX = PAD + (size - PAD * 2 - spanX * scale) / 2;
  const offZ = PAD + (size - PAD * 2 - spanZ * scale) / 2;
  return {
    scale,
    /** 世界 → 画布 */
    x: (value: number): number => offX + (value - plan.bounds.x1) * scale,
    z: (value: number): number => offZ + (value - plan.bounds.z1) * scale,
    len: (value: number): number => value * scale,
    /** 画布 → 世界 */
    invX: (value: number): number => (value - offX) / scale + plan.bounds.x1,
    invZ: (value: number): number => (value - offZ) / scale + plan.bounds.z1,
  };
}

/** 带描边的字：迷宫是密线，白字直接压上去看不清 */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
): void {
  ctx.font = font;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8, 10, 12, 0.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillText(text, x, y);
}

/** 底图：墙一次描完，再把每间厅铺一层底、点一个圈（大地图上挂名字） */
function paintBase(
  ctx: CanvasRenderingContext2D,
  plan: FloorPlan,
  size: number,
  labels: PlanLabels,
): void {
  const m = mapper(plan, size);
  const s = markerSize(size);
  const withText = size >= LABEL_MIN;

  // 厅：先淡淡铺一层底 —— 光看墙的线读不出「这一大块是间厅」
  ctx.fillStyle = 'rgba(246, 190, 118, 0.07)';
  for (const space of plan.spaces) {
    ctx.fillRect(
      m.x(space.rect.x1),
      m.z(space.rect.z1),
      m.len(space.rect.x2 - space.rect.x1),
      m.len(space.rect.z2 - space.rect.z1),
    );
  }

  // 墙：全部合成一条路径再一次描边 —— 几百段墙逐段 stroke 会掉帧
  ctx.strokeStyle = 'rgba(233, 229, 221, 0.5)';
  ctx.lineWidth = withText ? 1.2 : 1;
  ctx.beginPath();
  for (const wall of plan.walls) {
    ctx.moveTo(m.x(wall.a.x), m.z(wall.a.z));
    ctx.lineTo(m.x(wall.b.x), m.z(wall.b.z));
  }
  ctx.stroke();

  // 每间厅中心一个空心小圈：走在折廊里最容易丢的就是「大厅在哪个方向」。
  //  小地图上只留圈（152 px 写七个名字会糊成一团），大地图上再挂名字。
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.strokeStyle = 'rgba(246, 190, 118, 0.85)';
  ctx.textAlign = 'center';
  for (const space of plan.spaces) {
    const cx = m.x((space.rect.x1 + space.rect.x2) / 2);
    const cz = m.z((space.rect.z1 + space.rect.z2) / 2);
    ctx.beginPath();
    ctx.arc(cx, cz, s.room, 0, Math.PI * 2);
    ctx.stroke();
    if (withText) {
      const name = space.label[labels.locale ?? 'zh'] ?? space.label.zh;
      const font = `600 ${Math.max(9, Math.round(size * 0.031))}px system-ui, sans-serif`;
      label(ctx, name, cx, cz - s.room - 4, font);
    }
  }
  ctx.textAlign = 'start';
}

/** 覆盖层：当前房间点亮、视锥、人这一点；大地图上还有鼠标指着的落点 */
function paintOverlay(
  ctx: CanvasRenderingContext2D,
  plan: FloorPlan,
  size: number,
  x: number,
  z: number,
  yaw: number,
  ghost: Point | null,
): void {
  const m = mapper(plan, size);
  const s = markerSize(size);

  if (ghost) {
    const gx = m.x(ghost.x);
    const gz = m.z(ghost.z);
    ctx.beginPath();
    ctx.arc(gx, gz, s.cone * 0.45, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(246, 190, 118, 0.95)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(gx - s.dot * 2, gz);
    ctx.lineTo(gx + s.dot * 2, gz);
    ctx.moveTo(gx, gz - s.dot * 2);
    ctx.lineTo(gx, gz + s.dot * 2);
    ctx.strokeStyle = 'rgba(246, 190, 118, 0.95)';
    ctx.stroke();
  }

  // 相机朝向：(-sin yaw, -cos yaw)
  const angle = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  const px = m.x(x);
  const pz = m.z(z);
  ctx.beginPath();
  ctx.moveTo(px, pz);
  ctx.arc(px, pz, s.cone, angle - CONE_HALF, angle + CONE_HALF);
  ctx.closePath();
  ctx.fillStyle = 'rgba(246, 190, 118, 0.3)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, pz, s.dot, 0, Math.PI * 2);
  ctx.fillStyle = '#F6BE76';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(28, 22, 14, 0.8)';
  ctx.stroke();
}

/**
 * 一张图的画法：底图懒加载（网格模式下画布量出来是 0，切到 3D 之后第一帧
 * 才画），尺寸变了就重画。小地图与大地图各挂一个。
 */
function renderer(
  canvas: HTMLCanvasElement,
  plan: FloorPlan,
  labels: PlanLabels = {},
) {
  const ctx = canvas.getContext('2d');
  let base: HTMLCanvasElement | null = null;
  let size = 0;
  let last = { x: 0, z: 0, yaw: 0 };
  let ghost: Point | null = null;

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
    paintBase(layerCtx, plan, css, labels);
    base = layer;
    return true;
  }

  function draw(): void {
    if (!ctx) return;
    const css = Math.min(canvas.clientWidth, canvas.clientHeight);
    if (!base || css !== size) {
      if (!build(css)) return;
    }
    const dpr = canvas.width / size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (base) ctx.drawImage(base, 0, 0);
    ctx.scale(dpr, dpr);
    paintOverlay(ctx, plan, size, last.x, last.z, last.yaw, ghost);
  }

  return {
    set(x: number, z: number, yaw: number): void {
      last = { x, z, yaw };
    },
    setGhost(point: Point | null): void {
      ghost = point;
    },
    draw,
    locate(clientX: number, clientY: number): Point | null {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const px = clientX - rect.left;
      const pz = clientY - rect.top;
      if (px < 0 || pz < 0 || px > rect.width || pz > rect.height) return null;
      const m = mapper(plan, size || canvas.clientWidth);
      return { x: m.invX(px), z: m.invZ(pz) };
    },
    dispose(): void {
      base = null;
    },
  };
}

/** 左上角那张：每帧跟着人走 */
export function createMinimap(
  canvas: HTMLCanvasElement,
  plan: FloorPlan,
  labels: PlanLabels = {},
): MinimapHandle {
  const view = renderer(canvas, plan, labels);
  return {
    update(x, z, yaw) {
      view.set(x, z, yaw);
      view.draw();
    },
    dispose() {
      view.dispose();
    },
  };
}

/** 点开的那张：上面点一下就把人送过去（落点由调用方吸到能站的地方） */
export function createBigMap(
  canvas: HTMLCanvasElement,
  plan: FloorPlan,
  labels: PlanLabels = {},
): BigMapHandle {
  const view = renderer(canvas, plan, labels);
  let open = false;

  return {
    show(x, z, yaw) {
      open = true;
      view.set(x, z, yaw);
      view.draw();
    },
    update(x, z, yaw) {
      if (!open) return;
      view.set(x, z, yaw);
      view.draw();
    },
    hide() {
      open = false;
      view.setGhost(null);
    },
    isOpen() {
      return open;
    },
    locate(clientX, clientY) {
      return open ? view.locate(clientX, clientY) : null;
    },
    preview(point) {
      if (!open) return;
      view.setGhost(point);
      view.draw();
    },
    dispose() {
      view.dispose();
    },
  };
}

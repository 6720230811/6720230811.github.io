/**
 * 展厅的客户端入口：把 GalleryFloor.astro 渲染出来的 DOM 接成能走能看的展厅。
 *
 * 三条设计约束：
 * 1. 网格是唯一可靠形态。页面服务端渲染出来的就是网格，脚本确认能跑 3D 之后
 *    才切到展厅；中途任何一步失败（不支持 WebGL、three 加载不出来、纹理全挂）
 *    都退回网格并说明原因。没 JS 的用户照样能翻完所有作品。
 * 2. 这里不 import three。射线、向量运算都收在 floor.ts，本文件只拿纯数据的
 *    结果 —— 不支持的设备连 three 的 chunk 都不会下载。
 * 3. 不接管页面滚动与方向键，除非展厅真的在用（画布聚焦或沉浸模式）。
 */
import {
  EYE_HEIGHT,
  containsPoint,
  layoutFloor,
  routeTo,
  spaceAt,
  spawnOf,
  type PlanRoomInput,
  type Waypoint,
  type WallKey,
} from './plan';
import type { FloorHandle, PickResult } from './floor';

/** 与 GalleryFloor.astro 的 data-rooms 一一对应 */
interface PayloadItem {
  id: string;
  type: 'image' | 'video';
  src: string;
  thumb: string;
  w: number | null;
  h: number | null;
  title: string;
  desc: string;
  camera: string;
  place: { wall: WallKey; u: number; v: number; size?: number } | null;
}

interface PayloadRoom {
  id: string;
  label: string;
  intro: string;
  wall: string;
  floor: string;
  light: string;
  items: PayloadItem[];
}

type Mode = 'grid' | '3d';

const WALK_SPEED = 2.4;
const LOOK_SPEED = 0.0028;
const PITCH_LIMIT = 0.9;
/** 拖拽超过这个像素就不算「点击」，免得转视角时误开大图 */
const TAP_SLOP = 6;
/** 途经点的到达阈值；最后一个点才要求走到跟前 */
const WAYPOINT_ARRIVE = 0.25;

/** 读 data-rooms；坏数据直接当没有，走网格 */
function readRooms(root: HTMLElement): PayloadRoom[] {
  try {
    const parsed: unknown = JSON.parse(root.dataset.rooms ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (room): room is PayloadRoom =>
        !!room &&
        typeof room === 'object' &&
        typeof (room as PayloadRoom).id === 'string' &&
        Array.isArray((room as PayloadRoom).items),
    );
  } catch {
    return [];
  }
}

/** 按钮上挂着两套文案（如「沉浸模式」/「退出」），脚本按当前状态取 */
function label(el: Element | null, key: 'grid' | 'room' | 'immersive' | 'exit'): string {
  return el?.getAttribute(`data-label-${key}`)?.trim() || el?.textContent?.trim() || '';
}

export function mountGallery(rootEl: HTMLElement | null): void {
  if (!rootEl) return;
  // 下面整段（含大量闭包）都要用，先收成非空常量：TS 的 narrowing 进不了闭包
  const root: HTMLElement = rootEl;

  const pageEl = document.getElementById('gal-page');
  const canvasEl = root.querySelector<HTMLCanvasElement>('#gal-canvas');
  const rooms = readRooms(root);
  const items = rooms.flatMap((room) => room.items.map((item) => ({ ...item, roomId: room.id })));
  if (!pageEl || !canvasEl || items.length === 0) {
    degrade(pageEl, root);
    return;
  }
  // 下面整段都在闭包里用，先收成非空常量：TS 的 narrowing 进不了闭包
  const page: HTMLElement = pageEl;
  const canvas: HTMLCanvasElement = canvasEl;

  const progress = root.querySelector<HTMLElement>('#gal-progress');
  const progressBar = progress?.querySelector<HTMLElement>('span') ?? null;
  const hint = root.querySelector<HTMLElement>('#gal-hint');
  const where = root.querySelector<HTMLElement>('#gal-where');
  const gridButton = root.querySelector<HTMLButtonElement>('#gal-grid');
  const immersiveButton = root.querySelector<HTMLButtonElement>('#gal-immersive');
  const resetButton = root.querySelector<HTMLButtonElement>('#gal-reset');
  const focus = root.querySelector<HTMLElement>('#gal-focus');
  const focusImage = root.querySelector<HTMLImageElement>('#gal-focus-img');
  const focusTitle = root.querySelector<HTMLElement>('#gal-focus-title');
  const focusDesc = root.querySelector<HTMLElement>('#gal-focus-desc');
  const focusMeta = root.querySelector<HTMLElement>('#gal-focus-meta');
  const mode3d = document.getElementById('gal-mode-3d');
  const modeGrid = document.getElementById('gal-mode-grid');
  const cameraLabel = root.dataset.labelCamera ?? '';
  const corridorLabel = root.dataset.labelCorridor ?? '';
  const hereLabel = where?.dataset.here ?? '';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let mode: Mode = 'grid';
  let immersive = false;
  let focusIndex = -1;

  /** 深链 ?item= 决定从哪间房出生：不然分享海边的作品却出现在城市的房间里 */
  const deepLink = new URL(window.location.href).searchParams.get('item');
  const startRoomId =
    rooms.find((room) => room.items.some((item) => item.id === deepLink))?.id ??
    root.dataset.startRoom ??
    rooms[0]?.id ??
    '';
  const startLabel = rooms.find((room) => room.id === startRoomId)?.label ?? '';
  // 页面标题是「房间名 + 站点后缀」，换房间时把后缀原样接回去
  const titleSuffix = startLabel ? document.title.split(startLabel).pop() ?? '' : '';

  // ---- 模式切换：网格 / 展厅 ----
  function setMode(next: Mode): void {
    mode = next;
    page.dataset.mode = next;
    mode3d?.setAttribute('aria-pressed', String(next === '3d'));
    modeGrid?.setAttribute('aria-pressed', String(next === 'grid'));
    if (gridButton) gridButton.textContent = label(gridButton, next === '3d' ? 'grid' : 'room');
    if (next === 'grid') {
      closeFocus();
      setImmersive(false);
    }
  }

  function setImmersive(next: boolean): void {
    if (immersive === next) return;
    immersive = next;
    document.body.classList.toggle('is-immersive', next);
    if (immersiveButton) {
      immersiveButton.textContent = label(immersiveButton, next ? 'exit' : 'immersive');
      immersiveButton.setAttribute('aria-pressed', String(next));
    }
  }

  // ---- 走近看：DOM 浮层（文字画在 DOM 里比画进 3D 清晰，键盘也能用）----
  function isFocusOpen(): boolean {
    return focus?.dataset.open === 'true';
  }

  function openFocus(id: string): void {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0 || !focus) return;
    focusIndex = index;

    const item = items[index];
    if (focusImage) {
      focusImage.src = item.src;
      focusImage.alt = item.title;
    }
    if (focusTitle) focusTitle.textContent = item.title;
    if (focusDesc) focusDesc.textContent = item.desc;
    if (focusMeta) {
      focusMeta.textContent = item.camera && cameraLabel ? `${cameraLabel}：${item.camera}` : '';
    }
    focus.dataset.open = 'true';

    // 深链：?item=city-02 可以直接分享某一件（只动查询串，不动路径）
    const url = new URL(window.location.href);
    url.searchParams.set('item', item.id);
    window.history.replaceState(null, '', url);

    root.querySelector<HTMLButtonElement>('#gal-focus-close')?.focus();
  }

  function stepFocus(delta: number): void {
    if (!isFocusOpen() || items.length === 0) return;
    const next = (focusIndex + delta + items.length) % items.length;
    openFocus(items[next].id);
  }

  function closeFocus(): void {
    if (!focus || !isFocusOpen()) return;
    delete focus.dataset.open;
    focusIndex = -1;

    const url = new URL(window.location.href);
    url.searchParams.delete('item');
    window.history.replaceState(null, '', url);
    canvas.focus();
  }

  mode3d?.addEventListener('click', () => setMode('3d'));
  modeGrid?.addEventListener('click', () => setMode('grid'));
  gridButton?.addEventListener('click', () => setMode(mode === '3d' ? 'grid' : '3d'));
  immersiveButton?.addEventListener('click', () => setImmersive(!immersive));
  root.querySelector('#gal-focus-prev')?.addEventListener('click', () => stepFocus(-1));
  root.querySelector('#gal-focus-next')?.addEventListener('click', () => stepFocus(1));
  root.querySelector('#gal-focus-close')?.addEventListener('click', closeFocus);

  document.addEventListener('keydown', (event) => {
    if (!isFocusOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFocus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepFocus(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepFocus(1);
    }
  });

  start().catch(() => degrade(page, root));

  async function start(): Promise<void> {
    const floorModule = await import('./floor').catch(() => null);
    if (!floorModule?.isWebGLAvailable()) {
      degrade(page, root);
      return;
    }
    const { createFloor, loadTexture } = floorModule;

    const plan = layoutFloor(
      rooms.map(
        (room): PlanRoomInput => ({
          id: room.id,
          label: room.label,
          items: room.items,
          colors: {
            wall: resolveColor(room.wall, '#2b2f36'),
            floor: resolveColor(room.floor, '#1c1f24'),
            light: resolveColor(room.light, '#ffd9a8'),
          },
        }),
      ),
      root.dataset.corridor ?? corridorLabel,
    );

    let floor: FloorHandle;
    try {
      floor = createFloor({ canvas, plan });
    } catch {
      degrade(page, root);
      return;
    }

    const home = spawnOf(plan, startRoomId);
    const pos = { x: home.x, z: home.z };
    const keys = new Set<string>();
    let yaw = home.yaw;
    let pitch = 0;
    /** 途经点队列：点地面/画作时由 routeTo 算出，可能要绕走廊 */
    let path: Waypoint[] = [];
    let pendingFocus: string | null = null;
    let hereId = '';
    let dirty = true;
    let lastTime = 0;
    let frameHandle = 0;
    /** 连续撞墙的帧数：贴着墙走不算，但走不通就得认，别一直顶着墙滑 */
    let stuck = 0;

    const requestRender = (): void => {
      dirty = true;
    };

    function applyCamera(): void {
      floor.camera.position.set(pos.x, EYE_HEIGHT, pos.z);
      floor.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }

    /** 走一步：先整体，撞墙了再只走一个轴，贴着墙滑过去 */
    function moveTo(nx: number, nz: number): boolean {
      if (containsPoint(plan, nx, nz)) {
        pos.x = nx;
        pos.z = nz;
        return true;
      }
      if (containsPoint(plan, nx, pos.z)) {
        pos.x = nx;
        return true;
      }
      if (containsPoint(plan, pos.x, nz)) {
        pos.z = nz;
        return true;
      }
      return false;
    }

    /** 一帧的位移；返回是否动过（没动且没脏就不重画） */
    function step(dt: number): boolean {
      const forward =
        (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
        (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const strafe =
        (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
        (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);

      if (forward || strafe) {
        path = [];
        pendingFocus = null;
        stuck = 0;
        // 前后沿视线方向，左右沿它的垂直方向；斜着走不该更快
        const dx = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
        const dz = -Math.cos(yaw) * forward - Math.sin(yaw) * strafe;
        const length = Math.hypot(dx, dz) || 1;
        return moveTo(
          pos.x + (dx / length) * WALK_SPEED * dt,
          pos.z + (dz / length) * WALK_SPEED * dt,
        );
      }

      const target = path[0];
      if (!target) return false;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const distance = Math.hypot(dx, dz);
      // 减少动效：不慢慢走过去，直接站位
      const stride = reduceMotion ? distance : WALK_SPEED * dt;
      const arrival = path.length > 1 ? WAYPOINT_ARRIVE : 0.05;

      if (distance <= Math.max(stride, arrival)) {
        // 最后一点若落在墙里（点到了贴墙的地面），走到就行，别硬挤进去
        if (containsPoint(plan, target.x, target.z)) {
          pos.x = target.x;
          pos.z = target.z;
        }
        path.shift();
        if (path.length === 0 && pendingFocus) {
          const id = pendingFocus;
          pendingFocus = null;
          openFocus(id);
        }
        return true;
      }

      const ratio = stride / distance;
      const walked = moveTo(pos.x + dx * ratio, pos.z + dz * ratio);
      if (!walked) {
        // 目标点本身走不到（比如点在墙根上），顶几下就放弃，别一直贴着墙
        stuck += 1;
        if (stuck > 6) {
          path = [];
          stuck = 0;
          if (pendingFocus) {
            const id = pendingFocus;
            pendingFocus = null;
            openFocus(id);
          }
        }
        return false;
      }
      stuck = 0;
      return true;
    }

    /** 换房间（或进出走廊）时同步 HUD、URL 与页面标题 */
    function updateLocation(): void {
      const space = spaceAt(plan, pos.x, pos.z);
      const id = space?.id ?? '';
      if (id === hereId) return;
      hereId = id;
      if (!space) return;

      if (where) where.textContent = `${hereLabel}：${space.label}`;
      if (space.kind !== 'room') return;

      // URL 只换最后一段，?item= 之类的查询串原样留着
      const url = new URL(window.location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        parts[parts.length - 1] = space.id;
        url.pathname = `/${parts.join('/')}/`;
        window.history.replaceState(null, '', url);
      }
      if (titleSuffix) document.title = `${space.label}${titleSuffix}`;
      const heading = document.getElementById('gal-room-title');
      if (heading) heading.textContent = space.label;
      const intro = document.getElementById('gal-room-intro');
      const room = rooms.find((item) => item.id === space.id);
      if (intro && room) intro.textContent = room.intro;
    }

    function frame(now: number): void {
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
      lastTime = now;
      const moved = step(dt);
      if (moved) updateLocation();
      if (moved || dirty) {
        applyCamera();
        floor.render();
        dirty = false;
      }
      frameHandle = requestAnimationFrame(frame);
    }

    // ---- 看向与点击 ----
    let dragging = false;
    let travelled = 0;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (event) => {
      dragging = true;
      travelled = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      // 拖拽方向与视线相反：画面跟着手走，跟街景一个手感
      yaw += dx * LOOK_SPEED;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + dy * LOOK_SPEED));
      requestRender();
    });

    canvas.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (travelled > TAP_SLOP) return;

      const hit: PickResult | null = floor.pick(event.clientX, event.clientY);
      if (!hit) return;
      if (hit.kind === 'floor') {
        path = routeTo(plan, pos, hit);
        pendingFocus = null;
        requestRender();
        return;
      }
      walkTo(hit.id);
    });

    canvas.addEventListener('pointercancel', () => {
      dragging = false;
    });

    /** 点画作：先走到画前面（可能要穿过走廊去另一间房），到了再开大图 */
    function walkTo(id: string): void {
      const view = floor.viewpoint(id);
      const spot = view ? { x: view.x, z: view.z } : null;
      if (!spot || reduceMotion || Math.hypot(spot.x - pos.x, spot.z - pos.z) < 1.2) {
        if (spot) {
          pos.x = spot.x;
          pos.z = spot.z;
          updateLocation();
        }
        openFocus(id);
        return;
      }
      pendingFocus = id;
      path = routeTo(plan, pos, spot);
      requestRender();
    }

    /**
     * 回正视角：立刻站回当前房间的门口、视线放平。
     * 不做补间 —— 转晕的时候要的是马上稳住，不是再看一段动画。
     */
    function resetView(): void {
      keys.clear();
      path = [];
      pendingFocus = null;
      const space = spaceAt(plan, pos.x, pos.z);
      // 在走廊里就回出发的那间房，不然「回正」完还站在走廊中间
      const back = spawnOf(plan, space?.kind === 'room' ? space.id : startRoomId);
      pos.x = back.x;
      pos.z = back.z;
      yaw = back.yaw;
      pitch = 0;
      updateLocation();
      applyCamera();
      floor.render();
    }

    resetButton?.addEventListener('click', () => {
      resetView();
      // 沉浸模式下画布本来就在手里，不用抢焦点
      if (!immersive) canvas.focus();
    });

    // ---- 键盘：只有画布聚焦或沉浸模式下才接管方向键 ----
    const isTyping = (node: EventTarget | null): boolean =>
      node instanceof HTMLElement &&
      (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);

    document.addEventListener('keydown', (event) => {
      if (isTyping(event.target) || isFocusOpen()) return;
      // R 随时可用：转晕了还得先去找画布聚焦就太晚了
      if (event.code === 'KeyR') {
        event.preventDefault();
        resetView();
        return;
      }
      if (document.activeElement !== canvas && !immersive) return;
      if (!event.key.startsWith('Arrow') && !/^Key[WASD]$/.test(event.code)) return;
      keys.add(event.code);
      event.preventDefault();
      path = [];
      pendingFocus = null;
    });

    document.addEventListener('keyup', (event) => keys.delete(event.code));
    window.addEventListener('blur', () => keys.clear());

    // ---- 尺寸 ----
    const observer = new ResizeObserver(() => {
      // 网格模式下 .gal 是 display:none，尺寸为 0
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
      floor.setSize(canvas.clientWidth, canvas.clientHeight);
      requestRender();
    });
    observer.observe(canvas);

    if (hint) {
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const base = hint.dataset[touch ? 'touch' : 'desktop'] ?? hint.textContent;
      const reset = hint.dataset.reset;
      hint.textContent = reset ? `${base} · ${reset}` : base;
    }

    setMode('3d');
    floor.setSize(canvas.clientWidth, canvas.clientHeight);
    applyCamera();
    updateLocation();
    floor.render();
    frameHandle = requestAnimationFrame(frame);

    // ---- 纹理：缩略图先挂上，原图随后替换 ----
    if (progress) {
      progress.hidden = false;
      progress.setAttribute('role', 'progressbar');
      const loading = root.dataset.labelLoading;
      if (loading) progress.setAttribute('aria-label', loading);
    }
    let loaded = 0;
    const bump = (): void => {
      loaded += 1;
      if (progressBar) progressBar.style.width = `${Math.round((loaded / (items.length * 2)) * 100)}%`;
      if (loaded >= items.length * 2 && progress) {
        progress.dataset.done = 'true';
        // 等淡出动画走完再摘掉，别闪
        window.setTimeout(() => {
          progress.hidden = true;
        }, 900);
      }
      requestRender();
    };

    let broken = 0;
    await Promise.all(
      items.map(async (item) => {
        // 一件坏了不拖累整间展厅，只是这件一直停在缩略图上
        const declared = item.w && item.h ? item.w / item.h : null;
        try {
          const thumb = await loadTexture(item.thumb);
          floor.setPicture(item.id, thumb.texture, thumb.aspect ?? declared);
          bump();
        } catch {
          broken += 1;
          bump();
          bump();
          return;
        }
        try {
          const full = await loadTexture(item.src);
          floor.setPicture(item.id, full.texture, full.aspect);
          bump();
        } catch {
          bump();
        }
      }),
    );

    if (broken === items.length) {
      // 一张都没挂上，展厅是空的，不如直接给网格
      stop();
      degrade(page, root);
      return;
    }

    if (deepLink) openFocus(deepLink);

    // WebGL 上下文是有限的，离开页面时收干净
    window.addEventListener('pagehide', stop);

    function stop(): void {
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      floor.dispose();
    }
  }
}

/**
 * 读房间配色。
 * 变量可能是 hsl() 之类 three 不一定认的写法，先让浏览器解析成 rgb()。
 */
function resolveColor(input: string, fallback: string): string {
  const value = input.trim();
  if (!value) return fallback;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = value;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed || fallback;
}

/** 退回网格：data-mode 回到 grid 并说明原因；展厅整体藏掉，切换按钮也收了 */
function degrade(page: HTMLElement | null, root: HTMLElement | null): void {
  page?.setAttribute('data-mode', 'grid');
  document.getElementById('gal-fallback')?.removeAttribute('hidden');
  root?.setAttribute('hidden', '');
  for (const id of ['gal-mode-3d', 'gal-mode-grid']) {
    document.getElementById(id)?.setAttribute('hidden', '');
  }

  // 深链在降级路径上也要落地：交给网格里的那块瓦片，灯箱逻辑只有一份
  const deepLink = new URL(window.location.href).searchParams.get('item');
  if (deepLink) {
    document
      .querySelector<HTMLButtonElement>(`.gal-tile[data-id="${CSS.escape(deepLink)}"]`)
      ?.click();
  }
}

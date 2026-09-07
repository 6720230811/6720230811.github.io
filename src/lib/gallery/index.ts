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
  nearestWalkable,
  routeTo,
  type PlanRoomInput,
  type Waypoint,
} from './plan';
import { zoneAt } from './walls';
import { createBigMap, createMinimap, type BigMapHandle, type MinimapHandle } from './minimap';
import { isHallStyleId } from './styles';
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
  /** 主题，用来决定这件作品挂在哪一段（city → 城市长廊，sea → 自然长廊） */
  theme: string;
}

interface PayloadRoom {
  id: string;
  label: string;
  intro: string;
  /** 形制 id（见 styles.ts）；认不出来就退回金贝尔 */
  style: string;
  items: PayloadItem[];
}

type Mode = 'grid' | '3d';

const WALK_SPEED = 2.4;
const LOOK_SPEED = 0.0028;
const PITCH_LIMIT = 0.9;
/** 拖拽超过这个像素就不算「点击」，免得转视角时误开大图（手指抖得多，放宽些） */
const TAP_SLOP = 6;
const TAP_SLOP_TOUCH = 14;
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
  const minimapButton = root.querySelector<HTMLButtonElement>('#gal-minimap');
  const minimapEl = root.querySelector<HTMLCanvasElement>('#gal-minimap-canvas');
  const mapPanel = root.querySelector<HTMLElement>('#gal-map');
  const mapCanvasEl = root.querySelector<HTMLCanvasElement>('#gal-map-canvas');
  const mapClose = root.querySelector<HTMLButtonElement>('#gal-map-close');
  const mapToggle = root.querySelector<HTMLButtonElement>('#gal-map-toggle');
  const mapBox = root.querySelector<HTMLElement>('#gal-mapbox');
  const progressBar = progress?.querySelector<HTMLElement>('span') ?? null;
  /** 左上章节 HUD */
  const chapterBox = root.querySelector<HTMLElement>('#gal-chapter');
  const chapterNo = root.querySelector<HTMLElement>('#gal-chapter-no');
  const chapterName = root.querySelector<HTMLElement>('#gal-chapter-name');
  /** 左下作品信息 */
  const infoBox = root.querySelector<HTMLElement>('#gal-info');
  const infoTitle = root.querySelector<HTMLElement>('#gal-info-title');
  const infoDesc = root.querySelector<HTMLElement>('#gal-info-desc');
  const infoMeta = root.querySelector<HTMLElement>('#gal-info-meta');
  /** 首次进入的操作说明 */
  const introBox = root.querySelector<HTMLElement>('#gal-intro');
  const introText = root.querySelector<HTMLElement>('#gal-intro-text');
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
  const chapterLabel = root.dataset.labelChapter ?? '';
  const introLabel = root.dataset.labelIntro ?? '';
  /** 触屏说触屏的话：没有 WASD，也没有 R 键 */
  const introTouchLabel = root.dataset.labelIntroTouch ?? introLabel;
  /** 分区名是 { zh, en } 两份，按页面的语言取 */
  const localeOf = (): 'zh' | 'en' => (root.dataset.locale === 'en' ? 'en' : 'zh');

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
        }),
      ),
    );

    let floor: FloorHandle;
    try {
      floor = createFloor({ canvas, plan });
    } catch {
      degrade(page, root);
      return;
    }
    // 小地图 / 大地图：底图懒加载（网格模式下画布量出来是 0），切到 3D 之后
    // 第一帧才画。大地图点一下就传送，落点吸到能站的地方
    const minimap: MinimapHandle | null = minimapEl ? createMinimap(minimapEl, plan) : null;
    const bigmap: BigMapHandle | null = mapCanvasEl
      ? createBigMap(mapCanvasEl, plan, { hall: root.dataset.labelHall || '' })
      : null;

    function openMap(): void {
      if (!bigmap || !mapPanel) return;
      mapPanel.hidden = false;
      minimapButton?.setAttribute('aria-expanded', 'true');
      bigmap.show(pos.x, pos.z, yaw);
      mapClose?.focus();
    }

    function closeMap(): void {
      if (!bigmap?.isOpen() || !mapPanel) return;
      bigmap.hide();
      mapPanel.hidden = true;
      minimapButton?.setAttribute('aria-expanded', 'false');
      minimapButton?.focus();
    }

    /** 传送：不走路（routeTo 还是个 stub），直接站过去，别把人丢进墙里 */
    function teleportTo(spot: Waypoint): void {
      keys.clear();
      path = [];
      pendingFocus = null;
      pendingYaw = null;
      pos.x = spot.x;
      pos.z = spot.z;
      pitch = 0;
      stuck = 0;
      updateLocation();
      applyCamera();
      floor.render();
    }

    minimapButton?.addEventListener('click', () => {
      if (bigmap?.isOpen()) closeMap();
      else openMap();
    });
    mapClose?.addEventListener('click', closeMap);
    // 点面板以外的暗底关掉（点画布本身交给画布自己的 click）
    mapPanel?.addEventListener('click', (event) => {
      if (event.target === mapPanel) closeMap();
    });
    mapCanvasEl?.addEventListener('click', (event) => {
      const hit = bigmap?.locate(event.clientX, event.clientY);
      if (!hit) return;
      const spot = nearestWalkable(plan, hit.x, hit.z);
      if (!spot) return;
      closeMap();
      teleportTo(spot);
    });
    mapCanvasEl?.addEventListener('pointermove', (event) => {
      const hit = bigmap?.locate(event.clientX, event.clientY);
      bigmap?.preview(hit ? nearestWalkable(plan, hit.x, hit.z) : null);
    });
    mapCanvasEl?.addEventListener('pointerleave', () => bigmap?.preview(null));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && bigmap?.isOpen()) {
        event.preventDefault();
        closeMap();
      }
    });

    const home = plan.spawn;
    const pos = { x: home.x, z: home.z };
    const keys = new Set<string>();
    let yaw = home.yaw;
    let pitch = 0;
    /** 途经点队列：点地面/画作时由 routeTo 算出，跨展厅会经过中间的拱门 */
    let path: Waypoint[] = [];
    let pendingFocus: string | null = null;
    /** 走到画前之后该转到的角度（yaw）；跟着 pendingFocus 一起排队 */
    let pendingYaw: number | null = null;
    let hereId = '';
    let dirty = true;
    let lastTime = 0;
    let frameHandle = 0;
    /** stop() 之后就别再排下一帧了 */
    let stopped = false;
    /** 连续撞墙的帧数：贴着墙走不算，但走不通就得认，别一直顶着墙滑 */
    let stuck = 0;

    const requestRender = (): void => {
      dirty = true;
    };

    /** 走近了换高清纹理：start() 后半段才装好，先留空位 */
    let refreshFullTextures: (() => void) | null = null;

    function applyCamera(): void {
      floor.camera.position.set(pos.x, EYE_HEIGHT, pos.z);
      floor.camera.rotation.set(pitch, yaw, 0, 'YXZ');
      floor.updateLighting(pos.x, pos.z);
      // 传送完也得重算靠近的作品（moved=true 才会触发 updateProximity）
      updateLocation();
      updateProximity();
      refreshFullTextures?.();
      minimap?.update(pos.x, pos.z, yaw);
      bigmap?.update(pos.x, pos.z, yaw);
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
        pendingYaw = null;
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
        if (path.length === 0) arrive();
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
          arrive();
        }
        return false;
      }
      stuck = 0;
      return true;
    }

    /** 走到另一个分区时更新左上角的章节 HUD（新建筑只有一个入口，
     *  URL 不跟着变 —— 分区是章节，不是可寻址的页面） */
    function updateLocation(): void {
      const id = zoneAt(pos.x, pos.z);
      if (id === hereId) return;
      hereId = id;
      const current = plan.zones.find((item) => item.id === id);
      if (!current) return;
      const name = current.label[localeOf()] ?? current.label.zh;
      if (chapterName) chapterName.textContent = name;
      if (chapterNo) {
        chapterNo.textContent = current.chapter
          ? `${chapterLabel || ''} ${String(current.chapter).padStart(2, '0')}`.trim()
          : '';
      }
      if (chapterBox) chapterBox.hidden = false;
    }

    /**
     * 靠近作品时把左下角的信息浮出来，走开就淡掉。
     *  只在「人在 3.5 m 内 + 作品在视线前方」时才算靠近 ——
     *  背后的作品不该弹信息。
     */
    let nearId = '';
    function updateProximity(): void {
      let best: (typeof plan.placements)[number] | null = null;
      let bestDist = 3.5 * 3.5;
      const lookX = -Math.sin(yaw);
      const lookZ = -Math.cos(yaw);
      for (const placement of plan.placements) {
        if (placement.kind === 'placeholder') continue;
        const dx = placement.x - pos.x;
        const dz = placement.z - pos.z;
        const dist = dx * dx + dz * dz;
        if (dist > bestDist) continue;
        const length = Math.hypot(dx, dz) || 1;
        if ((dx / length) * lookX + (dz / length) * lookZ < 0.35) continue;
        bestDist = dist;
        best = placement;
      }
      const id = best ? best.id : '';
      if (id === nearId) return;
      nearId = id;
      const item = best ? items.find((entry) => entry.id === best!.id) : undefined;
      if (!best || !item) {
        if (infoBox) delete infoBox.dataset.open;
        return;
      }
      if (infoTitle) infoTitle.textContent = item.title;
      if (infoDesc) infoDesc.textContent = item.desc ?? '';
      if (infoMeta) {
        infoMeta.textContent = item.camera && cameraLabel ? `${cameraLabel}：${item.camera}` : '';
      }
      if (infoBox) infoBox.dataset.open = 'true';
    }

    /**
     * 看门狗：连续掉帧就先降分辨率，还掉就退回网格并说明原因。
     *  只在纹理都挂完之后才开始看 —— 加载那几秒本来就会卡。
     */
    let perfReady = false;
    let slowFrames = 0;
    /** 0 = 满配，1 = 已降过分辨率，2 = 已经退到网格 */
    let perfStage = 0;
    /** 低于这个帧率算慢（26 fps：肉眼已经能觉出顿） */
    const SLOW_MS = 1000 / 26;
    function watchPerformance(raw: number): void {
      if (!perfReady || perfStage >= 2 || mode !== '3d') return;
      // 切标签页回来的那一帧间隔能有好几秒，不算数
      if (raw <= 0 || raw > 500) return;
      if (raw < SLOW_MS) {
        slowFrames = 0;
        return;
      }
      slowFrames += 1;
      if (slowFrames < 45) return;
      slowFrames = 0;
      if (perfStage === 0) {
        perfStage = 1;
        floor.setPixelRatio(1);
        dirty = true;
        return;
      }
      perfStage = 2;
      stop();
      degrade(page, root);
    }

    function frame(now: number): void {
      // 已经收摊了（自动降级 / 页面隐藏）：别再碰已经 dispose 掉的 renderer
      if (stopped) return;
      const raw = lastTime ? now - lastTime : 0;
      const dt = Math.min(raw / 1000, 0.05);
      lastTime = now;
      watchPerformance(raw);
      const moved = step(dt);
      if (moved) {
        updateLocation();
        updateProximity();
      }
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
      // 一按下就开始转视角，先收掉悬停高亮
      setHovered(-1);
      canvas.setPointerCapture(event.pointerId);
    });

    // ---- 悬停：只在真鼠标上做，触屏没有「悬停」这回事 ----
    /** 高亮的是「哪一处挂画」而不是哪件作品：同一件挂了很多处，别一起亮 */
    let hovered = -1;

    function setHovered(slot: number): void {
      if (slot === hovered) return;
      hovered = slot;
      floor.setHover(slot >= 0 ? slot : null);
      canvas.style.cursor = slot >= 0 ? 'pointer' : '';
      requestRender();
    }

    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) {
        if (event.pointerType === 'mouse') {
          const hit = floor.pick(event.clientX, event.clientY);
          setHovered(hit?.kind === 'art' ? hit.slot : -1);
        }
        return;
      }
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
      if (travelled > (event.pointerType === 'mouse' ? TAP_SLOP : TAP_SLOP_TOUCH)) return;

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

    canvas.addEventListener('pointerleave', () => setHovered(-1));

    canvas.addEventListener('pointercancel', () => {
      dragging = false;
    });

    /** 走到位了：先正对作品再开大图，关掉之后人还站在画前看着它 */
    function arrive(): void {
      if (!pendingFocus) return;
      const id = pendingFocus;
      pendingFocus = null;
      if (pendingYaw !== null) {
        yaw = pendingYaw;
        pendingYaw = null;
        pitch = 0;
      }
      openFocus(id);
    }

    /** 点画作：先走到画前面（可能要穿过拱门去另一间房），到了再开大图 */
    function walkTo(id: string): void {
      const view = floor.viewpoint(id);
      if (!view) {
        openFocus(id);
        return;
      }
      const near = Math.hypot(view.x - pos.x, view.z - pos.z) < 1.2;
      if (reduceMotion || near) {
        // 站定并转身：只是「走过去」而不转头，等于背对着画
        pos.x = view.x;
        pos.z = view.z;
        yaw = view.yaw;
        pitch = 0;
        updateLocation();
        // 直接站过去也要重画一帧：不然视角与小地图要等下次交互才跟上
        requestRender();
        openFocus(id);
        return;
      }
      pendingFocus = id;
      pendingYaw = view.yaw;
      path = routeTo(plan, pos, { x: view.x, z: view.z });
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
      pendingYaw = null;
      // 新建筑只有一个出生点（序厅入口），回正就是回到那儿、朝正北
      const back = plan.spawn;
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
      pendingYaw = null;
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

    // 首次进入的操作说明：5 秒后自己淡掉（规格：首次进入显示，5 秒后淡出）
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (introText) introText.textContent = touch ? introTouchLabel : introLabel;
    if (introBox) {
      window.setTimeout(() => {
        introBox.dataset.faded = 'true';
        window.setTimeout(() => {
          introBox.hidden = true;
        }, 900);
      }, 5000);
    }

    // 右上小地图折叠
    mapToggle?.addEventListener('click', () => {
      if (!mapBox) return;
      const collapsed = mapBox.dataset.collapsed === 'true';
      if (collapsed) delete mapBox.dataset.collapsed;
      else mapBox.dataset.collapsed = 'true';
      mapToggle.setAttribute('aria-expanded', String(collapsed));
    });

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
      if (progressBar) progressBar.style.width = `${Math.round((loaded / items.length) * 100)}%`;
      if (loaded >= items.length && progress) {
        progress.dataset.done = 'true';
        // 等淡出动画走完再摘掉，别闪
        window.setTimeout(() => {
          progress.hidden = true;
        }, 900);
      }
      requestRender();
    };

    /**
     * 只挂缩略图；原图等走近了（FULL_DISTANCE 内）再换。
     *  规格：只加载玩家附近展区的高清图片，远处用缩略图。
     *  一张作品可能挂在多处（现在是每件只挂一次，但换图要按 id 换），
     *  所以按「这件作品最近的那一处」算距离。
     */
    const FULL_DISTANCE = 14;
    const fullAsked = new Set<string>();
    const nearestSpotOf = (id: string): { x: number; z: number } | null => {
      let best: { x: number; z: number } | null = null;
      let bestDist = Infinity;
      for (const placement of plan.placements) {
        if (placement.id !== id) continue;
        const d = (placement.x - pos.x) ** 2 + (placement.z - pos.z) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = { x: placement.x, z: placement.z };
        }
      }
      return best;
    };
    const refreshFullTexturesNow = (): void => {
      for (const item of items) {
        if (fullAsked.has(item.id)) continue;
        const spot = nearestSpotOf(item.id);
        if (!spot) continue;
        if ((spot.x - pos.x) ** 2 + (spot.z - pos.z) ** 2 > FULL_DISTANCE * FULL_DISTANCE) continue;
        fullAsked.add(item.id);
        loadTexture(item.src)
          .then(({ texture }) => floor.setPicture(item.id, texture))
          .catch(() => {
            // 原图挂不上就留着缩略图，不整块降级
          });
      }
    };

    let broken = 0;
    await Promise.all(
      items.map(async (item) => {
        try {
          const thumb = await loadTexture(item.thumb);
          floor.setPicture(item.id, thumb.texture);
          bump();
        } catch {
          broken += 1;
          bump();
        }
      }),
    );
    void broken;
    refreshFullTextures = refreshFullTexturesNow;
    refreshFullTextures();

    if (broken === items.length) {
      // 一张都没挂上，展厅是空的，不如直接给网格
      stop();
      degrade(page, root);
      return;
    }

    if (deepLink) openFocus(deepLink);
    // 挂画都到位了，这才开始看帧率
    perfReady = true;

    // WebGL 上下文是有限的，离开页面时收干净
    window.addEventListener('pagehide', stop);

    function stop(): void {
      stopped = true;
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      minimap?.dispose();
      bigmap?.dispose();
      floor.dispose();
    }
  }
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

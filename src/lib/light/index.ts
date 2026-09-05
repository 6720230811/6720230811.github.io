/**
 * 采光验证页的客户端入口：把 kimbell.astro 渲染出来的 DOM 接成能跑的场景。
 *
 * 与画廊（lib/gallery/index.ts）同一套做法：
 * - 页面先是一块静态的说明 + 画布，脚本确认能跑 WebGL 之后才动态 import
 *   场景模块；不支持的设备连 three 的 chunk 都不会下载
 * - 这一层不 import three，只拿纯数据的结果
 * - 时间滑块、视角按钮与统计读数都挂在 DOM 上（HUD 是页面 UI，场景里不放文字）
 */
import { DAY_END, DAY_START, formatHour, type SunState } from './sun';
import type { LightStudy, ViewKey } from './scene';

interface LightStats {
  fps: number;
  segments: number;
  vertices: number;
  triangles: number;
  calls: number;
}

/** 展品：由页面（数据层）通过 data-items 传进来 */
interface PayloadItem {
  id: string;
  thumb: string;
  src: string;
  w: number | null;
  h: number | null;
}

export function mountLight(root: HTMLElement | null): void {
  if (!root) return;
  const host: HTMLElement = root;

  const canvas = host.querySelector<HTMLCanvasElement>('#light-canvas');
  const slider = host.querySelector<HTMLInputElement>('#light-time');
  const clock = host.querySelector<HTMLElement>('#light-clock');
  const stateEl = host.querySelector<HTMLElement>('#light-state');
  const statsEl = host.querySelector<HTMLElement>('#light-stats');
  const fallback = host.querySelector<HTMLElement>('#light-fallback');
  if (!canvas || !slider) {
    if (fallback) fallback.hidden = false;
    return;
  }

  const canvasEl: HTMLCanvasElement = canvas;
  const sliderEl: HTMLInputElement = slider;
  sliderEl.min = String(DAY_START);
  sliderEl.max = String(DAY_END);

  const items: PayloadItem[] = readItems(host.dataset.items);
  const labels = {
    fps: host.dataset.labelFps ?? 'FPS',
    segments: host.dataset.labelSegments ?? 'segments',
    vertices: host.dataset.labelVertices ?? 'vertices',
    triangles: host.dataset.labelTriangles ?? 'triangles',
    calls: host.dataset.labelCalls ?? 'draw calls',
  };

  let hour = Number(sliderEl.value) || 12;
  let study: LightStudy | null = null;

  function writeClock(next: number): void {
    if (clock) clock.textContent = formatHour(next);
  }

  function writeState(state: SunState): void {
    if (!stateEl) return;
    stateEl.textContent = `${state.elevation.toFixed(0)}° · ${state.intensity.toFixed(2)}`;
  }

  function writeStats(stats: LightStats): void {
    if (!statsEl) return;
    statsEl.textContent = [
      `${labels.fps} ${stats.fps.toFixed(1)}`,
      `${labels.segments} ${stats.segments}`,
      `${labels.vertices} ${stats.vertices.toLocaleString('en-US')}`,
      `${labels.triangles} ${stats.triangles.toLocaleString('en-US')}`,
      `${labels.calls} ${stats.calls}`,
    ].join('\n');
  }

  function degrade(): void {
    if (fallback) fallback.hidden = false;
    host.dataset.ready = 'false';
  }

  start().catch(degrade);

  async function start(): Promise<void> {
    if (!isWebGLAvailable()) {
      degrade();
      return;
    }
    const module = await import('./scene').catch(() => null);
    const next = module?.createLightStudy({ canvas: canvasEl, items }) ?? null;
    if (!module || !next) {
      degrade();
      return;
    }
    study = next;
    host.dataset.ready = 'true';

    const apply = (value: number): void => {
      hour = value;
      writeClock(hour);
      writeState(study?.setTime(hour) as SunState);
    };
    sliderEl.addEventListener('input', () => apply(Number(sliderEl.value)));
    apply(hour);

    // 视角预设：俯视 / 横剖面 / 纵剖面 / 人视
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      button.addEventListener('click', () => {
        study?.setView(button.dataset.view as ViewKey);
        for (const other of host.querySelectorAll('[data-view]')) {
          other.setAttribute('aria-pressed', String(other === button));
        }
      });
    }

    const resize = (): void => study?.setSize(canvasEl.clientWidth, canvasEl.clientHeight);
    const observer = new ResizeObserver(resize);
    observer.observe(canvasEl);
    resize();

    // 画：缩略图先挂上，原图随后替换（与画廊同一套做法）
    void loadPaintings(module, study, items);

    // ---- 帧率：最近 30 帧的平均 ----
    const samples: number[] = [];
    let last = performance.now();
    let hudClock = 0;

    const frame = (now: number): void => {
      const dt = now - last;
      last = now;
      if (dt > 0) {
        samples.push(dt);
        if (samples.length > 30) samples.shift();
      }
      study?.render();

      hudClock += dt;
      if (hudClock > 250 && study) {
        hudClock = 0;
        const mean = samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1);
        const geometry = study.stats();
        writeStats({
          fps: mean > 0 ? 1000 / mean : 0,
          segments: geometry.segments,
          vertices: geometry.vertices,
          triangles: geometry.triangles,
          calls: study.calls(),
        });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    window.addEventListener('pagehide', () => {
      observer.disconnect();
      study?.dispose();
    });
  }
}

/**
 * 挂画上墙：先缩略图、后原图。
 * 一件坏了不拖累整座建筑；纹理到达后按真实比例校正画心。
 */
async function loadPaintings(
  module: typeof import('./scene'),
  study: LightStudy,
  items: readonly PayloadItem[],
): Promise<void> {
  const byId = new Map(items.map((item) => [item.id, item]));
  await Promise.all(
    study.hangings.ids.map(async (id) => {
      const item = byId.get(id);
      if (!item) return;
      const declared = item.w && item.h ? item.w / item.h : null;
      try {
        const thumb = await module.loadTexture(item.thumb);
        study.hangings.setPicture(id, thumb.texture, thumb.aspect ?? declared);
      } catch {
        return; // 缩略图都挂不上就留着空白卡纸
      }
      try {
        const full = await module.loadTexture(item.src);
        study.hangings.setPicture(id, full.texture, full.aspect);
      } catch {
        /* 停在缩略图上就够了 */
      }
    }),
  );
}

function readItems(raw: string | undefined): PayloadItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PayloadItem =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as PayloadItem).id === 'string' &&
        typeof (item as PayloadItem).src === 'string',
    );
  } catch {
    return [];
  }
}

/** 只问一句「能不能开 WebGL 上下文」，不建渲染器 */
function isWebGLAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (probe.getContext('webgl2') || probe.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

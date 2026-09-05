/**
 * 采光验证页的客户端入口：把 kimbell.astro 渲染出来的 DOM 接成能跑的场景。
 *
 * 与画廊（lib/gallery/index.ts）同一套做法：
 * - 页面先是一块静态的说明 + 画布，脚本确认能跑 WebGL 之后才动态 import
 *   场景模块；不支持的设备连 three 的 chunk 都不会下载
 * - 这一层不 import three，只拿纯数据的结果
 * - 时间滑块与统计读数都挂在 DOM 上（HUD 是页面 UI，场景里不放任何文字）
 */
import { DAY_END, DAY_START, formatHour, type SunState } from './sun';
import type { LightStudy } from './scene';

interface LightStats {
  fps: number;
  segments: number;
  vertices: number;
  triangles: number;
  calls: number;
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

  let hour = Number(sliderEl.value) || 12;
  let study: LightStudy | null = null;

  /** 统计读数：FPS 与几何规模；labels 从宿主元素的 data-* 上取，便于双语 */
  const labels = {
    fps: host.dataset.labelFps ?? 'FPS',
    segments: host.dataset.labelSegments ?? 'segments',
    vertices: host.dataset.labelVertices ?? 'vertices',
    triangles: host.dataset.labelTriangles ?? 'triangles',
    calls: host.dataset.labelCalls ?? 'draw calls',
  };

  function writeClock(next: number): void {
    if (clock) clock.textContent = formatHour(next);
  }

  function writeState(state: SunState): void {
    if (!stateEl) return;
    stateEl.textContent = `${state.elevation.toFixed(0)}° · ${state.intensity.toFixed(2)}`;
  }

  function writeStats(stats: LightStats): void {
    if (!statsEl) return;
    const rows: [string, string][] = [
      [labels.fps, stats.fps.toFixed(1)],
      [labels.segments, String(stats.segments)],
      [labels.vertices, stats.vertices.toLocaleString('en-US')],
      [labels.triangles, stats.triangles.toLocaleString('en-US')],
      [labels.calls, String(stats.calls)],
    ];
    // 中英文混排时对齐会歪，按最长标签补空格只对等宽字体有效，这里直接换行
    statsEl.textContent = rows.map(([key, value]) => `${key} ${value}`).join('\n');
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
    const next = module?.createLightStudy(canvasEl) ?? null;
    if (!next) {
      degrade();
      return;
    }
    study = next;
    host.dataset.ready = 'true';

    const apply = (next: number): void => {
      hour = next;
      writeClock(hour);
      writeState(study?.setTime(hour) as SunState);
    };
    sliderEl.addEventListener('input', () => apply(Number(sliderEl.value)));
    apply(hour);

    const resize = (): void => {
      study?.setSize(canvasEl.clientWidth, canvasEl.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvasEl);
    resize();

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

      // 读数每 0.25 s 刷一次，数字才看得清
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

/** 光是问一句「能不能开 WebGL 上下文」，不建渲染器 */
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

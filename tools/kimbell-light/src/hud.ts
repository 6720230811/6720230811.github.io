/**
 * HUD：时间滑块（6:00–19:00）+ 统计读数。
 * 这是页面 UI（DOM），不是场景里的招牌 —— 场景内不放任何文字。
 */
import { DAY_END, DAY_START, formatHour, type SunState } from './sun';

export interface Stats {
  fps: number;
  segments: number;
  vertices: number;
  triangles: number;
  calls: number;
}

export interface Hud {
  /** 当前滑块时间（小时，含小数） */
  hour(): number;
  /** 直接把时间设到滑块与时钟显示上（外部脚本/截图流程用） */
  setHour(next: number): void;
  setStats(stats: Stats): void;
  setSun(state: SunState): void;
}

export function createHud(initialHour: number, onChange: (hour: number) => void): Hud {
  const slider = document.getElementById('time') as HTMLInputElement | null;
  const clock = document.getElementById('clock');
  const stateEl = document.getElementById('sun-state');
  const statsEl = document.getElementById('stats');

  if (slider) {
    slider.min = String(DAY_START);
    slider.max = String(DAY_END);
    slider.value = String(initialHour);
    slider.addEventListener('input', () => onChange(Number(slider.value)));
  }
  if (clock) clock.textContent = formatHour(initialHour);
  if (slider) slider.addEventListener('input', () => {
    if (clock) clock.textContent = formatHour(Number(slider.value));
  });

  return {
    hour(): number {
      return slider ? Number(slider.value) : initialHour;
    },
    setHour(next: number): void {
      if (slider) slider.value = String(next);
      if (clock) clock.textContent = formatHour(next);
    },
    setSun(state: SunState): void {
      if (!stateEl) return;
      stateEl.textContent = [
        `高度角 ${state.elevation.toFixed(0)}°`,
        `方位角 ${state.azimuth.toFixed(0)}°`,
        `直射 ${state.intensity.toFixed(2)}`,
      ].join(' · ');
    },
    setStats(stats: Stats): void {
      if (!statsEl) return;
      statsEl.textContent = [
        `FPS        ${stats.fps.toFixed(1)}`,
        `摆线断面段数 ${stats.segments}`,
        `顶点数      ${stats.vertices.toLocaleString('en-US')}`,
        `三角形      ${stats.triangles.toLocaleString('en-US')}`,
        `Draw call  ${stats.calls}`,
      ].join('\n');
    },
  };
}

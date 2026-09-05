/**
 * 太阳模型：时间 → 高度角 / 方位角 / 色温 / 强度。
 *
 * 天窗缝沿拱长（z，南北向）开着，所以太阳的水平方位按真实一天走：
 * 6:00 从东（+x）低角度进来 → 12:30 升到最高、偏南（+z）→ 19:00 落到西（−x）。
 * 高度角峰值 62°（沃思堡纬度、春秋分前后的量级），日出日落两端压到 5°。
 *
 * 色温随高度角走：低角度穿过厚大气 → 2000K 橙红；正午 → 5500K 近白。
 */
import * as THREE from 'three';

export const DAY_START = 6;
export const DAY_END = 19;

export interface SunState {
  /** 高度角（度） */
  elevation: number;
  /** 方位角（度）：0 = +x（东），90 = +z（南），180 = −x（西） */
  azimuth: number;
  /** 太阳方向（从场景指向太阳的单位向量） */
  direction: THREE.Vector3;
  color: THREE.Color;
  /** 直射强度 */
  intensity: number;
  /** 反射器自发光强度（打亮翼面用） */
  emissive: number;
  /** 朝上聚光灯强度（模拟第一次反射） */
  bounce: number;
  /** 天空色（有机玻璃 / 环境贴图用） */
  sky: THREE.Color;
  /** 地面反弹色 */
  ground: THREE.Color;
  /** 环境光强度（天空漫射，压得很低） */
  ambient: number;
}

/** 色温阶梯：[高度角, 颜色] */
const STOPS: { elev: number; color: string }[] = [
  { elev: 0, color: '#ff6a2c' },
  { elev: 6, color: '#ff8f4d' },
  { elev: 14, color: '#ffb877' },
  { elev: 26, color: '#ffd9ac' },
  { elev: 42, color: '#fff0d8' },
  { elev: 62, color: '#fff7e8' },
];

function colorFor(elevation: number): THREE.Color {
  for (let i = 1; i < STOPS.length; i += 1) {
    if (elevation <= STOPS[i].elev) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      const f = (elevation - a.elev) / (b.elev - a.elev);
      return new THREE.Color(a.color).lerp(new THREE.Color(b.color), Math.max(0, Math.min(1, f)));
    }
  }
  return new THREE.Color(STOPS[STOPS.length - 1].color);
}

export function sunAt(hour: number): SunState {
  const t = (hour - DAY_START) / (DAY_END - DAY_START); // 0..1
  const day = Math.max(0, Math.min(1, t));
  // 高度角：日出日落两端低，正午最高
  const elevation = 5 + Math.sin(Math.PI * day) ** 1.05 * 57;
  // 方位角：东 → 南 → 西
  const azimuth = 15 + day * 150;

  const e = THREE.MathUtils.degToRad(elevation);
  const a = THREE.MathUtils.degToRad(azimuth);
  const direction = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();

  const noon = Math.sin(Math.PI * day);
  const intensity = 0.35 + 2.4 * noon ** 0.75;
  const color = colorFor(elevation);
  const sky = colorFor(Math.max(elevation, 20)).lerp(new THREE.Color('#cfe0f5'), 0.45 * noon);
  const ground = new THREE.Color('#6b6255').lerp(new THREE.Color('#a99a7f'), noon);

  return {
    elevation,
    azimuth,
    direction,
    color,
    intensity,
    // 反射器自发光与朝上补光都跟太阳强度走：天黑了屋里就暗
    emissive: 0.08 + 0.55 * noon ** 0.8,
    bounce: 0.4 + 4.2 * noon ** 0.9,
    sky,
    ground,
    ambient: 0.04 + 0.18 * noon,
  };
}

/** 12.5 → "12:30" */
export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

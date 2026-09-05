/**
 * 展厅形制目录：九种照着真实艺术厅复刻的展厅。
 *
 * 这一层是**纯数据**：不 import three，也不碰 DOM。plan.ts 拿它算平面尺寸，
 * floor.ts 拿它挑材质与顶棚做法 —— 两边引用同一份数字，改形制只改这里。
 *
 * 九间厅各自的形制要点（写在注释里，改参数时照着对）：
 * - kimbell    金贝尔美术馆（路易·康，1972）：扁摆线筒拱 + 拱顶一线天光 + 铝反光翼
 * - louvre     卢浮宫大画廊：通长筒拱、横向肋、侧高窗，深红锦缎墙 + 金框 + 拼花地板
 * - uffizi     乌菲齐长廊（瓦萨里，1581）：又窄又长，湿壁画拱顶、石地、连续挂画
 * - sistine    西斯廷礼拜堂：高厅筒拱、半月窗、大理石嵌花地，画挂得低、墙留得高
 * - whitecube  现代白盒子（MoMA 一路）：平顶轨道灯、纯白墙、水泥地，不要任何装饰
 * - versailles 凡尔赛镜厅（芒萨尔，1684）：一侧拱窗、一侧镜面、枝形灯、金饰
 * - neue       新国家美术馆（密斯，1968）：黑色钢网格顶 + 通高玻璃 + 花岗岩地
 * - shoin      东方木构厅堂：木格栅天花糊纸、朱漆柱、月洞门、暖纸光
 * - guggenheim 古根海姆中庭（赖特，1959）：椭圆穹顶 + 天眼 + 沿墙盘旋的坡道
 */

/** 所有形制的 id；顺序也是「不指定形制时轮流分配」的顺序 */
export const HALL_STYLE_IDS = [
  'kimbell',
  'louvre',
  'uffizi',
  'sistine',
  'whitecube',
  'versailles',
  'neue',
  'shoin',
  'guggenheim',
] as const;

export type HallStyleId = (typeof HALL_STYLE_IDS)[number];

export function isHallStyleId(value: string): value is HallStyleId {
  return (HALL_STYLE_IDS as readonly string[]).includes(value);
}

/** 墙面 / 地面 / 顶棚的材质做法；贴图由 surfaces.ts 现画 */
export type SurfaceKind =
  | 'travertine' // 石灰华：暖米色、水平层理、竖向板缝
  | 'plaster' // 抹灰：细颗粒，纯白盒子的墙
  | 'damask' // 锦缎：深红丝绒，卢浮宫挂画的那种墙
  | 'marble' // 大理石：纹路明显的抛光石
  | 'oak' // 白橡木地板
  | 'parquet' // 拼花地板：凡尔赛的人字拼
  | 'terrazzo' // 水磨石：灰底骨料
  | 'concrete' // 水泥：白盒子的地
  | 'granite' // 花岗岩：新国家美术馆的灰麻石
  | 'tatami'; // 榻榻米 / 席面

/** 顶棚做法 */
export type CeilingKind =
  | 'vault' // 筒拱（摆线或椭圆弧），可带天光缝与反光翼
  | 'dome' // 穹顶 + 天眼
  | 'flat' // 平顶 + 轨道灯
  | 'lattice' // 木格栅糊纸
  | 'grid'; // 钢网格玻璃顶

export interface CeilingConfig {
  kind: CeilingKind;
  /**
   * 矢高比：拱/穹顶的矢高 = 跨度 × 这个值。
   * 摆线是 1/π≈0.318（很扁），半圆是 0.5，西斯廷那种略陡的取 0.42。
   */
  rise?: number;
  /** 天光缝宽度（米）；给了就开一条通长的缝 */
  slot?: number;
  /** 缝下的反光翼：向外向下弯出去的浅弧，宽度（米） */
  wing?: number;
  /** 拱顶横向肋：一道道横跨拱顶的线脚 */
  ribs?: boolean;
  /** 半月窗：起拱线上一排拱形窗（西斯廷 / 卢浮宫的高窗） */
  lunettes?: boolean;
  /** 拱顶彩画：湿壁画贴图代替混凝土 + 明暗渐变 */
  paint?: boolean;
  /** 穹顶：天眼直径（米）、环向肋条数、是否沿墙盘一圈坡道 */
  dome?: { oculus: number; ribs: number; ramp: boolean };
  /** 平顶轨道灯：几条轨道 */
  tracks?: number;
  /** 钢网格灯：几列发光板 */
  panels?: number;
  /** 木格栅：几格 */
  lattice?: number;
}

export interface HallStyle {
  id: HallStyleId;
  /** 平面尺寸：跨度、墙高（也是拱的起拱线高度）、最短长度、每两件作品再加的长度 */
  metrics: { width: number; height: number; minLen: number; lenPerPair: number };
  ceiling: CeilingConfig;
  surfaces: { wall: SurfaceKind; floor: SurfaceKind };
  /**
   * 配色。wall / floor / ceiling 是各自贴图的底色，trim 是檐口与踢脚，
   * accent 是那一点出挑的颜色（金饰、朱漆、黑钢），metal 是金属件。
   */
  colors: {
    wall: string;
    floor: string;
    ceiling: string;
    trim: string;
    accent: string;
    metal: string;
    /** 画框与卡纸：金框配白卡纸，黑钢框配冷白卡纸 */
    frame: string;
    mat: string;
  };
  /** 灯光：强度与色调都是「这间厅本来该有的光」 */
  light: {
    ambient: number;
    hemi: number;
    hemiSky: string;
    hemiGround: string;
    /** 顶上的面光强度（筒拱的天光 / 平顶的灯带），0 表示不挂 */
    area: number;
    areaColor: string;
    /** 背景色与 PMREM 环境贴图的上下两色 */
    bg: string;
    envTop: string;
    envBottom: string;
    /** 天光落在地上的那道光的强度 */
    pool: number;
  };
  features: {
    /** 长墙上的壁柱：把一整面墙分成一间间展位 */
    pilasters: boolean;
    /** 起拱线下的檐口 */
    cornice: boolean;
    /** 端墙前的长凳 */
    bench: boolean;
    /** 地面中轴的石材带 + 沿墙走边 */
    runner: boolean;
    /** 枝形灯数量（沿长度均分），0 表示不挂 */
    chandeliers: number;
    /** 宫灯（纸灯笼）数量 */
    lanterns: number;
    /** 一侧长墙做满镜面（镜厅） */
    mirrors: boolean;
    /** 与镜面相对的一侧做一排拱形高窗 */
    windows: boolean;
    /** 端墙整片通高玻璃 */
    glazing: boolean;
  };
  /** 门洞样式：石门套是方的、卢浮宫是拱券、东方厅堂是月洞门 */
  door: { shape: 'square' | 'arch' | 'moon'; color: string };
}

export const HALL_STYLES: Record<HallStyleId, HallStyle> = {
  // 金贝尔：扁摆线筒拱，拱顶一线天光，缝下两片铝反光翼
  kimbell: {
    id: 'kimbell',
    metrics: { width: 6.4, height: 3.2, minLen: 9, lenPerPair: 3.2 },
    ceiling: { kind: 'vault', rise: 1 / Math.PI, slot: 0.7, wing: 0.9 },
    surfaces: { wall: 'travertine', floor: 'oak' },
    colors: {
      wall: '#ded5c6',
      floor: '#d8c6a8',
      ceiling: '#e6e4de',
      trim: '#8d8578',
      accent: '#c0b7a4',
      metal: '#d3d8dc',
      frame: '#1f2329',
      mat: '#efece4',
    },
    light: {
      ambient: 0.2,
      hemi: 0.6,
      hemiSky: '#dbe8f5',
      hemiGround: '#e0cdb0',
      area: 10,
      areaColor: '#fff8ec',
      bg: '#cbc7c0',
      envTop: '#e8f1fb',
      envBottom: '#a9a093',
      pool: 0.2,
    },
    features: {
      pilasters: true,
      cornice: true,
      bench: true,
      runner: true,
      chandeliers: 0,
      lanterns: 0,
      mirrors: false,
      windows: false,
      glazing: false,
    },
    door: { shape: 'square', color: '#c0b7a4' },
  },

  // 卢浮宫大画廊：通长筒拱、横向肋、侧高窗；深红锦缎墙、金框、拼花地板、枝形灯
  louvre: {
    id: 'louvre',
    metrics: { width: 6.0, height: 4.0, minLen: 14, lenPerPair: 3.0 },
    ceiling: { kind: 'vault', rise: 0.4, ribs: true, lunettes: true, paint: true },
    surfaces: { wall: 'damask', floor: 'parquet' },
    colors: {
      wall: '#6d2629',
      floor: '#b98d55',
      ceiling: '#efe2c4',
      trim: '#c9a227',
      accent: '#d8b345',
      metal: '#cbab5c',
      frame: '#b3873a',
      mat: '#f3ead6',
    },
    light: {
      ambient: 0.24,
      hemi: 0.42,
      hemiSky: '#f3e6cf',
      hemiGround: '#8a6a3f',
      area: 7,
      areaColor: '#fff0d8',
      bg: '#6b3a33',
      envTop: '#f0e2c8',
      envBottom: '#6a4c31',
      pool: 0.12,
    },
    features: {
      pilasters: true,
      cornice: true,
      bench: true,
      runner: true,
      chandeliers: 3,
      lanterns: 0,
      mirrors: false,
      windows: false,
      glazing: false,
    },
    door: { shape: 'arch', color: '#c9a227' },
  },

  // 乌菲齐长廊：又窄又长，湿壁画拱顶，石地，两边一路挂过去
  uffizi: {
    id: 'uffizi',
    metrics: { width: 4.2, height: 3.4, minLen: 16, lenPerPair: 2.4 },
    ceiling: { kind: 'vault', rise: 0.36, ribs: true, paint: true },
    surfaces: { wall: 'plaster', floor: 'terrazzo' },
    colors: {
      wall: '#efe6d2',
      floor: '#cfc6b4',
      ceiling: '#f2e8cf',
      trim: '#b79a5e',
      accent: '#8c6f3c',
      metal: '#c9b183',
      frame: '#8a6a34',
      mat: '#f6f1e3',
    },
    light: {
      ambient: 0.22,
      hemi: 0.5,
      hemiSky: '#f6efdd',
      hemiGround: '#b09b78',
      area: 8,
      areaColor: '#fff4de',
      bg: '#d8cdb6',
      envTop: '#f8f0dd',
      envBottom: '#a2937a',
      pool: 0.16,
    },
    features: {
      pilasters: true,
      cornice: true,
      bench: true,
      runner: true,
      chandeliers: 0,
      lanterns: 0,
      mirrors: false,
      windows: true,
      glazing: false,
    },
    door: { shape: 'arch', color: '#cfc0a0' },
  },

  // 西斯廷礼拜堂：高厅筒拱、一圈半月窗、大理石嵌花地，画挂得低、墙留得高
  sistine: {
    id: 'sistine',
    metrics: { width: 5.2, height: 5.6, minLen: 11, lenPerPair: 3.4 },
    ceiling: { kind: 'vault', rise: 0.42, ribs: true, lunettes: true, paint: true },
    surfaces: { wall: 'marble', floor: 'marble' },
    colors: {
      wall: '#e3dcc8',
      floor: '#cdbf9f',
      ceiling: '#f4ecd4',
      trim: '#b9a15f',
      accent: '#8d6f34',
      metal: '#c8b478',
      frame: '#7d5f2a',
      mat: '#f7f1df',
    },
    light: {
      ambient: 0.2,
      hemi: 0.46,
      hemiSky: '#f5ecd6',
      hemiGround: '#b09a6f',
      area: 9,
      areaColor: '#fff6e2',
      bg: '#cfc4a6',
      envTop: '#faf2df',
      envBottom: '#9d8c68',
      pool: 0.22,
    },
    features: {
      pilasters: true,
      cornice: true,
      bench: true,
      runner: false,
      chandeliers: 0,
      lanterns: 0,
      mirrors: false,
      windows: true,
      glazing: false,
    },
    door: { shape: 'arch', color: '#cfc3a4' },
  },

  // 现代白盒子：平顶轨道灯、纯白墙、水泥地，一件装饰都不要
  whitecube: {
    id: 'whitecube',
    metrics: { width: 6.0, height: 3.6, minLen: 8, lenPerPair: 3.0 },
    ceiling: { kind: 'flat', tracks: 2 },
    surfaces: { wall: 'plaster', floor: 'concrete' },
    colors: {
      wall: '#f4f4f2',
      floor: '#d6d6d4',
      ceiling: '#fbfbfa',
      trim: '#e8e8e6',
      accent: '#2c2f33',
      metal: '#8b8f94',
      frame: '#f7f7f5',
      mat: '#ffffff',
    },
    light: {
      ambient: 0.42,
      hemi: 0.7,
      hemiSky: '#ffffff',
      hemiGround: '#dcdcda',
      area: 6,
      areaColor: '#ffffff',
      bg: '#e2e2e0',
      envTop: '#ffffff',
      envBottom: '#d4d4d2',
      pool: 0,
    },
    features: {
      pilasters: false,
      cornice: false,
      bench: true,
      runner: false,
      chandeliers: 0,
      lanterns: 0,
      mirrors: false,
      windows: false,
      glazing: false,
    },
    door: { shape: 'square', color: '#e6e6e4' },
  },

  // 凡尔赛镜厅：一侧拱窗、一侧镜面，金饰、枝形灯、人字拼花
  versailles: {
    id: 'versailles',
    metrics: { width: 5.6, height: 4.2, minLen: 13, lenPerPair: 3.0 },
    ceiling: { kind: 'vault', rise: 0.38, ribs: true, paint: true },
    surfaces: { wall: 'marble', floor: 'parquet' },
    colors: {
      wall: '#e8dcc0',
      floor: '#c09a5f',
      ceiling: '#f6ecd2',
      trim: '#d3b25c',
      accent: '#e0c471',
      metal: '#d8bb6a',
      frame: '#c39b3f',
      mat: '#f8f1de',
    },
    light: {
      ambient: 0.26,
      hemi: 0.5,
      hemiSky: '#fdf3dc',
      hemiGround: '#b28c52',
      area: 8,
      areaColor: '#fff3d6',
      bg: '#c9b58c',
      envTop: '#fdf5e2',
      envBottom: '#8d7442',
      pool: 0.18,
    },
    features: {
      pilasters: true,
      cornice: true,
      bench: true,
      runner: true,
      chandeliers: 4,
      lanterns: 0,
      mirrors: true,
      windows: true,
      glazing: false,
    },
    door: { shape: 'arch', color: '#d3b25c' },
  },

  // 新国家美术馆：黑色钢网格顶 + 发光板，通高玻璃，灰色花岗岩地
  neue: {
    id: 'neue',
    metrics: { width: 7.0, height: 4.6, minLen: 10, lenPerPair: 3.0 },
    ceiling: { kind: 'grid', panels: 3 },
    surfaces: { wall: 'plaster', floor: 'granite' },
    colors: {
      wall: '#e9e9e7',
      floor: '#a8a6a1',
      ceiling: '#3a3d40',
      trim: '#24272a',
      accent: '#1b1d20',
      metal: '#5d6165',
      frame: '#202326',
      mat: '#f2f3f4',
    },
    light: {
      ambient: 0.38,
      hemi: 0.72,
      hemiSky: '#e9f1fb',
      hemiGround: '#b9b7b2',
      area: 9,
      areaColor: '#f2f6ff',
      bg: '#c8ccd2',
      envTop: '#eaf2fd',
      envBottom: '#b0aea9',
      pool: 0.1,
    },
    features: {
      pilasters: false,
      cornice: true,
      bench: true,
      runner: false,
      chandeliers: 0,
      lanterns: 0,
      mirrors: false,
      windows: false,
      glazing: true,
    },
    door: { shape: 'square', color: '#2b2e31' },
  },

  // 东方木构厅堂：木格栅天花糊纸、朱漆柱、月洞门、席面、宫灯
  shoin: {
    id: 'shoin',
    metrics: { width: 5.2, height: 2.9, minLen: 8, lenPerPair: 2.8 },
    ceiling: { kind: 'lattice', lattice: 5 },
    surfaces: { wall: 'plaster', floor: 'tatami' },
    colors: {
      wall: '#ece3d2',
      floor: '#c9b98a',
      ceiling: '#6a4a2c',
      trim: '#7d3b2a',
      accent: '#9c3a26',
      metal: '#8a6a3a',
      frame: '#7d3b2a',
      mat: '#f6efdd',
    },
    light: {
      ambient: 0.3,
      hemi: 0.56,
      hemiSky: '#fff0d6',
      hemiGround: '#9c8a63',
      area: 7,
      areaColor: '#ffe6bc',
      bg: '#c3ae8c',
      envTop: '#fff2dc',
      envBottom: '#8a7450',
      pool: 0.14,
    },
    features: {
      pilasters: false,
      cornice: true,
      bench: true,
      runner: true,
      chandeliers: 0,
      lanterns: 3,
      mirrors: false,
      windows: true,
      glazing: false,
    },
    door: { shape: 'moon', color: '#8d3f2a' },
  },

  // 古根海姆中庭：椭圆穹顶 + 天眼，沿墙一圈盘旋的坡道
  guggenheim: {
    id: 'guggenheim',
    metrics: { width: 7.2, height: 3.4, minLen: 10, lenPerPair: 3.2 },
    ceiling: { kind: 'dome', dome: { oculus: 1.6, ribs: 24, ramp: true } },
    surfaces: { wall: 'plaster', floor: 'terrazzo' },
    colors: {
      wall: '#f2f1ee',
      floor: '#c9c6bf',
      ceiling: '#fbfbfa',
      trim: '#e4e3df',
      accent: '#3c3f42',
      metal: '#9aa0a4',
      frame: '#f7f7f5',
      mat: '#ffffff',
    },
    light: {
      ambient: 0.4,
      hemi: 0.74,
      hemiSky: '#ffffff',
      hemiGround: '#d6d4cf',
      area: 9,
      areaColor: '#ffffff',
      bg: '#dedcd8',
      envTop: '#ffffff',
      envBottom: '#c9c7c2',
      pool: 0.2,
    },
    features: {
      pilasters: false,
      cornice: false,
      bench: true,
      runner: false,
      chandeliers: 0,
      lanterns: 0,
      mirrors: false,
      windows: false,
      glazing: false,
    },
    door: { shape: 'square', color: '#e8e7e4' },
  },
};

/** 取形制；id 不认识就退回金贝尔（数据里手滑写错也不至于白屏） */
export function hallStyle(id: string): HallStyle {
  return HALL_STYLES[isHallStyleId(id) ? id : 'kimbell'];
}

/**
 * 不指定形制时按顺序轮流分配：同一层里挨着的两间不会撞成同一形制。
 * index 取房间在平面上的序号即可。
 */
export function styleByRotation(index: number): HallStyleId {
  return HALL_STYLE_IDS[((index % HALL_STYLE_IDS.length) + HALL_STYLE_IDS.length) % HALL_STYLE_IDS.length];
}

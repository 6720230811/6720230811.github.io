/**
 * 夜行折廊 —— 建筑蓝图（纯数据，不 import three）。
 *
 *  这栋楼只有一条主长廊：中心线是 CORRIDOR_PATH 那 14 个点，净宽 4 m，
 *  从南侧的入口 [4,0] 一路折到南侧的出口 [34,0]，全长 112 m。沿途的房间
 *  都是从长廊身上「长」出来的：
 *
 *  - 序厅 / 中央大厅 / 总览区：长廊从房间中间穿过（corridorThrough），
 *    房间范围内的长廊墙被拆掉，由房间自己的墙接管 —— 于是这些房间是长廊
 *    自然放宽出来的节点，不是另开的一间方屋。
 *  - 潮汐之间 / 临展厅 / 沉浸展厅 / 大型作品厅：靠支廊或共用墙上的门洞接
 *    在长廊上，可以独立开关，关了也不影响长廊通行。
 *
 *  改建筑只改这个文件。墙怎么从这些数字长出来，见 walls.ts。
 *
 *  坐标：X 东西向右为正，Z 南北向上为正（+Z = 北），Y 高度，单位米。
 */
import type { Locale } from '../../i18n/ui';

export interface Vec2 {
  x: number;
  z: number;
}

/** 轴对齐矩形 */
export interface Rect {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * 建筑占地。规格写 Z 0–28，两处调整：
 *  - Z 到 30：临展厅要放到长廊 z=23 那一段的北侧（见 ROOMS 注释）
 *  - Z 从 -1.2 起：入口与出口外侧各挑出 1.2 m 的门廊，免得走出门就是虚空
 */
export const BUILDING: Rect = { x1: 0, z1: -1.2, x2: 38, z2: 30 };

/** 人眼高度（米） */
export const EYE_HEIGHT = 1.65;
/** 出生点：序厅里，朝正北（+Z）。three 相机看 -Z，所以 yaw = π */
export const SPAWN = { x: 4, z: 1.5, yaw: Math.PI };

/** 人身半径：离墙这么近就走不过去了（碰撞盒按它膨胀） */
export const BODY_R = 0.35;

/**
 * 主长廊中心线（规格给定，一个点都不要动）。
 * 入口 [4,0]（南）→ 出口 [34,0]（南），单向叙事，也允许原路返回。
 */
export const CORRIDOR_PATH: Vec2[] = [
  { x: 4, z: 0 },
  { x: 4, z: 5 },
  { x: 14, z: 5 },
  { x: 14, z: 10 },
  { x: 5, z: 10 },
  { x: 5, z: 16 },
  { x: 17, z: 16 },
  { x: 17, z: 23 },
  { x: 34, z: 23 },
  { x: 34, z: 16 },
  { x: 25, z: 16 },
  { x: 25, z: 8 },
  { x: 34, z: 8 },
  { x: 34, z: 0 },
];

export const CORRIDOR = {
  /** 标准净宽 */
  width: 4,
  /** 墙体厚 */
  wallT: 0.2,
  /** 标准墙高 / 净高 */
  height: 3.6,
  /** 转角内侧倒角：相机贴墙时不生硬 */
  chamfer: 0.05,
  /** 入口与出口的开口宽度 */
  mouth: 3,
  /** 节点处局部放宽到这么宽（放宽段用房间表达） */
  wide: 5.5,
} as const;

/** 门洞：普通 2.8 / 重要 3.2 / 拱券 3.0；高度 3.0 普通 / 3.4 重点 */
export const DOOR = {
  width: 2.8,
  widthMajor: 3.2,
  widthArch: 3,
  height: 3,
  heightMajor: 3.4,
  /** 门套深度 */
  depth: 0.22,
  /** 浅拱券起拱高度 */
  archSpring: 2.35,
} as const;

export type ZoneId =
  | 'entry'
  | 'night'
  | 'city'
  | 'nature'
  | 'light'
  | 'slow'
  | 'final'
  | 'atrium'
  | 'tide'
  | 'temp'
  | 'immersion'
  | 'large'
  | 'overview';

export interface Zone {
  id: ZoneId;
  /** 章节编号（只有长廊段有） */
  chapter?: number;
  label: Record<Locale, string>;
  /** 净高（米） */
  ceiling: number;
  /** 基础墙色（禁用纯白） */
  wall: string;
  /** 主题墙色；null = 全用基础色 */
  accent: string | null;
  /** 主题墙占本区墙面的比例 0.2–0.3 */
  accentRatio: number;
  /**
   * 墙面竖向阴影缝（内凹的细缝，不是画上去的线）。
   *  给了 spacing 就沿墙按不规则间距排；不给就只画在主题墙两端
   *  （自然长廊：蓝绿主题墙与中性墙之间那道 12 mm 缝）。
   *  side 用来只做单侧墙 —— 规格要求夜行长廊只做右墙，不做对称装饰。
   */
  reveal?: {
    color: string;
    width: number;
    spacing?: [number, number];
    side?: 'left' | 'right';
  };
  /**
   * 天花光槽：宽度与色温随章节变（规格 0.18–0.24 m / 3000–3800 K）。
   *  color 直接给发光面颜色（光影长廊要暖琥珀白），intensity 调亮度
   *  （终章要暗一档），stagger 是城市长廊那种「两段错位」的线性光槽。
   */
  slot?: {
    width: number;
    kelvin: number;
    color?: string;
    intensity?: number;
    stagger?: boolean;
  };
  /** 可移动展墙的正 / 反 / 主题三色（临展厅） */
  screen?: { front: string; back: string; theme: string };
  /**
   * 墙脚 / 墙顶的内凹阴影缝（米）。
   *  规格不要凸出的粗踢脚线：墙脚一律 50 mm 内凹暗缝；
   *  只有深色天花那一圈再留 30 mm 顶缝（让天花显得悬浮）。
   *  沉浸展厅例外：不设踢脚，墙地交接 20 mm。
   */
  trim?: { base?: number; top?: number };
  ceilingColor: string;
  floorColor: string;
  /** 地面大模块尺寸（米） */
  floorModule: [number, number];
  kind: 'corridor' | 'room';
  /** 长廊章节在折线上的弧长区间（米），房间没有 */
  span?: [number, number];
}

/**
 * 分区表。
 *  长廊六段的 span 按折线弧长切：
 *    0–20 夜行 / 20–35 城市 / 35–54 自然 / 54–78 光影 / 78–95 慢门 / 95–112 终章
 *  （112 m = 各段长度之和）
 */
export const ZONES: Zone[] = [
  {
    id: 'entry',
    label: { zh: '入口序厅', en: 'Entrance' },
    ceiling: 3.4,
    wall: '#E8E4DC',
    accent: null,
    accentRatio: 0,
    ceilingColor: '#F1EEE7',
    floorColor: '#57534D',
    floorModule: [1.2, 1.2],
    kind: 'room',
  },
  {
    id: 'night',
    chapter: 1,
    label: { zh: '夜行长廊', en: 'Night Walk' },
    ceiling: 3.6,
    wall: '#E8E4DC',
    accent: '#542B33',
    accentRatio: 0.28,
    // 右墙：20 mm 暗石墨竖向缝，3–5 m 一道（间距不规则，不做对称装饰）
    reveal: { color: '#232726', width: 0.02, spacing: [3, 5], side: 'right' },
    // 3000 K，天花边缘还有极弱的暗藏暖光
    slot: { width: 0.2, kelvin: 3000 },
    // 3000 K 那档的顶色
    ceilingColor: '#D8D0C5',
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'corridor',
    span: [0, 20],
  },
  {
    id: 'city',
    chapter: 2,
    label: { zh: '城市长廊', en: 'City Corridor' },
    ceiling: 3.6,
    wall: '#E8E4DC',
    accent: '#B8AEA1',
    accentRatio: 0.26,
    // 8–10 m 一道 8 mm 青铜竖向分缝
    reveal: { color: '#896A47', width: 0.008, spacing: [8, 10] },
    // 两段错位线性光槽，3200 K，城市道路那种节奏（不要霓虹）
    slot: { width: 0.22, kelvin: 3200, stagger: true },
    ceilingColor: '#DDD8CF',
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'corridor',
    span: [20, 35],
  },
  {
    id: 'nature',
    chapter: 3,
    label: { zh: '自然长廊', en: 'Nature Corridor' },
    ceiling: 3.8,
    wall: '#E8E4DC',
    accent: '#627775',
    accentRatio: 0.26,
    // 只画在蓝绿主题墙两端：主题墙与中性墙之间的 12 mm 内凹缝
    reveal: { color: '#232726', width: 0.012 },
    // 柔和洗墙光，3500 K
    slot: { width: 0.24, kelvin: 3500 },
    ceilingColor: '#D5D9D2',
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'corridor',
    span: [35, 54],
  },
  {
    id: 'light',
    chapter: 4,
    label: { zh: '光影长廊', en: 'Light Corridor' },
    // 规格 3.8–4 m：暗顶，顶面亮度明显低于作品墙
    ceiling: 4,
    wall: '#E8E4DC',
    accent: '#8E8B84',
    accentRatio: 0.24,
    // 局部 8 mm 青铜收边（近处才看得见，禁止大面积金色）
    reveal: { color: '#896A47', width: 0.008, spacing: [7, 9] },
    // 暗顶 + 局部发光带，暖琥珀白
    slot: { width: 0.18, kelvin: 2900, color: '#F5D4A2' },
    // 暗顶
    ceilingColor: '#403A37',
    trim: { top: 0.03 },
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'corridor',
    span: [54, 78],
  },
  {
    id: 'slow',
    chapter: 5,
    label: { zh: '慢门长廊', en: 'Slow Shutter' },
    ceiling: 3.6,
    wall: '#E8E4DC',
    accent: '#5A5348',
    accentRatio: 0.24,
    // 较窄的中性光槽，3600–3800 K
    slot: { width: 0.18, kelvin: 3700 },
    // 暗顶：光槽亮度由入口向沉浸展厅逐渐降低
    ceilingColor: '#283338',
    trim: { top: 0.03 },
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'corridor',
    span: [78, 95],
  },
  {
    id: 'final',
    chapter: 6,
    label: { zh: '终章长廊', en: 'Final Corridor' },
    ceiling: 3.6,
    wall: '#E8E4DC',
    accent: '#3F4A4E',
    accentRatio: 0.24,
    // 收束：光槽比别处暗一档
    slot: { width: 0.2, kelvin: 3000, intensity: 1.3 },
    // 规格没给终章顶色：比别处压一档，配合收束感
    ceilingColor: '#CFC9BE',
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'corridor',
    span: [95, 112],
  },
  {
    id: 'atrium',
    label: { zh: '中央大厅', en: 'Central Hall' },
    ceiling: 5,
    wall: '#DED7CC',
    accent: '#C9BFAF',
    accentRatio: 0.22,
    // 顶棚周围那两条隐藏轨道灯槽：3900 K
    slot: { width: 0.2, kelvin: 3900 },
    ceilingColor: '#E3DDD2',
    floorColor: '#625E57',
    floorModule: [2, 2],
    kind: 'room',
  },
  {
    id: 'tide',
    label: { zh: '潮汐之间', en: 'Between Tides' },
    ceiling: 4.2,
    wall: '#E8E4DC',
    accent: '#627775',
    accentRatio: 0.22,
    ceilingColor: '#DCE0D9',
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'room',
  },
  {
    id: 'temp',
    label: { zh: '临展厅', en: 'Temporary' },
    ceiling: 4.2,
    wall: '#E5E1D9',
    accent: '#CFC7B8',
    accentRatio: 0.2,
    // 可移动展墙：正面 / 背面 / 本期主题色（主题色只有一种，由展览数据定）
    screen: { front: '#DCD8D0', back: '#B7B0A5', theme: '#30494B' },
    ceilingColor: '#E2DED6',
    floorColor: '#57534D',
    floorModule: [1.2, 2.4],
    kind: 'room',
  },
  {
    id: 'immersion',
    label: { zh: '沉浸展厅', en: 'Immersion' },
    ceiling: 4.5,
    wall: '#202325',
    accent: '#2C3033',
    accentRatio: 0.2,
    ceilingColor: '#0F1213',
    floorColor: '#292C2D',
    floorModule: [2.4, 2.4],
    kind: 'room',
    // 不设踢脚线：墙地交接只留 20 mm 内凹缝；天花也是深色的，顶上同样留缝
    trim: { base: 0.02, top: 0.03 },
  },
  {
    id: 'large',
    label: { zh: '大型作品厅', en: 'Large Works' },
    ceiling: 5.5,
    wall: '#D8D5CE',
    accent: '#B9B4AA',
    accentRatio: 0.2,
    // 两条平行黑色轨道灯槽：作品灯那一档 4000 K
    slot: { width: 0.16, kelvin: 4000 },
    // 墙与深色天花之间那道 30 mm 缝：天花看着像浮着
    trim: { base: 0.05, top: 0.03 },
    ceilingColor: '#2C2E2D',
    floorColor: '#5B574F',
    floorModule: [2, 2],
    kind: 'room',
  },
  {
    id: 'overview',
    label: { zh: '总览区与出口', en: 'Overview & Exit' },
    ceiling: 3.6,
    wall: '#E8E4DC',
    accent: '#8E8B84',
    accentRatio: 0.2,
    // 出口区：整体比终章亮一档
    ceilingColor: '#E6E0D6',
    floorColor: '#57534D',
    floorModule: [1.2, 1.2],
    kind: 'room',
  },
];

const ZONE_MAP = new Map(ZONES.map((zone) => [zone.id, zone]));

/**
 * 展览数据里的 theme → 可移动展墙的主题色。
 *  规格：一面展墙可以换成主题色，但同一时期只能出现一种 ——
 *  所以取本期作品里最多的那个 theme，全馆只用这一个颜色。
 */
export const THEME_COLOR: Record<string, string> = {
  city: '#364852', // 烟熏蓝灰
  sea: '#30494B', // 暮色蓝绿
};

export function zone(id: ZoneId): Zone {
  const found = ZONE_MAP.get(id);
  if (!found) throw new Error(`未知分区：${id}`);
  return found;
}

export type WallKey = 'n' | 'e' | 's' | 'w';

export interface DoorSpec {
  /** 开在这面墙上（n = 矩形北侧 z1，s = 南侧 z2，w = 西侧 x1，e = 东侧 x2） */
  wall: WallKey;
  /** 门洞中心沿这面墙的坐标 */
  at: number;
  width: number;
  height: number;
  /** 浅拱券：起拱 DOOR.archSpring，总高 3.4 */
  arch?: boolean;
}

/** 房间里的东西：凳子、装置占位、可移动展墙、隔墙 */
export type PropSpec =
  | { kind: 'bench'; x: number; z: number; w: number; d: number; ry: number }
  | { kind: 'sculpture'; x: number; z: number; r: number }
  | { kind: 'partition'; x1: number; z1: number; x2: number; z2: number; h: number };

export interface RoomSpec {
  id: ZoneId;
  rect: Rect;
  /** 长廊是否从房间中穿过：是 → 房间范围内的长廊墙拆掉，由房间墙接管 */
  corridorThrough: boolean;
  doors: DoorSpec[];
  props: PropSpec[];
}

/**
 * 房间表。与规格的三处偏差（都在上面说明过）：
 *  - 临展厅 Z 25–30（规格 21–27，那块被长廊 z=23 那一段占着）
 *  - 沉浸展厅 Z 10–14（规格 10–15，北墙要让给慢门长廊的 z=14 墙）
 *  - 大型作品厅 X 17–25 / Z 0.5–6（规格 13–23 / 1–8，被夜行长廊的转角切到）
 */
export const ROOMS: RoomSpec[] = [
  {
    id: 'entry',
    rect: { x1: 2, z1: 0, x2: 10, z2: 7 },
    corridorThrough: true,
    doors: [
      // 南侧入口，3 m 开口
      { wall: 's', at: 4, width: CORRIDOR.mouth, height: 3 },
      // 东侧：长廊继续往东（4 m，等于长廊净宽）
      { wall: 'e', at: 5, width: CORRIDOR.width, height: 3.4 },
    ],
    props: [
      // 3 m 短隔墙：挡住从入口直接看到东侧出口，形成进入仪式感
      { kind: 'partition', x1: 7.5, z1: 0, x2: 7.5, z2: 3, h: 3 },
    ],
  },
  {
    id: 'atrium',
    rect: { x1: 12, z1: 12, x2: 22, z2: 22 },
    corridorThrough: true,
    doors: [
      // 西：长廊从西侧进来（自然长廊 z=16 那一段），浅拱券 3 m
      { wall: 'w', at: 16, width: DOOR.widthArch, height: DOOR.heightMajor, arch: true },
      // 北：长廊在大厅里转向北，从这里出去
      { wall: 'n', at: 17, width: DOOR.widthArch, height: DOOR.heightMajor, arch: true },
      // 南：3 m 支线门洞 → 大型作品厅
      { wall: 's', at: 19, width: 3, height: DOOR.height },
    ],
    props: [
      { kind: 'sculpture', x: 17, z: 17, r: 1.15 },
      { kind: 'bench', x: 14, z: 14.5, w: 1.8, d: 0.45, ry: 0 },
      { kind: 'bench', x: 20, z: 19.5, w: 1.8, d: 0.45, ry: Math.PI / 2 },
    ],
  },
  {
    id: 'tide',
    rect: { x1: 2, z1: 20, x2: 13, z2: 27 },
    corridorThrough: false,
    doors: [{ wall: 's', at: 8, width: 3, height: DOOR.height }],
    props: [{ kind: 'bench', x: 7.5, z: 23.5, w: 1.8, d: 0.45, ry: 0 }],
  },
  {
    id: 'temp',
    rect: { x1: 22, z1: 25, x2: 37, z2: 30 },
    corridorThrough: false,
    doors: [{ wall: 's', at: 28, width: DOOR.widthMajor, height: DOOR.heightMajor }],
    props: [
      // 2–3 面可移动展墙：不挡主入口与主要回游路线
      { kind: 'partition', x1: 25, z1: 27.5, x2: 29, z2: 27.5, h: 3.2 },
      { kind: 'partition', x1: 31, z1: 26.5, x2: 35, z2: 26.5, h: 3.2 },
    ],
  },
  {
    id: 'immersion',
    rect: { x1: 28, z1: 10, x2: 37, z2: 14 },
    corridorThrough: false,
    doors: [{ wall: 'n', at: 30, width: DOOR.widthMajor, height: DOOR.height }],
    props: [
      // 偏心隔墙：进门看不完全部内容，门内 2.5 m 是低照度过渡空间
      { kind: 'partition', x1: 28.5, z1: 11.5, x2: 33.5, z2: 11.5, h: 3.6 },
    ],
  },
  {
    id: 'large',
    rect: { x1: 17, z1: 0.5, x2: 25, z2: 6 },
    corridorThrough: false,
    doors: [
      // 北：中央大厅南支线
      { wall: 'n', at: 19, width: 3, height: DOOR.heightMajor },
      // 东：→ 总览区
      { wall: 'e', at: 4.5, width: 3, height: DOOR.height },
    ],
    props: [{ kind: 'sculpture', x: 21, z: 3.2, r: 2 }],
  },
  {
    id: 'overview',
    rect: { x1: 30, z1: 0, x2: 38, z2: 6 },
    corridorThrough: true,
    doors: [
      // 西：大型作品厅过来的支线
      { wall: 'w', at: 4.5, width: 3, height: DOOR.height },
      // 南：出口
      { wall: 's', at: 34, width: CORRIDOR.mouth, height: DOOR.height },
      // 北：长廊（终章）从这里进来
      { wall: 'n', at: 34, width: CORRIDOR.width, height: DOOR.heightMajor },
    ],
    props: [],
  },
];

/** 支廊：规格只给了位置，坐标在这里定死 */
export interface BranchSpec {
  id: string;
  /** 中心线两端（轴对齐） */
  from: Vec2;
  to: Vec2;
  width: number;
  /** 归属分区（决定墙色与净高） */
  zone: ZoneId;
}

export const BRANCHES: BranchSpec[] = [
  // 自然长廊（北墙 z=18）→ 潮汐之间南门（z=20）
  { id: 'branch-tide', from: { x: 8, z: 18 }, to: { x: 8, z: 20 }, width: 3, zone: 'tide' },
  // 中央大厅南门（z=12）→ 大型作品厅北门（z=6）
  { id: 'branch-atrium-large', from: { x: 19, z: 12 }, to: { x: 19, z: 6 }, width: 3, zone: 'large' },
  // 大型作品厅东门（x=25）→ 总览区西门（x=30）
  { id: 'branch-large-overview', from: { x: 25, z: 4.5 }, to: { x: 30, z: 4.5 }, width: 3, zone: 'overview' },
];

/**
 * 长廊墙上要额外开的口子（房间门洞已经在 ROOMS 里，这里是「支廊接到长廊」
 * 的那几处 —— 长廊墙不是房间的，只能在这儿点名）。
 */
export const CORRIDOR_CUTS: Rect[] = [
  // 自然长廊北墙（z=18）给「潮汐之间」支廊开的 3 m 口子
  { x1: 6.5, z1: 17.6, x2: 9.5, z2: 18.4 },
  // 光影长廊北墙（z=25）给临展厅的 3.2 m 门洞
  { x1: 26.4, z1: 24.6, x2: 29.6, z2: 25.4 },
  // 慢门长廊南墙（z=14）给沉浸展厅的 3.2 m 门洞
  { x1: 28.4, z1: 13.6, x2: 31.6, z2: 14.4 },
];

/** 门廊：入口与出口各挑出 1.2 m，三面墙（朝北是敞口，接房间门洞） */
export const PORCHES: Rect[] = [
  { x1: 2.5, z1: -1.2, x2: 5.5, z2: 0 },
  { x1: 32.5, z1: -1.2, x2: 35.5, z2: 0 },
];

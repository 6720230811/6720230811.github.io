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
   * 长廊左右两面的墙色（按前进方向分左右）。
   *  城市长廊：左墙暖混凝土灰 + 微水泥，右墙暖矿物灰泥且比左墙亮，
   *  作品数量也左多右少 —— 规格要的就是这种不对称的节奏。
   */
  sideWalls?: { left?: string; right?: string };
  /** 端景墙（转角正对那面）顶部藏一道洗墙灯槽 */
  wash?: boolean;
  /** 天花烘一层极轻微的静态波纹明暗（潮汐之间） */
  ceilingRipple?: boolean;
  /**
   * 天花整体发光：大面积漫射柔光（潮汐之间的「水面」）。
   *  只是 emissive + 一点点很弱的补光，不是真实光源 —— 亮面在顶上，
   *  厅里那点漫射靠补光给，没有投影。
   */
  glow?: { color: string; intensity: number; fill?: number };
  /**
   * 这个分区的环境光乘数：1 = 全馆默认。
   *  序厅压到 0.3 —— 进门先暗，往里走（城市长廊 / 中央大厅）才放开，
   *  「先暗再亮」是进门那一下的节奏。
   */
  ambient?: number;
  /**
   * 天花上规则但简洁的轨道灯（临展厅）：rows 条平行轨，灯具每 spacing 米一个。
   *  规格：轨道与灯具颜色 #363938。
   */
  tracks?: { rows: number; spacing: number };
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
    // 凹龛里那两条竖向暗缝灯：3000 K，只洗龛的内壁，不照画
    slot: { width: 0.18, kelvin: 3000 },
    // 环境光压到 0.3：进门先暗，往里走（城市长廊 / 中央大厅）才放开 ——
    //  实测整屏平均亮度 序厅 80 / 夜行长廊 93 / 城市长廊 137
    ambient: 0.3,
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
    // 端景墙：烟熏蓝灰（规格：给有灯光、建筑、夜景元素的那件主作品当背景）
    accent: '#364852',
    accentRatio: 0.26,
    // 左墙暖混凝土灰（微水泥）、右墙暖矿物灰泥且比左墙亮
    sideWalls: { left: '#AEA69B', right: '#DFD8CB' },
    // 端景墙顶部藏一道洗墙灯槽
    wash: true,
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
    // 端景墙：隐藏式顶光（规格还有两盏窄角射灯，那是作品灯的活儿）
    wash: true,
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
    // 外圈 4.2：中心那 4 × 4 m 由跌级升到 5.0（walls 的高度跟着这个数走）
    ceiling: 4.2,
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
    // 大面积漫射柔光 + 极轻微的静态波纹明暗（不许动态水纹投影）
    ceilingRipple: true,
    ceilingColor: '#DCE0D9',
    // 顶棚自己发一层冷白的光（偏青，像水面的天光），波纹照样调制它
    glow: { color: '#CFE4DC', intensity: 0.55, fill: 4.5 },
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
    // 规则但简洁的轨道灯：3 条平行轨，灯具每 2.6 m 一个（轨道与灯具 #363938）
    tracks: { rows: 3, spacing: 2.6 },
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
    // 不再额外挑 accent：北面那道重点墙由房间的 wallColors 给，
    // 免得 accent 机制把重点墙盖掉
    accent: null,
    accentRatio: 0,
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
  /** tint：隔断自己的颜色（不写就跟房间墙一个色） */
  /** t：隔断的厚度（给了就画成一块有厚度的实墙，不再是一张纸） */
  | {
      kind: 'partition';
      x1: number;
      z1: number;
      x2: number;
      z2: number;
      h: number;
      tint?: string;
      t?: number;
    };

/**
 * 墙上的凹龛：沿这面墙 at 处挖一个 width 宽的洞口，退进去 depth，
 *  洞口高 top（top 到天花那截是龛楣）。主视觉就嵌在龛的后壁上。
 */
export interface NicheSpec {
  wall: WallKey;
  /** 洞口中心（沿墙坐标） */
  at: number;
  width: number;
  depth: number;
  /** 洞口顶高（米），上面是龛楣 */
  top: number;
  /** 洞口底高（米），下面是龛台；不写就是落地 */
  bottom?: number;
}

/**
 * 折板天花：沿一个方向切成若干条，每条一个高度（潮汐之间那道「水面」）。
 *  折与折之间会自动补一道竖向的收口面。
 */
export interface FoldSpec {
  along: 'x' | 'z';
  /** 切点（沿 along 方向的坐标，升序） */
  at: number[];
  /** 每条的高度（比 at 多一个） */
  heights: number[];
}

/** 地面上换一块别的颜色（序厅入口的门垫、城市长廊端景前的停顿区） */
export interface FloorPatch {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: string;
  /** 铺装模块按这个分区走（长廊里的换色块没有房间可以挂） */
  zone?: ZoneId;
}

/** 藻井：房间天花中央这一块沉下去，四周留一圈灯槽 */
export interface CofferSpec {
  /** 井口（天花上开的洞） */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** 下沉高度：天花 3.4、drop 0.35 → 井底 3.05 */
  drop: number;
  /** 四周灯槽宽（米） */
  slot: number;
}

export interface RoomSpec {
  id: ZoneId;
  rect: Rect;
  /** 长廊是否从房间中穿过：是 → 房间范围内的长廊墙拆掉，由房间墙接管 */
  corridorThrough: boolean;
  doors: DoorSpec[];
  props: PropSpec[];
  /**
   * 四面墙各自的墙色（序厅与大型作品厅用：这几间的四面性格完全不同）。
   *  不给就统一用分区的 wall 色。
   */
  wallColors?: Partial<Record<WallKey, string>>;
  /**
   * 主视觉（hero）钉在哪一面墙上。
   *  不写就按 hang.ts 的老规矩：长廊挑尽端墙、房间挑最长那面。
   *  房间有一面明确的重点墙时写它 —— 最长那面不一定是该挂主视觉的那面。
   */
  heroWall?: WallKey;
  /**
   * 某面墙做成微弧：给矢高（弦就是这面墙的全长）。
   *  正值朝房间外鼓（室内变宽），负值朝里凹。
   */
  arc?: Partial<Record<WallKey, number>>;
  /** 墙上的凹龛 */
  niches?: NicheSpec[];
  /**
   * 天花的藻井：一层套一层（外 → 内），每层一圈灯槽。
   *  drop 为正是往下沉（序厅的藻井），为负是往上升（中央大厅的跌级）。
   */
  coffers?: CofferSpec[];
  /**
   * 折墙：把某面墙等分几段、每段给一个偏移，拼成锯齿墙。
   *  首尾必须是 0（要接得上转角），而且这面墙上不能有门洞。
   */
  fold?: Partial<Record<WallKey, number[]>>;
  /** 切角：四个直角各切掉这么长（方盒子 → 八边形） */
  chamfer?: number;
  /** 天花的折板（与藻井二选一：藻井是「中间一块沉下去」，折板是「整片折几折」） */
  folds?: FoldSpec;
  /** 地面上换色的几块（门垫之类） */
  patches?: FloorPatch[];
}

/**
 * 房间表。与规格的三处偏差（都在上面说明过）：
 *  - 临展厅 Z 25–30（规格 21–27，那块被长廊 z=23 那一段占着）
 *  - 沉浸展厅 Z 10–14（规格 10–15，北墙要让给慢门长廊的 z=14 墙）
 *  - 大型作品厅 X 17–27 / Z 0.5–6（规格 13–23 / 1–8，被夜行长廊的转角切到）
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
      // 3 m 短隔墙：挡住从入口直接看到东侧出口，形成进入仪式感。
      //  0.3 m 厚（是块实墙不是一张纸），南端伸到 z=-0.3 去接微弧后的南墙
      {
        kind: 'partition',
        x1: 7.5,
        z1: -0.3,
        x2: 7.5,
        z2: 3,
        h: 3.1,
        tint: '#D7D0C4',
        t: 0.3,
      },
      // 长凳：放在进门右手那块安静的角落（长廊从房间北边穿过去，西墙前是走的道），
      //  坐下来正对北墙凹龛里的主视觉
      { kind: 'bench', x: 8.2, z: 1.5, w: 2.4, d: 0.42, ry: 0 },
    ],
    // 入口 1.8 m 的门垫：地面深一档，进门那一步踩在另一块材料上
    patches: [{ x1: 2.4, z1: 0, x2: 5.6, z2: 1.8, color: '#4A4741' }],
    // 序厅四面：南（入口）深石墨、北（主视觉）深酒红、西（策展文字）浅米、东（平面图）青灰
    wallColors: { s: '#232726', n: '#4A202A', w: '#C7BFB3', e: '#3D4443' },
    // 主视觉在北墙（深酒红），嵌进凹龛里
    heroWall: 'n',
    // 南墙（入口那面）朝外微鼓 0.35 m：弦 8 m，R≈23 —— 进门时墙往两侧退开
    arc: { s: 0.35 },
    // 北墙凹龛：3.4 宽、退 0.4 m，主视觉嵌进去；上面留 0.6 m 龛楣
    niches: [{ wall: 'n', at: 7.3, width: 3.4, depth: 0.4, top: 2.8 }],
    // 天花：中央 4.4 × 5.0 沉 0.35 m，四周 180 mm 灯槽 —— 压暗的厅里唯一的光
    coffers: [{ x1: 3.8, z1: 1.2, x2: 8.2, z2: 6.2, drop: 0.35, slot: 0.18 }],
  },
  {
    id: 'atrium',
    rect: { x1: 12, z1: 12, x2: 22, z2: 22 },
    corridorThrough: true,
    // 四角各切 2.6 m：方盒子切成八边形（四个直角变成四道 45° 斜墙）
    chamfer: 2.6,
    // 三级跌级天花：外圈 4.2 → 中环 4.6 → 中心 5.0（负 drop = 往上升）
    coffers: [
      { x1: 13.8, z1: 13.8, x2: 20.2, z2: 20.2, drop: -0.4, slot: 0.2 },
      { x1: 15, z1: 15, x2: 19, z2: 19, drop: -0.8, slot: 0.2 },
    ],
    doors: [
      // 西：长廊从西侧进来（自然长廊 z=16 那一段），浅拱券 3 m
      { wall: 'w', at: 16, width: DOOR.widthArch, height: DOOR.heightMajor, arch: true },
      // 北：长廊在大厅里转向北，从这里出去
      { wall: 'n', at: 17, width: DOOR.widthArch, height: DOOR.heightMajor, arch: true },
      // 南：3 m 支线门洞 → 大型作品厅（支廊中心线 x=18.5，与北门 x=17 错开）
      { wall: 's', at: 18.5, width: 3, height: DOOR.height },
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
    // 东墙整面改成大弧：弦 7 m、矢高 1.2（R≈5.7），房间像个被水冲弯的洞
    arc: { e: 1.2 },
    // 发光顶折三折：4.2 / 3.95 / 4.2 —— 顶是「水面」，不是一块发光的平板
    folds: { along: 'x', at: [5.6, 9.2], heights: [4.2, 3.95, 4.2] },
    props: [{ kind: 'bench', x: 7.5, z: 23.5, w: 1.8, d: 0.45, ry: 0 }],
  },
  {
    id: 'temp',
    rect: { x1: 22, z1: 25, x2: 37, z2: 30 },
    corridorThrough: false,
    doors: [{ wall: 's', at: 28, width: DOOR.widthMajor, height: DOOR.heightMajor }],
    props: [
      // 可移动展墙：统一偏 12°（不正交排），动线自然变成「之」字。
      //  12° 的正切 ≈ 0.213：4 m 长的墙两端差 0.85 m
      { kind: 'partition', x1: 25, z1: 26.1, x2: 29, z2: 26.94, h: 3.2 },
      { kind: 'partition', x1: 31, z1: 27.44, x2: 35, z2: 26.6, h: 3.2 },
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
    rect: { x1: 17, z1: 0.5, x2: 27, z2: 6 },
    corridorThrough: false,
    doors: [
      // 北：中央大厅南支线。门洞贴着西北角开（x 17–20），把整面北墙让给
      //  重点墙 —— 规格要「北面 ≥7 m 的烟熏陶土墙」，墙只有 10 m 宽，
      //  门洞只能靠一头放，剩下的 20–27 才是连续的一整片
      { wall: 'n', at: 18.5, width: 3, height: DOOR.heightMajor },
      // 东：→ 总览区
      { wall: 'e', at: 4.5, width: 3, height: DOOR.height },
    ],
    // 南墙做成锯齿：中间凸 0.6、两侧各凹 0.3 —— 同一面墙上三张画各有各的朝向，
    //  视线不打架（北墙那 7 m 烟熏土留给主视觉，不动）
    fold: { s: [0, -0.3, 0.6, -0.3, 0] },
    // 装置占位往西偏、收小一点：主视觉在北墙 x 22–25，占位的体块要是杵在
    //  房间正中（x 20.8–23.2），从厅里看主视觉的左边一截就被它挡了
    props: [{ kind: 'sculpture', x: 20.5, z: 3.2, r: 1.5 }],
    // 四面各一色：北面是低饱和烟熏陶土的重点墙（20–27 那 7 m，给大型作品
    //  当背景），东西两面挂大型横幅，南面放创作过程、文字与小型作品
    wallColors: { n: '#765448', e: '#D2CCC1', w: '#D2CCC1', s: '#B6AEA3' },
    // 主视觉挂在那面 7 m 烟熏陶土上（南墙更长，但它是「创作过程 / 文字」那一面）
    heroWall: 'n',
  },
  {
    id: 'overview',
    rect: { x1: 30, z1: 0, x2: 38, z2: 6 },
    corridorThrough: true,
    // 出口做成漏斗：最后 2.4 m 两侧各内收，洞口从 5 m 收到 3 m（门洞宽），
    //  上面再压一块 2.8 m 的门斗天花 —— 走出去之前先收一下
    props: [
      { kind: 'partition', x1: 31.2, z1: 2.4, x2: 32.5, z2: 0, h: 3.6, t: 0.24 },
      { kind: 'partition', x1: 36.8, z1: 2.4, x2: 35.5, z2: 0, h: 3.6, t: 0.24 },
    ],
    coffers: [{ x1: 31.2, z1: 0, x2: 36.8, z2: 2.4, drop: 0.8, slot: 0.04 }],
    doors: [
      // 西：大型作品厅过来的支线
      { wall: 'w', at: 4.5, width: 3, height: DOOR.height },
      // 南：出口
      { wall: 's', at: 34, width: CORRIDOR.mouth, height: DOOR.height },
      // 北：长廊（终章）从这里进来
      { wall: 'n', at: 34, width: CORRIDOR.width, height: DOOR.heightMajor },
    ],
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
  { id: 'branch-atrium-large', from: { x: 18.5, z: 12 }, to: { x: 18.5, z: 6 }, width: 3, zone: 'large' },
  // 大型作品厅东门（x=27）→ 总览区西门（x=30）
  { id: 'branch-large-overview', from: { x: 27, z: 4.5 }, to: { x: 30, z: 4.5 }, width: 3, zone: 'overview' },
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

/**
 * 长廊墙上的壁龛：按中心线的弧长定位到某一侧的墙上。
 *  长廊不像房间有四面墙可以挂数据，只能按「走到第几米、左边还是右边」说。
 */
export interface CorridorNicheSpec {
  /** 壁龛中心落在长廊墙上的位置（世界坐标，取最近的那段墙） */
  at: { x: number; z: number };
  /** 沿行进方向的左手墙 / 右手墙 */
  side: 'left' | 'right';
  width: number;
  depth: number;
  /** 洞口顶高 */
  top: number;
  /** 洞口底高（离地） */
  bottom: number;
  tint?: string;
}

/**
 * 夜行长廊右墙三处壁龛：0.9 宽、0.75 高、退 0.35，龛底 1.35（视线高）。
 *  位置：z=3 那道墙上三处（x 11.4 / 13.1 / 14.8，间距不规则）—— 都躲开了序厅
 *  （序厅把 x 2–10 / z 0–7 范围内的长廊墙裁掉了，开在那一段的龛会跟着被裁掉）。
 *  间距故意不规则：是「被水冲出来的孔」，不是装饰节奏。
 *  龛内衬暗石墨，与那道竖缝同色。
 */
export const CORRIDOR_NICHES: CorridorNicheSpec[] = [
  { at: { x: 11.4, z: 3 }, side: 'left', width: 0.9, depth: 0.35, top: 2.1, bottom: 1.35, tint: '#232726' },
  { at: { x: 13.1, z: 3 }, side: 'left', width: 0.9, depth: 0.35, top: 2.1, bottom: 1.35, tint: '#232726' },
  { at: { x: 14.8, z: 3 }, side: 'left', width: 0.9, depth: 0.35, top: 2.1, bottom: 1.35, tint: '#232726' },
];
/** 长廊地面上换色的几块：城市长廊端景墙前那块 2.4 × 2.4 的停顿区 */
export const CORRIDOR_PATCHES: FloorPatch[] = [
  { x1: 4, z1: 8.8, x2: 6.4, z2: 11.2, color: '#4E4A44', zone: 'city' },
];

/** 门廊：入口与出口各挑出 1.2 m，三面墙（朝北是敞口，接房间门洞） */
export const PORCHES: Rect[] = [
  { x1: 2.5, z1: -1.2, x2: 5.5, z2: 0 },
  { x1: 32.5, z1: -1.2, x2: 35.5, z2: 0 },
];

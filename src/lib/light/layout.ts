/**
 * 金贝尔美术馆 · 建筑数据（16 个摆线筒拱 = 6 + 4 + 6）
 *
 * 坐标：Y 向上，室外地坪 Y = 0，室内地面（平台面）Y = PLATFORM_H；
 * X 东西向（西为 −X），Z 南北向（南为 −Z）。
 *
 * 尺寸全部以米为单位，换算基准 1 ft = 0.3048 m。下面每一条都标了出处，
 * 与数据卡冲突的地方写在注释里（最后会在汇报里统一说明）：
 * - 单拱 30.48（沿 X）× 6.10（沿 Z），拱顶内表面 6.10 ✓ 数据卡第二节
 * - 摆线 x = r(θ−sinθ), y = r(1−cosθ)。一个完整拱跨 2πr，所以
 *   跨度 6.10 → r = 6.10/2π = 0.9705，矢高 2r = 1.941。
 *   数据卡写的「r = 3.05、拱高 2r = 6.1」与「跨度 6.10」不能同时成立
 *   （r = 3.05 的摆线跨 19.16 m）：取摆线公式 + 跨度 6.10，矢高 1.941，
 *   起拱线因此是 6.10 − 1.941 = 4.159 m（数据卡写「墙体高 3.2」——
 *   那个数被用作填充墙高，墙顶到拱面之间留楔形收口缝，正是必须保留的节点）
 * - 拱中心距 30.78（30.48 + 0.3 结构分隔）✓ 数据卡第二节
 */
import { RISE, R } from './cycloid';

export const FT = 0.3048;

// ---------- 单拱 ----------
export const VAULT_LEN = 30.48; // 沿 X（100 ft）
export const VAULT_W = 6.10; // 沿 Z（20 ft）
export const APEX = 6.10; // 拱顶内表面（相对室内地面）
export const SPRING = APEX - RISE; // 起拱线 4.159

// ---------- 天窗缝与肋 ----------
export const SLOT_W = 0.61; // 2 ft
export const RIB_STEP = 3.05; // 10 ft 一道
export const RIB_COUNT = Math.round(VAULT_LEN / RIB_STEP); // 10 道

// ---------- 填充墙（拱与拱之间、沿 X 的非承重墙）----------
export const WALL_H = 3.2;
export const WALL_T = 0.30;
/** 墙顶到拱面之间的楔形收口缝：本建筑可「读」的构造节点，必须保留 */
export const WALL_SLOT = SPRING - WALL_H;

// ---------- 柱 ----------
export const COL = 0.61; // 2 ft 见方
export const COL_INSET = 0.6; // 位于拱四角内侧

// ---------- 平台 / 庭院 ----------
export const PLATFORM_H = 1.2;
export const COURT_SUNKEN = 0.5;

// ---------- 排布 ----------
export const SEP = 0.30; // 同排拱之间的结构分隔
export const PITCH = VAULT_LEN + SEP; // 30.78 拱中心距

export type RowKey = 'south' | 'middle' | 'north';
/** 端墙做法：实体 / 露空（门廊）/ 玻璃（入口门厅） */
export type EndKind = 'wall' | 'open' | 'glass';

export interface VaultSpec {
  id: string;
  row: RowKey;
  /** 排内序号 0..5 */
  index: number;
  /** 拱中心（X 沿拱长，Z 沿拱宽） */
  x: number;
  z: number;
  west: EndKind;
  east: EndKind;
}

/** 三排：前排（南）6 拱、中排 4 拱、后排（北）6 拱 */
const ROW_Z: Record<RowKey, number> = { south: -14.64, middle: -7.32, north: 0 };
/** 中排轴线：入口与树廊都对它 */
export const ROW_MIDDLE_Z = ROW_Z.middle;
/** 中排让出首尾两个拱位：西端是入口庭院，东端对称留白 */
const ROW_SLOTS: Record<RowKey, number[]> = {
  south: [0, 1, 2, 3, 4, 5],
  middle: [1, 2, 3, 4],
  north: [0, 1, 2, 3, 4, 5],
};

export const VAULTS: VaultSpec[] = (['south', 'middle', 'north'] as RowKey[]).flatMap((row) =>
  ROW_SLOTS[row].map((index): VaultSpec => {
    // 西端：南北两排的最西一拱露空成门廊；中排最西一拱是玻璃入口门厅
    // 东端：中排最东一拱同样做玻璃（对称），其余实体
    const west: EndKind =
      row === 'middle' ? (index === 1 ? 'glass' : 'wall') : index === 0 ? 'open' : 'wall';
    const east: EndKind = row === 'middle' && index === 4 ? 'glass' : 'wall';
    return {
      id: `${row}-${index}`,
      row,
      index,
      x: index * PITCH,
      z: ROW_Z[row],
      west,
      east,
    };
  }),
);

/** 建筑主体（拱壳外皮）的 X 范围 */
export const BUILDING_X = {
  min: Math.min(...VAULTS.map((v) => v.x)) - VAULT_LEN / 2,
  max: Math.max(...VAULTS.map((v) => v.x)) + VAULT_LEN / 2,
};
/** 建筑主体的 Z 范围（最南一排的南边 → 最北一排的北边） */
export const BUILDING_Z = {
  min: ROW_Z.south - VAULT_W / 2,
  max: ROW_Z.north + VAULT_W / 2,
};

// ---------- 填充墙：两道，沿 X 贯通，位于排与排之间 ----------
export interface WallFaceSegment {
  /** 墙中心线 z */
  z: number;
  /** 墙面朝向：−1 朝南，+1 朝北 */
  normal: -1 | 1;
  /** 所属拱（挂画位按它归组） */
  vault: VaultSpec;
}

/** 两道填充墙的中心线 z（南排|中排 与 中排|北排 的中线） */
export const WALL_Z = [
  (ROW_Z.south + ROW_Z.middle) / 2,
  (ROW_Z.middle + ROW_Z.north) / 2,
] as const;

/**
 * 所有可挂画的墙面段：一道墙有南北两个面，每个面按拱分成一段。
 * 南排 6 + 中排 4（朝南）+ 中排 4（朝北）+ 北排 6 = 20 段
 */
export const WALL_SEGMENTS: WallFaceSegment[] = WALL_Z.flatMap((z) =>
  VAULTS.flatMap((vault): WallFaceSegment[] => {
    const southRow = vault.z < z;
    return [{ z, normal: southRow ? -1 : 1, vault }];
  }),
);

/** 每段墙的净尺寸 */
export const WALL_SEG_LEN = 29.9;
export const HANG_COUNT = 6; // 每段 6 个挂位
export const HANG_STEP = 4.6; // 挂位间距
export const HANG_Y = 1.55; // 挂画中心线距室内地面（成人视高）

// ---------- 柱：每拱 4 根，位于拱四角内侧 0.6 m ----------
export interface ColumnSpec {
  x: number;
  z: number;
  /** 柱顶接到拱面，所以高度按所在 z 的拱面高程算 */
  height: number;
}

/** 摆线断面上某个 z（拱中心为 0）处的拱面高度（相对起拱线） */
export function vaultHeightAt(zLocal: number): number {
  // 反解 θ：x = r(θ − sinθ) − πr
  const target = zLocal + Math.PI * R;
  let lo = 0;
  let hi = Math.PI * 2;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (R * (mid - Math.sin(mid)) < target) lo = mid;
    else hi = mid;
  }
  const theta = (lo + hi) / 2;
  return R * (1 - Math.cos(theta));
}

export const COLUMNS: ColumnSpec[] = VAULTS.flatMap((vault) => {
  const halfLen = VAULT_LEN / 2 - COL_INSET;
  const halfWid = VAULT_W / 2 - COL_INSET;
  return ([-1, 1] as (-1 | 1)[]).flatMap((sx) =>
    ([-1, 1] as (-1 | 1)[]).map((sz): ColumnSpec => {
      const zLocal = sz * halfWid;
      return {
        x: vault.x + sx * halfLen,
        z: vault.z + zLocal,
        height: SPRING + vaultHeightAt(zLocal),
      };
    }),
  );
});

// ---------- 庭院 ----------
export interface Rect2 {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** 中排让出的西端：入口门厅正东的露天中庭（下沉 0.5） */
export const COURT_ATRIUM: Rect2 = {
  x: (BUILDING_X.min + (ROW_SLOTS.middle[0] * PITCH - VAULT_LEN / 2)) / 2,
  z: (ROW_Z.south + VAULT_W / 2 + ROW_Z.north - VAULT_W / 2) / 2,
  w: ROW_SLOTS.middle[0] * PITCH - VAULT_LEN / 2 - BUILDING_X.min,
  d: ROW_Z.north - VAULT_W / 2 - (ROW_Z.south + VAULT_W / 2),
};
/** 中排让出的东端：对称的另一处露天铺地 */
export const COURT_EAST: Rect2 = {
  x: (ROW_SLOTS.middle[3] * PITCH + VAULT_LEN / 2 + BUILDING_X.max) / 2,
  z: COURT_ATRIUM.z,
  w: BUILDING_X.max - (ROW_SLOTS.middle[3] * PITCH + VAULT_LEN / 2),
  d: COURT_ATRIUM.d,
};
/** 北庭院 12.2 × 12.2（40 ft），乔木数株 */
export const COURT_NORTH: Rect2 = {
  x: (BUILDING_X.min + BUILDING_X.max) / 2,
  z: BUILDING_Z.max + 12.2 / 2,
  w: 12.2,
  d: 12.2,
};
/** 南庭院 6.1 × 6.1（20 ft），下沉 0.5，草剧场 */
export const COURT_SOUTH: Rect2 = {
  x: (BUILDING_X.min + BUILDING_X.max) / 2,
  z: BUILDING_Z.min - 6.1 / 2,
  w: 6.1,
  d: 6.1,
};

// ---------- 平台 ----------
/** 平台（基座）范围：把建筑、三处庭院与西侧的树廊水池都托起来 */
export const PLATFORM: Rect2 = {
  x: (BUILDING_X.min - 15 + BUILDING_X.max) / 2,
  z: (COURT_SOUTH.z - COURT_SOUTH.d / 2 - 2 + COURT_NORTH.z + COURT_NORTH.d / 2 + 2) / 2,
  w: BUILDING_X.max - (BUILDING_X.min - 15) + 0,
  d: COURT_NORTH.z + COURT_NORTH.d / 2 + 2 - (COURT_SOUTH.z - COURT_SOUTH.d / 2 - 2),
};

// ---------- 西侧树廊与水池 ----------
export const ALLEE = {
  /** 两列树的 X（一列靠建筑，一列在外） */
  rows: [BUILDING_X.min - 7.8, BUILDING_X.min - 10.8] as const,
  count: 9,
  spacing: 3,
  /** 树廊沿 Z 的中心：对准入口中轴（中排轴线） */
  centerZ: ROW_Z.middle,
  height: 6,
  crownR: 1.55,
};
/** 树廊两侧各一座长条浅水池：12 m × 1.5 m，水位齐平台 */
export const POOLS = [
  { x: BUILDING_X.min - 4.6, z: ROW_Z.middle, w: 1.5, d: 12 },
  { x: BUILDING_X.min - 13.9, z: ROW_Z.middle, w: 1.5, d: 12 },
] as const;

// ---------- 中庭喷泉（南北各一座）----------
export const FOUNTAINS = [
  { x: COURT_ATRIUM.x, z: COURT_ATRIUM.z + COURT_ATRIUM.d / 2 - 1.6 },
  { x: COURT_ATRIUM.x, z: COURT_ATRIUM.z - COURT_ATRIUM.d / 2 + 1.6 },
] as const;

// ---------- 南庭院：草坡 + 三块玄武岩（抽象几何）----------
export const BASALTS = [
  { x: -1.7, z: -1.1, w: 1.5, d: 1.1, h: 1.0 },
  { x: 1.5, z: 0.9, w: 1.1, d: 1.4, h: 1.5 },
  { x: 0.2, z: 1.7, w: 0.9, d: 0.8, h: 0.7 },
] as const;

/** 北庭院的乔木（简单树干 + 球状树冠） */
export const COURT_TREES = [
  { x: -3.4, z: -3.2, h: 6.4 },
  { x: 3.1, z: -2.4, h: 5.6 },
  { x: -2.2, z: 3.4, h: 5.9 },
  { x: 2.6, z: 3.0, h: 6.8 },
  { x: 0.1, z: 0.2, h: 7.2 },
] as const;

/**
 * 自检：把关键尺寸打成一列，验收时直接对数据卡。
 * 页面控制台里也能看到（scene.ts 建场景时会调一次）。
 */
export function selfCheck(): string[] {
  const round = (n: number): string => n.toFixed(3);
  return [
    `单拱 长 ${round(VAULT_LEN)} / 宽 ${round(VAULT_W)} / 拱顶 ${round(APEX)}`,
    `摆线 r ${round(R)}  矢高 ${round(RISE)}  起拱线 ${round(SPRING)}`,
    `拱数 ${VAULTS.length}（南 ${ROW_SLOTS.south.length} · 中 ${ROW_SLOTS.middle.length} · 北 ${ROW_SLOTS.north.length}）`,
    `拱中心距 ${round(PITCH)}  结构分隔 ${round(SEP)}`,
    `天窗缝 ${round(SLOT_W)}  横向肋 ${RIB_COUNT} 道 @ ${round(RIB_STEP)} m`,
    `填充墙 高 ${round(WALL_H)} 厚 ${round(WALL_T)} 楔形收口缝 ${round(WALL_SLOT)}`,
    `柱 ${COLUMNS.length} 根 @ ${round(COL)} m 见方，高 ${round(COLUMNS[0].height)}`,
    `挂画位 ${WALL_SEGMENTS.length * HANG_COUNT} 个（${WALL_SEGMENTS.length} 段 × ${HANG_COUNT}）`,
  ];
}

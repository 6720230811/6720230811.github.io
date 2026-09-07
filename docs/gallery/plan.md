# 夜行折廊 — 场景结构与改造计划

> 目标：把现有「Hilbert 迷宫 + 一间大厅」的 3D 画廊，改成「一条折廊贯穿 + 沿途扩张出各个展厅」的
> **夜行折廊**。长廊是建筑语言的核心，占总可参观面积 65%–70%；房间是长廊途中自然扩张或支线连接
> 出来的节点，不取代长廊。

---

## 一、现状与结论

| 现有 | 处理 |
|---|---|
| `hilbert.ts` 生成 48×48 m Hilbert 迷宫（510 段墙） | **删除**。新长廊是规格给定的折线，不再用 Hilbert 递归；折线偏移（miter）工具迁到 `walls.ts` |
| `hall.ts` 在迷宫中间挖 12×12 m 大厅 | **删除**。中央大厅改为规格里的 X12–22 / Z12–22，且长廊从它中间穿过 |
| `plan.ts` 布局 | **重写**。输出改为：分区（章节）、作品墙清单、作品排布、出生点 |
| `floor.ts` 场景 | **重写**。按分区给墙色/天花高度/地面/灯槽/门套，用 InstancedMesh |
| `surfaces.ts` 程序化纹理 | **改**。大模块地面、矿涂料墙、柔光顶棚、铜灰嵌条 |
| `minimap.ts` | **改**。右上可折叠，画主长廊 + 房间 + 当前位置 + 已参观区域 |
| `index.ts` 交互 | **改**。章节 HUD、策展路线/自由探索、真实沿折线的路径行走 |
| `styles.ts`（九种艺术厅形制） | **保留但 3D 不再用**（数据 schema 仍在用它的 id 做门牌文字） |
| 降级到网格浏览 | **保留**，不弱化 |

---

## 二、坐标与尺寸（唯一真源）

```
X 东西向右为正，Z 南北向上为正（+Z = 北），Y 高度
建筑 X 0–38 m，Z 0–30 m        ← 规格写 Z 0–28，见下方「冲突 1」
地面 Y = 0，人眼 1.65 m
出生 (4, 1.65, 1.5)，朝 +Z（正北）→ three 相机 yaw = π
长廊净宽 4 m，墙厚 0.2 m，标准墙高 3.6 m，转角内侧倒角 0.05 m
入口 [4,0] 开口 3 m；出口 [34,0] 开口 3 m
```

### 主长廊中心线（规格给定，不改）

```
[4,0] → [4,5] → [14,5] → [14,10] → [5,10] → [5,16] → [17,16] → [17,23]
→ [34,23] → [34,16] → [25,16] → [25,8] → [34,8] → [34,0]
```

### 章节切分

| # | 区间 | 章节 | 主题墙色 |
|---|---|---|---|
| 1 | [4,0]→[14,10] | 夜行长廊 | 深酒红 `#542B33` |
| 2 | [14,10]→[5,16] | 城市长廊 | 暖石灰 `#B8AEA1` |
| 3 | [5,16]→[17,23] | 自然长廊 | 灰蓝绿 `#627775` |
| 4 | [17,23]→[34,16] | 光影长廊 | 中央大厅同系浅砂岩的暗一档 |
| 5 | [34,16]→[25,8] | 慢门长廊 | 同上 |
| 6 | [25,8]→[34,0] | 终章长廊 | 同上 |

### 房间

| 分区 | X | Z | 净高 | 与长廊的关系 |
|---|---|---|---|---|
| 入口序厅 entry | 2–10 | 0–7 | 3.4 | 长廊 [4,0]→[4,5] 从中穿过 |
| 中央大厅 atrium | 12–22 | 12–22 | 5.0 | 长廊 [5,16]→[17,16]→[17,23] 从中穿过并转向 |
| 潮汐之间 tide | 2–13 | 20–27 | 4.2 | 支廊 X=8，Z 16–20，宽 3 m |
| 临展厅 temp | 22–37 | **25–30** | 4.2 | 南墙（Z=25）3.2 m 门洞接光影长廊 |
| 沉浸展厅 immersion | 28–37 | 10–15 | 4.5 | 西门（X=28）3.2 m 门洞接慢门长廊，门内 2.5 m 低照度过渡 |
| 大型作品厅 large | 13–23 | 1–8 | 5.5 | 北墙（Z=8）3 m 门洞 ← 中央大厅南支线；东墙（X=23）3 m 门洞 → 总览区 |
| 总览区/出口 overview | 30–38 | 0–7 | 3.6 | 长廊 [34,8]→[34,0] 从中穿过 |

### 支廊（规格只给了位置，坐标由我定）

- **A 中央大厅南 → 大型作品厅**：中心 X=19，Z 12→8，宽 3 m（两端 3 m 门洞）。
- **B 大型作品厅东 → 总览区**：中心 Z=5，X 23→30，宽 3 m（两端 3 m 门洞）。
- **C 自然长廊 → 潮汐之间**：中心 X=8，Z 16→20，宽 3 m（规格给定）。

---

## 三、需要你知道的三处规格冲突（我按下面的办法处理，你要改就说）

**冲突 1 — 临展厅 Z 21–27 与主长廊 z=23 那一段重叠。**
长廊在 z=23 的那一段，墙到 z=21 与 z=25；临展厅 Z 21–27 整块被长廊穿掉一半。而规格又要求
「临展厅可以独立关闭，但不能影响主长廊通行」——这要求长廊**不能**穿过临展厅。
→ **处理**：长廊坐标一字不改（它是这个设计的骨头），把临展厅北移到 **Z 25–30**，建筑 Z 上限
相应从 28 放到 **30**。临展厅仍是 15×5 m，够放 2–3 面可移动展墙。

**冲突 2 — 沉浸展厅「经慢门长廊进入」。**
慢门长廊最后一段在 X=25（墙到 X=27），沉浸展厅西墙在 X=28，中间空 1 m。
→ **处理**：这 1 m 做成有厚度的框景门洞（门套 0.25 m 深）；房内西侧加一道偏心隔墙，隔出规格要的
约 2.5 m 低照度过渡空间，顺便挡住「进门看完全部」的视线。

**冲突 3 — 中央大厅北门洞 Z=22 / X 15.5–18.5，但长廊在 X=17 转北。**
长廊 [17,16]→[17,23] 是 4 m 宽（X 15–19），门洞 3 m（15.5–18.5）比长廊窄 1 m。
→ **处理**：按规格做——门洞窄于长廊，形成「收一下再放开」的框景；两侧各留 0.5 m 完整墙面，
符合「门洞两侧至少保留 0.8 m 完整墙面」的精神（此处长廊墙到墙 4 m，留 0.5 m 是几何上限，
我会在门洞两侧把墙做成整段不断开）。

---

## 四、文件改动计划

### 新增

| 文件 | 职责 |
|---|---|
| `src/lib/gallery/blueprint.ts` | **纯数据**：长廊折线、房间矩形、门洞、分区色板/净高/地面、支廊。改建筑只改这一个文件 |
| `src/lib/gallery/walls.ts` | **几何生成**：折线双侧偏移墙（miter 斜接 + 0.05 倒角）、房间墙（按门洞断开）、门套/拱券、房间内长廊墙的裁切、碰撞盒、分区判定 |
| `src/lib/gallery/hang.ts` | **作品自动排布**：作品墙清单 → 落点（不重复、留白 30%、hero/salon/standard/video） |
| `docs/gallery/plan.md` | 本文档 |
| `docs/gallery/stage-N.md` | 每阶段的完成/后续报告 |

### 改写

| 文件 | 改动 |
|---|---|
| `plan.ts` | 消费 blueprint/walls/hang，输出 `FloorPlan { walls, obstacles, zones, artWalls, placements, bounds, spawn }` |
| `floor.ts` | 按分区建墙/天花/地面/踢脚/灯槽/门套/房间道具；分区配色与净高 |
| `surfaces.ts` | 大模块地面、矿涂料墙、柔光顶棚、铜灰嵌条、中性占位画框 |
| `index.ts` | 章节 HUD、沿折线的真实路径行走、策展路线/自由探索、首次提示 5 s 淡出 |
| `minimap.ts` | 右上可折叠；画主长廊、房间、当前位置、已参观区域 |
| `GalleryFloor.astro` | 新 HUD 结构（左上章节 / 右上地图 / 左下作品信息 / 右下按钮） |
| `gallery.css` | 新 HUD 样式 |
| `i18n/ui.ts` | 章节名、模式名、提示文案（中英） |

### 删除

- `hilbert.ts`（折线偏移工具迁到 `walls.ts`）
- `hall.ts`（中央大厅进了 `blueprint.ts`）

### 数据

- `gallery.json` / `gallery.schema.ts`：作品加可选 `zone` 字段；不写则按 `theme` 映射
  （city → 城市长廊，sea → 自然长廊/潮汐之间）。作品数增加不用改建筑代码。

---

## 五、数据结构（完整）

```ts
// ---------- blueprint.ts ----------
export interface Vec2 { x: number; z: number }
export interface Rect { x1: number; z1: number; x2: number; z2: number }

export const BUILDING: Rect;                 // { x1:0, z1:0, x2:38, z2:30 }
export const CORRIDOR_PATH: Vec2[];          // 上面那 14 个点
export const CORRIDOR = { width: 4, wallT: 0.2, height: 3.6, chamfer: 0.05 };
export const EYE_HEIGHT = 1.65;
export const SPAWN = { x: 4, z: 1.5, yaw: Math.PI };   // 朝 +Z

export type ZoneId =
  | 'entry' | 'night' | 'city' | 'nature' | 'light' | 'slow' | 'final'
  | 'atrium' | 'tide' | 'temp' | 'immersion' | 'large' | 'overview';

export interface Zone {
  id: ZoneId;
  /** 章节编号（只有长廊段有） */
  chapter?: number;
  /** 分区名，i18n key 后缀 */
  labelKey: string;
  ceiling: number;                 // 净高（米）
  wall: string;                    // 基础墙色
  accent: string | null;           // 主题墙色（null = 全用基础色）
  accentRatio: number;             // 主题墙占比 0.2–0.3
  ceilingColor: string;
  floor: { color: string; module: [number, number] };   // 1.2×1.2 或 1.2×2.4
  kind: 'corridor' | 'room';
  /** 长廊章节在折线上的起止参数（0–1 沿折线弧长），房间没有 */
  span?: [number, number];
}

export type WallKey = 'n' | 'e' | 's' | 'w';

export interface DoorSpec {
  /** 开在哪面墙上 */
  wall: WallKey;
  /** 门洞中心沿这面墙的坐标 */
  at: number;
  width: number;      // 2.8 普通 / 3.2 重要 / 3.0 拱券
  height: number;     // 3.0 普通 / 3.4 重点
  /** 浅拱券（起拱 2.35、总高 3.4、宽 3.0） */
  arch?: boolean;
}

export interface RoomSpec {
  id: ZoneId;
  rect: Rect;
  /** 长廊是否从房间中穿过（是 → 房间范围内的长廊墙被裁掉，由房间墙接管） */
  corridorThrough: boolean;
  doors: DoorSpec[];
  /** 房间里的东西：凳子、装置占位、可移动展墙 */
  props: PropSpec[];
}

export type PropSpec =
  | { kind: 'bench'; x: number; z: number; w: number; d: number; ry: number }
  | { kind: 'sculpture'; x: number; z: number; r: number }
  | { kind: 'screen'; x1: number; z1: number; x2: number; z2: number; t: number }  // 可移动展墙
  | { kind: 'partition'; x1: number; z1: number; x2: number; z2: number; t: number; h: number };

// ---------- walls.ts ----------
export interface WallSegment {
  a: Vec2; b: Vec2;
  /** 法线指向「人进不去的一侧」（墙芯 / 房间外 / 隔断内部）；作品挂在 -normal 一面 */
  normal: Vec2;
  length: number;
  height: number;          // 这面墙的净高（随分区）
  zone: ZoneId;
  /** base 基础墙 / accent 主题墙 / partition 独立展墙 / door-jamb 门套 */
  kind: 'base' | 'accent' | 'partition';
}

export interface DoorOpening {
  x: number; z: number;    // 门洞中心
  width: number; height: number;
  /** 门洞所在墙的走向（ry） */
  ry: number;
  depth: number;           // 门套深度 0.18–0.25
  arch: boolean;
  zone: ZoneId;
}

export interface Obstacle { x1: number; z1: number; x2: number; z2: number }

// ---------- plan.ts ----------
export interface ArtWall {
  id: string;
  zone: ZoneId;
  start: Vec2; end: Vec2;
  /** 墙面法线，指向房间/走廊内侧；作品挂在墙面上、朝 normal 方向 */
  normal: Vec2;
  length: number;
  capacity: number;                       // 由长度与作品尺寸推算
  type: 'standard' | 'hero' | 'salon' | 'video';
  /** 两端预留（米）：墙角 ≥1.2、门洞 ≥0.8–1 */
  reservedStart: number;
  reservedEnd: number;
  ceilingHeight: number;
}

export interface Placement {
  id: string;              // 作品 id；占位为 `void:<wall>:<n>`
  zone: ZoneId;
  wallId: string;
  x: number; y: number; z: number; ry: number;
  fw: number; fh: number;
  title: string; author: string;
  kind: 'hero' | 'standard' | 'salon' | 'video' | 'placeholder';
}

export interface FloorPlan {
  walls: WallSegment[];
  obstacles: Obstacle[];
  zones: ZoneSpec[];              // 章节/房间，供 HUD 与路径用
  artWalls: ArtWall[];
  placements: Placement[];
  doors: DoorOpening[];
  props: PropSpec[];
  bounds: Rect;
  spawn: { x: number; z: number; yaw: number };
}
```

---

## 六、分阶段实施

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| **S1** | `blueprint.ts` + `walls.ts` + `plan.ts` 重写（几何与分区），`hang.ts` 先按简单规则 | 脚本自测：全平面连通、门洞位置/宽度正确、房间内无长廊残墙、无穿墙点 |
| **S2** | `floor.ts` 重写：分区墙色/净高/地面模块/踢脚/灯槽/门套拱券/房间道具 | 截图：能看出一条折廊 + 中央大厅 + 各房间，天花高度有变化 |
| **S3** | 灯光：3500 K 环境、灯槽 emissive、近处 SpotLight（≤3 盏动态阴影）、曝光 0.95 / 雾 0.012 | 截图：夜间叙事感，作品不发灰，帧率不掉 |
| **S4** | `hang.ts` 完整排布规则 + 占位画框 + 缩略图→高清纹理 + 释放 | 每件作品只出现一次，留白 ≥30%，hero 在尽端/转角/放宽处 |
| **S5** | 交互与 UI：章节 HUD、右上可折叠地图、左下作品信息、右下按钮、首次提示、策展路线/自由探索 | 走一遍全流程；门洞处章节名会变 |
| **S6** | 性能与降级：InstancedMesh、纹理释放、移动端、低性能自动降级 + 验收对照 10 条 | 构建通过、移动端可走、无 WebGL 时正常退网格 |

每个阶段结束写一份 `docs/gallery/stage-N.md`：做了什么 / 自测结果 / 接下来做什么。

/**
 * 建筑：16 个摆线筒拱（6+4+6）、填充墙与楔形收口缝、柱网、平台、庭院、
 * 西侧树廊与水池。
 *
 * 两条实现上的取舍：
 * - 重复构件（拱壳、肋、柱、反射器段）全部用 InstancedMesh：16 个拱壳只占
 *   一次 draw call，整场 draw call 压在 40 上下，4096² 的阴影图才跑得动
 * - 拱壳内外表面分成两个材质组：内表面清水混凝土、外表面铅铜屋面
 * - 贴图全部程序化生成（textures.ts），不用任何外部素材
 */
import * as THREE from 'three';
import {
  APEX_H,
  LENGTH,
  LENGTH_SEGMENTS,
  PROFILE_SEGMENTS,
  SLOT_W,
  SHELL_T,
  SPAN,
  SPRING_H,
  archProfile,
  splitAtSlot,
} from './cycloid';
import {
  ALLEE,
  BASALTS,
  BUILDING_X,
  BUILDING_Z,
  COL,
  COLUMNS,
  COURT_ATRIUM,
  COURT_EAST,
  COURT_NORTH,
  COURT_SOUTH,
  COURT_SUNKEN,
  COURT_TREES,
  FOUNTAINS,
  PLATFORM,
  PLATFORM_H,
  POOLS,
  VAULTS,
  WALL_H,
  WALL_SEG_LEN,
  WALL_T,
  WALL_Z,
  type EndKind,
} from './layout';
import { buildEndWallGeometry, loftShell, loftTube, wingLoop } from './geometry';
import {
  brushedAluminiumTexture,
  concreteTexture,
  oakTexture,
  perforationTexture,
  travertineTexture,
} from './textures';

/** 反射器：天窗缝正下方 1.5 m，沿 X 每 3.05 m 一段（10 段），翼展 2.7 m（Z 向） */
export const REFLECTOR = {
  centerY: APEX_H - 1.5,
  span: 2.7,
  drop: 0.42,
  thickness: 0.05,
  segmentLen: 3.05,
  segments: Math.round(LENGTH / 3.05), // 10
  // 反射器是一段小体：loop 段数降到 32（宽 2.7 m 已够细腻），长度方向 1 段足矣
  loopSegments: 32,
  lengthSegments: 1,
};

export interface Building {
  /** 室内地面在这个 group 的 y=0，整个 group 抬到平台面上 */
  group: THREE.Group;
  /** 反射器材质：时间滑块要改它的自发光 */
  reflectorMaterial: THREE.MeshStandardMaterial;
  dispose(): void;
}

export function buildBuilding(): Building {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // ---------- 贴图 ----------
  const concreteMap = track(concreteTexture());
  concreteMap.repeat.set(4, 4);
  const travertineMap = track(travertineTexture());
  travertineMap.repeat.set(4, 4);
  const oakMap = track(oakTexture());
  oakMap.repeat.set(1, 8);
  const aluMap = track(brushedAluminiumTexture());
  const perfMap = track(perforationTexture());

  // ---------- 材质（色值按数据卡第六节）----------
  // 清水混凝土 #C8C4BA / roughness 0.85 / 哑光
  const concrete = track(
    new THREE.MeshStandardMaterial({
      map: concreteMap,
      color: '#C8C4BA',
      roughness: 0.85,
      metalness: 0,
      envMapIntensity: 0.6,
    }),
  );
  // 铅铜屋面 #4A4A44 / 金属度 0.8 / roughness 0.5
  const roof = track(
    new THREE.MeshStandardMaterial({
      color: '#4A4A44',
      roughness: 0.5,
      metalness: 0.8,
      envMapIntensity: 0.8,
    }),
  );
  // 洞石 #E4D8C0 / roughness 0.9
  const travertine = track(
    new THREE.MeshStandardMaterial({
      map: travertineMap,
      color: '#E4D8C0',
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.5,
    }),
  );
  // 白橡木 #D9C6A4 / roughness 0.45（清漆微高光）
  const oak = track(
    new THREE.MeshStandardMaterial({
      map: oakMap,
      color: '#D9C6A4',
      roughness: 0.45,
      metalness: 0.03,
      envMapIntensity: 0.6,
    }),
  );
  // 不锈钢 / 拉丝金属：金属度 1.0，roughness 0.32
  const steel = track(
    new THREE.MeshStandardMaterial({ color: '#B8BABC', roughness: 0.32, metalness: 1 }),
  );
  // 有机玻璃：透射 0.92，roughness 0.1（只用在天窗缝上，别处用便宜的半透明）
  const plexiglass = track(
    new THREE.MeshPhysicalMaterial({
      color: '#EAF2FA',
      roughness: 0.1,
      metalness: 0,
      transmission: 0.92,
      thickness: 0.05,
      ior: 1.49,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );
  // 楔形收口缝的采光带：也是玻璃，但用便宜的半透明（数量多，不走 transmission）
  const slotGlass = track(
    new THREE.MeshStandardMaterial({
      color: '#DDE8F2',
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.42,
      emissive: new THREE.Color('#DCE6F2'),
      emissiveIntensity: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  // 反射器：阳极氧化穿孔铝，银灰微哑光
  const reflectorMaterial = track(
    new THREE.MeshStandardMaterial({
      map: aluMap,
      alphaMap: perfMap,
      transparent: true,
      alphaTest: 0.5,
      color: '#CFD2D4',
      roughness: 0.38,
      metalness: 0.86,
      emissive: new THREE.Color('#FFE9C8'),
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  const water = track(
    new THREE.MeshStandardMaterial({
      color: '#6E7C82',
      roughness: 0.08,
      metalness: 0.2,
      envMapIntensity: 1.2,
    }),
  );
  const grass = track(
    new THREE.MeshStandardMaterial({ color: '#7C8A5C', roughness: 0.95, metalness: 0 }),
  );
  const basalt = track(
    new THREE.MeshStandardMaterial({ color: '#33342F', roughness: 0.72, metalness: 0.05 }),
  );
  const foliage = track(
    new THREE.MeshStandardMaterial({ color: '#3E5A3A', roughness: 0.9, metalness: 0 }),
  );
  const bark = track(
    new THREE.MeshStandardMaterial({ color: '#4A4038', roughness: 0.95, metalness: 0 }),
  );

  const profile = archProfile(PROFILE_SEGMENTS);
  const [leftHalf, rightHalf] = splitAtSlot(profile, SLOT_W / 2);

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  // ---------- 拱壳：16 个，一次 draw call（内外两个材质组）----------
  const shellGeometry = mergeShells([
    loftShell(leftHalf, LENGTH, SHELL_T, LENGTH_SEGMENTS, 1),
    loftShell(rightHalf, LENGTH, SHELL_T, LENGTH_SEGMENTS, 1),
  ]);
  track(shellGeometry);
  const shells = new THREE.InstancedMesh(shellGeometry, [concrete, roof], VAULTS.length);
  shells.castShadow = true;
  shells.receiveShadow = true;
  VAULTS.forEach((vault, i) => {
    pos.set(vault.x, SPRING_H, vault.z);
    shells.setMatrixAt(i, matrix.compose(pos, quat, scale));
  });
  shells.instanceMatrix.needsUpdate = true;
  group.add(shells);

  // ---------- 横向连接肋：每 3.05 m 一道，用粗断面（视觉上是细带，不需要 64 段）----------
  const ribsPerVault = Math.round(LENGTH / 3.05);
  const ribProfile = archProfile(24);
  const ribGeometry = track(loftShell(ribProfile, 0.14, SHELL_T + 0.05, 1, 1));
  const ribs = new THREE.InstancedMesh(ribGeometry, concrete, VAULTS.length * ribsPerVault);
  ribs.castShadow = true;
  ribs.receiveShadow = true;
  let rib = 0;
  for (const vault of VAULTS) {
    for (let i = 0; i < ribsPerVault; i += 1) {
      const z = -LENGTH / 2 + ((i + 0.5) / ribsPerVault) * LENGTH;
      pos.set(vault.x, SPRING_H, vault.z + z);
      ribs.setMatrixAt(rib, matrix.compose(pos, quat, scale));
      rib += 1;
    }
  }
  ribs.instanceMatrix.needsUpdate = true;
  group.add(ribs);

  // ---------- 天窗缝：每拱一条通长的有机玻璃 ----------
  const slotGeometry = track(new THREE.PlaneGeometry(SLOT_W, LENGTH));
  const slots = new THREE.InstancedMesh(slotGeometry, plexiglass, VAULTS.length);
  const lying = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  VAULTS.forEach((vault, i) => {
    pos.set(vault.x, APEX_H - 0.03, vault.z);
    slots.setMatrixAt(i, matrix.compose(pos, lying, scale));
  });
  slots.instanceMatrix.needsUpdate = true;
  group.add(slots);

  // ---------- 端墙：实体（山墙）/ 玻璃（门厅）；'open' 的不砌 ----------
  const endGeometry = track(buildEndWallGeometry(profile, SPRING_H));
  const endsOf = (kind: EndKind): { vault: (typeof VAULTS)[number]; side: 'west' | 'east' }[] =>
    VAULTS.flatMap((vault) =>
      ([['west', vault.west], ['east', vault.east]] as ['west' | 'east', EndKind][])
        .filter(([, k]) => k === kind)
        .map(([side]) => ({ vault, side })),
    );

  const solidEnds = endsOf('wall');
  const endWalls = new THREE.InstancedMesh(endGeometry, concrete, solidEnds.length);
  endWalls.castShadow = true;
  endWalls.receiveShadow = true;
  solidEnds.forEach(({ vault, side }, i) => {
    const x = vault.x + (side === 'west' ? -LENGTH / 2 : LENGTH / 2);
    const turn = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, side === 'west' ? 0 : Math.PI, 0),
    );
    endWalls.setMatrixAt(i, matrix.compose(pos.set(x, 0, vault.z), turn, scale));
  });
  endWalls.instanceMatrix.needsUpdate = true;
  group.add(endWalls);

  const glassEnds = endsOf('glass');
  const lobbyGlass = new THREE.InstancedMesh(endGeometry, plexiglass, glassEnds.length);
  lobbyGlass.castShadow = true;
  glassEnds.forEach(({ vault, side }, i) => {
    const x = vault.x + (side === 'west' ? -LENGTH / 2 : LENGTH / 2);
    const turn = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, side === 'west' ? 0 : Math.PI, 0),
    );
    lobbyGlass.setMatrixAt(i, matrix.compose(pos.set(x, 0, vault.z), turn, scale));
  });
  lobbyGlass.instanceMatrix.needsUpdate = true;
  group.add(lobbyGlass);

  // 门厅的钢框：竖挺 + 横楣 instanced（2 端 × (7 + 3) = 20 件 → 2 个 draw call）
  const mullionGeo = new THREE.BoxGeometry(0.08, APEX_H, 0.08);
  const railGeo = new THREE.BoxGeometry(0.08, 0.07, SPAN);
  disposables.push(mullionGeo, railGeo);
  const mullionCount = glassEnds.length * 7;
  const railCount = glassEnds.length * 3;
  const mullions = new THREE.InstancedMesh(mullionGeo, steel, mullionCount);
  const rails = new THREE.InstancedMesh(railGeo, steel, railCount);
  mullions.castShadow = true;
  let mi = 0;
  let ri = 0;
  for (const { vault, side } of glassEnds) {
    const x = vault.x + (side === 'west' ? -LENGTH / 2 : LENGTH / 2);
    for (let i = 0; i <= 6; i += 1) {
      mullions.setMatrixAt(
        mi++,
        matrix.compose(
          pos.set(x, APEX_H / 2, vault.z - SPAN / 2 + (i / 6) * SPAN),
          quat,
          scale,
        ),
      );
    }
    for (const y of [0.9, 2.4, SPRING_H]) {
      rails.setMatrixAt(ri++, matrix.compose(pos.set(x, y, vault.z), quat, scale));
    }
  }
  mullions.instanceMatrix.needsUpdate = true;
  rails.instanceMatrix.needsUpdate = true;
  group.add(mullions, rails);
  disposables.push(mullions, rails);

  // ---------- 柱：每拱 4 根，柱头接到拱面 ----------
  const colGeometry = track(new THREE.BoxGeometry(COL, 1, COL));
  const columns = new THREE.InstancedMesh(colGeometry, concrete, COLUMNS.length);
  columns.castShadow = true;
  columns.receiveShadow = true;
  COLUMNS.forEach((column, i) => {
    scale.set(1, column.height, 1);
    columns.setMatrixAt(i, matrix.compose(pos.set(column.x, column.height / 2, column.z), quat, scale));
  });
  scale.set(1, 1, 1);
  columns.instanceMatrix.needsUpdate = true;
  group.add(columns);

  // ---------- 填充墙：两道，沿 X 贯通；墙顶到拱面留楔形收口缝 ----------
  const panelGeometry = track(new THREE.BoxGeometry(WALL_SEG_LEN, WALL_H, WALL_T));
  const panels = new THREE.InstancedMesh(panelGeometry, travertine, VAULTS.length * 2);
  panels.castShadow = true;
  panels.receiveShadow = true;
  let panel = 0;
  for (const wallZ of WALL_Z) {
    for (const vault of VAULTS) {
      // 只砌紧邻这道墙的那一排（排距 7.32，隔一排是 10.98）
      if (Math.abs(vault.z - wallZ) > 4.2) continue;
      const normal: -1 | 1 = vault.z < wallZ ? -1 : 1;
      pos.set(vault.x, WALL_H / 2, wallZ + normal * (WALL_T / 2));
      panels.setMatrixAt(panel, matrix.compose(pos, quat, scale));
      panel += 1;
    }
  }
  panels.count = panel;
  panels.instanceMatrix.needsUpdate = true;
  group.add(panels);

  /**
   * 外纵墙：南北两侧各一道，拱从墙顶起拱（这是承重的围护墙，不是填充墙，
   * 所以不留楔形缝、也不设挂画位）。墙顶正好落在起拱线 4.159 m。
   */
  const sideWallGeometry = track(
    new THREE.BoxGeometry(BUILDING_X.max - BUILDING_X.min, SPRING_H, WALL_T),
  );
  for (const side of [-1, 1] as (-1 | 1)[]) {
    const wall = new THREE.Mesh(sideWallGeometry, travertine);
    wall.position.set(
      (BUILDING_X.min + BUILDING_X.max) / 2,
      SPRING_H / 2,
      side === -1 ? BUILDING_Z.min - WALL_T / 2 : BUILDING_Z.max + WALL_T / 2,
    );
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // 楔形收口缝：从墙顶（3.2）斜到拱脚（起拱线），一片玻璃把这个「可«读»的节点」封上
  buildWallSlots(group, disposables, slotGlass, steel);

  // ---------- 地面：白橡木 6.1 m 与洞石 3.05 m 沿 Z 交替 ----------
  buildFloors(group, disposables, oak, travertine);

  // ---------- 反射器：每拱 10 段翼形穿孔铝 ----------
  buildReflectors(group, disposables, reflectorMaterial, steel);

  // ---------- 平台、庭院、树廊、水池（室外地坪在 y = −PLATFORM_H）----------
  const outdoors = new THREE.Group();
  outdoors.position.y = -PLATFORM_H;
  buildOutdoors(outdoors, disposables, {
    concrete,
    travertine,
    water,
    grass,
    basalt,
    foliage,
    bark,
  });
  group.add(outdoors);

  return {
    group,
    reflectorMaterial,
    dispose() {
      for (const item of disposables) item.dispose();
      for (const mesh of [shells, ribs, slots, endWalls, lobbyGlass, columns, panels]) {
        mesh.dispose();
      }
    },
  };
}

/**
 * 楔形收口缝的采光带：墙顶（3.2）到拱脚（起拱线）之间那道斜缝，
 * 用一片斜置的玻璃封住 —— 直射光因此进不到室内，缝本身还是亮的。
 * 全部上 InstancedMesh：玻璃面 1 个 draw call + 上下钢压条 2 个。
 */
function buildWallSlots(
  group: THREE.Group,
  disposables: { dispose(): void }[],
  glass: THREE.Material,
  steel: THREE.Material,
): void {
  // 收集所有段的几何参数
  type SlotInfo = { x: number; cy: number; cz: number; length: number; tilt: number };
  const list: SlotInfo[] = [];
  for (const wallZ of WALL_Z) {
    for (const vault of VAULTS) {
      if (Math.abs(vault.z - wallZ) > 4.2) continue;
      const normal: -1 | 1 = vault.z < wallZ ? -1 : 1;
      const wallTop = { z: wallZ + normal * (WALL_T / 2), y: WALL_H };
      const vaultEdge = { z: vault.z - normal * (SPAN / 2), y: SPRING_H };
      const dz = vaultEdge.z - wallTop.z;
      const dy = vaultEdge.y - wallTop.y;
      list.push({
        x: vault.x,
        cy: (wallTop.y + vaultEdge.y) / 2,
        cz: (wallTop.z + vaultEdge.z) / 2,
        length: Math.hypot(dz, dy),
        tilt: Math.atan2(dz, dy),
      });
    }
  }
  if (list.length === 0) return;

  // 同一 length 用一个几何；不同 length 的才分几何（这里都是同一个值）
  const length = list[0].length;
  const glassGeo = new THREE.PlaneGeometry(WALL_SEG_LEN, length);
  const barGeo = new THREE.BoxGeometry(WALL_SEG_LEN, 0.06, 0.06);
  disposables.push(glassGeo, barGeo);

  const glasses = new THREE.InstancedMesh(glassGeo, glass, list.length);
  glasses.castShadow = true;
  glasses.receiveShadow = true;
  const barsTop = new THREE.InstancedMesh(barGeo, steel, list.length);
  const barsBot = new THREE.InstancedMesh(barGeo, steel, list.length);

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);

  list.forEach((slot, i) => {
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2 + slot.tilt, 0, 0),
    );
    glasses.setMatrixAt(i, matrix.compose(pos.set(slot.x, slot.cy, slot.cz), rotation, scale));
    barsTop.setMatrixAt(i, matrix.compose(pos.set(slot.x, slot.cy + slot.length / 2, slot.cz), quat, scale));
    barsBot.setMatrixAt(i, matrix.compose(pos.set(slot.x, slot.cy - slot.length / 2, slot.cz), quat, scale));
  });
  glasses.instanceMatrix.needsUpdate = true;
  barsTop.instanceMatrix.needsUpdate = true;
  barsBot.instanceMatrix.needsUpdate = true;
  group.add(glasses, barsTop, barsBot);
  disposables.push(glasses, barsTop, barsBot);
}

/**
 * 地面：白橡木 6.1 m（20 ft）与洞石 3.05 m（10 ft）沿 Z 向交替，
 * 从建筑最南一侧开始循环，形成 20:10 的节奏。
 * 数据卡要求「接缝对准拱中心线」，但排距是 7.32 m（拱宽 6.10 + 分隔），
 * 与 6.10 / 3.05 的循环取不到公共缝位；这里让接缝落在拱脚线上（相邻两拱
 * 的分界），是能取到的最接近的做法。
 */
function buildFloors(
  group: THREE.Group,
  disposables: { dispose(): void }[],
  oak: THREE.Material,
  travertine: THREE.Material,
): void {
  const spanX = BUILDING_X.max - BUILDING_X.min;
  const centerX = (BUILDING_X.min + BUILDING_X.max) / 2;
  let cursor = BUILDING_Z.min;
  let useStone = false;

  while (cursor < BUILDING_Z.max - 0.01) {
    const width = Math.min(useStone ? 3.05 : 6.1, BUILDING_Z.max - cursor);
    const geometry = new THREE.PlaneGeometry(spanX, width);
    disposables.push(geometry);
    const strip = new THREE.Mesh(geometry, useStone ? travertine : oak);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(centerX, 0.01, cursor + width / 2);
    strip.receiveShadow = true;
    group.add(strip);
    cursor += width;
    useStone = !useStone;
  }
}

/** 反射器：每拱 10 段翼形穿孔铝，细钢索吊在拱壳下 */
function buildReflectors(
  group: THREE.Group,
  disposables: { dispose(): void }[],
  material: THREE.Material,
  steel: THREE.Material,
): void {
  const loop = wingLoop({
    span: REFLECTOR.span,
    centerY: REFLECTOR.centerY,
    drop: REFLECTOR.drop,
    thickness: REFLECTOR.thickness,
    segments: REFLECTOR.loopSegments,
  });
  const geometry = loftTube(loop, REFLECTOR.segmentLen, REFLECTOR.lengthSegments, 0.12);
  disposables.push(geometry);

  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    VAULTS.length * REFLECTOR.segments,
  );
  mesh.castShadow = true;
  // 投影用不带 alphaMap 的深度材质：孔不漏光，直射光到不了地面与画作
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  disposables.push(mesh.customDepthMaterial);

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  let i = 0;
  for (const vault of VAULTS) {
    for (let s = 0; s < REFLECTOR.segments; s += 1) {
      const x = vault.x - LENGTH / 2 + (s + 0.5) * REFLECTOR.segmentLen;
      mesh.setMatrixAt(i, matrix.compose(pos.set(x, 0, vault.z), quat, scale));
      i += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  disposables.push(mesh);

  // 吊索：每段两根，从天窗缝两侧的拱面吊下来
  const rodGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
  disposables.push(rodGeometry);
  const rods = new THREE.InstancedMesh(
    rodGeometry,
    steel,
    VAULTS.length * REFLECTOR.segments * 2,
  );
  let r = 0;
  for (const vault of VAULTS) {
    for (let s = 0; s < REFLECTOR.segments; s += 1) {
      const x = vault.x - LENGTH / 2 + (s + 0.5) * REFLECTOR.segmentLen;
      for (const side of [-1, 1] as (-1 | 1)[]) {
        const top = APEX_H - 0.08;
        const bottom = REFLECTOR.centerY - REFLECTOR.drop + 0.36;
        pos.set(x, (top + bottom) / 2, vault.z + side * (REFLECTOR.span / 2 - 0.24));
        scale.set(1, top - bottom, 1);
        rods.setMatrixAt(r, matrix.compose(pos, quat, scale));
        r += 1;
      }
    }
  }
  scale.set(1, 1, 1);
  rods.instanceMatrix.needsUpdate = true;
  group.add(rods);
  disposables.push(rods);
}

interface OutdoorMaterials {
  concrete: THREE.Material;
  travertine: THREE.Material;
  water: THREE.Material;
  grass: THREE.Material;
  basalt: THREE.Material;
  foliage: THREE.Material;
  bark: THREE.Material;
}

/** 平台、三处庭院、南侧下沉台阶、西侧树廊与水池 */
function buildOutdoors(
  group: THREE.Group,
  disposables: { dispose(): void }[],
  m: OutdoorMaterials,
): void {
  const add = (mesh: THREE.Mesh, castShadow = false): void => {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(mesh.geometry);
  };

  // 平台（基座）：整块 1.2 m 高
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(PLATFORM.w, PLATFORM_H, PLATFORM.d),
    m.concrete,
  );
  platform.position.set(PLATFORM.x, PLATFORM_H / 2, PLATFORM.z);
  add(platform, true);

  // 四角缓坡
  for (const sx of [-1, 1] as (-1 | 1)[]) {
    for (const sz of [-1, 1] as (-1 | 1)[]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(6, PLATFORM_H, 6), m.concrete);
      ramp.position.set(
        PLATFORM.x + sx * (PLATFORM.w / 2 - 2),
        PLATFORM_H / 2,
        PLATFORM.z + sz * (PLATFORM.d / 2 - 2),
      );
      ramp.rotation.y = Math.PI / 4;
      add(ramp, true);
    }
  }

  // 南侧下沉台阶：通向南庭院
  for (let i = 0; i < 6; i += 1) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(6.1, PLATFORM_H / 6, 0.5), m.travertine);
    step.position.set(
      COURT_SOUTH.x,
      PLATFORM_H - (i + 0.5) * (PLATFORM_H / 6),
      COURT_SOUTH.z + COURT_SOUTH.d / 2 + 0.25 + i * 0.5,
    );
    add(step, true);
  }

  // 中庭与东庭：铺洞石；中庭下沉 0.5
  const atrium = new THREE.Mesh(
    new THREE.BoxGeometry(COURT_ATRIUM.w, COURT_SUNKEN, COURT_ATRIUM.d),
    m.travertine,
  );
  atrium.position.set(COURT_ATRIUM.x, PLATFORM_H - COURT_SUNKEN / 2, COURT_ATRIUM.z);
  add(atrium, true);

  const east = new THREE.Mesh(
    new THREE.BoxGeometry(COURT_EAST.w, COURT_SUNKEN, COURT_EAST.d),
    m.travertine,
  );
  east.position.set(COURT_EAST.x, PLATFORM_H - COURT_SUNKEN / 2, COURT_EAST.z);
  add(east, true);

  // 两座喷泉：basin + 水面 + 水柱 —— 各两座，但每座体量够大，保留单独 draw
  for (const fountain of FOUNTAINS) {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.28, 24), m.travertine);
    basin.position.set(fountain.x, PLATFORM_H - COURT_SUNKEN + 0.14, fountain.z);
    add(basin, true);

    const surface = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.06, 24), m.water);
    surface.position.set(fountain.x, PLATFORM_H - COURT_SUNKEN + 0.3, fountain.z);
    add(surface);

    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, 0.55, 8), m.water);
    jet.position.set(fountain.x, PLATFORM_H - COURT_SUNKEN + 0.55, fountain.z);
    add(jet);
  }

  // 南侧下沉台阶：通向南庭院（6 步，instanced）
  const stepGeo = new THREE.BoxGeometry(6.1, PLATFORM_H / 6, 0.5);
  disposables.push(stepGeo);
  const steps = new THREE.InstancedMesh(stepGeo, m.travertine, 6);
  steps.castShadow = true;
  steps.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 6; i += 1) {
    pos.set(
      COURT_SOUTH.x,
      PLATFORM_H - (i + 0.5) * (PLATFORM_H / 6),
      COURT_SOUTH.z + COURT_SOUTH.d / 2 + 0.25 + i * 0.5,
    );
    steps.setMatrixAt(i, matrix.compose(pos, quat, scale));
  }
  steps.instanceMatrix.needsUpdate = true;
  group.add(steps);
  disposables.push(steps);

  // 收集所有树：树干 + 树冠一起上 InstancedMesh
  type treeSpec = { x: number; z: number; h: number; crownR: number };
  const trees: treeSpec[] = [];
  for (const tree of COURT_TREES) {
    trees.push({ x: COURT_NORTH.x + tree.x, z: COURT_NORTH.z + tree.z, h: tree.h, crownR: 1.6 });
  }
  for (const rowX of ALLEE.rows) {
    for (let i = 0; i < ALLEE.count; i += 1) {
      const z = ALLEE.centerZ + (i - (ALLEE.count - 1) / 2) * ALLEE.spacing;
      trees.push({ x: rowX, z, h: ALLEE.height, crownR: ALLEE.crownR });
    }
  }

  if (trees.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.17, 1, 8);
    disposables.push(trunkGeo);
    const crownsGeo = new THREE.SphereGeometry(1, 12, 8);
    disposables.push(crownsGeo);
    const trunks = new THREE.InstancedMesh(trunkGeo, m.bark, trees.length);
    const crowns = new THREE.InstancedMesh(crownsGeo, m.foliage, trees.length);
    trunks.castShadow = true;
    crowns.castShadow = true;
    trees.forEach((tree, i) => {
      trunks.setMatrixAt(
        i,
        matrix.compose(
          pos.set(tree.x, PLATFORM_H + (tree.h * 0.55) / 2, tree.z),
          quat,
          scale.set(1, tree.h * 0.55, 1),
        ),
      );
      crowns.setMatrixAt(
        i,
        matrix.compose(
          pos.set(tree.x, PLATFORM_H + tree.h * 0.55 + tree.crownR * 0.55, tree.z),
          quat,
          scale.set(tree.crownR, tree.crownR, tree.crownR),
        ),
      );
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    group.add(trunks, crowns);
    disposables.push(trunks, crowns);
  }

  // 北庭院草坪（一片）
  const northLawn = new THREE.Mesh(
    new THREE.BoxGeometry(COURT_NORTH.w, 0.12, COURT_NORTH.d),
    m.grass,
  );
  northLawn.position.set(COURT_NORTH.x, PLATFORM_H - 0.06, COURT_NORTH.z);
  add(northLawn);

  // 南庭院：下沉草剧场 + 三块玄武岩
  const southLawn = new THREE.Mesh(
    new THREE.BoxGeometry(COURT_SOUTH.w, 0.4, COURT_SOUTH.d),
    m.grass,
  );
  southLawn.position.set(COURT_SOUTH.x, PLATFORM_H - COURT_SUNKEN / 2 - 0.1, COURT_SOUTH.z);
  add(southLawn);
  for (const rock of BASALTS) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(rock.w, rock.h, rock.d), m.basalt);
    block.position.set(
      COURT_SOUTH.x + rock.x,
      PLATFORM_H - COURT_SUNKEN + rock.h / 2,
      COURT_SOUTH.z + rock.z,
    );
    block.rotation.y = rock.x * 0.5;
    add(block, true);
  }

  // 树廊两侧的长条浅水池
  for (const pool of POOLS) {
    const basin = new THREE.Mesh(new THREE.BoxGeometry(pool.w, 0.35, pool.d), m.travertine);
    basin.position.set(pool.x, PLATFORM_H - 0.175, pool.z);
    add(basin, true);

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(pool.w - 0.24, pool.d - 0.24),
      m.water,
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(pool.x, PLATFORM_H - 0.04, pool.z);
    add(surface);
  }

  // 南北两侧的女儿墙
  for (const side of [-1, 1] as (-1 | 1)[]) {
    const parapet = new THREE.Mesh(
      new THREE.BoxGeometry(BUILDING_X.max - BUILDING_X.min, 0.5, 0.3),
      m.travertine,
    );
    parapet.position.set(
      (BUILDING_X.min + BUILDING_X.max) / 2,
      PLATFORM_H + 0.25,
      side === -1 ? BUILDING_Z.min - WALL_T - 0.15 : BUILDING_Z.max + WALL_T + 0.15,
    );
    add(parapet, true);
  }
}


/**
 * 把拱壳的两半合成一个几何，并分两个材质组：
 * 0 = 内表面（清水混凝土），1 = 外表面（铅铜屋面）。
 * loftShell 先写满内表面、再写满外表面，所以各占一半索引 —— 前提是 halves
 * 的三角形数相同（天窗缝居中，两半对称成立）。
 */
function mergeShells(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const groupSizes: number[] = [];

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex();
    const base = positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    const inner = index ? index.count / 2 : 0; // 前半是内表面
    groupSizes.push(inner);
    if (index) for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + base);
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);

  // 各半的内表面合成组 0，外表面合成组 1
  const innerTotal = groupSizes.reduce((a, b) => a + b, 0);
  merged.addGroup(0, innerTotal, 0);
  merged.addGroup(innerTotal, indices.length - innerTotal, 1);
  merged.computeBoundingSphere();
  return merged;
}

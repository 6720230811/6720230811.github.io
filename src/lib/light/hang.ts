/**
 * 挂画系统：建筑给出「墙」，画由数据层提供。
 *
 * 每拱南北两侧的填充墙内立面上预置挂画位网格：
 * - 每段墙净长 29.9 m，横向 6 个挂位，间距 4.6 m，整组在段内居中
 * - 纵向单行，挂画中心线距室内地面 1.55 m（成人视高）
 * - 每拱两端的山墙不设挂画位
 * 20 段 × 6 = 120 个挂位；墙上留白的那部分是洞石中性背景。
 *
 * 三种构件都上 InstancedMesh，120 个挂位只占少数 draw call：
 * - 画框与卡纸整场各一份 InstancedMesh
 * - 画心按展品分组（同一件重复），每个展品一份 InstancedMesh + 独立材质
 */
import * as THREE from 'three';
import { HANG_COUNT, HANG_STEP, HANG_Y, WALL_SEG_LEN, WALL_T, WALL_SEGMENTS } from './layout';

/** 页面传进来的展品 */
export interface HangItem {
  id: string;
  thumb: string;
  src: string;
  w: number | null;
  h: number | null;
}

export interface Hanging {
  group: THREE.Group;
  /** 画心网格，按展品 id 换纹理（同一件可能挂在多个挂位上） */
  pictures: Map<string, THREE.InstancedMesh>;
  /** 画框（拾取目标），userData.id = 展品 id */
  pickables: THREE.Object3D[];
  /** 挂位总数（自检用） */
  slots: number;
  setPicture(id: string, texture: THREE.Texture, aspect: number | null): void;
  setHover(id: string | null): void;
  dispose(): void;
}

/** 卡纸（画心四周留白）宽度 */
const MAT_W = 0.07;
const FRAME_LIP = 0.03;
const FRAME_DEPTH = 0.05;
/** 画心的长边（米）：挂画带 1.55 ± 0.75 之内，不与墙顶收口缝打架 */
const ART_LONG = 1.3;

export function buildHanging(items: readonly HangItem[]): Hanging {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const placeholderData = new Uint8Array([214, 208, 196, 255]);
  const placeholder = new THREE.DataTexture(placeholderData, 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.needsUpdate = true;
  track(placeholder);

  /** 画框与卡纸是同一种材质整场共享；每个展品自己的画心材质带纹理 */
  const frameMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#2A2622', roughness: 0.45, metalness: 0.3 }),
  );
  const matMaterial = track(
    new THREE.MeshStandardMaterial({ color: '#F1EDE4', roughness: 0.9 }),
  );

  const unitPlane = track(new THREE.PlaneGeometry(1, 1));
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));

  /** 每个挂位的中心（室内坐标），按段分组 */
  const slots: { x: number; y: number; z: number; ry: number; itemId: string }[] = [];
  for (const segment of WALL_SEGMENTS) {
    const startX =
      segment.vault.x - WALL_SEG_LEN / 2 +
      (WALL_SEG_LEN - (HANG_COUNT - 1) * HANG_STEP) / 2;
    for (let i = 0; i < HANG_COUNT; i += 1) {
      const index = slots.length;
      const item = items.length > 0 ? items[index % items.length] : undefined;
      slots.push({
        x: startX + i * HANG_STEP,
        y: HANG_Y,
        z: segment.z + segment.normal * (WALL_T / 2 + 0.02),
        ry: segment.normal === 1 ? 0 : Math.PI,
        itemId: item?.id ?? '',
      });
    }
  }

  const pictures = new Map<string, THREE.InstancedMesh>();
  const pickables: THREE.Object3D[] = [];
  const boxes = new Map<string, { w: number; h: number }>();

  if (items.length > 0) {
    // 按展品分组：同一件重复挂在多个位置时，画心共享纹理
    const byItem = new Map<string, typeof slots>();
    slots.forEach((slot) => {
      const list = byItem.get(slot.itemId) ?? [];
      list.push(slot);
      byItem.set(slot.itemId, list);
    });

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);

    for (const item of items) {
      const list = byItem.get(item.id);
      if (!list || list.length === 0) continue;
      const aspect = item.w && item.h ? item.w / item.h : 3 / 2;
      const box = fitArt(ART_LONG, aspect);
      boxes.set(item.id, box);

      const pictureMaterial = track(
        new THREE.MeshBasicMaterial({
          map: placeholder,
          toneMapped: false,
          fog: false,
        }),
      );
      const picture = new THREE.InstancedMesh(unitPlane, pictureMaterial, list.length) as THREE.InstancedMesh;
      picture.castShadow = false;
      pictures.set(item.id, picture);
      group.add(picture);

      for (let i = 0; i < list.length; i += 1) {
        const slot = list[i];
        pos.set(slot.x, slot.y, slot.z);
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, slot.ry, 0));
        picture.setMatrixAt(i, matrix.compose(pos, rotation, scale.set(box.w, box.h, 1)));
      }
      picture.instanceMatrix.needsUpdate = true;
    }

    // 所有画框 + 所有卡纸 = 各一份 InstancedMesh
    const frames = new THREE.InstancedMesh(unitBox, frameMaterial, slots.length);
    const mats = new THREE.InstancedMesh(unitPlane, matMaterial, slots.length);
    frames.castShadow = true;
    frames.receiveShadow = true;
    mats.receiveShadow = true;
    pickables.push(frames);
    slots.forEach((slot, index) => {
      const box = boxes.get(slot.itemId) ?? { w: ART_LONG, h: ART_LONG / 1.5 };
      const outerW = box.w + MAT_W * 2;
      const outerH = box.h + MAT_W * 2;

      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, slot.ry, 0));
      frames.setMatrixAt(
        index,
        matrix.compose(
          pos.set(slot.x, slot.y, slot.z),
          rotation,
          scale.set(outerW, outerH, FRAME_DEPTH),
        ),
      );
      mats.setMatrixAt(
        index,
        matrix.compose(
          pos.set(slot.x, slot.y, slot.z + FRAME_DEPTH / 2 + 0.001),
          rotation,
          scale.set(outerW - FRAME_LIP * 2, outerH - FRAME_LIP * 2, 1),
        ),
      );
    });
    frames.instanceMatrix.needsUpdate = true;
    mats.instanceMatrix.needsUpdate = true;
    group.add(frames, mats);
  }

  return {
    group,
    pictures,
    pickables,
    slots: slots.length,
    setPicture(id, texture, aspect) {
      const picture = pictures.get(id);
      if (!picture) return;
      const box = aspect ? fitArt(ART_LONG, aspect) : boxes.get(id);
      if (!box) return;
      const material = picture.material as THREE.MeshBasicMaterial;
      const previous = material.map;
      material.map = texture;
      material.needsUpdate = true;
      boxes.set(id, box);
      const matrix = new THREE.Matrix4();
      const tmp = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      for (let i = 0; i < picture.count; i += 1) {
        picture.getMatrixAt(i, matrix);
        matrix.decompose(tmp, q, s);
        s.set(box.w, box.h, 1);
        matrix.compose(tmp, q, s);
        picture.setMatrixAt(i, matrix);
      }
      picture.instanceMatrix.needsUpdate = true;
      if (previous && previous !== placeholder) previous.dispose();
    },
    setHover(id) {
      frameMaterial.emissive.setHex(id ? 0x3A2F1C : 0x000000);
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}

/** 按长边与比例求画心尺寸 */
function fitArt(long: number, aspect: number): { w: number; h: number } {
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}
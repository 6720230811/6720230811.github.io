/**
 * 构建期读图片尺寸：只解析文件头，不解码像素。
 *
 * 为什么要自己写：合集走「目录约定 + 构建期扫描」，往目录里丢一张图就该自动
 * 出现在页面上 —— 如果尺寸要人手填进 meta.json，那「丢进去就行」就是空话。
 * 而画框比例、拼贴的 aspect-ratio、避免 CLS 的 width/height 都依赖真实尺寸。
 *
 * 为什么不用 sharp / image-size：本仓没有这两个依赖，为读 8 个字节装一个原生
 * 模块（sharp 还要带平台二进制）不划算。四种格式的头部解析加起来不到 100 行，
 * 且都是规范里写死的固定字段。
 *
 * 只读文件前 256KB：JPEG 的 SOF 段偶尔会排在很大的 EXIF / ICC 后面，
 * 头部读不到时再整份读一次兜底（见 sizeOf）。
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs';

const HEAD_BYTES = 1 << 18; // 256KB

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number): number =>
  b[i]! * 0x1000000 + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number): number =>
  b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

const tag = (b: Uint8Array, i: number, s: string): boolean => {
  for (let k = 0; k < s.length; k += 1) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
};

/** JPEG：跳段找 SOF（C0–CF，去掉 DHT/JPG/DAC 三个同区段） */
function jpeg(b: Uint8Array): Size | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1; // 容错：填充字节或错位，往前挪一格继续找
      continue;
    }
    const marker = b[i + 1]!;
    // 无长度字段的标记：SOI / TEM / RSTn
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOF：段长(2) 精度(1) 高(2) 宽(2)
      return { h: u16be(b, i + 5), w: u16be(b, i + 7) };
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

/** PNG：8 字节签名后就是 IHDR */
function png(b: Uint8Array): Size | null {
  if (!tag(b, 0, '\x89PNG\r\n\x1a\n')) return null;
  return { w: u32be(b, 16), h: u32be(b, 20) };
}

/** GIF：逻辑屏幕描述符里的宽高，小端 */
function gif(b: Uint8Array): Size | null {
  if (!tag(b, 0, 'GIF8')) return null;
  return { w: u16le(b, 6), h: u16le(b, 8) };
}

/**
 * WebP 三种块：
 * - VP8X（扩展，canvas 尺寸 24 位、存的是「减一」）
 * - VP8（有损，帧头里 14 位宽高）
 * - VP8L（无损，位打包，宽高各 14 位）
 */
function webp(b: Uint8Array): Size | null {
  if (!tag(b, 0, 'RIFF') || !tag(b, 8, 'WEBP')) return null;
  if (tag(b, 12, 'VP8X')) {
    return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  }
  if (tag(b, 12, 'VP8 ')) {
    // 20 起是块数据：3 字节 tag + 3 字节同步码，然后宽(2) 高(2)
    return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  }
  if (tag(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null; // 无损帧头签名
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export interface Size {
  w: number;
  h: number;
}

/** 认不出来的格式返回 null（调用方按 3:2 兜底） */
export function parseSize(bytes: Uint8Array): Size | null {
  const size = jpeg(bytes) ?? png(bytes) ?? gif(bytes) ?? webp(bytes);
  if (!size || !size.w || !size.h) return null;
  return size;
}

/** 头部够不够判断：格式签名 + 关键字段都落在前若干字节里 */
function probe(bytes: Uint8Array): Size | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  return png(bytes) ?? gif(bytes) ?? webp(bytes);
}

/** 读文件头；JPEG 的 SOF 靠后时整份再读一次 */
export function sizeOf(file: string): Size | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const head = new Uint8Array(HEAD_BYTES);
    const read = readSync(fd, head, 0, HEAD_BYTES, 0);
    const trimmed = head.subarray(0, read);
    const fast = probe(trimmed);
    if (fast) return fast;

    // 头 256KB 里没有：多半是超大 EXIF 的 JPEG，整份读一次
    const total = statSync(file).size;
    if (total <= read) return null;
    const whole = new Uint8Array(total);
    readSync(fd, whole, 0, total, 0);
    return parseSize(whole);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

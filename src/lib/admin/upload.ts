import { setStatus } from './dom';
import { repo, paths } from '../../data/admin';
import { saveBinaryFile, statFile, GhError, type Repo } from './github';
import { toSlug } from './serialize';
import { requireToken } from './token';
import { registerLocalImage } from './postview';
import { insertAtCaret, replaceOnce } from './toolbar';

/**
 * 配图上传：把图片直接拖进正文（或 Ctrl/Cmd+V 粘贴）就写进仓库。
 *
 * 顺序改过一次：以前是「先上传成功、再插入 Markdown」，大图要转好几秒，
 * 那几秒里光标像是卡住了。现在先就地插一个 ![上传中...](loading) 占位，
 * 压缩上传结束后静默替换成真实地址，写作者不用等。
 */

/** 压缩后的最长边：上传前压到这个尺寸，仓库和流量都小得多 */
const MAX_EDGE = 1600;
/** 单张上限（压缩之后的大小） */
const MAX_BYTES = 5 * 1024 * 1024;
/** 重名后缀最多试这么多次 */
const MAX_TRIES = 50;

/** 上传途中插在正文里的占位：上传完成后会被原样替换掉 */
export const PLACEHOLDER = '![上传中...](loading)';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** 动图与矢量图不压：GIF 压成 WebP 会丢动画，SVG 走 canvas 没有意义 */
const KEEP_AS_IS = new Set(['image/gif', 'image/svg+xml']);

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** 人话体积：140KB / 1.2MB */
export function humanSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1048576).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 压到长边 MAX_EDGE 并转 WebP；压不了（老浏览器 / 动图 / 矢量图）就原样返回 */
export async function compressToWebp(file: File): Promise<{ blob: Blob; ext: string }> {
  const ext = MIME_EXT[file.type] ?? 'png';
  if (KEEP_AS_IS.has(file.type)) return { blob: file, ext };

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const webp = await toBlob(canvas, 'image/webp', 0.85);
    if (webp) return { blob: webp, ext: 'webp' };
  } catch {
    // 解码失败就按原样传，交给 GitHub 去拒
  }
  return { blob: file, ext };
}

/** 一次 statFile 同时做「查重」和「取 sha」，不浪费请求 */
async function nextFreePath(token: string, stem: string, ext: string): Promise<string> {
  for (let n = 1; n <= MAX_TRIES; n += 1) {
    const name = n === 1 ? `${stem}.${ext}` : `${stem}-${n}.${ext}`;
    const path = paths.illustration(name);
    if (!(await statFile(repo as Repo, path, token))) return path;
  }
  throw new Error('同名文件太多了，换个 slug 或先清理一下 illustrations 目录。');
}

/** 返回插入正文用的站内地址（public/illustrations/x.webp → /illustrations/x.webp） */
export function siteUrl(repoPath: string): string {
  return `/${repoPath.replace(/^public\//, '')}`;
}

/** 上传单张：压缩 → 写仓库 → 返回站内地址；失败返回 null（错误已经提示过） */
export async function uploadOne(file: File, base: string): Promise<string | null> {
  const token = requireToken();
  if (!token) return null;

  try {
    const { blob, ext } = await compressToWebp(file);
    if (blob.size > MAX_BYTES) {
      setStatus(
        `${file.name} 压完还有 ${humanSize(blob.size)}，超过 5MB 上限，先自己压缩一下。`,
        'error'
      );
      return null;
    }

    const stem = `${toSlug(base) || 'image'}-${stamp()}`;
    const path = await nextFreePath(token, stem, ext);
    setStatus(`正在上传 ${path}…`, 'busy');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await saveBinaryFile(repo as Repo, path, token, bytes, `add image: ${path}`);

    // 站点上要等 Actions 部署完才有这张图，先拿 blob URL 顶上，预览里立刻能看到
    const url = siteUrl(path);
    registerLocalImage(url, URL.createObjectURL(blob));
    return url;
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : `上传失败：${(e as Error).message}`, 'error');
    return null;
  }
}

export async function uploadImages(files: readonly File[], base: string): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      setStatus(`${file.name || '这个文件'} 不是图片，已跳过。`, 'error');
      continue;
    }
    const url = await uploadOne(file, base);
    if (url) urls.push(url);
  }
  if (urls.length) {
    setStatus(`已上传 ${urls.length} 张图，Actions 大约 1 分钟后线上生效。`, 'ok');
  }
  return urls;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * 全局兜底：把文件拖到编辑区之外的地方松手，浏览器会直接打开这个文件 ——
 * 正在写的正文就没了。这里一律拦掉（编辑区内部另有自己的处理）。
 */
export function initDropGuard(): void {
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
}

/** 粘贴与拖入：先插占位，上传完成后静默替换成真实地址 */
export function initImageDrop(
  ta: HTMLTextAreaElement,
  base: () => string,
  zone?: HTMLElement
): void {
  const dropZone = zone ?? ta;

  const handle = (files: readonly File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;

    insertAtCaret(ta, `\n\n${images.map(() => PLACEHOLDER).join('\n\n')}\n\n`);
    void (async () => {
      for (const file of images) {
        const url = await uploadOne(file, base());
        // 哪个占位先被替换无所谓，反正数量对得上，失败的那张留一行注释说明
        replaceOnce(ta, PLACEHOLDER, url ? `![](${url})` : `<!-- 上传失败：${file.name} -->`);
      }
    })();
  };

  ta.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.some((f) => f.type.startsWith('image/'))) return; // 普通文本照常粘贴
    // 不拦的话浏览器会把文件名或路径当成文本粘进正文
    e.preventDefault();
    handle(files);
  });

  ta.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('is-dropping');
  });
  ta.addEventListener('dragleave', () => dropZone.classList.remove('is-dropping'));
  ta.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    dropZone.classList.remove('is-dropping');
    if (!files.length) return;
    e.preventDefault();
    handle(files);
  });
}

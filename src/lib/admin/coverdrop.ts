import { setStatus } from './dom';
import { compressToWebp, humanSize, uploadOne } from './upload';

/**
 * 封面上传卡片：点击选文件、拖拽进卡片、或直接填外链地址。
 *
 * 本地图走的是「先压后传」：Canvas 压到长边 1600px 转 WebP，
 * 压缩一结束就把缩略图和「已压缩至 WebP (140KB)」的角标显示出来，
 * 让人在等上传的那几秒里知道图是对的、压到多小了。
 */

export interface CoverDrop {
  /** 地址变了（手填或上传完成）用它刷新缩略图 */
  refresh: () => void;
}

export function initCoverDrop(o: {
  zone: HTMLElement;
  file: HTMLInputElement;
  thumb: HTMLImageElement;
  badge: HTMLElement;
  url: HTMLInputElement;
  hint: HTMLElement;
  onChange: () => void;
  emptyHint: () => string;
}): CoverDrop {
  /** 站内地址 → 本地 blob URL：刚传的图还没部署，缩略图先用本地的 */
  const local = new Map<string, string>();

  function refresh(): void {
    const raw = o.url.value.trim();
    if (!raw) {
      o.thumb.hidden = true;
      o.thumb.removeAttribute('src');
      o.badge.hidden = true;
      const empty = o.emptyHint();
      o.hint.hidden = !empty;
      o.hint.className = 'cover__hint';
      o.hint.textContent = empty;
      return;
    }
    o.hint.hidden = true;
    o.thumb.hidden = false;
    o.thumb.src = local.get(raw) ?? raw;
  }

  async function take(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      setStatus(`${file.name || '这个文件'} 不是图片。`, 'error');
      return;
    }

    const { blob, ext } = await compressToWebp(file);
    // 压缩完立刻给反馈：缩略图 + 角标，上传在后面继续跑
    o.thumb.hidden = false;
    o.thumb.src = URL.createObjectURL(blob);
    o.badge.hidden = false;
    o.badge.textContent =
      ext === 'webp'
        ? `已压缩至 WebP（${humanSize(blob.size)}）`
        : `原样上传 ${ext.toUpperCase()}（${humanSize(blob.size)}）`;

    // uploadOne 收的是 File：把压缩后的 Blob 包成一个同名 File，出错时提示里才认得出是哪张图
    const packed = new File([blob], file.name.replace(/\.\w+$/, '') + '.' + ext, {
      type: blob.type,
    });
    const url = await uploadOne(packed, o.url.value.trim() || 'cover');
    if (!url) {
      o.badge.textContent = '上传失败，地址没变';
      return;
    }
    local.set(url, o.thumb.src);
    o.url.value = url;
    refresh();
    o.onChange();
  }

  o.zone.addEventListener('click', () => o.file.click());
  o.file.addEventListener('change', () => {
    const file = o.file.files?.[0];
    if (file) void take(file);
    o.file.value = '';
  });

  const stop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  o.zone.addEventListener('dragover', (e) => {
    stop(e);
    o.zone.classList.add('is-dropping');
  });
  o.zone.addEventListener('dragleave', (e) => {
    stop(e);
    o.zone.classList.remove('is-dropping');
  });
  o.zone.addEventListener('drop', (e) => {
    stop(e);
    o.zone.classList.remove('is-dropping');
    const file = e.dataTransfer?.files?.[0];
    if (file) void take(file);
  });

  o.url.addEventListener('input', () => {
    o.badge.hidden = true;
    refresh();
    o.onChange();
  });
  o.thumb.addEventListener('error', () => {
    o.hint.hidden = false;
    o.hint.className = 'cover__hint cover__hint--warn';
    o.hint.textContent = '封面加载不出来：检查地址；刚上传的图要等 Actions 部署完才在线。';
  });

  return { refresh };
}

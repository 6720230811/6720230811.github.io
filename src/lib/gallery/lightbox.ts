/**
 * 网格模式的灯箱。
 *
 * 用原生 <dialog>：焦点陷阱、Esc 关闭、::backdrop 都是白送的；这里只负责
 * 把每块 .gal-tile 上的 data-* 搬到灯箱里，外加左右翻页。
 * 网格本身是服务端渲染的，禁用 JS 时这些按钮点不出灯箱，但图片照样看得见。
 */
export function initGridLightbox(): void {
  const dialogEl = document.getElementById('gal-lightbox') as HTMLDialogElement | null;
  const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('.gal-tile'));
  if (!dialogEl || tiles.length === 0) return;
  // 闭包里要用，先收成非空常量：TS 的 narrowing 进不了闭包
  const dialog: HTMLDialogElement = dialogEl;

  const image = dialog.querySelector<HTMLImageElement>('#gal-lb-img');
  const titleEl = dialog.querySelector<HTMLElement>('#gal-lb-title');
  const descEl = dialog.querySelector<HTMLElement>('#gal-lb-desc');
  const metaEl = dialog.querySelector<HTMLElement>('#gal-lb-meta');
  const cameraLabel = dialog.dataset.labelCamera ?? '';

  let current = -1;

  function show(index: number): void {
    const tile = tiles[index];
    if (!tile) return;
    current = index;

    if (image) {
      image.src = tile.dataset.src ?? '';
      image.alt = tile.dataset.title ?? '';
    }
    if (titleEl) titleEl.textContent = tile.dataset.title ?? '';
    if (descEl) descEl.textContent = tile.dataset.desc ?? '';
    if (metaEl) {
      const camera = tile.dataset.camera ?? '';
      metaEl.textContent = camera && cameraLabel ? `${cameraLabel}：${camera}` : '';
    }
  }

  function open(index: number): void {
    show(index);
    if (!dialog.open) dialog.showModal();
  }

  function step(delta: number): void {
    if (current < 0) return;
    show((current + delta + tiles.length) % tiles.length);
  }

  tiles.forEach((tile, index) => {
    tile.addEventListener('click', () => open(index));
  });

  dialog.querySelector('#gal-lb-prev')?.addEventListener('click', () => step(-1));
  dialog.querySelector('#gal-lb-next')?.addEventListener('click', () => step(1));
  dialog.querySelector('#gal-lb-close')?.addEventListener('click', () => dialog.close());

  // 点在灯箱内容以外的区域（也就是 ::backdrop 上）关闭
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  });

  dialog.addEventListener('close', () => {
    current = -1;
  });
}

/**
 * 网格模式的灯箱。
 *
 * 用原生 <dialog>：焦点陷阱、Esc 关闭、::backdrop 都是白送的；这里只负责
 * 把每块 .gal-tile 上的 data-* 搬到灯箱里，外加左右翻页。
 * 网格本身是服务端渲染的，禁用 JS 时这些按钮点不出灯箱，但图片照样看得见。
 */
export function initGridLightbox(): void {
  const dialogEl = document.getElementById('gal-lightbox') as HTMLDialogElement | null;
  if (!dialogEl) return;

  /*
    哪一批按钮算「一册」由灯箱自己说了算（data-tiles）：
    网格是 .gal-tile，合集详情页的照片流是 .gal-plate__tile。
    写死在选择器里的话，详情页要么点不开灯箱、要么把 3D 网格的按钮一起算进来。
    为什么走 data 属性而不是组件 prop：Astro 的 <script> 是提升出去的，
    读不到组件 props，只能借 DOM 传一次。
  */
  const selector = dialogEl.dataset.tiles || '.gal-tile';
  const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
  if (tiles.length === 0) return;

  /*
    接过一次的别再接（watchGridLightbox 会在首屏先后调两次）。
    接两遍不是「多一次无用调用」：一次点击开两回灯箱，第二回 showModal() 直接抛
    InvalidStateError；而且两份独立的 current 索引，翻页会各翻各的。
    标记打在 <dialog> 上 —— 它每换一页都是新节点，换页后自然会重接一次。
    注意标记只能打在「瓦片检查之后」：换页途中 #gal-lightbox 可能先于正文出现。
  */
  if (dialogEl.dataset.lbBound === '1') return;
  dialogEl.dataset.lbBound = '1';

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

/**
 * 换页之后重新接一次灯箱 —— 与 lib/gallery/index.ts 的 mountGalleryHall 同一条理由：
 * <script> 是模块，一次会话只求值一次，换页后新 DOM 里的 #gal-lightbox 就没人接了
 * （症状：从索引点进合集，点照片没反应）。
 *
 * 每页都调用一次没有成本：页面上没有 #gal-lightbox 时，initGridLightbox 第一行就返回。
 */
export function watchGridLightbox(): void {
  const boot = (): void => initGridLightbox();

  const win = window as Window & { __galLbBound?: true };
  if (!win.__galLbBound) {
    win.__galLbBound = true;
    document.addEventListener('astro:page-load', boot);
  }
  boot();
}

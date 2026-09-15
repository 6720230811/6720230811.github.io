/**
 * 画廊各页的「目录 ↔ 正文」联动。
 *
 * 只有一件事：**目录那一行 ↔ 正文里对应的那一块，互相点亮**。
 * 点亮的同时给容器挂上 `is-dimming`，没被点到的那些退到半透明 ——
 * 那一下「聚光」就是这套版面的语言，也是把它从「一堆缩略图」里拉出来的东西。
 *
 * 约定全部走 data 属性（不认类名），所以封面页与详情页共用同一份实现：
 *   [data-gal-dim]       —— 压暗的容器；挂了它才「其余退后半步」
 *   [data-gal-block=id]  —— 正文里的一块（一本封面 / 一张照片）
 *   [data-gal-jump=id]   —— 目录那一行
 *   [data-gal-open]      —— 块里可点的那个按钮；有它，点目录行就转发到这里
 *
 * 绑定方式按本仓既有约定（见 Search.astro 的长注释）：
 * 把「撤掉本实例」的句柄挂到 window 上，新实例进来先调旧的。
 * 因为首屏「脚本执行 + astro:page-load」会跑两遍，而换页之后又是另一份实例、
 * 另一套闭包 —— 光靠「每份实例撤自己」挡不住跨实例叠加。叠起来的后果不是
 * 「多一次无用调用」，而是功能坏掉（见 Navbar 汉堡按钮踩过的坑）。
 */
type StudioWindow = Window & { __galStudioCleanup?: null | (() => void) };

export function initGalleryStudio(): void {
  const win = window as StudioWindow;
  win.__galStudioCleanup?.();

  let cleanup = () => {};
  win.__galStudioCleanup = () => cleanup();

  const init = (): void => {
    cleanup();
    const ac = new AbortController();
    cleanup = () => ac.abort();
    const { signal } = ac;

    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-gal-block]'));
    if (blocks.length === 0) return;

    const rail = document.querySelector<HTMLElement>('[data-gal-dir]');
    const rows = rail
      ? Array.from(rail.querySelectorAll<HTMLAnchorElement>('[data-gal-jump]'))
      : [];

    const blockById = new Map<string, HTMLElement>();
    const dims = new Set<HTMLElement>();
    for (const block of blocks) {
      const id = block.dataset.galBlock;
      if (id) blockById.set(id, block);
      const dim = block.closest<HTMLElement>('[data-gal-dim]');
      if (dim) dims.add(dim);
    }

    /** id 为空 = 全部熄灯 */
    const lit = (id: string | null): void => {
      for (const dim of dims) dim.classList.toggle('is-dimming', Boolean(id));
      for (const block of blocks) {
        block.classList.toggle('is-lit', Boolean(id) && block.dataset.galBlock === id);
      }
      for (const row of rows) {
        row.classList.toggle('is-lit', Boolean(id) && row.dataset.galJump === id);
      }
    };

    const bindLit = (el: HTMLElement, id: string | undefined): void => {
      if (!id) return;
      el.addEventListener('pointerenter', () => lit(id), { signal });
      el.addEventListener('focus', () => lit(id), { signal });
      el.addEventListener('pointerleave', () => lit(null), { signal });
      el.addEventListener('blur', () => lit(null), { signal });
    };

    for (const row of rows) bindLit(row, row.dataset.galJump);
    for (const block of blocks) bindLit(block, block.dataset.galBlock);

    /*
      目录那一行点下去，如果对应的块里有可点的按钮（详情页：开灯箱），
      就转发过去而不是跳到锚点 —— 一页照片里跳锚点几乎等于没动。
      但那一行渲染成 <a>（封面页：真链接，直接进合集；详情页：无 JS 时的锚点兜底），
      所以**只在块里真有 [data-gal-open] 时**才 preventDefault。
    */
    for (const row of rows) {
      const id = row.dataset.galJump;
      if (!id) continue;
      row.addEventListener(
        'click',
        (event) => {
          const opener = blockById.get(id)?.querySelector<HTMLButtonElement>('[data-gal-open]');
          if (!opener) return;
          event.preventDefault();
          // 灯箱自己的 click 监听挂在按钮上，转发过去即可
          opener.click();
        },
        { signal }
      );
    }

    // 重绑完再登记「下次换页继续重绑」。挂在同一个 controller 上，
    // 下一次 init 一 abort 就把它连同其它监听一起换掉 —— 恒为恰好一套。
    document.addEventListener('astro:page-load', init, { signal });
  };

  init();
}

/**
 * 未保存改动的提醒。
 *
 * beforeunload 只在用户和页面交互过之后才会弹，弹框文案由浏览器定，改不了；
 * 而且它管不到「站内点链接」这类不卸载文档的跳转，所以顶栏的外链要单独拦一次。
 */

let dirty = false;

export function markDirty(): void {
  dirty = true;
}

export function markClean(): void {
  dirty = false;
}

export function isDirty(): boolean {
  return dirty;
}

export function initUnsavedGuard(leaveText: string): void {
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    // Chrome 要求设置这个 legacy 字段才会真的弹确认框
    e.returnValue = '';
  });

  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('.admin-top__link'))) {
    link.addEventListener('click', (e) => {
      if (dirty && !window.confirm(leaveText)) e.preventDefault();
    });
  }
}

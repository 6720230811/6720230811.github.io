import { initMdToolbar } from './toolbar';
import type { Mirror } from './mirror';

/**
 * 悬浮格式浮岛：选中文字时浮在光标上方，省得把手移到顶上的工具栏。
 *
 * 位置靠影子层量出来（textarea 自己不给光标坐标）。
 * 关键细节：浮岛上的 mousedown 要 preventDefault，
 * 否则点按钮时 textarea 先失焦、选区没了，加粗就加到了空选区上。
 */

export function initBubble(
  ta: HTMLTextAreaElement,
  mirror: Mirror,
  host: HTMLElement,
  el: HTMLElement
): void {
  initMdToolbar(el, ta);
  el.addEventListener('mousedown', (e) => e.preventDefault());

  const hide = () => {
    el.hidden = true;
  };

  function place(): void {
    if (ta.selectionStart === ta.selectionEnd || document.activeElement !== ta) {
      hide();
      return;
    }

    mirror.sync();
    const at = mirror.rectAt(ta.selectionStart);
    if (!at) {
      hide();
      return;
    }

    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const top = Math.max(4, at.top - h - 8);
    const left = Math.min(Math.max(4, at.left - 6), Math.max(4, host.clientWidth - w - 6));
    el.style.transform = `translate(${left}px, ${top}px)`;
  }

  for (const evt of ['select', 'mouseup', 'keyup', 'scroll']) {
    ta.addEventListener(evt, place);
  }
  ta.addEventListener('input', hide);
  ta.addEventListener('blur', () => {
    // 等一拍：点浮岛按钮时也会先触发 blur，直接隐藏就点不到了
    window.setTimeout(() => {
      if (document.activeElement !== ta) hide();
    }, 150);
  });
  hide();
}

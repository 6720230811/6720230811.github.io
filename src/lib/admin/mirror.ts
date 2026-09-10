/**
 * textarea 的「影子层」。
 *
 * textarea 里没法直接问「第 37 行在哪个像素位置」「光标在第几个字的位置」，
 * 所以复制一份同样字体、同样宽度、同样换行的隐藏 DOM，靠它去量：
 * - 双向同步滚动要知道源码行 ↔ 像素的对应关系
 * - 悬浮格式浮岛要浮在选中文字正上方
 *
 * 只在内容或宽度变了的时候重建（rebuild），量的时候读 offsetTop / Range。
 */

export interface CaretRect {
  /** 相对 host 左上角的坐标（浮岛直接拿去定位） */
  top: number;
  left: number;
  height: number;
}

export class Mirror {
  private readonly el: HTMLDivElement;
  private readonly inner: HTMLDivElement;
  private lines: HTMLDivElement[] = [];
  private lengths: number[] = [];
  private value = '';
  private width = 0;
  /**
   * offsetTop 的基准：行号 → 像素要减掉它。
   * 影子层是 absolute 定位的，offsetTop 量的是到定位父级的距离，
   * 直接拿去当 scrollTop 会整体偏掉「textarea 上边距 + padding」这么多。
   */
  private base = 0;

  /** host：影子层与浮层的定位参照（必须是 textarea 的定位父级） */
  constructor(
    private readonly ta: HTMLTextAreaElement,
    private readonly host: HTMLElement
  ) {
    this.el = document.createElement('div');
    this.el.className = 'editor__mirror';
    this.el.setAttribute('aria-hidden', 'true');
    this.inner = document.createElement('div');
    this.el.append(this.inner);
    host.append(this.el);
    this.sync();
  }

  /** 内容或宽度变了才重建；位置与滚动每次都同步 */
  sync(): void {
    this.copyBox();
    if (this.ta.value !== this.value || this.ta.clientWidth !== this.width) {
      this.value = this.ta.value;
      this.width = this.ta.clientWidth;
      this.rebuild();
    }
    this.inner.style.transform = `translateY(${-this.ta.scrollTop}px)`;
  }

  private copyBox(): void {
    const cs = getComputedStyle(this.ta);
    const box = this.ta.getBoundingClientRect();
    const hostBox = this.host.getBoundingClientRect();
    Object.assign(this.el.style, {
      left: `${box.left - hostBox.left}px`,
      top: `${box.top - hostBox.top}px`,
      width: `${this.ta.clientWidth}px`,
      height: `${this.ta.clientHeight}px`,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      textIndent: cs.textIndent,
      textTransform: cs.textTransform,
      tabSize: cs.tabSize,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
    });
  }

  private rebuild(): void {
    const frag = document.createDocumentFragment();
    this.lines = [];
    this.lengths = [];
    for (const line of this.ta.value.split('\n')) {
      const div = document.createElement('div');
      // 空行也要占一行高度，塞一个零宽字符（纯空格在 pre-wrap 下也可能被折行吞掉）
      div.textContent = line || '\u200b';
      frag.append(div);
      this.lines.push(div);
      this.lengths.push(line.length + 1); // +1 是那个换行
    }
    this.inner.textContent = '';
    this.inner.append(frag);

    // 第一行的 offsetTop 减去 padding-top 就是「内容原点」
    const pad = parseFloat(getComputedStyle(this.ta).paddingTop) || 0;
    this.base = this.lines.length ? this.lines[0].offsetTop - pad : 0;
  }

  private top(i: number): number {
    return (this.lines[i]?.offsetTop ?? 0) - this.base;
  }

  /** 第 line 行相对内容顶部的像素位置（可以传小数，会插值） */
  lineTop(line: number): number {
    if (!this.lines.length) return 0;
    const i = Math.max(0, Math.min(this.lines.length - 1, Math.floor(line)));
    if (i + 1 >= this.lines.length) return this.top(i);
    return this.top(i) + (this.top(i + 1) - this.top(i)) * (line - i);
  }

  /** 滚动位置在第几行（带小数，用来做平滑同步） */
  lineAt(y: number): number {
    if (!this.lines.length) return 0;
    if (y <= this.top(0)) return 0;

    // 二分：找最后一个 top <= y 的行
    let lo = 0;
    let hi = this.lines.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.top(mid) <= y) lo = mid;
      else hi = mid - 1;
    }
    if (lo >= this.lines.length - 1) return lo;
    const span = this.top(lo + 1) - this.top(lo);
    return span > 0 ? lo + (y - this.top(lo)) / span : lo;
  }

  /** 第 index 个字符的坐标：浮岛定位用；量不到返回 null */
  rectAt(index: number): CaretRect | null {
    this.copyBox();
    const box = this.host.getBoundingClientRect();
    const { line, col } = this.locate(index);
    const node = this.lines[line]?.firstChild;
    if (!node) return null;

    const range = document.createRange();
    const at = Math.min(col, node.textContent?.length ?? 0);
    range.setStart(node, at);
    range.setEnd(node, at);

    const rect = range.getBoundingClientRect();
    const height = this.lines[line].offsetHeight || rect.height;
    // 零宽 Range 在行首时宽度是 0 但 top/left 仍可信；拿不到高度就退回行高
    return {
      top: rect.top - box.top,
      left: rect.left - box.left,
      height: height || parseFloat(getComputedStyle(this.ta).lineHeight) || 20,
    };
  }

  /** 字符下标 → 行号与列号 */
  private locate(index: number): { line: number; col: number } {
    let rest = Math.max(0, index);
    for (let i = 0; i < this.lengths.length; i += 1) {
      if (rest < this.lengths[i]) return { line: i, col: rest };
      rest -= this.lengths[i];
    }
    const last = this.lengths.length - 1;
    return { line: Math.max(0, last), col: this.lengths[last] ?? 0 };
  }

  destroy(): void {
    this.el.remove();
  }
}

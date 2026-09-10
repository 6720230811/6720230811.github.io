/**
 * 可拖拽的分隔条。
 *
 * 以前三栏宽度写死在 CSS 变量里（260 / 300px），排版只跟着屏幕大小走，
 * 但每个人的用法不一样：有人要宽列表、有人要宽检查器、长文写作时要宽预览。
 * 现在每个分隔条都能拖，宽度存本地，双击复位，键盘（←/→）也能微调。
 *
 * 三个注意点：
 * - 拖动期间要关掉 grid-template-columns 的过渡，否则会「橡皮筋」，拖了不跟手
 * - 中间写作区永远留够 MIN_CANVAS，拖到底也不会把正文挤没
 * - 窄屏（≤960px）下左右两栏是浮层，分隔条没意义，交回媒体查询
 */

/** 中间写作区最窄也要留这么多 */
const MIN_CANVAS = 360;
/** 窄屏断点：与 admin.css 里的浮层断点一致 */
const NARROW = '(max-width: 960px)';

interface PaneConfig {
  /** localStorage 的 key */
  store: string;
  /** 分隔条上的 data-resize-pane 值 */
  pane: string;
  /** 要写的 CSS 变量 */
  variable: string;
  /** 最小值（px 或 %） */
  min: number;
  /** 双击复位到这个值 */
  fallback: number;
  unit: 'px' | '%';
  /** 右侧的分隔条：往左拖是变大 */
  invert?: boolean;
  /** px 模式的动态上限里，还要减掉另一栏的宽度 */
  others?: () => number;
}

const round = (value: number) => Math.round(value);

function readNumber(key: string, fallback: number): number {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  } catch {
    return fallback;
  }
}

function storeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(round(value)));
  } catch {
    // 隐私模式：本次会话内已经生效，存不下也罢
  }
}

interface DragOptions {
  read: () => number;
  apply: (value: number) => void;
  min: () => number;
  max: () => number;
  invert?: boolean;
  step: number;
  reset: () => void;
  commit: () => void;
}

/** 指针拖拽 + 双击复位 + 方向键微调 */
function attach(handle: HTMLElement, opts: DragOptions): void {
  let dragging = false;
  let startX = 0;
  let startValue = 0;

  const clamp = (value: number) => Math.min(Math.max(value, opts.min()), opts.max());

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startValue = opts.read();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-active');
    document.body.classList.add('is-resizing');
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = (e.clientX - startX) * (opts.invert ? -1 : 1);
    opts.apply(clamp(startValue + delta));
  });

  const finish = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    handle.classList.remove('is-active');
    document.body.classList.remove('is-resizing');
    opts.apply(clamp(opts.read()));
    opts.commit();
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);

  handle.addEventListener('dblclick', () => {
    opts.reset();
    opts.commit();
  });

  handle.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    opts.apply(clamp(opts.read() + dir * opts.step * (opts.invert ? -1 : 1)));
    opts.commit();
  });
}

export function initResize(): void {
  const found = document.querySelector<HTMLElement>('.workbench');
  if (!found) return;
  // 收成一个非空常量：下面的闭包（窗口 resize、断点变化）里就不用反复判空
  const workbench: HTMLElement = found;

  const handles = Array.from(document.querySelectorAll<HTMLElement>('[data-resize-pane]'));
  if (!handles.length) return;

  // 当前值（px 或 %）：拖动期间以此为准，不去读 computed style（避免频繁触发布局）
  const values = new Map<string, number>();

  const configs: PaneConfig[] = [
    {
      store: 'admin_sb_w',
      pane: 'sidebar',
      variable: '--adm-sb-w',
      min: 200,
      fallback: 260,
      unit: 'px',
      others: () => values.get('admin_ins_w') ?? 300,
    },
    {
      store: 'admin_ins_w',
      pane: 'inspector',
      variable: '--adm-ins-w',
      min: 260,
      fallback: 300,
      unit: 'px',
      invert: true,
      others: () => values.get('admin_sb_w') ?? 260,
    },
    {
      store: 'admin_editor_w',
      pane: 'editor',
      variable: '--adm-editor-w',
      min: 25,
      fallback: 50,
      unit: '%',
    },
    {
      store: 'admin_pv_w',
      pane: 'profile',
      variable: '--adm-pv-w',
      min: 30,
      fallback: 52,
      unit: '%',
    },
  ];

  for (const config of configs) {
    values.set(config.store, readNumber(config.store, config.fallback));
  }

  /** 最小值：px 模式是像素，% 模式是百分比（两栏各留 min，所以上限是 100-min） */
  const minOf = (config: PaneConfig): number => config.min;

  const maxOf = (config: PaneConfig): number => {
    if (config.unit === '%') return 100 - minOf(config);
    const available = workbench.clientWidth - MIN_CANVAS - (config.others?.() ?? 0);
    return Math.max(config.min, Math.min(560, available));
  };

  const applyValue = (config: PaneConfig, value: number): void => {
    values.set(config.store, value);
    document.body.style.setProperty(
      config.variable,
      config.unit === '%' ? `${round(value)}%` : `${round(value)}px`
    );
  };

  for (const handle of handles) {
    const name = handle.dataset.resizePane ?? '';
    const config = configs.find((c) => c.pane === name);
    if (!config) continue;

    attach(handle, {
      read: () => values.get(config.store) ?? config.fallback,
      apply: (value) => applyValue(config, value),
      min: () => minOf(config),
      max: () => maxOf(config),
      invert: config.invert,
      step: config.unit === '%' ? 2 : 16,
      reset: () => applyValue(config, config.fallback),
      commit: () => storeNumber(config.store, values.get(config.store) ?? config.fallback),
    });
  }

  /** 窄屏下左右栏是浮层：撤掉内联变量，让媒体查询接管宽度 */
  const narrow = window.matchMedia(NARROW);
  function syncNarrow(): void {
    workbench.dataset.resize = narrow.matches ? 'off' : 'on';
    if (narrow.matches) {
      for (const config of configs) document.body.style.removeProperty(config.variable);
      return;
    }
    for (const config of configs) {
      const value = values.get(config.store) ?? config.fallback;
      applyValue(config, Math.min(Math.max(value, minOf(config)), maxOf(config)));
    }
  }

  // 窗口变小后，原来的宽度可能已经把中间挤没了，重新夹一次
  window.addEventListener('resize', () => {
    if (narrow.matches) return;
    for (const config of configs) {
      const value = values.get(config.store) ?? config.fallback;
      applyValue(config, Math.min(Math.max(value, minOf(config)), maxOf(config)));
    }
  });

  narrow.addEventListener('change', syncNarrow);
  syncNarrow();
}

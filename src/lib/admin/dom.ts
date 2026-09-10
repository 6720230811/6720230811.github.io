/**
 * 后台几个页面模块共用的小工具。
 *
 * 风格保持朴素：模块级函数 + 按 id 取元素，不引框架。
 */

import { GhError } from './github';

/** 取元素：后台是固定结构的单页，少了哪个元素说明模板改了，直接报错比静默失败好 */
export function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`页面缺少元素 #${id}`);
  return el as T;
}

export type StatusKind = 'ok' | 'error' | 'info' | 'busy';

/** 当前打开的分区（文章 / 个人信息 / 友链 / 素材），快捷键按它决定要不要响应 */
export function activeSection(): string {
  return (
    document.querySelector('.sidebar__tab[aria-selected="true"]')?.getAttribute('data-tab') ?? 'post'
  );
}

/** 顶栏中间那行字：当前在编辑哪个文件 */
export function setTopbarPath(text: string): void {
  const el = document.getElementById('topbar-path');
  if (el) el.textContent = text;
}

/**
 * 提示条（toast）。
 *
 * 以前是页面底部一条 `#status`：新消息直接顶掉旧的，error 还永远不消失——
 * 一条失败提示能把底部挡住一整轮操作。现在改成右下角的栈：
 * - ok / info 几秒后自己走，error / busy 留着但要能手动关掉
 * - 最多 3 条，多的从最旧的开始挤出去
 * - 同一条消息连着来（比如限流重试）不重复堆
 * - busy 是「当前操作进行中」的进度，新的 busy 顶掉旧的
 * 调用方签名没变，还能多给一个动作按钮（比如「撤销」）。
 */
const AUTO_HIDE: Record<StatusKind, number> = { ok: 6000, info: 6000, error: 0, busy: 0 };
const TOAST_MAX = 3;

export interface ToastAction {
  label: string;
  run: () => void;
}

function toastHost(): HTMLElement {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toasts';
    // 屏幕阅读器播报：礼貌模式，不打断用户当前朗读
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  return host;
}

function dismiss(el: HTMLElement): void {
  el.classList.add('is-leaving');
  window.setTimeout(() => el.remove(), 160);
}

export function setStatus(message: string, kind: StatusKind = 'info', action?: ToastAction): void {
  if (!message) return;
  const host = toastHost();

  // 同一操作会连着报好几次同样的话（进度、重试），别堆成一摞
  const same = Array.from(host.children).find(
    (el) => (el as HTMLElement).dataset.message === message
  );
  if (same) return;
  if (kind === 'busy') {
    for (const el of Array.from(host.children)) {
      if ((el as HTMLElement).dataset.kind === 'busy') dismiss(el as HTMLElement);
    }
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  toast.dataset.message = message;
  toast.dataset.kind = kind;

  const text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = message;
  toast.append(text);

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      dismiss(toast);
      action.run();
    });
    toast.append(btn);
  }

  // 常驻的那些必须能关：以前 error 只能靠下一次操作把它顶掉
  if (!AUTO_HIDE[kind]) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(toast));
    toast.append(close);
  }

  host.append(toast);
  while (host.children.length > TOAST_MAX) dismiss(host.firstElementChild as HTMLElement);

  // 带动作（比如「撤销删除」）的多留一会儿：6 秒来不及看清就没了
  const ms = action ? Math.max(AUTO_HIDE[kind], 12000) : AUTO_HIDE[kind];
  if (ms) window.setTimeout(() => dismiss(toast), ms);
}

/**
 * 左下角那块常驻提示（草稿恢复、本地存储不可用），跟右下角的 toast 分开。
 *
 * 它是 position: fixed，正好盖着侧栏底部（仓库胶囊、设置齿轮），而以前一旦出现
 * 就一直挂到下一次操作——「已恢复草稿」那条能挡一整轮编辑。现在：
 * - 默认 8 秒后自己收起；鼠标悬停或键盘停在上面时暂停计时（够时间读完）
 * - 点整块、点 × 都能立刻收起
 * - `sticky` 给环境级警告用（隐私模式下草稿存不下）：不自动走，但仍可点掉
 */
const NOTICE_AUTO_HIDE = 8000;
/** 与 .admin-notice.is-leaving 的动画时长保持一致 */
const NOTICE_LEAVE_MS = 160;

let noticeTimer: number | undefined;
let noticeSticky = false;
let noticePaused = false;

function collapseNotice(): void {
  const el = document.getElementById('draft-notice');
  window.clearTimeout(noticeTimer);
  if (!el || el.hidden) return;
  el.classList.add('is-leaving');
  noticeTimer = window.setTimeout(() => {
    el.hidden = true;
    el.classList.remove('is-leaving');
  }, NOTICE_LEAVE_MS);
}

function armNotice(): void {
  window.clearTimeout(noticeTimer);
  if (noticeSticky || noticePaused) return;
  noticeTimer = window.setTimeout(collapseNotice, NOTICE_AUTO_HIDE);
}

/** 事件只挂一次：setNotice 会被反复调用（保存、切换文章都会清一下） */
function noticeEl(): HTMLElement {
  const el = $<HTMLElement>('draft-notice');
  if (el.dataset.wired) return el;
  el.dataset.wired = '1';

  // 整块可点：它挡住的地方本来就是它，点下去就是想让它让开
  el.addEventListener('click', collapseNotice);
  el.addEventListener('mouseenter', () => {
    noticePaused = true;
    window.clearTimeout(noticeTimer);
  });
  el.addEventListener('mouseleave', () => {
    noticePaused = false;
    armNotice();
  });
  el.addEventListener('focusin', () => {
    noticePaused = true;
    window.clearTimeout(noticeTimer);
  });
  el.addEventListener('focusout', () => {
    noticePaused = false;
    armNotice();
  });
  return el;
}

export function setNotice(message: string, opts: { sticky?: boolean } = {}): void {
  const el = noticeEl();
  window.clearTimeout(noticeTimer);
  el.classList.remove('is-leaving');
  noticeSticky = Boolean(opts.sticky);
  // 新的一条要有自己的完整计时；此刻指针/焦点就在上面的话就别计时了
  noticePaused = el.matches(':hover') || el.contains(document.activeElement);

  if (!message) {
    el.hidden = true;
    return;
  }

  // 先露出来再写文本：aria-live 只在可见时播报
  el.hidden = false;
  const text = el.querySelector('.status__text');
  if (text) text.textContent = message;
  else el.textContent = message;
  armNotice();
}

/**
 * 顶部横幅：token 失效这类「环境级」问题用。
 * 它不占文档流（fixed），点动作按钮可以呼出配置抽屉。
 */
export function setBanner(message: string, action?: { label: string; run: () => void }): void {
  const el = $('banner');
  el.hidden = !message;
  if (!message) return;

  $('banner-text').textContent = message;
  const btn = $<HTMLButtonElement>('banner-action');
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = action.run;
  }
}

/** 每个输入框下面的红字：id 约定为 e-<字段> / post-error */
export function setFieldError(id: string, message: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !message;
  el.textContent = message;
}

// ---------------------------------------------------------------- 确认浮层
export interface ConfirmOptions {
  title: string;
  /** 支持换行（原样显示） */
  body: string;
  okLabel?: string;
  /** 危险操作：确认按钮用红色（默认 true） */
  danger?: boolean;
}

let confirmEl: HTMLDialogElement | null = null;

function ensureConfirm(): HTMLDialogElement {
  if (confirmEl) return confirmEl;
  const el = document.createElement('dialog');
  el.className = 'cmodal';
  el.innerHTML = `
    <p class="cmodal__title"></p>
    <p class="cmodal__body"></p>
    <div class="cmodal__actions">
      <button class="btn btn--sm cmodal__cancel" type="button">取消</button>
      <button class="btn btn--sm btn--danger cmodal__ok" type="button">确定</button>
    </div>
  `;
  document.body.append(el);
  confirmEl = el;
  return el;
}

/**
 * 危险操作的确认框。
 *
 * 以前是 window.confirm：样式跟后台完全两张皮，而且一长串清单挤在一行里。
 * 现在是自己的模态：标题 + 可换行的正文 + 明确的两个按钮，Esc / 点外面都不会误确认。
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const el = ensureConfirm();
  (el.querySelector('.cmodal__title') as HTMLElement).textContent = opts.title;
  (el.querySelector('.cmodal__body') as HTMLElement).textContent = opts.body;

  const ok = el.querySelector<HTMLButtonElement>('.cmodal__ok');
  const cancel = el.querySelector<HTMLButtonElement>('.cmodal__cancel');
  if (ok) {
    ok.textContent = opts.okLabel ?? '确定';
    ok.classList.toggle('btn--danger', opts.danger !== false);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      el.removeEventListener('close', onClose);
      if (el.open) el.close();
      resolve(value);
    };
    // Esc 关闭 / 点 backdrop 关闭都会走 close，一律当「取消」
    const onClose = () => finish(false);
    el.addEventListener('close', onClose);
    if (ok) ok.onclick = () => finish(true);
    if (cancel) cancel.onclick = () => finish(false);
    el.showModal();
  });
}

/** 异步入口的统一兜底：GhError 显示中文提示，避免错误被 Promise 静默吞掉 */
export function run(task: () => Promise<void>): void {
  void task().catch((e: unknown) => {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  });
}

export function debounce(fn: () => void, ms: number): () => void {
  let timer: number | undefined;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}

/** HH:MM，自动暂存提示用 */
export function clockTime(at: number = Date.now()): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 持久化侧栏 / 检查器的折叠状态：刷新后保持上次的布局 */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // 隐私模式：本次会话内已经生效，不写也罢
  }
}

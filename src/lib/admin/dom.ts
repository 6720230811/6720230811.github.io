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

/** ok / info 是「事情办完了」的提示，几秒后自己消失；error 与 busy 留着等用户处理 */
const AUTO_HIDE: Record<StatusKind, number> = { ok: 6000, info: 6000, error: 0, busy: 0 };
let hideTimer: number | undefined;

export function setStatus(message: string, kind: StatusKind = 'info'): void {
  const el = $('status');
  el.hidden = false;
  el.textContent = message;
  el.className = `status status--${kind}`;
  window.clearTimeout(hideTimer);
  const ms = AUTO_HIDE[kind];
  if (ms) hideTimer = window.setTimeout(() => {
    el.hidden = true;
  }, ms);
}

/** 常驻提示（草稿恢复、本地存储不可用），跟状态条分开：它不随下一次操作消失 */
export function setNotice(message: string): void {
  const el = $('draft-notice');
  el.hidden = !message;
  el.textContent = message;
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

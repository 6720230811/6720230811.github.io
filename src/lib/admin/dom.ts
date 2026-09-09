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

export function setStatus(message: string, kind: StatusKind = 'info'): void {
  const el = $('status');
  el.hidden = false;
  el.textContent = message;
  el.className = `status status--${kind}`;
}

/** 常驻提示（草稿恢复、本地存储不可用），跟状态条分开：它不随下一次操作消失 */
export function setNotice(message: string): void {
  const el = $('draft-notice');
  el.hidden = !message;
  el.textContent = message;
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

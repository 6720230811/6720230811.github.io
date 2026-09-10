import { $, clockTime } from './dom';
import { saveDraft } from './drafts';

/**
 * 自动暂存：每 3 秒看一眼有没有改动，有就静默写进本地草稿库。
 *
 * 不用「每次输入都存」：一次输入事件可能只敲了半个字，存太频繁纯属浪费
 * （IndexedDB 是异步的，但 localStorage 镜像是同步的，长文每键一次会卡）。
 * 3 秒的间隔刚好——人停下来想事情的时候就存完了。
 */

export interface Autosave<T> {
  markDirty: () => void;
  /** 立刻存一次（切文章、发布前用） */
  flush: () => Promise<void>;
}

export function createAutosave<T>(opts: {
  key: () => string;
  collect: () => T;
  interval?: number;
}): Autosave<T> {
  const pill = $('autosave-pill');
  let dirty = false;
  let saving = false;

  function flash(at: number): void {
    pill.textContent = `已保存于 ${clockTime(at)}`;
    pill.dataset.state = 'saved';
    pill.classList.remove('is-flash');
    // 强制 reflow：连续两次保存时动画才不会卡住不动
    void pill.offsetWidth;
    pill.classList.add('is-flash');
    window.setTimeout(() => pill.classList.remove('is-flash'), 1600);
  }

  async function save(): Promise<void> {
    if (!dirty || saving) return;
    saving = true;
    dirty = false;
    try {
      await saveDraft(opts.key(), opts.collect());
      flash(Date.now());
    } catch {
      pill.dataset.state = 'error';
      pill.textContent = '本地暂存失败';
    } finally {
      saving = false;
    }
  }

  window.setInterval(() => void save(), opts.interval ?? 3000);
  // 关标签页前再抢救一次：3 秒的间隔可能刚好卡在中间
  window.addEventListener('beforeunload', () => void save());

  return {
    markDirty() {
      dirty = true;
      pill.dataset.state = 'pending';
      pill.textContent = '有改动待暂存';
    },
    flush: save,
  };
}

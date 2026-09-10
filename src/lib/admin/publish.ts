import { $ } from './dom';

/**
 * 发布控制条的多阶段状态。
 *
 * 以前点完发布只有一个「1 分钟后生效」的提示，远端到底成没成全靠猜。
 * 现在按钮下方这块区域把整个生命周期摊开：
 *   写入 Commit（转圈）→ 轮询 Actions（秒表）→ 构建完成（变绿 + 直达链接）
 * 失败时给出失败步骤与重试入口，不用跳去 GitHub 页面翻日志。
 */

export type PubState = 'idle' | 'commit' | 'poll' | 'done' | 'fail' | 'note';

export interface PublishPanel {
  commit: (text?: string) => void;
  poll: () => void;
  done: (url?: string) => void;
  fail: (message: string, detail?: { steps?: string[]; logUrl?: string; retry?: () => void }) => void;
  note: (message: string) => void;
  reset: () => void;
  busy: (on: boolean) => void;
}

const TEXT: Record<PubState, string> = {
  idle: '',
  commit: '正在写入仓库 Commit…',
  poll: 'Git 提交成功，正在轮询 Actions 构建…',
  done: '✓ 构建完成，线上已生效',
  fail: 'Actions 构建失败',
  note: '',
};

export function createPublishPanel(): PublishPanel {
  const stage = $('publish-stage');
  const text = $('pub-text');
  const timer = $('pub-timer');
  const link = $<HTMLAnchorElement>('publish-link');
  const detail = $('publish-detail');
  const detailText = $('pub-detail-text');
  const steps = $<HTMLUListElement>('pub-detail-steps');
  const retry = $<HTMLButtonElement>('pub-retry');
  const log = $<HTMLAnchorElement>('pub-log');
  // data-write：删除 / 副本这类写操作，发布期间同样要锁住
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-publish], [data-write]')
  );

  let tick: number | undefined;
  let startedAt = 0;

  function stopTimer(): void {
    window.clearInterval(tick);
    tick = undefined;
    timer.hidden = true;
  }

  function setState(state: PubState, custom?: string): void {
    stopTimer();
    stage.hidden = state === 'idle';
    stage.dataset.state = state;
    text.textContent = custom ?? TEXT[state];
    if (state !== 'done') link.hidden = true;
    if (state !== 'fail') {
      detail.hidden = true;
      detailText.textContent = '';
      steps.textContent = '';
      log.hidden = true;
      retry.hidden = true;
      retry.onclick = null;
    }
  }

  return {
    commit(custom?: string) {
      setState('commit', custom);
    },

    poll() {
      setState('poll');
      startedAt = Date.now();
      timer.hidden = false;
      timer.textContent = '00:00';
      tick = window.setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      }, 1000);
    },

    done(url?: string) {
      setState('done');
      if (url) {
        link.href = url;
        link.hidden = false;
      }
    },

    fail(message, info) {
      setState('fail', `${TEXT.fail}：${message}`);
      detail.hidden = false;
      detailText.textContent = message;
      steps.textContent = '';
      for (const step of info?.steps ?? []) {
        const li = document.createElement('li');
        li.textContent = step;
        steps.append(li);
      }
      steps.hidden = !steps.children.length;
      if (info?.logUrl) {
        log.href = info.logUrl;
        log.hidden = false;
      }
      if (info?.retry) {
        retry.hidden = false;
        retry.onclick = () => {
          const run = info.retry;
          setState('commit');
          if (run) run();
        };
      }
    },

    note(message) {
      setState('note', message);
    },

    reset() {
      setState('idle');
    },

    busy(on: boolean) {
      for (const btn of buttons) btn.disabled = on;
    },
  };
}

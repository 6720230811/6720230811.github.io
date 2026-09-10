import { $, setStatus, setBanner, run } from './dom';
import { repo, site } from '../../data/admin';
import { pingRepo, GhError, type RepoAccess } from './github';

/**
 * GitHub Token：本地存取 + 状态胶囊 + 配置抽屉。
 *
 * 以前 token 表单占着首屏三分之一，每次进后台都先被它挡一下；
 * 现在默认只剩左下角一枚状态胶囊：
 *   ● 仓库连接正常 (main)   —— 绿色微脉冲
 *   ▲ 未配置 GitHub Token   —— 琥珀警示
 * 点它才从右侧滑出配置抽屉；填完可以先用「测试连接」验一遍权限，
 * 通过了才自动保存（不用盲填盲存，再去发布时才发现没权限）。
 *
 * token 只存在这台浏览器的 localStorage 里，不会上传到任何服务器。
 */

const TOKEN_KEY = 'admin_token';

export function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeToken(value: string): void {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 隐私模式：本次会话内用内存里的值即可
  }
}

// ---------------------------------------------------------------- 状态胶囊
export type PillState = 'checking' | 'ok' | 'missing' | 'error';

let pillState: PillState = 'missing';

function paintPill(state: PillState, text: string): void {
  pillState = state;
  const pill = $('token-pill');
  pill.dataset.state = state;
  $('token-pill-text').textContent = text;
  pill.title = text;
}

/** token 出问题时的统一处理：顶部横幅 + 胶囊变色 + 发布按钮置灰 */
export function flagTokenProblem(hint: string): void {
  paintPill('error', readToken() ? 'Token 不可用' : '未配置 GitHub Token');
  setBanner(hint, { label: '前往配置 Token', run: openDrawer });
  setPublishEnabled(false);
}

function setPublishEnabled(on: boolean): void {
  for (const el of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-publish]'))) {
    el.disabled = !on;
    el.title = on ? '' : '先配置一个有效 Token 才能发布';
  }
}

export function tokenReady(): boolean {
  return pillState === 'ok';
}

// ---------------------------------------------------------------- 抽屉
let drawerOpen = false;

export function openDrawer(): void {
  const drawer = $('token-drawer');
  drawer.hidden = false;
  drawerOpen = true;
  // 下一帧再加 class，过渡才有起点
  requestAnimationFrame(() => drawer.classList.add('is-open'));
  $<HTMLInputElement>('token-input').focus();
}

export function closeDrawer(): void {
  const drawer = $('token-drawer');
  drawer.classList.remove('is-open');
  drawerOpen = false;
  window.setTimeout(() => {
    if (!drawerOpen) drawer.hidden = true;
  }, 220);
}

// ---------------------------------------------------------------- 连通性自检
interface PingResult {
  ok: boolean;
  access?: RepoAccess;
  message: string;
}

async function ping(token: string): Promise<PingResult> {
  try {
    const access = await pingRepo(repo, token);
    if (access.contents === 'read' || access.contents === 'none') {
      return {
        ok: false,
        access,
        message: 'Token 对这个仓库只有读权限，发布不了：Contents 要设成 Read and write。',
      };
    }
    const actionsNote = access.actions === 'read' ? '' : '（Actions 读权限没有，发布后只能给链接，不能自动轮询）';
    return {
      ok: true,
      access,
      message: `${access.fullName} · ${access.branch} · Contents 可写${actionsNote}`,
    };
  } catch (e) {
    if (e instanceof GhError) return { ok: false, message: e.hint };
    return { ok: false, message: String(e) };
  }
}

function showPingResult(result: PingResult): void {
  const box = $('ping-result');
  box.hidden = false;
  box.dataset.state = result.ok ? 'ok' : 'error';
  box.textContent = result.ok ? `✓ ${result.message}` : `✕ ${result.message}`;
}

/** 启动时与保存后都跑一遍：胶囊上那句「连接正常」是真验过的，不是猜的 */
async function verify(token: string, onChange: () => void): Promise<void> {
  paintPill('checking', '正在检查仓库连接…');
  const result = await ping(token);
  if (!result.ok) {
    flagTokenProblem(result.message);
    return;
  }
  paintPill('ok', `仓库连接正常 (${result.access?.branch ?? repo.branch})`);
  setBanner('');
  setPublishEnabled(true);
  run(async () => onChange());
}

/** 没有 token 就提示，返回 null 让调用方直接退出 */
export function requireToken(): string | null {
  const token = readToken();
  if (!token) {
    flagTokenProblem('未配置 GitHub Token：填一个才能读写仓库。');
    // 上传图片这类操作也会走到这里，光有横幅不够显眼，补一条 toast
    setStatus('没有 Token，读写不了仓库：点左下角状态胶囊配一个。', 'error');
    return null;
  }
  return token;
}

export function initTokenPanel(onChange: () => void): void {
  const input = $<HTMLInputElement>('token-input');
  const drawer = $('token-drawer');

  $('token-pill').addEventListener('click', openDrawer);
  for (const el of Array.from(drawer.querySelectorAll<HTMLElement>('[data-drawer-close]'))) {
    el.addEventListener('click', closeDrawer);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) closeDrawer();
  });

  $('token-toggle').addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('token-toggle').textContent = show ? '隐藏' : '显示';
  });

  /** 测试连接：拿输入框里的值（没有就用已保存的）真去打一次 API */
  $('token-ping').addEventListener('click', () => {
    const value = input.value.trim() || readToken();
    if (!value) {
      showPingResult({ ok: false, message: '先粘贴一个 Token。' });
      return;
    }
    const btn = $<HTMLButtonElement>('token-ping');
    btn.disabled = true;
    btn.classList.add('is-busy');
    $('ping-result').hidden = true;

    void ping(value).then((result) => {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      showPingResult(result);
      // 验过了就顺手存下来：省一次「保存」点击，也避免验的是 A、存的是 B
      if (result.ok && input.value.trim()) {
        writeToken(input.value.trim());
        input.value = '';
        setStatus('Token 校验通过，已保存到本浏览器。', 'ok');
        void verify(readToken(), onChange);
      }
    });
  });

  $('token-save').addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) {
      setStatus('Token 不能为空。', 'error');
      return;
    }
    writeToken(value);
    input.value = '';
    setStatus(`Token 已保存到本浏览器（共 ${value.length} 位）`, 'ok');
    void verify(readToken(), onChange);
  });

  $('token-clear').addEventListener('click', () => {
    writeToken('');
    input.value = '';
    $('ping-result').hidden = true;
    paintPill('missing', '未配置 GitHub Token');
    setBanner('未配置 GitHub Token：填一个才能读写仓库。', { label: '前往配置 Token', run: openDrawer });
    setPublishEnabled(false);
    setStatus('Token 已清除。', 'info');
  });

  // 打开抽屉时把仓库信息补上，让人确认自己发的是哪个仓库
  $('token-repo').textContent = `${repo.owner}/${repo.repo}`;
  $('token-branch').textContent = repo.branch;
  const actionsLink = $<HTMLAnchorElement>('token-actions-link');
  actionsLink.href = site.actions();

  const token = readToken();
  if (token) {
    void verify(token, onChange);
  } else {
    paintPill('missing', '未配置 GitHub Token');
    setBanner('未配置 GitHub Token：填一个才能读写仓库。', { label: '前往配置 Token', run: openDrawer });
    setPublishEnabled(false);
  }
}

import { $, setStatus, run } from './dom';

/**
 * GitHub Token 的本地存取。
 *
 * token 只存在这台浏览器的 localStorage 里，不会上传到任何服务器；
 * 隐私模式下 localStorage 会抛异常，这种情况本次会话内用内存里的值即可。
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
    // 隐私模式：本次会话内保留内存里的值就够了
  }
}

/** 没有 token 就提示，返回 null 让调用方直接退出 */
export function requireToken(): string | null {
  const token = readToken();
  if (!token) setStatus('请先在上方保存 GitHub Token。', 'error');
  return token || null;
}

/** onSaved：存好 token 之后要做的事（后台用它去拉文章列表） */
export function initTokenBar(onSaved: () => void): void {
  const input = $<HTMLInputElement>('token-input');

  $('token-save').addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) {
      setStatus('Token 不能为空。', 'error');
      return;
    }
    writeToken(value);
    input.value = '';
    const masked = `${value.slice(0, 8)}…（共 ${value.length} 位）`;
    setStatus(`Token 已保存到本浏览器：${masked}`, 'ok');
    run(async () => onSaved());
  });

  $('token-clear').addEventListener('click', () => {
    writeToken('');
    setStatus('Token 已清除。', 'info');
  });
}

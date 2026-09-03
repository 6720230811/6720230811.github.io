/**
 * GitHub Contents API 的浏览器端封装（只读/写文件，不含目录列举以外的能力）。
 *
 * 纯静态站没有后端，所以「发布」就是让浏览器拿着 token 直接调 GitHub API
 * 把文件写回仓库，再由 Actions 构建部署。
 */

const API = 'https://api.github.com';

export interface Repo {
  owner: string;
  repo: string;
  branch: string;
}

export interface FileState {
  text: string;
  /** 文件的 blob sha，更新时必须带上；新建时没有 */
  sha: string;
}

/** 带中文提示的 API 错误 */
export class GhError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly resetAt?: Date
  ) {
    super(message);
    this.name = 'GhError';
  }

  static async from(res: Response): Promise<GhError> {
    let body: { message?: string } | null = null;
    try {
      body = (await res.json()) as { message?: string };
    } catch {
      // 有些错误响应不是 JSON，忽略即可，用状态码兜底
    }
    const reset = res.headers.get('x-ratelimit-reset');
    return new GhError(
      res.status,
      body?.message ?? res.statusText,
      reset ? new Date(Number(reset) * 1000) : undefined
    );
  }

  /** 面向使用者的中文提示 */
  get hint(): string {
    switch (this.status) {
      case 401:
        return 'Token 无效或已过期，请重新粘贴一个（旧的已失效，可直接覆盖）。';
      case 403:
        return this.resetAt
          ? `已触发 GitHub 限流（5000 次/小时），请在 ${this.resetAt.toLocaleTimeString()} 之后再试。`
          : 'Token 权限不足：需要 Contents 的 Read and write 权限，且只能选这一个仓库。';
      case 404:
        return '仓库或文件不存在。请确认仓库名、分支，以及 token 对该仓库有读权限。';
      case 409:
        return '远端文件已被改动（sha 过期）。请先点「重新载入」，确认内容后再保存。';
      case 422:
        return '内容被 GitHub 拒绝：检查文件路径是否含中文、空格或非法字符。';
      default:
        return `GitHub 返回 ${this.status}：${this.message}`;
    }
  }
}

async function request<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) throw await GhError.from(res);

  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining && Number(remaining) < 50) {
    console.warn(`GitHub API 剩余配额偏低：${remaining}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const fileUrl = (r: Repo, path: string) =>
  `${API}/repos/${r.owner}/${r.repo}/contents/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}?ref=${encodeURIComponent(r.branch)}`;

// ---------------------------------------------------------------- base64
// btoa 只接受 Latin-1，中文必须先 UTF-8 编码；且 String.fromCharCode(...bytes)
// 参数过多会抛 RangeError，所以按 32KB 分块。
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- 读写
interface FileResponse {
  content: string;
  sha: string;
  encoding: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

/** 读取文件；不存在返回 null（表示这是新建） */
export async function readFile(
  r: Repo,
  path: string,
  token: string
): Promise<FileState | null> {
  try {
  const res = await request<FileResponse>(fileUrl(r, path), token);
  // GitHub 在路径是目录时返回的是数组，没有 content 字段；
  // 不拦住的话会在 decodeBase64 里抛一个看不懂的 undefined.replace
  if (typeof res.content !== 'string') {
    throw new Error(`${path} 不是一个文件（GitHub 返回的是目录列表）`);
  }
  return { text: decodeBase64(res.content), sha: res.sha };
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return null;
    throw e;
  }
}

/** 列出目录下的文件名（只取 .md） */
export async function listDir(r: Repo, path: string, token: string): Promise<DirectoryEntry[]> {
  try {
    const res = await request<DirectoryEntry[]>(fileUrl(r, path), token);
    return Array.isArray(res) ? res : [];
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return [];
    throw e;
  }
}

const put = (r: Repo, path: string, token: string, text: string, message: string, sha?: string) =>
  request(fileUrl(r, path), token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encodeBase64(text),
      branch: r.branch,
      // 新建时必须不带 sha，带了反而会 422
      ...(sha ? { sha } : {}),
    }),
  });

/**
 * 写入队列：所有写操作串行执行。
 * 连点两次会互相把对方的 sha 顶掉（409），串行化之后就不会了。
 */
let tail: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

/** 保存文件。sha 冲突时自动取最新 sha 重试一次。 */
export async function saveFile(
  r: Repo,
  path: string,
  token: string,
  text: string,
  message: string
): Promise<void> {
  return enqueue(async () => {
    const current = await readFile(r, path, token);
    try {
      await put(r, path, token, text, message, current?.sha);
    } catch (e) {
      if (e instanceof GhError && e.status === 409) {
        const fresh = await readFile(r, path, token);
        if (fresh) {
          await put(r, path, token, text, message, fresh.sha);
          return;
        }
      }
      throw e;
    }
  });
}

/** 保存后跳转去查看构建进度 */
export function actionsUrl(r: Repo): string {
  return `https://github.com/${r.owner}/${r.repo}/actions`;
}

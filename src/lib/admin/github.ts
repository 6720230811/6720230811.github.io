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

/** 只取文件的 sha，不解码内容：对二进制解码毫无意义，还白费内存 */
export async function statFile(r: Repo, path: string, token: string): Promise<string | null> {
  try {
    const res = await request<{ sha: string }>(fileUrl(r, path), token);
    return res.sha ?? null;
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

/** 二进制转 base64：同 encodeBase64 的分块写法，避免 String.fromCharCode 参数过多抛 RangeError */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// put 收「已经编好的 base64」，文本与二进制共用一条写入路径
const put = (r: Repo, path: string, token: string, b64: string, message: string, sha?: string) =>
  request(fileUrl(r, path), token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: b64,
      branch: r.branch,
      // 新建时必须不带 sha，带了反而会 422；覆盖时必须带 sha，否则也是 422
      ...(sha ? { sha } : {}),
    }),
  });

// DELETE contents：删文件，必须带 sha
const del = (r: Repo, path: string, token: string, sha: string, message: string) =>
  request(fileUrl(r, path), token, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: r.branch }),
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

/** PUT contents 的响应：commit.sha 是这次提交号，发布后拿它去对 Actions 的 run */
interface PutResponse {
  content?: { sha?: string };
  commit?: { sha?: string };
}

/**
 * 保存文件。sha 冲突时自动取最新 sha 重试一次。
 * 返回这次提交的 commit sha（内容没变时 GitHub 不产生提交，返回 null）。
 */
export async function saveFile(
  r: Repo,
  path: string,
  token: string,
  text: string,
  message: string
): Promise<string | null> {
  return enqueue(async () => {
    const current = await readFile(r, path, token);
    let res: PutResponse;
    try {
      res = await put(r, path, token, encodeBase64(text), message, current?.sha) as PutResponse;
    } catch (e) {
      if (e instanceof GhError && e.status === 409) {
        const fresh = await readFile(r, path, token);
        if (fresh) {
          res = await put(r, path, token, encodeBase64(text), message, fresh.sha) as PutResponse;
          return res?.commit?.sha ?? null;
        }
      }
      throw e;
    }
    return res?.commit?.sha ?? null;
  });
}

/**
 * 写二进制文件（配图）。与 saveFile 同一套：串行队列 + 409 重试。
 * 权限还是 Contents: Read and write，不用额外申请。
 */
export async function saveBinaryFile(
  r: Repo,
  path: string,
  token: string,
  bytes: Uint8Array,
  message: string
): Promise<void> {
  return enqueue(async () => {
    const sha = await statFile(r, path, token);
    const b64 = encodeBase64Bytes(bytes);
    try {
      await put(r, path, token, b64, message, sha ?? undefined);
    } catch (e) {
      if (e instanceof GhError && e.status === 409) {
        const fresh = await statFile(r, path, token);
        if (fresh) {
          await put(r, path, token, b64, message, fresh);
          return;
        }
      }
      throw e;
    }
  });
}

/**
 * 删文件。与 saveFile 同一套：串行队列 + 409 重试。
 * 返回这次提交的 commit sha（文件本来就不存在时返回 null）。
 */
export async function deleteFile(
  r: Repo,
  path: string,
  token: string,
  message: string
): Promise<string | null> {
  return enqueue(async () => {
    const sha = await statFile(r, path, token);
    if (!sha) return null;

    try {
      const res = (await del(r, path, token, sha, message)) as { commit?: { sha?: string } };
      return res?.commit?.sha ?? null;
    } catch (e) {
      if (e instanceof GhError && e.status === 409) {
        const fresh = await statFile(r, path, token);
        if (!fresh) return null;
        const res = (await del(r, path, token, fresh, message)) as { commit?: { sha?: string } };
        return res?.commit?.sha ?? null;
      }
      throw e;
    }
  });
}

/** 保存后跳转去查看构建进度 */
export function actionsUrl(r: Repo): string {
  return `https://github.com/${r.owner}/${r.repo}/actions`;
}

// ---------------------------------------------------------------- 连通性自检
export type Permission = 'write' | 'read' | 'none' | 'unknown';

export interface RepoAccess {
  fullName: string;
  branch: string;
  /** Contents 权限：只有 write 才能发布 */
  contents: Permission;
  /** Actions 读取权限：没有就轮询不了构建状态，只能给链接 */
  actions: Permission;
  private: boolean;
}

interface RepoResponse {
  full_name: string;
  default_branch: string;
  private: boolean;
  permissions?: { push?: boolean; pull?: boolean; admin?: boolean };
}

/**
 * 「测试连接」用的自检：一次请求看清 token 对这个仓库到底能干什么。
 * 分三步：读仓库 → 确认分支存在 → 试探 Actions 读权限（不影响结果，拿不到就降级）。
 */
export async function pingRepo(r: Repo, token: string): Promise<RepoAccess> {
  const info = await request<RepoResponse>(`${API}/repos/${r.owner}/${r.repo}`, token);

  let branch = r.branch;
  try {
    const b = await request<{ name: string }>(
      `${API}/repos/${r.owner}/${r.repo}/branches/${encodeURIComponent(r.branch)}`,
      token
    );
    branch = b.name;
  } catch (e) {
    if (e instanceof GhError && e.status === 404) {
      throw new GhError(404, `仓库里有，但没有 ${r.branch} 分支`, undefined);
    }
    throw e;
  }

  // 细粒度 token 不给 permissions 时拿不到 push，就按 unknown 处理（写的时候才知道）
  const perm = info.permissions;
  const contents: Permission = perm?.push
    ? 'write'
    : perm?.pull
      ? 'read'
      : ('unknown' as Permission);

  let actions: Permission = 'read';
  try {
    await request(`${API}/repos/${r.owner}/${r.repo}/actions/runs?per_page=1`, token);
  } catch (e) {
    // 只是没有 Actions 读权限，不影响写文章；让发布流程降级成「给链接」
    if (e instanceof GhError && (e.status === 403 || e.status === 404)) actions = 'none';
    else actions = 'unknown';
  }

  return {
    fullName: info.full_name,
    branch,
    contents,
    actions,
    private: Boolean(info.private),
  };
}

// ---------------------------------------------------------------- Actions 构建状态
export interface WorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: string | null;
  html_url: string;
  head_sha: string;
  run_started_at?: string | null;
}

/** 找这次提交触发的那次 workflow run（刚提交时可能还没建出来，返回 null 让调用方再等一轮） */
export async function findRun(r: Repo, token: string, commitSha: string): Promise<WorkflowRun | null> {
  const res = await request<{ workflow_runs: WorkflowRun[] }>(
    `${API}/repos/${r.owner}/${r.repo}/actions/runs?branch=${encodeURIComponent(r.branch)}&per_page=10`,
    token
  );
  const runs = res.workflow_runs ?? [];
  return runs.find((run) => run.head_sha === commitSha) ?? null;
}

/** 失败原因：把失败的步骤名列出来，省得去 GitHub 页面上翻 */
export async function failedSteps(r: Repo, token: string, runId: number): Promise<string[]> {
  try {
    const res = await request<{
      jobs: { conclusion: string | null; name: string; steps?: { name: string; conclusion: string | null }[] }[];
    }>(`${API}/repos/${r.owner}/${r.repo}/actions/runs/${runId}/jobs?per_page=100`, token);

    const out: string[] = [];
    for (const job of res.jobs ?? []) {
      const failed = (job.steps ?? []).filter((s) => s.conclusion === 'failure');
      if (failed.length) out.push(...failed.map((s) => `${job.name} → ${s.name}`));
      else if (job.conclusion === 'failure') out.push(job.name);
    }
    return out;
  } catch {
    // 拿不到 jobs 就不硬凑，面板里给 run 的链接就好
    return [];
  }
}

/** 重跑失败的任务：需要 Actions 写权限，没有会抛 403，调用方兜住 */
export async function rerunFailed(r: Repo, token: string, runId: number): Promise<void> {
  await request(
    `${API}/repos/${r.owner}/${r.repo}/actions/runs/${runId}/rerun-failed-jobs`,
    token,
    { method: 'POST' }
  );
}

import { $, setStatus } from './dom';

/**
 * 抓取服务（自托管 crawl4ai）的客户端与配置。
 *
 * 实测结论（0.9.3，别照抄旧文档）：
 * - 取正文：`POST /md` body `{url, f:"fit"}` → `{markdown, success}`；
 *   旧的 `GET /md/{url}` 已经没了（会 404）
 * - 要元数据/图片/状态码：`POST /crawl` body `{urls:[...], crawler_config:{...}}`
 *   → `results[0]` 里带 `markdown`（可能是字符串或 `{fit_markdown, raw_markdown}`）、
 *   `metadata{title,description,author,keywords}`、`media.images`、`status_code`、`error_message`
 * - 认证：`Authorization: Bearer <CRAWL4AI_API_TOKEN>`（没带就 401）
 * - 跨域：服务端默认 `cors_allow_origins: []`（拒绝一切），部署时必须显式列出本后台的地址；
 *   并且要让 CORS 预检穿过它的认证闸门（见部署说明里的 auth_gate 补丁）
 *
 * 这里不缓存任何结果：抓取是低频动作，缓存只会让"刷新一下看看"变得不可预期。
 */

const URL_KEY = 'admin_crawl_url';
const TOKEN_KEY = 'admin_crawl_token';
/** 首次抓取要把 Chromium 拉起来，给足时间 */
const DEFAULT_TIMEOUT = 120_000;

export interface CrawlConfig {
  base: string;
  token: string;
}

export function readCrawlConfig(): CrawlConfig {
  try {
    return {
      base: (localStorage.getItem(URL_KEY) ?? '').trim().replace(/\/+$/, ''),
      token: localStorage.getItem(TOKEN_KEY) ?? '',
    };
  } catch {
    return { base: '', token: '' };
  }
}

export function writeCrawlConfig(base: string, token: string): void {
  try {
    localStorage.setItem(URL_KEY, base.trim().replace(/\/+$/, ''));
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    // 隐私模式：本次会话可用，存不下也罢
  }
}

export function clearCrawlConfig(): void {
  try {
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 同上 */
  }
}

export function crawlConfigured(): boolean {
  return Boolean(readCrawlConfig().base);
}

// ---------------------------------------------------------------- 失败分类
export type CrawlFailure =
  | { kind: 'noconfig' }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'auth' }
  | { kind: 'ratelimit' }
  | { kind: 'server'; detail: string }
  | { kind: 'target'; status: number; detail: string }
  | { kind: 'empty' };

export function describeFailure(failure: CrawlFailure): string {
  switch (failure.kind) {
    case 'noconfig':
      return '还没配置抓取服务：点左下角状态胶囊，填服务地址和 token。';
    case 'unreachable':
      return `连不上抓取服务（${failure.detail}）。检查隧道/服务是否在线，地址是否写全（https://，不要带路径）。`;
    case 'auth':
      return '抓取服务拒绝了 token（401）。核对后台里填的 token 与服务端 CRAWL4AI_API_TOKEN 是否一致。';
    case 'ratelimit':
      return '抓取服务限流了（429）。等一会儿再试，或在服务端把 rate_limiting.default_limit 调大。';
    case 'server':
      return `抓取服务报错：${failure.detail}`;
    case 'target':
      return failure.status
        ? `目标页面返回 ${failure.status}，抓到的可能是错误页而不是正文。${failure.detail}`
        : `目标页面抓取失败：${failure.detail}`;
    default:
      return '没有取到正文（页面可能需要登录，或是纯 JS 渲染）。可以改用「手动粘贴正文」。';
  }
}

// ---------------------------------------------------------------- 请求
interface CrawlMeta {
  title?: string;
  description?: string;
  author?: string;
  keywords?: string[];
}

export interface CrawlResult {
  /** 正文：整页 markdown（配图完整）；/crawl 不通时才退回只有正文的过滤版 */
  markdown: string;
  /**
   * 服务端过滤版正文（fit），当"样板参照系"用：整页里找不到的行判为导航/页脚。
   * 不直接拿它当正文——它是按文本密度剪的，图片整段都会被剪掉。
   */
  reference: string;
  /** raw = 正文取自整页，fit = /crawl 不通、只能拿过滤版 */
  bodySource: 'raw' | 'fit';
  meta: CrawlMeta;
  /** 正文里出现的图片绝对地址（去重、去掉 data:） */
  images: string[];
  statusCode?: number;
  /** 实际用的接口，排错时有用 */
  via: 'crawl' | 'md';
}

type Outcome = { ok: true; result: CrawlResult } | { ok: false; failure: CrawlFailure };

async function post(
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<{ ok: true; data: unknown } | { ok: false; failure: CrawlFailure }> {
  const { base, token } = readCrawlConfig();
  if (!base) return { ok: false, failure: { kind: 'noconfig' } };

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) return { ok: false, failure: { kind: 'auth' } };
    if (response.status === 429) return { ok: false, failure: { kind: 'ratelimit' } };
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        failure: { kind: 'server', detail: `${response.status} ${text.slice(0, 200)}` },
      };
    }
    return { ok: true, data: await response.json() };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, failure: { kind: 'unreachable', detail: `超过 ${Math.round(timeoutMs / 1000)} 秒没响应` } };
    }
    return { ok: false, failure: { kind: 'unreachable', detail: (e as Error).message } };
  } finally {
    window.clearTimeout(timer);
  }
}

/** crawl4ai 的 markdown 字段可能是字符串，也可能是 {fit_markdown, raw_markdown, …} */
function pickMarkdown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['fit_markdown', 'raw_markdown', 'markdown_with_citations', 'markdown']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
  }
  return '';
}

function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function collectImages(value: unknown, pageUrl: string): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const entry of value) {
    const src =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? String((entry as Record<string, unknown>).src ?? '')
          : '';
    if (!src || src.startsWith('data:')) continue;
    out.add(absolutize(src, pageUrl));
  }
  return [...out];
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,，;；]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * 只要正文：`POST /md` 的 `f: "fit"` 走 crawl4ai 自带的 PruningContentFilter，
 * 导航/侧栏/页脚会被剔掉。实测 runoob 那篇：整页 31415 字符 → 11921（少 62%）。
 * 失败不报错——只是少一层过滤，正文还有 /crawl 的原始 markdown 兜着。
 */
async function fetchFitMarkdown(url: string, timeoutMs: number): Promise<string> {
  const simple = await post('/md', { url, f: 'fit' }, timeoutMs);
  if (!simple.ok) return '';
  return pickMarkdown((simple.data as Record<string, unknown>).markdown);
}

/**
 * 过滤版能不能当参照系。太短（<200 字符，或不到整页的 25%）说明它把正文也剪了——
 * 这时拿它当参照会把整页删空，宁可退回纯规则清洗。
 */
function usableReference(raw: string, fit: string): string {
  const f = fit.trim();
  if (f.length < 200) return '';
  if (raw.trim() && f.length < raw.trim().length * 0.25) return '';
  return fit;
}

/**
 * 抓一页：/crawl 取元数据+图片+状态码，同时 /md?f=fit 取"只剩正文"的版本。
 * 两个请求并行——它们互不依赖，串行会白等一倍（实测并行总耗时≈较慢的那个）。
 */
export async function crawlUrl(url: string, timeoutMs = DEFAULT_TIMEOUT): Promise<Outcome> {
  const [full, fit] = await Promise.all([
    post('/crawl', { urls: [url], crawler_config: { cache_mode: 'BYPASS' } }, timeoutMs),
    fetchFitMarkdown(url, timeoutMs),
  ]);

  if (full.ok) {
    const data = full.data as { results?: unknown[] };
    const first = (data.results?.[0] ?? {}) as Record<string, unknown>;
    const markdown = pickMarkdown(first.markdown);
    const status = typeof first.status_code === 'number' ? first.status_code : undefined;
    const meta = (first.metadata ?? {}) as Record<string, unknown>;

    if (markdown.trim() && first.success !== false) {
      return {
        ok: true,
        result: {
          markdown,
          reference: usableReference(markdown, fit),
          bodySource: 'raw',
          meta: {
            title: typeof meta.title === 'string' ? meta.title : undefined,
            description: typeof meta.description === 'string' ? meta.description : undefined,
            author: typeof meta.author === 'string' ? meta.author : undefined,
            keywords: asStringArray(meta.keywords),
          },
          images: collectImages((first.media as Record<string, unknown> | undefined)?.images, url),
          statusCode: status,
          via: 'crawl',
        },
      };
    }
    // /crawl 明确报了目标页错误：直接反馈，别用 /md 再糊一遍
    if (first.success === false && String(first.error_message ?? '').trim()) {
      return {
        ok: false,
        failure: {
          kind: 'target',
          status: status ?? 0,
          detail: String(first.error_message).slice(0, 200),
        },
      };
    }
  } else if (full.failure.kind === 'auth' || full.failure.kind === 'noconfig' || full.failure.kind === 'ratelimit') {
    return { ok: false, failure: full.failure };
  }

  // /crawl 这条路不通（或没给出正文）：/md 拿到什么就用什么（没有整页可参照）
  if (fit.trim()) {
    return {
      ok: true,
      result: {
        markdown: fit,
        reference: '',
        bodySource: 'fit',
        meta: {},
        images: [],
        statusCode: undefined,
        via: 'md',
      },
    };
  }

  return { ok: false, failure: full.ok ? { kind: 'empty' } : full.failure };
}

/** 健康检查（同时当预热用：叫醒容器里的浏览器） */
export async function pingCrawl(
  base: string,
  token: string
): Promise<{ ok: boolean; version?: string; error?: string }> {
  const clean = base.trim().replace(/\/+$/, '');
  if (!clean) return { ok: false, error: '先填服务地址' };
  try {
    const response = await fetch(`${clean}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const data = (await response.json()) as { status?: string; version?: string };
    if (data.status && data.status !== 'ok') return { ok: false, error: `服务状态 ${data.status}` };
    return { ok: true, version: data.version ?? '未知' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------- 配置界面
/** Token 抽屉里的「抓取服务」一段：填地址、token，点测试连接验证 */
export function initCrawlSettings(): void {
  const urlInput = $<HTMLInputElement>('crawl-url');
  const tokenInput = $<HTMLInputElement>('crawl-token');
  const toggle = $<HTMLButtonElement>('crawl-token-toggle');
  const ping = $<HTMLButtonElement>('crawl-ping');
  const save = $<HTMLButtonElement>('crawl-save');
  const clear = $<HTMLButtonElement>('crawl-clear');
  const result = $('crawl-ping-result');

  const existing = readCrawlConfig();
  urlInput.value = existing.base;
  tokenInput.value = existing.token;

  const say = (text: string, state: 'ok' | 'error' | 'busy'): void => {
    result.hidden = false;
    result.textContent = text;
    result.dataset.state = state;
  };

  toggle.addEventListener('click', () => {
    const showing = tokenInput.type === 'text';
    tokenInput.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? '显示' : '隐藏';
  });

  ping.addEventListener('click', () => {
    void (async () => {
      const base = urlInput.value.trim();
      if (!base) {
        say('先填服务地址，例如 https://xxx.ts.net', 'error');
        return;
      }
      if (!/^https?:\/\//i.test(base)) {
        say('地址要带协议：https:// 开头（http 只能用于本机调试）', 'error');
        return;
      }
      say('正在测试…', 'busy');
      const outcome = await pingCrawl(base, tokenInput.value.trim());
      if (outcome.ok) {
        // 测通了就直接存，省一步
        writeCrawlConfig(base, tokenInput.value.trim());
        say(`连接正常，服务版本 ${outcome.version}。已保存。`, 'ok');
        setStatus(`抓取服务连通（crawl4ai ${outcome.version}）。`, 'ok');
      } else {
        say(`连接失败：${outcome.error}`, 'error');
      }
    })();
  });

  save.addEventListener('click', () => {
    writeCrawlConfig(urlInput.value, tokenInput.value);
    const { base } = readCrawlConfig();
    setStatus(base ? `已保存抓取服务地址：${base}` : '抓取服务地址已清空。', 'ok');
  });

  clear.addEventListener('click', () => {
    clearCrawlConfig();
    urlInput.value = '';
    tokenInput.value = '';
    result.hidden = true;
    setStatus('已清除抓取服务配置。', 'ok');
  });
}

import { findCharacter, pet } from '../../data/pet';
import type { Locale } from '../../i18n/ui';
import { pickLine } from './lines';

/**
 * 对话层：把「用户问了一句」变成「宠物该说什么」。
 *
 * 三条路，优先顺序固定：
 *   1. 本地检索 —— 先把问题和站内条目对一遍，命中就把链接挂上（无论后面走谁）
 *   2. 直连模型 —— 浏览器里存了 Key 就真调一次 OpenAI 兼容接口
 *   3. 台词兜底 —— 没 Key / 超时 / 报错 / 被 CORS 拦，一律退回台词库
 *
 * 关于「浏览器直连」的诚实说明：
 * 纯静态站没有地方藏密钥，所以 Key 是访客自己的，只存本机 localStorage。
 * 代价是**很多官方端点不允许浏览器直接调用**（没有 CORS 头），请求会在预检阶段
 * 就被浏览器掐掉，表现为 fetch 抛 "Failed to fetch"。默认端点因此选了明确
 * 支持浏览器调用的 OpenRouter；换别的端点若撞上 CORS，界面会给出明确提示，
 * 而不是让人对着一个「网络错误」发呆。
 */

/** 站内条目：由 Pet.astro 在构建期从 content collection 生成 */
export interface SiteDoc {
  title: string;
  url: string;
  tags: readonly string[];
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 一条站内链接。
 * url **一定**是站内目录里真实存在的地址（不是模型瞎写的），label 就是它的标题 ——
 * 所以渲染出来永远可点、也永远有个人话标签，不会出现一串裸路径。
 */
export interface ChatLink {
  url: string;
  label: string;
}

export interface ChatReply {
  text: string;
  source: 'local' | 'llm';
  /**
   * 这条回答该配的站内链接，**可能有多条**。
   * 模型一次列三篇文章时三条都要能点 —— 只留一条是说不通的。
   */
  links?: readonly ChatLink[];
  /** 出错时给的技术提示：只给填了 Key 的人看（他自己配的东西自己修） */
  detail?: string;
}

export interface AskOptions {
  locale: Locale;
  /**
   * 当前角色 id —— 人格与名字都由它决定，见 systemPrompt。
   * 不传（或传了个认不出的 id）会回落到默认角色，不会报错。
   * 之所以做成可选：自检（probe）那条路根本不生成 system prompt。
   */
  character?: string;
  docs: readonly SiteDoc[];
  history: readonly Turn[];
  signal?: AbortSignal;
  /**
   * 流式增量回调：每收到一段正文就调一次，参数是**到目前为止的全文**。
   * 界面据此把气泡逐字填上，首字从「整段生成完」提前到 0.4～1.5 秒。
   */
  onDelta?: (partial: string) => void;
}

/** 只存本机的凭据，键名沿用 admin 那套习惯（localStorage，不上传） */
export const SECRET = {
  key: 'pet_llm_key',
  endpoint: 'pet_llm_endpoint',
  model: 'pet_llm_model',
} as const;

export function readSetting(name: string): string {
  try {
    return localStorage.getItem(name)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function writeSetting(name: string, value: string): void {
  try {
    if (value.trim()) localStorage.setItem(name, value.trim());
    else localStorage.removeItem(name);
  } catch {
    // 无痕模式：本次会话用不了就算了，请求会退到台词库
  }
}

// ---------------------------------------------------------------- 端点归一化

/**
 * 把「基址」补成「可 POST 的完整地址」。
 *
 * 这是最容易踩的坑：各家控制台给的都是**基址**（`.../v1`、`.../compatible-mode/v1`），
 * 而这里要 POST 的是基址 + `/chat/completions`。两串地址长得很像，粘错之后
 * 请求会打到基址上，返回 404 —— 看上去就像「明明都填对了，就是不行」。
 *
 * 与其指望人记住这个后缀，不如在这里补齐：填基址也照样能用。
 * 只认「看起来像 API 基址」的尾巴（以 `/v1`、`/v2` 这类结尾），
 * 免得把已经写全的地址又接一截上去。
 */
export function normalizeEndpoint(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  if (!url) return url;
  // 已经写到 completions 就不动它（有的网关还带 /chat/completions/ 之外的变体）
  if (/\/completions$/i.test(url)) return url;
  if (/\/v\d+$/i.test(url)) return `${url}/chat/completions`;
  return url;
}

/** 由对话地址推出同源的模型清单地址（自检用）。 */
function modelsUrl(endpoint: string): string {
  return /\/chat\/completions$/i.test(endpoint)
    ? endpoint.replace(/\/chat\/completions$/i, '/models')
    : `${endpoint}/models`;
}

// ------------------------------------------------------------------ 本地检索

/**
 * 把问题往站内条目上对一遍。
 *
 * 刻意做得简陋：中文切二字片段、拉丁文切词，命中就加权计分。
 * 之所以不上 embedding，是因为索引只有几十条、还要在浏览器里跑，
 * 为它多下载一个模型不划算；命中率够用，而且完全离线。
 *
 * **两类命中分开记**，因为可信度差得远：
 *   - 拉丁词（tailscale、astro）几乎不可能撞车 → 一个词就是强证据，给 2 分
 *   - 中文二字片段是弱证据。相邻二字片段会从同一段文字里重复得分：
 *     问「用一句话介绍你自己」，光是「你自己」这三个字就同时命中
 *     「你自」和「自己」，凭空凑够 2 分 —— 足以把一条毫不相关的文章
 *     挂到气泡上（实测踩到过）。所以**只有中文命中时要 3 分才认**。
 */
export function matchDoc(query: string, docs: readonly SiteDoc[]): SiteDoc | null {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return null;

  const bigrams = new Set<string>();
  const words = new Set<string>();
  for (let i = 0; i < q.length - 1; i++) {
    const pair = q.slice(i, i + 2);
    // 只切中文片段：字母数字的词另有 words 处理，混在一起会互相污染
    if (/[\u4e00-\u9fa5]/.test(pair)) bigrams.add(pair);
  }
  for (const word of q.split(/[^a-z0-9+#._-]+/)) {
    if (word.length >= 3) words.add(word);
  }
  if (!bigrams.size && !words.size) return null;

  let best: SiteDoc | null = null;
  let bestScore = 0;
  for (const doc of docs) {
    const hay = `${doc.title} ${doc.tags.join(' ')}`.toLowerCase();
    let zh = 0;
    let latin = 0;
    for (const gram of bigrams) if (hay.includes(gram)) zh += 1;
    for (const word of words) if (hay.includes(word)) latin += 2;

    const score = zh + latin;
    // 有专有词命中就按 2 分算；纯中文蹭上来的要 3 分（理由见上方注释）
    const threshold = latin > 0 ? 2 : 3;
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }
  return best;
}

/**
 * 正文收口：压平换行，再兜一个**很宽松**的硬上限。
 *
 * 关键：这个上限**不是排版手段**。排版交给气泡自己的 max-height + 滚动，
 * 字数约束交给 system prompt（pet.maxBubbleChars）—— 在这里硬截断只会把
 * 一个本来完整的答案削掉，那正是「回答看起来没写完」的成因。
 *
 * 它现在只防一种极端情况：某个网关不认 max_tokens，一口气吐几千字。
 * 上限跟着 token 预算走（中文约 1 字 1 token，留 2 倍余量），
 * 所以调大 maxAnswerTokens 时它自动跟上，不会变成新的暗桩。
 */
export function clip(text: string, max = pet.maxAnswerTokens * 2): string {
  const flat = text.replace(/\s*\n+\s*/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * 「看起来像站内路径」的候选片段。
 *
 * 前面必须是**空白或标点**：正文里的斜杠（日期 2026/09、分数）不该被当成路径。
 * 斜杠后第一个字符必须是字母数字，所以光秃秃一个 `/` 永远不会入选 ——
 * 这一点是下面那条 bug 的关键防线。
 *
 * 标点集要**成对收全**：早先只写了开引号（`“`）漏了闭引号（`”`），
 * 也只写了 `「」` 漏了 `》` —— 于是「《标题》/blog/x/」这种很常见的写法
 * 匹配不到，链接被整条漏掉。这类漏写不会报错，只是安静地少一条链接。
 */
const PATH_RE = /(?:^|[\s，。、；：！？,;:!?()（）【】「」『』《》“”‘’"'])(\/[A-Za-z0-9][\w\-.~/]*)/g;

/** 比较地址时忽略结尾斜杠：目录里写 `/blog/`，正文里可能写 `/blog` */
function normUrl(url: string): string {
  return url.length > 1 ? url.replace(/\/+$/, '') : url;
}

/** 「引出链接」的标点：模型写 `…东西：/blog/x/，那篇…`，URL 摘走后这个冒号就被孤零零留在原地 */
const PUNCT_BEFORE = /[：:，,、；;]/;
/** 紧跟其后的标点：冒号后面本来该是 URL，现在直接接上它，读起来像打错了 */
const PUNCT_AFTER = /[，,。.、；;：:！!？?）)】\]]/;

/**
 * 修补「摘掉 URL 之后」的接缝。
 *
 * 只处理**删除点两侧**那一对字符，不碰全局 —— 全局替换会把正文里本来就有的
 * `：，` 一起改掉，那是在替用户改标点。这里的判断依据很硬：这两个字符原本被一个
 * URL 隔开，现在贴到了一起，所以左侧那个引出用的标点必须让位。
 *
 *   模型写的：…写东西：/blog/hello-world/，那篇比较短…
 *   摘完不修：…写东西：，那篇比较短…      ← 看着像坏了
 *   修完：    …写东西，那篇比较短…        ✓
 *
 * 顺带处理 URL 落在句末的情况（`…看这里：/blog/x/`）—— 结尾孤零零一个冒号同样是坏的。
 */
function mendSeam(text: string, at: number): string {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const prev = before.slice(-1);
  if (!PUNCT_BEFORE.test(prev)) return before + after;
  if (after === '') return before.slice(0, -1);
  if (PUNCT_AFTER.test(after.slice(0, 1))) return before.slice(0, -1) + after;
  return before + after;
}

/**
 * 把答案里的站内链接摘下来，交给界面单独渲染成可点的一行。
 *
 * 为什么非摘不可：链接留在正文里既**不可点**，又要占两三行、吃掉大半字数预算 ——
 * 「明明是完整回答，却只显示半句」就是这么来的。摘掉之后正文回到标题本身，
 * 链接以 `→ 标题` 的形式排在下面，两边都不挤。
 *
 * 方向很重要：**从正文里取候选路径，再去目录里查表**，而且是精确相等。
 * 反过来做（拿目录 URL 去正文里 indexOf）会出事：`/` 能命中任意一个斜杠、
 * `/blog/` 能命中 `/blog/hello-world/` 的前缀，于是一次引用三篇文章的回答
 * 被凭空挂上「首页」和「博客」两条它从没提过的链接 —— 实测踩到过。
 * 查不到就当作没写，宁可少挂一条链接，也不挂一条假的。
 *
 * 摘除时**从后往前剪**：位置才不会被前面的删除推移。
 */
export function detachDocLinks(
  text: string,
  docs: readonly SiteDoc[]
): { text: string; links: ChatLink[] } {
  const index = new Map<string, SiteDoc>();
  for (const doc of docs) index.set(normUrl(doc.url), doc);

  const found: { at: number; len: number; link: ChatLink }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(PATH_RE)) {
    const raw = match[1].replace(/[.,;:!?]+$/, ''); // 句末标点被一起吞进来了
    const doc = index.get(normUrl(raw));
    if (!doc || seen.has(doc.url)) continue;
    seen.add(doc.url);
    // match[0] 含前导的空白/标点，真正的路径从 group 1 开始
    found.push({
      at: match.index + match[0].length - match[1].length,
      len: match[1].length,
      link: { url: doc.url, label: doc.title },
    });
  }

  found.sort((a, b) => a.at - b.at);
  let out = text;
  // 从后往前剪，位置才不会被前面的删除推移；每剪一处顺手修补接缝
  for (const hit of [...found].sort((a, b) => b.at - a.at)) {
    out = mendSeam(out.slice(0, hit.at) + out.slice(hit.at + hit.len), hit.at);
  }
  out = out
    // URL 摘掉后常剩下一对空括号，或者标点前多一个空格，都清掉
    .replace(/[（(【\[]\s*[)）】\]]/g, '')
    .replace(/\s+([，。、；：!?！？,;）)】])/g, '$1')
    .replace(/([（(【\[])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s，。、；：,;]+/, '')
    .trim();
  return { text: out, links: found.map((hit) => hit.link) };
}

// -------------------------------------------------------------------- 系统提示

function systemPrompt(options: AskOptions): string {
  const isZh = options.locale === 'zh';
  // 人格跟着当前角色走。**认不出的 id 必须回落**，不能让它变成空字符串 ——
  // 空 persona 会让这只宠物彻底失去性格，问什么都只回一段干巴巴的说明。
  const who = findCharacter(options.character);
  const persona = isZh ? who.persona : who.personaEn;
  const name = isZh ? who.name : who.nameEn;

  // 只带最近若干条进 prompt：全量条目才是浪费，检索已经由 matchDoc 做完了
  const known = options.docs
    .slice(0, pet.promptDocs)
    .map((doc) => `- ${doc.title} → ${doc.url}`)
    .join('\n');

  return [
    persona,
    '',
    isZh
      ? `关于这个站点，你只认得下面这些条目（标题 → 链接）：\n${known}`
      : `You only know these entries about this site (title → link):\n${known}`,
    '',
    isZh
      ? `回答要求：正文不超过 ${pet.maxBubbleChars} 个字；不要用 Markdown、不要用列表、不要用表情；` +
        `提到站内文章时，把它的链接（形如 /blog/xxx/）原样写在那句话里 —— ` +
        `链接会单独排成可点的一行，**不计入上面的字数**，所以别为了省字数把链接省掉；` +
        `清单里没有的内容，直说不知道。`
      : `Answer rules: keep the prose under ${pet.maxBubbleChars} characters; no Markdown, no lists, no emoji; ` +
        `when you mention an article, write its link (like /blog/xxx/) inline in that sentence — ` +
        `links are rendered separately as clickable rows and do NOT count towards the limit, so never drop a link to save room; ` +
        `if it is not in the list, say you do not know.`,
    '',
    isZh ? `自己的名字是「${name}」。` : `Your name is "${name}".`,
  ].join('\n');
}

// ---------------------------------------------------------------- 模型直连

/**
 * 出问题时用来定位的上下文：**请求到底打给了谁、等了多久**。
 *
 * 之前只有一句「请求超时了：端点可能没响应，或者模型太慢」—— 信息量等于零，
 * 用户只能拿着截图来问。把地址、模型、耗时一起报出来，问题基本能自己看明白。
 */
interface Attempt {
  endpoint: string;
  model: string;
  started: number;
  /** 已经接上流了 —— 用来区分「完全没响应」和「答到一半断了」 */
  streaming?: boolean;
}

function elapsed(at: Attempt): string {
  return ((Date.now() - at.started) / 1000).toFixed(1);
}

/** 去掉协议头，面板窄，省点地方 */
function short(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, '');
}

function where(at: Attempt): string {
  return `${short(at.endpoint)} · ${at.model}`;
}

/** 把各种失败翻译成「人话 + 下一步怎么办」，并带上「打给谁、等了多久」 */
function describeError(error: unknown, at: Attempt): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return at.streaming
      ? `答到一半卡住了（${elapsed(at)}s 没有新数据）。 ${where(at)}`
      : `等了 ${elapsed(at)}s 没有任何响应。最常见的原因是模型太慢 —— ` +
          `思考型模型（glm-5、glm-4.7 这类）会先自己推理很久却不吐正文。 ${where(at)}`;
  }
  if (error instanceof TypeError) {
    // fetch 抛 TypeError 基本只有两种情况：断网，或被 CORS 拦掉
    return navigator.onLine
      ? `${short(at.endpoint)} 连不上：地址可能写错了，或者这个端点不允许浏览器直连（CORS）。模型：${at.model}`
      : '当前网络似乎断了。';
  }
  return `${String(error)} · ${where(at)}`;
}

/**
 * 把网关塞在响应体里的**真正原因**捞出来。
 *
 * 各家（OpenRouter、阿里云百炼、DeepSeek…）失败时都会给一句话，
 * 例如 `{"error":{"message":"Model not exist."}}`。只丢一个状态码出来，
 * 人就只能对着 404 猜；把这句话原样透出来，问题基本上一眼可见。
 */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (!raw) return '';
    try {
      const data = JSON.parse(raw) as {
        error?: { message?: string } | string;
        message?: string;
      };
      const msg = typeof data.error === 'string' ? data.error : data.error?.message;
      return (msg || data.message || '').trim().slice(0, 200);
    } catch {
      // 不是 JSON（网关丢回一个 HTML 错误页 / 反向代理的纯文本），压成一行原文
      return raw
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
    }
  } catch {
    return '';
  }
}

function httpHint(status: number): string {
  if (status === 401 || status === 403) return 'Key 无效，或者这个 Key 没有该模型的权限。';
  if (status === 404)
    return '404 一般是两件事之一：接口地址没写全（要带 /chat/completions），或者模型名在这个端点上不存在。';
  if (status === 400 || status === 422) return '请求被拒，多半是模型名不对，或者这个模型不接受当前参数。';
  if (status === 429) return '触发限流或额度用尽，等一会儿再试。';
  if (status >= 500) return '对方服务端出错了，不是你的配置问题。';
  return `请求被拒绝（HTTP ${status}）。`;
}

/** 发一次 POST。抽出来是为了「摘掉 enable_thinking 重试一次」那条路能复用 */
function postChat(
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      // OpenRouter 用它区分调用来源，别的网关会忽略
      'X-Title': 'homepage-pet',
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * 请求体。`thinkingFlag=false` 时摘掉 `enable_thinking`，
 * 给「严格校验参数、不认识的参数直接报 400」的网关（如 OpenAI 官方）重试用。
 */
function chatBody(
  input: string,
  options: AskOptions,
  model: string,
  thinkingFlag: boolean
): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt(options) },
      ...options.history.slice(-pet.historyTurns * 2),
      { role: 'user', content: input },
    ],
    // 给到 maxAnswerTokens 而不是死抠一个很小的数：字数由 maxBubbleChars 管，
    // token 上限只是别让它写成长文。两者要配套，否则会先被 token 截断一次。
    // 注意它**管不住思维链**：实测 max_tokens=200 时 glm-5 照样吐了 1206 字。
    // 真正管住思维链的是 disableThinking。
    max_tokens: pet.maxAnswerTokens,
    temperature: 0.85,
    ...(pet.stream ? { stream: true } : {}),
    ...(pet.disableThinking && thinkingFlag ? { enable_thinking: false } : {}),
  };
}

/**
 * 读 SSE 流，返回「目前收到的正文」和「是否被中途掐断」。
 *
 * 两个坑：
 *   1. 一个 chunk 可能从中间切断一行 JSON —— 所以按行攒 buffer，半个的留到下一轮
 *   2. 思考型模型会先吐很久 `reasoning_content`（正文一个字都没有）。
 *      那些分片也算「有数据」，不会被误判成卡死，只是得继续等。
 *      真正解决它的是 disableThinking，这里只是兜底。
 */
async function readStream(
  res: Response,
  options: AskOptions,
  arm: (ms: number) => void
): Promise<{ text: string; stalled: boolean }> {
  const body = res.body;
  if (!body) return { text: '', stalled: false };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stalled = false;
  let finished = false;

  while (!finished) {
    // 每读到一段就重置静默计时 —— 只有「一直没动静」才算死，总时长不设限
    arm(pet.streamIdleMs);
    let done = false;
    let bytes: Uint8Array | undefined;
    try {
      const result = await reader.read();
      done = result.done;
      bytes = result.value;
    } catch (error) {
      // 被静默超时打断：已经攒到的半句照样交付，比整段丢掉有用
      if (text) {
        stalled = true;
        break;
      }
      throw error;
    }
    if (done) break;
    if (!bytes) continue;

    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') {
        finished = true;
        break;
      }
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) {
          text += piece;
          options.onDelta?.(text);
        }
      } catch {
        // 半行 JSON，忽略；下一轮 buffer 补齐后会重新解析
      }
    }
  }

  try {
    await reader.cancel();
  } catch {
    // 流已经自然结束，cancel 会抛，无所谓
  }
  return { text: text.trim(), stalled };
}

async function askModel(input: string, options: AskOptions): Promise<ChatReply> {
  const key = readSetting(SECRET.key);
  // 归一化放在这里而不是保存时：即使用户粘的是基址、而且从没点过保存，
  // 这次请求也能打对地方
  const endpoint = normalizeEndpoint(readSetting(SECRET.endpoint) || pet.endpoint);
  const model = readSetting(SECRET.model) || pet.model;
  const at: Attempt = { endpoint, model, started: Date.now() };

  const ctrl = new AbortController();
  let timer = 0;
  /**
   * 重新计时。**超时语义分两段**：
   *   请求阶段 → 首字节上限（pet.timeoutMs）
   *   流式阶段 → 静默上限（pet.streamIdleMs），总时长不设限
   * 之前全程只有一个「整段生成 20 秒」的硬墙，慢模型必然失败 —— 那正是
   * 「问什么都是超时」的根因。
   */
  const arm = (ms: number): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => ctrl.abort(), ms);
  };
  const signal = options.signal ?? ctrl.signal;

  const fail = (detail: string): ChatReply => ({
    text: pickLine('error', options.locale, options.character),
    source: 'local',
    detail,
  });

  try {
    arm(pet.timeoutMs);
    let res = await postChat(endpoint, key, chatBody(input, options, model, true), signal);

    // 网关不认识 enable_thinking（OpenAI 官方接口就会这么报）→ 摘掉重试一次
    if (pet.disableThinking && (res.status === 400 || res.status === 422)) {
      const refused = await readErrorBody(res);
      res = await postChat(endpoint, key, chatBody(input, options, model, false), signal);
      if (!res.ok) {
        const why = (await readErrorBody(res)) || refused;
        return fail([why, httpHint(res.status), where(at)].filter(Boolean).join(' · '));
      }
    }

    if (!res.ok) {
      // 优先显示网关自己那句话，后面再缀上「怎么办」和「打给谁」
      const why = await readErrorBody(res);
      return fail([why, httpHint(res.status), where(at)].filter(Boolean).join(' · '));
    }

    // 流式：网关通常会照做，但忽略 stream 参数的也不少 —— 按 Content-Type 判断
    const type = res.headers.get('content-type') ?? '';
    if (pet.stream && res.body && /event-stream/i.test(type)) {
      at.streaming = true;
      const { text, stalled } = await readStream(res, options, arm);
      if (!text) {
        return fail(
          stalled
            ? `端点接上了但一直没吐正文（等了 ${elapsed(at)}s）。多半是模型在「思考」—— ` +
                `换成 qwen-turbo / qwen-plus / kimi-k2.5 这类快模型会明显好转。 ${where(at)}`
            : `端点返回了空内容。 ${where(at)}`
        );
      }
      // 先把链接摘出去，再给正文收口 —— 顺序反了就等于把链接一起算进字数
      const { text: prose, links } = detachDocLinks(text, options.docs);
      return {
        // 整段都是链接（罕见）时正文会空掉，那就退回原文，至少不给出一个空气泡
        text: clip(prose || text),
        source: 'llm',
        links,
        detail: stalled ? `回答被截断了（${elapsed(at)}s 内没有新数据）。` : undefined,
      };
    }

    // 非流式，或网关忽略了 stream 参数
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    if (!data) {
      return fail(`端点返回的不是 JSON，可能被网关或反向代理改写了。 ${where(at)}`);
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return fail(`端点返回了空内容。 ${where(at)}`);
    }
    const detached = detachDocLinks(text, options.docs);
    return { text: clip(detached.text || text), source: 'llm', links: detached.links };
  } catch (error) {
    return fail(describeError(error, at));
  } finally {
    window.clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ 连接自检

export interface ProbeResult {
  ok: boolean;
  /** 直接给访客看的一句话结论 */
  message: string;
  /** 模型名不存在时，从这个端点**实际可用**的清单里挑出的替代项 */
  suggestions?: string[];
  /** 最终会请求的完整地址，让人一眼看见后缀补上没有 */
  endpoint: string;
  /** 实测耗时（毫秒）。只读探测测不出来，只有真跑一次对话才有 */
  latencyMs?: number;
}

/**
 * 常见通用对话模型，按「快、稳、到处都有」排序。
 *
 * 为什么需要点名单：只靠名字长度排会推出 `gui-plus`、`qvq-plus` 这类短名字的
 * 边缘模型 —— 真实踩到过，那种推荐等于添乱。名单里没有才退回启发式排序。
 * 别把它当白名单：它只影响「模型名填错时给什么建议」，不影响任何请求逻辑。
 */
const FAVORED = [
  'qwen-plus',
  'qwen-turbo',
  'qwen-max',
  'kimi-k2.5',
  'deepseek-chat',
  'gpt-4o-mini',
  'gpt-4o',
  'glm-4.7',
  'llama-3.3-70b-versatile',
];

/**
 * 从 /models 返回里挑几个「适合这个宠物」的名字。
 *
 * 两步筛：
 *   1. 排掉图像 / 语音 / 向量 / 重排 / OCR —— 它们也在清单里，但对宠物毫无用处
 *   2. **快模型优先**。这条是被真实事故逼出来的：早先只按名字长度排序，
 *      结果把 glm-5 排在最前，而它正文首字要 22 秒 —— 配完就是「每次都超时」。
 */
function suggestModels(ids: readonly string[], current: string): string[] {
  const chatLike = ids.filter(
    (id) => !/image|vision|-vl|ocr|embed|rerank|speech|audio|asr|tts|realtime|video|omni|-mt-|math|coder|character/i.test(id)
  );
  const available = (chatLike.length ? chatLike : ids).filter((id) => id !== current);

  /** 思考型排最后：正文之前它先自己推理很久，对一句 90 字的回答是纯浪费 */
  const rank = (id: string): number => {
    if (/think|reason|-r1|o1-|o3-|qwq|qvq|gui-/i.test(id)) return 2;
    if (/turbo|flash|plus|mini|small|lite/i.test(id)) return 0;
    return 1;
  };

  const favored = FAVORED.filter((id) => available.includes(id));
  const rest = available
    .filter((id) => !FAVORED.includes(id))
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b));

  return [...favored, ...rest].slice(0, 3);
}

/**
 * 自检用的迷你请求：就一句「在吗」，能答上来就说明整条链路（地址、Key、模型）
 * 都真的通了，而且能顺手量出**真实耗时**。
 *
 * 为什么非跑不可：GET /models 只能证明「清单里有这个名字」，证明不了「它答得动、
 * 答得快」。上次就是只做只读探测，用户看到 ✓ 之后照样每次超时 —— 那个 ✓ 是假的安全感。
 *
 * 与真实提问的两点差别，都是刻意的：
 *   - 请求形状**完全一致**（同样带 stream 和 enable_thinking），否则会误报。
 *     实测有的模型只支持流式（qwq-plus 会报 "only support stream mode"），
 *     有的模型反而拒绝 enable_thinking（qwen3-next-…-thinking 报 400）——
 *     自检必须走和正式提问同一条路，才测得出真东西。
 *   - 自检要一个**有界**的结果，所以这里用总时长上限，不像正式提问那样
 *     只在「流中静默」时才计时。超出就报「太慢」，这正是要告诉用户的。
 */
async function smokeTest(
  endpoint: string,
  key: string,
  model: string
): Promise<{ ok: boolean; latencyMs: number; note: string }> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), pet.timeoutMs);
  const started = Date.now();
  const at: Attempt = { endpoint, model, started };
  const body = (thinkingFlag: boolean): Record<string, unknown> => ({
    model,
    messages: [{ role: 'user', content: '在吗' }],
    max_tokens: 24,
    temperature: 0.5,
    ...(pet.stream ? { stream: true } : {}),
    ...(pet.disableThinking && thinkingFlag ? { enable_thinking: false } : {}),
  });

  try {
    let res = await postChat(endpoint, key, body(true), ctrl.signal);
    // 有的模型反过来拒绝 enable_thinking —— 摘掉重试一次
    if (pet.disableThinking && (res.status === 400 || res.status === 422)) {
      res = await postChat(endpoint, key, body(false), ctrl.signal);
    }
    if (!res.ok) {
      const why = await readErrorBody(res);
      return { ok: false, latencyMs: Date.now() - started, note: why || httpHint(res.status) };
    }

    const type = res.headers.get('content-type') ?? '';
    let content = '';
    if (pet.stream && res.body && /event-stream/i.test(type)) {
      at.streaming = true;
      // 传空 arm：自检不要「静默重计时」，上面那只总时长计时器说了算
      const read = await readStream(res, { locale: 'zh', docs: [], history: [] }, () => {});
      content = read.text;
    } else {
      const data = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
      } | null;
      content = data?.choices?.[0]?.message?.content?.trim() ?? '';
    }

    const latencyMs = Date.now() - started;
    return { ok: !!content, latencyMs, note: content ? '' : `端点在，但 ${latencyMs}ms 内没返回可读内容。` };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, note: describeError(error, at) };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 「测试连接」按钮背后的逻辑，两步：
 *
 *   1. **只读探测**（GET /models）—— 一次同时验证两件最容易错的事：
 *      Key 是否有效（401 会当场暴露）、模型名在不在这家的清单里。
 *      顺带把最终的完整地址回显出来，省得人对着两串几乎一样的 URL 反复怀疑。
 *   2. **真发一句话** —— 量出真实耗时。偏慢就直说「偏慢，建议换模型」，
 *      而不是给一个「连接正常」然后让用户去撞超时。
 *
 * 端点不提供 /models 时不算失败，降级成「只做第 2 步」——
 * 不因为探测手段不可用就误报配置有问题。
 */
export async function probe(): Promise<ProbeResult> {
  const key = readSetting(SECRET.key);
  const endpoint = normalizeEndpoint(readSetting(SECRET.endpoint) || pet.endpoint);
  const model = readSetting(SECRET.model) || pet.model;

  if (!key) return { ok: false, message: '先填 Key，再点测试。', endpoint };

  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 15_000);
  let ids: string[] = [];
  try {
    const res = await fetch(modelsUrl(endpoint), {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const why = await readErrorBody(res);
      return { ok: false, message: why || httpHint(res.status), endpoint };
    }

    const data = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
    ids = (data?.data ?? []).map((m) => m.id).filter((id): id is string => !!id);

    if (ids.length && !ids.includes(model)) {
      return {
        ok: false,
        message: `端点通了、Key 也有效，但模型名「${model}」不在可用清单里。`,
        suggestions: suggestModels(ids, model),
        endpoint,
      };
    }
  } catch (error) {
    // 拿不到清单不是致命问题，继续往下真发一句话
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, message: describeError(error, { endpoint, model, started: Date.now() - 15_000 }), endpoint };
    }
  } finally {
    window.clearTimeout(t);
  }

  // ---- 第二步：真发一句话，量真实耗时 ----
  const smoke = await smokeTest(endpoint, key, model);
  const secs = (smoke.latencyMs / 1000).toFixed(1);

  if (!smoke.ok) {
    return {
      ok: false,
      message: `模型「${model}」能查到，但真发一句话没拿到回答：${smoke.note}`,
      suggestions: ids.length ? suggestModels(ids, model) : undefined,
      endpoint,
      latencyMs: smoke.latencyMs,
    };
  }
  if (smoke.latencyMs >= pet.probeSlowMs) {
    return {
      ok: true,
      message: `连接正常，「${model}」可用 —— 但实测 ${secs} 秒，偏慢，对话会卡。建议换个快模型。`,
      suggestions: ids.length ? suggestModels(ids, model) : undefined,
      endpoint,
      latencyMs: smoke.latencyMs,
    };
  }
  return {
    ok: true,
    message: `连接正常，模型「${model}」可用，实测 ${secs} 秒。`,
    endpoint,
    latencyMs: smoke.latencyMs,
  };
}

// ---------------------------------------------------------------- 本地回答

/** 没接模型时，命中条目就明说去哪看；否则给一句台词 */
function localAnswer(hit: SiteDoc | null, locale: Locale, character?: string): string {
  if (!hit) return pickLine('noKey', locale, character);
  return locale === 'zh'
    ? `你要找的应该是《${hit.title}》，点下面去看。`
    : `You probably want "${hit.title}" — link below.`;
}

// ------------------------------------------------------------------ 入口

export async function ask(input: string, options: AskOptions): Promise<ChatReply> {
  const query = input.trim();
  if (!query) return { text: pickLine('empty', options.locale, options.character), source: 'local' };

  // 先检索：命中的链接不管最终谁回答都挂上，模型答得再花哨也不影响它指路
  const hit = matchDoc(query, options.docs);
  const retrieved: ChatLink[] = hit ? [{ url: hit.url, label: hit.title }] : [];

  if (!readSetting(SECRET.key)) {
    return { text: localAnswer(hit, options.locale, options.character), source: 'local', links: retrieved };
  }

  const replied = await askModel(query, options);
  // 模型自己引用了文章就不再补检索结果：那份清单已经具体到篇，
  // 后面再缀一个「博客」首页反而像噪声。检索是**兜底**，不是常驻附加项。
  const links = replied.links?.length ? replied.links : retrieved;
  return { ...replied, links: links.length ? links : undefined };
}

/**
 * 文章清洗：把抓到的 Markdown 收拾成能直接进草稿的样子，外加一个 HTML→Markdown
 * 的降级通道（服务不可达时靠"复制粘贴正文"那条兜底路径要用）。
 *
 * 全是纯函数（不碰 DOM、不碰网络），所以能用 node 直接跑用例验证——清洗规则最怕
 * 越改越离谱，有测试兜着才敢动。
 *
 * 这里做四件事，按重要性排序：
 * 1. 中文软换行合并：crawl4ai 是按视觉行输出的，中文段落被拆成多行，
 *    渲染出来每个换行会变成一个空格（"这带来 两个后果"）——必须按 CJK 规则无空格拼接
 * 2. 去页脚噪音：订阅 / 相关阅读 / 赞赏 / 版权这类短行直接丢，并统计丢了几行
 * 3. 结构规整：标题前留空行、表格与列表前的空行、连续空行压成一个
 * 4. 图片 URL 替换：正文图转存到仓库后要把外链换成本站地址
 */

/** 结构性行的开头：标题、列表、引用、表格、代码围栏、分隔线、HTML 标签 */
const STRUCTURAL =
  /^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|!\[|<[a-zA-Z/!]|\s*$)/;

/** 句末标点：以这些结尾的行不该和下一行拼在一起（说明本来就是一个独立句子/段落） */
const SENTENCE_END = /[。！？；：!?;:）”』】》]$/;

/** 短行噪音（长度上限 + 匹配），避免把正经内容误伤 */
const NOISE: RegExp[] = [
  /^(?:订阅|关注(?:我|我们|公众号)|扫码关注|点赞|在看|转发|分享到.{0,8}|收藏(?:这|本)文|赞赏|打赏|赞助|广告)/,
  /^(?:阅读全文|点击(?:阅读原文|这里)|原文链接|查看原文|返回顶部|上一篇|下一篇|相关(?:阅读|文章)|推荐(?:阅读|文章)|猜你(?:喜欢|想看)|目录)/,
  /^(?:comments?|leave a comment|subscribe|sign ?up|newsletter|share this|sponsored by|advertisement|related posts|read more|posted (?:on|by)|all rights reserved)\b/i,
  // 注意别加 \b：© 不是单词字符，\b 匹配不上（这里踩过一次）
  /^(?:©|copyright|版权所有|未经(?:作者)?许可)/i,
  /^(?:分享|评论|点赞|阅读|浏览)\s*[\d,.]*\s*$/,
  // 元信息行：「2026年9月4日 07:59 | 留言（22）」这类：以计数结尾就是元信息，
  // 不用去解析日期格式（日期里带空格的情况太多，写正则反而更脆）
  /^(?:.{0,36}?)(?:留言|评论|阅读|浏览|点赞|分享)[（(]?\d+[）)]?\s*$/,
  /^[-–—=*_·\s]{6,}$/,
];

const NOISE_MAX = 40;

/**
 * 不限长度的噪音：版权行经常长到 60+ 字符（"Copyright © 2013-2026 All Rights Reserved.
 * 备案号：闽ICP备15012807号-1"），按短行匹配会漏；但也不能随便放宽——下面这些
 * 模式几乎只出现在页脚，放宽是安全的。
 */
const NOISE_ANY: RegExp[] = [
  /^(?:©|copyright|版权所有|all rights reserved)/i,
  /^(?:.{0,80}?)(?:ICP备|公安备案|备案号)/,
];

function isNoise(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (NOISE_ANY.some((re) => re.test(text))) return true;
  if (text.length > NOISE_MAX) return false;
  return NOISE.some((re) => re.test(text));
}

// ---------------------------------------------------------------- 页头 / 页脚样板
/**
 * Markdown 链接（含可选 title）。链接目标要容忍转义括号——导航里常见
 * `javascript:void\(0\)` 这种地址，写成 `[^)\s]+` 会匹配不全，后面按"可见文字"
 * 或"整行是否只有链接"判断时就会漏判（踩过两次）。
 */
const LINK = /\[([^\]]*)\]\((?:\\.|[^)\\])*\)/g;
/** 短标签行的长度上限：栏目名、"暂无记录"这类 */
const LABEL_MAX = 20;

/**
 * 「链接汤」判定：一行里 ≥3 个链接，且可见文字基本由链接标签组成。
 *
 * 导航栏 / 目录 / 相关阅读就是这个形态。按行数判断是抓不到的——crawl4ai 会把
 * 整个侧栏压成**一整行**（实测 runoob：一行 21 个链接），所以只能看链接密度。
 */
export function isLinkSoup(line: string, minLinks = 3, minDensity = 0.6): boolean {
  const links = [...line.matchAll(LINK)];
  if (links.length < minLinks) return false;
  const labelChars = links.reduce((n, m) => n + m[1].trim().length, 0);
  // 可见文字 = 把每个链接换成它的标签文字，再去掉标记符号与空白
  const visible = line.replace(LINK, '$1').replace(/[*_`#>\s]/g, '').length;
  // 全是空标签的图标链接行（`[ ](javascript:void(0) "返回顶部")`）：可见文字几乎为零
  if (visible <= 12) return true;
  return labelChars / visible >= minDensity;
}

/** 整行只有一张图（页脚二维码、分隔图这类，出现在首尾肯定不是正文） */
function isOnlyImage(line: string): boolean {
  return /^\s*!\[[^\]]*\]\(.*\)\s*$/.test(line);
}

/** 非全局版：给 test() 用（LINK 带 g，test 会推 lastIndex，踩过这个坑） */
const HAS_LINK = /\[[^\]]*\]\([^)]*\)/;

/**
 * 「标签 + 链接」行：页脚那排入口就是这形态（`在线实例·[JavaScript 实例](…)`、
 * `· [免责声明](…)`）。判据是链接之外的文字很短、且整行不以句末标点结尾——
 * 正文里嵌一行"详见 [官方文档](…)。"会带句号，不会中招。
 */
function isLabelLink(line: string): boolean {
  const text = line.trim();
  if (!text || SENTENCE_END.test(text)) return false;
  if (!HAS_LINK.test(text)) return false;
  const rest = text.replace(LINK, ' ').replace(/[·|—–*_`\s]/g, '');
  return rest.length <= LABEL_MAX;
}

/** 短标签行：栏目名、"暂无记录"这种，既不成句也不是列表项 */
function isLabel(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > LABEL_MAX) return false;
  if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|!\[)/.test(text)) return false;
  if (SENTENCE_END.test(text)) return false;
  return !/[。！？.!?,，；;]/.test(text);
}

/**
 * 「只有链接的列表项」：整页抓取时导航是一行一个子弹链接（`* [首页](…)`），
 * 链接密度判不出来（每行只有 1 个链接），但形态很固定。
 * 只在页头/页脚这两段里算样板——正文中间的单链接列表可能是正经参考链接。
 */
function isLinkBullet(line: string): boolean {
  const m = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
  if (!m) return false;
  const rest = m[1].trim();
  // 链接目标要放宽：导航里常见 javascript:void\(0\) 这种带转义括号的地址，
  // 用严格的 [^)\s]+ 匹配不到（踩过一次）
  return /^\[[^\]]*\]\(.*\)$/.test(rest) || /^<[^>\s]+>$/.test(rest);
}

/** 整行只有链接、没有别的文字（站点 banner 那种「# [站点名](首页)」） */
function isOnlyLink(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const links = [...t.matchAll(LINK)];
  if (!links.length) return false;
  return t.replace(LINK, '').replace(/[*_`\s]/g, '').length <= 4;
}

/** 诊断用：一行属于哪类样板（不是样板返回 ''），测试里按它逐行核对 */
export function classifyBoilerplate(line: string): string {
  if (!line.trim()) return 'blank';
  if (isNoise(line)) return 'noise';
  if (isHeadingLine(line)) return isOnlyLink(line.replace(/^\s*#+\s*/, '')) ? 'brand' : 'heading';
  if (isLinkSoup(line)) return 'soup';
  if (isLinkBullet(line)) return 'linkbullet';
  if (isLabel(line)) return 'label';
  return 'text';
}

const isHeadingLine = (line: string): boolean => /^\s{0,3}#{1,6}\s/.test(line);

/**
 * 砍掉开头的样板：站点 banner（整行就是一个链接的标题）、栏目名、链接汤、
 * 以及原本属于导航的那几个小标题，直到第一段真正的正文为止。
 *
 * 只在「确实见过样板」时才砍（sawNoise）——一篇开头就是小标题的文章不该被误伤。
 */
function stripHead(lines: string[]): { lines: string[]; dropped: number } {
  let i = 0;
  let sawNoise = false;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const branding = isHeadingLine(line) && isOnlyLink(line.replace(/^\s*#+\s*/, ''));
    if (isLinkSoup(line) || isLabel(line) || isLinkBullet(line) || isOnlyImage(line) || isLabelLink(line) || branding) {
      sawNoise = true;
      i += 1;
      continue;
    }
    if (isHeadingLine(line)) {
      if (sawNoise) {
        i += 1;
        continue;
      }
      break;
    }
    break; // 第一段正文：到此为止
  }
  return sawNoise ? { lines: lines.slice(i), dropped: i } : { lines, dropped: 0 };
}

/** 砍掉结尾的样板：页脚链接、栏目名、备案号、以及它们上面的那几个小标题 */
function stripTail(lines: string[]): { lines: string[]; dropped: number } {
  let end = lines.length;
  let sawNoise = false;
  while (end > 0) {
    const line = lines[end - 1];
    if (!line.trim()) {
      end -= 1;
      continue;
    }
    if (isNoise(line) || isLinkSoup(line) || isLabel(line) || isLinkBullet(line) || isOnlyImage(line) || isLabelLink(line)) {
      sawNoise = true;
      end -= 1;
      continue;
    }
    if (isHeadingLine(line)) {
      if (sawNoise) {
        end -= 1;
        continue;
      }
      break;
    }
    break;
  }
  return sawNoise ? { lines: lines.slice(0, end), dropped: lines.length - end } : { lines, dropped: 0 };
}

/**
 * 摘要：优先用页面 meta，其次正文首段。按句末标点截断——
 * 硬截断会切出"…它不仅"这种半句（导入 runoob 那篇就是这样）。
 */
export function clipDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const cut = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? ')
  );
  if (cut >= max * 0.4) return head.slice(0, cut + 1).trim();
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** 中日韩字符（含假名与全角标点区间）：判断拼接时要不要加空格 */
export function isCjk(ch: string): boolean {
  return /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u3040-\u30ff]/.test(ch);
}

/**
 * 拼接处要不要补空格。
 *
 * 中文之间当然不加；麻烦的是中英边界，两种真实情况都不少见：
 *   「一篇\nsrc/content/posts/zh/x.md\n的 id 是…」→ 原文有空格，要补
 *   「发布于\n2026年9月」→ 原文没空格，不能补
 * 区分办法：另一侧以数字开头就不补（中文紧接数字是常态），
 * 以字母/路径符号开头就补（英文词、路径、代码片段）。
 */
function boundaryNeedsSpace(prev: string, next: string): boolean {
  const left = prev.slice(-1);
  const right = next.slice(0, 1);
  const leftCjk = isCjk(left);
  const rightCjk = isCjk(right);

  if (leftCjk && rightCjk) return false;
  if (leftCjk !== rightCjk) {
    const asciiFirst = leftCjk ? right : left;
    if (/[0-9]/.test(asciiFirst)) return false;
    return /[A-Za-z/`\\_~$@]/.test(asciiFirst);
  }
  // 纯 ASCII 之间：照常补空格
  return true;
}

function joinParagraph(prev: string, next: string): string {
  return boundaryNeedsSpace(prev, next) ? `${prev} ${next}` : prev + next;
}

export interface CleanResult {
  text: string;
  /** 被丢掉的噪音行（便于在界面上说明"去掉了什么"） */
  removed: string[];
  /** 合并了多少个软换行 */
  merged: number;
  /** 页头样板去掉的行数（导航、栏目名、站点 banner） */
  head: number;
  /** 页脚样板去掉的行数（页脚链接、备案号、相关阅读） */
  tail: number;
}

/**
 * 段落合并：连续的非结构行拼成一段。
 * 只处理「软换行」，遇到标题/列表/引用/代码/表格一律断开，保证结构不被打乱。
 */
function mergeSoftWraps(lines: string[]): { lines: string[]; merged: number } {
  const out: string[] = [];
  let merged = 0;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const prev = out.length ? out[out.length - 1] : '';

    const canMerge =
      line.trim() !== '' &&
      prev.trim() !== '' &&
      !STRUCTURAL.test(line) &&
      !STRUCTURAL.test(prev) &&
      !SENTENCE_END.test(prev) &&
      !/^\s*[-*+|]/.test(prev);

    if (canMerge) {
      out[out.length - 1] = joinParagraph(prev, line.trim());
      merged += 1;
      continue;
    }
    out.push(line);
  }

  return { lines: out, merged };
}

/** 主入口：一轮清洗 */
export function cleanMarkdown(input: string): CleanResult {
  const removed: string[] = [];

  // 归一化不可见字符与"•"这种非标准列表符号
  let text = input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/^\s*[·•▪]\s+/gm, '- ');

  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (isNoise(line)) {
      removed.push(line.trim());
      continue;
    }
    // 正文中间也砍「链接堆」，但门槛更高（≥4 个链接且基本只有标签）：导航/相关阅读
    // 常被 crawl4ai 压成这样一行，靠首尾裁剪够不着（它会卡在某一行"文本"上）。
    // 门槛不放低是怕误伤「延伸阅读：[A](…) [B](…) [C](…)」这种正经行。
    if (isLinkSoup(line, 4, 0.7)) {
      removed.push(line.trim());
      continue;
    }
    kept.push(line);
  }

  // 页头/页脚必须在合并软换行之前砍：导航那一行会被 mergeSoftWraps 和紧邻的正文
  // 粘成一行（"AI Agent 教程" + 21 个链接 + 正文），粘上之后就再也认不出来了
  const headTrim = stripHead(kept);
  const tailTrim = stripTail(headTrim.lines);
  const { lines, merged } = mergeSoftWraps(tailTrim.lines);

  // 连续重复行（同一个"订阅"按钮出现两次之类）
  const dedup: string[] = [];
  for (const line of lines) {
    if (line.trim() && dedup.length && dedup[dedup.length - 1].trim() === line.trim()) continue;
    dedup.push(line);
  }

  // 压空行 + 标题/代码围栏前后留空行
  const out: string[] = [];
  let inFence = false;
  for (const line of dedup) {
    const isHeading = /^\s{0,3}#{1,6}\s/.test(line);
    const isFence = /^\s{0,3}(?:```|~~~)/.test(line);
    // 只有"开围栏"前面要空行；闭合围栏前面留空行会把代码块内容撑出一个尾巴
    const needsGapBefore = isHeading || (isFence && !inFence);
    const prev = out.length ? out[out.length - 1] : '';
    if (needsGapBefore && prev.trim() !== '') out.push('');
    if (line.trim() === '' && prev.trim() === '') continue;
    out.push(line);
    if (isFence) inFence = !inFence;
  }

  text = out.join('\n').trim();

  // 围栏没闭合就补一个，否则后面整段都会被当代码
  const fences = (text.match(/^\s{0,3}(?:```|~~~)/gm) ?? []).length;
  if (fences % 2 === 1) text += '\n```';

  return { text, removed, merged, head: headTrim.dropped, tail: tailTrim.dropped };
}

// ---------------------------------------------------------------- 结构提取
export function firstHeading(md: string): string {
  for (const line of md.split('\n')) {
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) return m[1].replace(/[*_`]/g, '').trim();
  }
  return '';
}

/** 第一段正文（用来当 description 兜底） */
export function firstParagraph(md: string): string {
  for (const block of md.split(/\n{2,}/)) {
    const text = block.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^[#>|\-*]|^!\[|^\d+[.)]\s/.test(text)) continue;
    return text;
  }
  return '';
}

/** 摘要模式：保留开头若干段，其余丢掉（按空行分块） */
export function takeParagraphs(md: string, count: number): string {
  const blocks = md.split(/\n{2,}/);
  return blocks.slice(0, count).join('\n\n').trim();
}

export interface MdImage {
  alt: string;
  url: string;
}

/** 正文里的图片（Markdown 语法 + 少量 HTML <img>） */
export function listImages(md: string): MdImage[] {
  const out: MdImage[] = [];
  for (const m of md.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    out.push({ alt: m[1], url: m[2] });
  }
  for (const m of md.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    out.push({ alt: '', url: m[1] });
  }
  return out;
}

/** 把图片地址替换成站内地址（转存成功后调用） */
export function replaceImageUrls(md: string, map: Map<string, string>): string {
  let out = md;
  for (const [from, to] of map) {
    if (from === to) continue;
    out = out.split(`](${from})`).join(`](${to})`);
    out = out.split(`src="${from}"`).join(`src="${to}"`);
    out = out.split(`src='${from}'`).join(`src='${to}'`);
  }
  return out;
}

// ---------------------------------------------------------------- HTML → Markdown
const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const key = name.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith('#')) {
      const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    return whole;
  });
}

/**
 * 极简 HTML → Markdown，只服务于"从网页复制正文粘贴进来"这条路。
 * 不追求完备：覆盖标题/段落/列表/引用/代码/粗斜体/链接/图片/换行就够，
 * 认不出的标签一层层剥掉，宁可少样式也不要留一堆 <div>。
 */
export function htmlToMarkdown(html: string): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|iframe|svg|form|button|nav|footer|header)\b[\s\S]*?<\/\1>/gi, '');

  // 代码块先摘出来，避免里面的尖括号被后续规则吃掉
  const blocks: string[] = [];
  out = out.replace(/<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_all, attrs: string, code: string) => {
    const lang = /(?:language-|lang-)([\w+#-]+)/.exec(attrs)?.[1] ?? '';
    const body = decodeEntities(code.replace(/<[^>]+>/g, '')).replace(/\s+$/, '');
    blocks.push(`\`\`\`${lang}\n${body}\n\`\`\``);
    // 前后留空行：不然接在代码块后面的段落会和闭合围栏粘在一起
    return `\n\n\u0000BLOCK${blocks.length - 1}\u0000\n\n`;
  });

  out = out
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_a, level: string, text: string) => `\n\n${'#'.repeat(Number(level))} ${text.trim()}\n\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_a, text: string) => `\n\n${text.trim().replace(/^/gm, '> ')}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_a, text: string) => `\n- ${text.trim()}`)
    .replace(/<\/(?:ul|ol)>/gi, '\n\n')
    .replace(/<(?:ul|ol)\b[^>]*>/gi, '')
    .replace(/<\/(?:p|div|section|article|tr)>/gi, '\n\n')
    .replace(/<(?:p|div|section|article|tr)\b[^>]*>/gi, '')
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_a, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, '').trim();
      if (!label) return '';
      return label === href ? `<${href}>` : `[${label}](${href})`;
    })
    .replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi, (_a, src: string) => `\n\n![](${src})\n\n`)
    .replace(/<[^>]+>/g, '');

  out = decodeEntities(out).replace(/\u0000BLOCK(\d+)\u0000/g, (_a, i: string) => blocks[Number(i)] ?? '');
  return cleanMarkdown(out).text;
}

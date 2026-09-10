import { setStatus } from './dom';
import { crawlUrl, describeFailure, type CrawlResult } from './crawl';
import {
  cleanMarkdown,
  clipDescription,
  firstHeading,
  firstParagraph,
  htmlToMarkdown,
  listImages,
  replaceImageUrls,
  takeParagraphs,
} from './cleanArticle';
import { uploadOne } from './upload';
import { today, toSlug, type PostFrontmatter } from './serialize';

/**
 * 「从网址导入」的流水线：拿到正文 → 清洗 → 图片转存 → 拼一篇草稿。
 *
 * 三条产品底线（都在这一步落实）：
 * 1. 产物一律 `draft: true`：自动生成的东西必须人看过才发
 * 2. 保留 `source`（原文地址）：文章页会据此把 canonical 指回原文，
 *    这是"收藏/摘录他人文章"该有的诚实，也避免自己站点被判重复内容
 * 3. 正文结构化：开头一张来源卡（原文链接 + 作者 + 抓取时间），结尾留「我的想法」，
 *    中间才是正文——让它明确是一篇"读后收藏"，而不是冒名顶替的原创
 *
 * 图片转存是可选步骤：外链图多半有防盗链，转存到 public/illustrations 之后
 * 就一劳永逸了；但浏览器直连抓图会撞 CORS（对方不给头就取不到），
 * 所以失败的那些保持原地址、如实报数，绝不静默丢掉。
 */

/** 单篇最多转存几张：一次点掉太多图会刷出一串提交，得不偿失 */
const MAX_TRANSFER_IMAGES = 12;
/** 小于这个体积的多半是图标 / 埋点像素，转存没意义 */
const MIN_IMAGE_BYTES = 3 * 1024;
const IMAGE_TIMEOUT = 20_000;

export interface ImportOptions {
  url: string;
  pasted: string;
  transferImages: boolean;
  style: 'full' | 'excerpt';
}

export interface DraftPost {
  frontmatter: PostFrontmatter;
  body: string;
}

export interface ImportOutcome {
  ok: boolean;
  draft?: DraftPost;
  /** 给人看的处理摘要（清洗掉几行、图片转存几张） */
  report: string[];
  error?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isHtml(text: string): boolean {
  return /<(?:p|div|h[1-6]|br|img|a|ul|ol|li|pre|code|blockquote)\b/i.test(text);
}

/** 去掉与标题重复的正文 H1（crawl4ai 常把标题也放进 Markdown） */
function stripTitleHeading(md: string, title: string): string {
  const lines = md.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstIndex < 0) return md;
  const match = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(lines[firstIndex]);
  if (!match) return md;
  const heading = match[1].replace(/[*_`]/g, '').trim();
  return sameTitle(heading, title) ? lines.slice(firstIndex + 1).join('\n').trim() : md;
}

/**
 * 标题比对：忽略空白与分隔符。「AI Agent 教程」和「AI Agent 教程 | 菜鸟教程」是同一篇
 * ——原标题常带站点后缀，严格相等会漏掉，正文里就多出一个重复 H1。
 */
function sameTitle(a: string, b: string): boolean {
  const norm = (s: string): string =>
    s.replace(/[\s|/\\\-–—_·,，。:：()（）[\]【】]/g, '').toLowerCase();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length >= long.length * 0.5;
}

async function fetchAsFile(url: string, name: string): Promise<File | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT) });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size < MIN_IMAGE_BYTES) return null;
    const ext = blob.type.split('/')[1]?.split('+')[0] ?? 'png';
    return new File([blob], `${name}.${ext}`, { type: blob.type });
  } catch {
    // 跨域不给头 / 防盗链 / 超时：保持原地址即可，下面会统计
    return null;
  }
}

/** 正文里把外链图转存到仓库，返回替换表与统计 */
async function transferImages(
  markdown: string,
  baseName: string
): Promise<{ markdown: string; done: number; total: number; skipped: number }> {
  const found = listImages(markdown);
  if (!found.length) return { markdown, done: 0, total: 0, skipped: 0 };

  const unique = [...new Set(found.map((image) => image.url))];
  const targets = unique.slice(0, MAX_TRANSFER_IMAGES);
  const map = new Map<string, string>();

  let done = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const url = targets[i];
    setStatus(`正在转存图片 ${i + 1}/${targets.length}…`, 'busy');
    const file = await fetchAsFile(url, `${baseName}-img${i + 1}`);
    if (!file) continue;
    const local = await uploadOne(file, `${baseName}-img${i + 1}`);
    if (local) {
      map.set(url, local);
      done += 1;
    }
  }

  return {
    markdown: replaceImageUrls(markdown, map),
    done,
    total: unique.length,
    skipped: unique.length - done,
  };
}

function buildBody(
  cleaned: string,
  opts: { url: string; title: string; author?: string; host: string; style: 'full' | 'excerpt'; notes: string[] }
): string {
  const sourceLine = opts.url
    ? `> **原文**：[${opts.title}](${opts.url})${opts.author ? ` · ${opts.author}` : ''}${
        opts.host ? ` · ${opts.host}` : ''
      }`
    : '> **来源**：手动粘贴（未记录原文地址）';
  const metaLine = `> 抓取整理于 ${today()}${opts.notes.length ? ` · ${opts.notes.join(' · ')}` : ''}`;

  const parts = [sourceLine, metaLine, ''];
  if (opts.style === 'excerpt') {
    parts.push('## 摘录', '', cleaned, '', '> （以上为开头几段的摘录，完整内容见原文）', '');
  } else {
    // 全文模式也明确标注"以下是原文"：这是转载/收藏，不是我的原创
    parts.push('## 原文', '', cleaned, '');
  }
  parts.push('---', '', '## 我的想法', '', '');
  return parts.join('\n');
}

interface AssembleContext {
  url: string;
  transferImages: boolean;
  style: 'full' | 'excerpt';
  meta: { title?: string; description?: string; author?: string; keywords?: string[] };
  report: string[];
  via: 'crawl' | 'md' | 'paste';
}

/** 摘要模式的段落数（放在这里方便调） */
export const EXCERPT_PARAGRAPHS = 3;

export async function buildDraftFromUrl(url: string, opts: ImportOptions): Promise<ImportOutcome> {
  const report: string[] = [];
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, report, error: '地址要以 http:// 或 https:// 开头。' };
  }

  setStatus('正在抓取页面…', 'busy');
  const outcome = await crawlUrl(target);
  if (!outcome.ok) {
    return { ok: false, report, error: describeFailure(outcome.failure) };
  }
  const result: CrawlResult = outcome.result;

  // 抓到 404/403 页面时 crawl4ai 也可能说"成功"：这里必须自己拦
  if (result.statusCode && result.statusCode >= 400) {
    return {
      ok: false,
      report,
      error: `目标页面返回 ${result.statusCode}，抓到的是错误页而不是正文，已放弃。`,
    };
  }

  const cleaned = cleanMarkdown(result.markdown);
  report.push(
    result.bodySource === 'fit'
      ? `正文取服务端过滤版：${result.rawLength} → ${result.markdown.length} 字符（导航/侧栏/页脚已剔掉）`
      : `正文用整页原始内容（${result.markdown.length} 字符）`,
    `规则清洗后 ${cleaned.text.length} 字符`,
    cleaned.head ? `去掉页头样板 ${cleaned.head} 行` : '',
    cleaned.tail ? `去掉页脚样板 ${cleaned.tail} 行` : '',
    cleaned.removed.length ? `去掉链接堆/推荐行 ${cleaned.removed.length} 行` : '',
    cleaned.merged ? `合并 ${cleaned.merged} 处软换行` : ''
  );
  // 上面几项有些是条件语句的结果，统一去掉空串，免得提示里出现空档
  const kept = report.filter(Boolean);
  report.length = 0;
  report.push(...kept);

  return assemble(cleaned.text, {
    url: target,
    transferImages: opts.transferImages,
    style: opts.style,
    meta: result.meta,
    report,
    via: result.via,
  });
}

/** 粘贴兜底：完全不依赖抓取服务（服务没起、站点反爬、要登录时用这条） */
export async function buildDraftFromPaste(
  text: string,
  opts: ImportOptions
): Promise<ImportOutcome> {
  const report: string[] = [];
  if (!text.trim()) return { ok: false, report, error: '粘贴框是空的。' };

  const raw = isHtml(text) ? htmlToMarkdown(text) : text;
  const cleaned = cleanMarkdown(raw);
  report.push(
    `粘贴 ${raw.length} 字符，清洗后 ${cleaned.text.length} 字符`,
    cleaned.head ? `去掉页头样板 ${cleaned.head} 行` : '',
    cleaned.tail ? `去掉页脚样板 ${cleaned.tail} 行` : '',
    cleaned.removed.length ? `去掉链接堆/推荐行 ${cleaned.removed.length} 行` : ''
  );
  const keptPaste = report.filter(Boolean);
  report.length = 0;
  report.push(...keptPaste);

  return assemble(cleaned.text, {
    url: opts.url.trim(),
    transferImages: opts.transferImages,
    style: opts.style,
    meta: {},
    report,
    via: 'paste',
  });
}

/** 两条入口最后都汇到这里：定标题 → 转图 → 拼正文与 frontmatter */
async function assemble(cleanedText: string, context: AssembleContext): Promise<ImportOutcome> {
  const host = hostOf(context.url);
  const title =
    (context.meta.title ?? '').trim() ||
    firstHeading(cleanedText) ||
    (host ? `${host} 的文章` : '未命名文章');

  let body = stripTitleHeading(cleanedText, title);
  if (!body.trim()) {
    return { ok: false, report: context.report, error: '清洗后正文是空的，这篇可能抓不到正文。' };
  }
  if (context.style === 'excerpt') body = takeParagraphs(body, EXCERPT_PARAGRAPHS);

  if (context.transferImages) {
    const stem = toSlug(title).slice(0, 40) || 'import';
    const images = await transferImages(body, stem);
    body = images.markdown;
    if (images.total) {
      context.report.push(
        images.done === images.total
          ? `图片全部转存到仓库（${images.done} 张）`
          : `图片转存 ${images.done}/${images.total} 张，其余仍指向原站（多半不给跨域）`
      );
    }
  }

  const tags = (context.meta.keywords ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag.length <= 20)
    .slice(0, 5);

  // 摘要按句末标点截断：硬截断会切出"…它不仅"这种半句（导入 runoob 那篇就是）
  const description = clipDescription(
    (context.meta.description ?? '').trim() || firstParagraph(body),
    160
  );

  const notes = [`via ${context.via}`].filter(Boolean);

  const frontmatter: PostFrontmatter = {
    title,
    description,
    date: today(),
    category: '',
    tags,
    aliases: [],
    // 关键：默认草稿，人工过目后再发布
    draft: true,
    ...(context.url ? { source: context.url } : {}),
  };

  return {
    ok: true,
    draft: {
      frontmatter,
      body: buildBody(body, {
        url: context.url,
        title,
        author: context.meta.author,
        host,
        style: context.style,
        notes,
      }),
    },
    report: context.report,
  };
}

import { ProfileSchema, FriendsSchema } from '../../data/profile.schema';

/**
 * 后台的序列化工具：Markdown frontmatter 拼装/解析、slug 处理、
 * JSON 的稳定输出、以及 NewsItem.text 的行内 HTML 白名单过滤。
 */

export interface PostFrontmatter {
  title: string;
  description: string;
  date: string;
  updated?: string;
  category: string;
  tags: string[];
  draft: boolean;
}

export interface PostFile {
  data: PostFrontmatter;
  body: string;
}

// ---------------------------------------------------------------- slug
/**
 * 文件名只能用 ASCII：内容集合的 id 会过 github-slugger，
 * 中文会被清成空串（见 src/content.config.ts 顶部的说明）。
 */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// ---------------------------------------------------------------- frontmatter
/** YAML 双引号标量的转义：JSON 字符串字面量与 YAML 的双引号规则兼容 */
const quote = (value: string) => JSON.stringify(value);

export function buildPostFile(post: PostFile): string {
  const { data, body } = post;
  const lines = [
    '---',
    `title: ${quote(data.title)}`,
    `description: ${quote(data.description)}`,
    `date: ${data.date}`,
  ];
  if (data.updated) lines.push(`updated: ${data.updated}`);
  lines.push(`category: ${quote(data.category)}`);
  lines.push(`tags: [${data.tags.map((t) => quote(t)).join(', ')}]`);
  if (data.draft) lines.push('draft: true');
  lines.push('---', '');

  // 正文与 frontmatter 之间保留一个空行
  return `${lines.join('\n')}\n${body.replace(/^\n+/, '')}`;
}

/** 解析 frontmatter。只支持本项目用到的扁平结构（含 [a, b] 这种行内数组）。 */
export function parsePostFile(text: string): PostFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return {
      data: { title: '', description: '', date: today(), category: '', tags: [], draft: false },
      body: text,
    };
  }

  const [, raw, body] = match;
  const parsed: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    parsed[kv[1]] = kv[2].trim();
  }

  const list = (value: string | undefined): string[] => {
    if (!value) return [];
    const inner = value.replace(/^\[|\]$/g, '').trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  };

  return {
    data: {
      title: unquote(parsed.title ?? ''),
      description: unquote(parsed.description ?? ''),
      date: parsed.date ?? today(),
      updated: parsed.updated ? unquote(parsed.updated) : undefined,
      category: unquote(parsed.category ?? ''),
      tags: list(parsed.tags),
      draft: parsed.draft === 'true',
    },
    body: body ?? '',
  };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^["'].*["']$/.test(trimmed) && trimmed[0] === trimmed.at(-1)) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- JSON 输出
/**
 * 写回前统一走一遍 schema：
 * - strict() 拒绝未在 schema 里的键（zod 默认会静默丢掉未知键，那会悄悄吞数据）
 * - 输出对象的 key 顺序 = schema 声明顺序，所以 diff 永远是干净的
 */
export function stableProfileJson(input: unknown): string {
  const parsed = ProfileSchema.strict().parse(input);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/** 友链文件是 { zh: [...], en: [...] }，写回时两份一起序列化，key 顺序固定 */
export function stableFriendsFileJson(zh: unknown, en: unknown): string {
  const parsed = {
    zh: FriendsSchema.array().parse(zh),
    en: FriendsSchema.array().parse(en),
  };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

// ---------------------------------------------------------------- 行内 HTML 白名单
// NewsItem.text 用 set:html 渲染，所以保存前过滤一次。
// 注意正则不带 /g：带 g 时 test() 会因 lastIndex 漂移而给出错误结果。
const INLINE_TAG = /^<\/?(b|strong|i|em|a|code|br|span)(\s[^<>]*)?>$/i;
const DANGEROUS = /\son\w+\s*=|(?:javascript|data):/i;

export function sanitizeInline(text: string): string {
  return text.replace(/<[^>]*>/g, (tag) =>
    INLINE_TAG.test(tag) && !DANGEROUS.test(tag) ? tag : ''
  );
}

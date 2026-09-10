/**
 * 轻量 BibTeX 解析：够用就好，不追求覆盖全部 BibTeX 方言。
 *
 * 支持的写法：
 *   @inproceedings{key, title = {…}, author = {A and B}, year = {2025}, …}
 * - 值可以是 {花括号}（允许嵌套一层）、"引号" 或裸 token（year = 2025）
 * - 字段名大小写不敏感；值里的换行折叠成空格
 *
 * 学术主页要的只是 title / author / venue / year / url 这几样，
 * 解析失败的字段宁可丢掉也不硬塞 —— 比塞错强。
 */

export interface BibEntry {
  /** 条目类型：inproceedings / article / …（统一小写） */
  type: string;
  /** 引用键，如 zhang2025kv */
  key: string;
  /** 字段名统一小写 */
  fields: Record<string, string>;
}

export interface ParsedPublication {
  title: string;
  authors: string[];
  venue: string;
  year: number;
  links?: { pdf?: string; code?: string; project?: string };
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

/** 去掉 {最外层}（BibTeX 里连写 {{Deep}} 两层也常见） */
function unwrap(value: string): string {
  let out = collapse(value);
  while (out.startsWith('{') && out.endsWith('}')) out = out.slice(1, -1).trim();
  return out;
}

/** "Last, First" → "First Last"；纯粹的 "First Last" 原样返回 */
function toFullName(raw: string): string {
  const name = unwrap(raw);
  const comma = name.indexOf(',');
  if (comma > 0) return collapse(`${name.slice(comma + 1)} ${name.slice(0, comma)}`);
  return name;
}

/** 作者串：作者之间用 " and " 分隔（BibTeX 规范），大括号里的 and 不算 */
function splitAuthors(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0 && /\s/.test(ch) && raw.slice(i, i + 5).toLowerCase() === ' and ') {
      out.push(cur);
      cur = '';
      i += 4; // for 循环再 +1，正好跳过 " and "
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map(toFullName).filter(Boolean);
}

/** 从 pos 开始读一个字段值：{平衡括号} / "引号" / 裸 token */
function readValue(text: string, pos: number): { value: string; next: number } | null {
  while (pos < text.length && /\s/.test(text[pos])) pos += 1;
  const ch = text[pos];
  if (ch === undefined) return null;

  if (ch === '{' || ch === '"') {
    const close = ch === '{' ? '}' : '"';
    let depth = 0;
    let i = pos;
    if (ch === '{') depth = 1;
    i += 1;
    const start = i;
    while (i < text.length) {
      const c = text[i];
      if (ch === '{') {
        if (c === '{') depth += 1;
        else if (c === '}') {
          depth -= 1;
          if (depth === 0) return { value: text.slice(start, i), next: i + 1 };
        }
      } else if (c === close) {
        return { value: text.slice(start, i), next: i + 1 };
      }
      i += 1;
    }
    return { value: text.slice(start), next: text.length }; // 括号没闭合：能捞多少捞多少
  }

  // 裸 token：读到逗号或换行
  const start = pos;
  while (pos < text.length && !/[,\n]/.test(text[pos])) pos += 1;
  return { value: text.slice(start, pos).trim(), next: pos };
}

export function parseBibtex(text: string): BibEntry[] {
  const out: BibEntry[] = [];
  const source = text.replace(/\r\n?/g, '\n');
  const head = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let match: RegExpExecArray | null;

  while ((match = head.exec(source))) {
    const type = match[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const key = match[2];
    const fields: Record<string, string> = {};

    let pos = match.index + match[0].length;
    // 条目以内层平衡的大括号结束（值里可能有 {…}，所以数深度）
    let depth = 1;
    let end = source.length;
    for (let i = pos; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    while (pos < end) {
      // 跳过逗号与空白，读字段名
      while (pos < end && /[\s,]/.test(source[pos])) pos += 1;
      const nameMatch = /^([A-Za-z][\w-]*)\s*=\s*/.exec(source.slice(pos, end));
      if (!nameMatch) {
        // 不是 "name ="（多是收尾的逗号），往前挪一格避免死循环
        pos += 1;
        continue;
      }
      pos += nameMatch[0].length;
      const value = readValue(source.slice(pos, end), 0);
      if (!value) break;
      fields[nameMatch[1].toLowerCase()] = value.value;
      pos += value.next;
    }

    if (Object.keys(fields).length) out.push({ type, key, fields });
  }

  return out;
}

/** url 归类：arxiv / .pdf → pdf，github → code，其它 → project */
function classifyLink(url: string): { pdf?: string; code?: string; project?: string } {
  const link = unwrap(url);
  if (!link) return {};
  const lower = link.toLowerCase();
  if (lower.includes('arxiv.org') || lower.endsWith('.pdf')) return { pdf: link };
  if (lower.includes('github.com')) return { code: link };
  return { project: link };
}

/** BibTeX 条目 → Profile 里的论文对象；解析不出来的字段给兜底值，交给用户补 */
export function bibToPublication(entry: BibEntry): ParsedPublication {
  const f = entry.fields;
  const year = Number.parseInt(f.year ?? '', 10);

  const pub: ParsedPublication = {
    title: unwrap(f.title ?? '') || '（未命名论文）',
    authors: f.author ? splitAuthors(f.author) : [],
    venue: unwrap(f.booktitle ?? f.journal ?? '') || '未注明',
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
  };

  const link = classifyLink(f.url ?? '');
  if (Object.keys(link).length) pub.links = link;
  return pub;
}

/** 一段文本里可能粘了好几条；返回解析成功的论文，失败的条数单独报 */
export function parsePublications(text: string): { pubs: ParsedPublication[]; failed: number } {
  const entries = parseBibtex(text);
  const pubs: ParsedPublication[] = [];
  let failed = 0;
  for (const entry of entries) {
    const pub = bibToPublication(entry);
    if (!pub.authors.length) failed += 1;
    else pubs.push(pub);
  }
  return { pubs, failed };
}

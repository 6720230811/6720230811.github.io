import { toSlug } from './serialize';

/**
 * Slug 建议。
 *
 * 文件名必须 ASCII（内容集合的 id 会过 github-slugger，中文会被清成空串），
 * 所以中文标题要先转拼音。拼音表不小（几百 KB），走动态 import：
 * 只有标题里出现中文时才去拉那个 chunk，纯英文标题完全不加载。
 */

const CJK_RANGE = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff';
const CJK = new RegExp(`[${CJK_RANGE}]`);
const SEGMENT = new RegExp(`([A-Za-z0-9']+)|([${CJK_RANGE}]+)`, 'g');

type PinyinFn = (text: string, options: Record<string, unknown>) => unknown;

let loader: Promise<PinyinFn | null> | null = null;

function loadPinyin(): Promise<PinyinFn | null> {
  loader ??= import('pinyin-pro')
    .then((mod) => mod.pinyin as unknown as PinyinFn)
    .catch(() => null);
  return loader;
}

/** 同步版本：只留 ASCII。拼音还没加载完时先把英文部分填上，不至于空着 */
export function quickSlug(title: string): string {
  return toSlug(title);
}

/** 太长的文件名不好看，截到 60 字符内的最后一个连字符 */
function cap(slug: string): string {
  if (slug.length <= 60) return slug;
  const cut = slug.slice(0, 60);
  const at = cut.lastIndexOf('-');
  return at > 20 ? cut.slice(0, at) : cut;
}

/**
 * 标题 → slug。
 * 规则：连续英文/数字算一段、连续中日文算一段（段内拼音连写），段之间用连字符。
 * 「这次搭建 Astro 真正卡住我的三件事」→ zheci-dajian-astro-…
 */
export async function suggestSlug(title: string): Promise<string> {
  const ascii = toSlug(title);
  if (!CJK.test(title)) return cap(ascii);

  const pinyin = await loadPinyin();
  if (!pinyin) return cap(ascii); // 加载失败就退回 ASCII 部分

  const parts: string[] = [];
  for (const m of title.matchAll(SEGMENT)) {
    if (m[1]) {
      parts.push(m[1].toLowerCase());
      continue;
    }
    const syllables = pinyin(m[2], { toneType: 'none', type: 'array' });
    const text = Array.isArray(syllables)
      ? (syllables as string[]).join('')
      : String(syllables).replace(/\s+/g, '-');
    if (text) parts.push(text);
  }

  const out = toSlug(parts.join('-'));
  return cap(out || ascii);
}

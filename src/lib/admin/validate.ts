import { isValidSlug, today } from './serialize';
import type { PostFrontmatter } from './serialize';

/**
 * 发布前的校验。
 *
 * 之前三段 if 埋在保存逻辑里，只在点发布那一刻拦一下；
 * 现在独立出来，输入过程中也跑（改过之后才跑，避免刚载入就一片红）。
 */

export type FieldId = 'post-slug' | 'post-title' | 'post-category' | 'post-date' | 'post-updated';

export interface Issue {
  field: FieldId;
  message: string;
}

export interface ValidateInput {
  /** 要写入的 slug（已有文章时就是当前文件名） */
  slug: string;
  /** 当前打开的文章：空串表示新建 */
  currentSlug: string;
  data: PostFrontmatter;
  /** 仓库里已有的 slug，用来查重 */
  known: ReadonlySet<string>;
  /** 已经在 slug 旁确认过「覆盖同名文件」 */
  overwrite?: boolean;
}

export function validatePost(input: ValidateInput): Issue[] {
  const { slug, currentSlug, data, known } = input;
  const issues: Issue[] = [];

  // 已有文章且 slug 没动 → 就是原地更新，不用查重；
  // 改名（slug 与当前文件名不同）等同于新建一份，规则与新建一样
  if (!currentSlug || slug !== currentSlug) {
    if (!slug) {
      issues.push({ field: 'post-slug', message: '新建文章必须填 slug（就是文件名）。' });
    } else if (!isValidSlug(slug)) {
      issues.push({
        field: 'post-slug',
        message: 'slug 只能用小写字母、数字和连字符，例如 my-new-post。文件名必须是 ASCII。',
      });
    } else if (known.has(slug) && !input.overwrite) {
      issues.push({
        field: 'post-slug',
        message: `已经有一篇叫 ${slug} 的文章了，换一个名字，或者从左边列表里打开它。`,
      });
    }
  }

  if (!data.title) issues.push({ field: 'post-title', message: 'title 不能为空。' });
  if (!data.category) {
    issues.push({ field: 'post-category', message: 'category 不能为空（schema 里是必填）。' });
  }

  // 不校验 date 格式：<input type="date"> 里拿不到非法字符串，
  // 清空时 collectPost 会退回今天，所以这里是死路，别写假校验。
  //
  // 但要拦未来的日期：选择器那边已经用 max 把未来的日子置灰了，这里兜住
  // 「手动改 value」「从网址导入带进来一个未来日期」这些绕过选择器的情形。
  const limit = today();
  if (data.date && data.date > limit) {
    issues.push({
      field: 'post-date',
      message: `发布日期不能是未来的日子（今天是 ${limit}），日历里未来的日子是灰的、点不动。`,
    });
  }
  if (data.updated && data.updated > limit) {
    issues.push({ field: 'post-updated', message: '修改时间不能是未来的日子。' });
  }

  return issues;
}

const ALL_FIELDS: readonly FieldId[] = [
  'post-slug',
  'post-title',
  'post-category',
  'post-date',
  'post-updated',
];

/**
 * 把问题显示在第一个出错的字段上并聚焦过去。
 * 返回是否通过，调用方据此决定要不要发请求。
 */
export function showIssues(issues: readonly Issue[], setError: (message: string) => void): boolean {
  for (const id of ALL_FIELDS) document.getElementById(id)?.classList.remove('input--invalid');
  if (issues.length === 0) {
    setError('');
    return true;
  }

  setError(issues[0].message);
  const el = document.getElementById(issues[0].field);
  el?.classList.add('input--invalid');
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return false;
}

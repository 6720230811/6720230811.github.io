import { repo, paths } from '../../data/admin';
import { readFile, readBase64, saveFile, deletePathsBatch, statFile, type Repo } from './github';
import { buildPostFile, parsePostFile } from './serialize';
import { makeTrashItem, pushTrash } from './trash';

/**
 * 批量操作：改分类 / 改标签 / 转草稿 / 复制到另一语言 / 删除。
 *
 * 两类动作的写法不同：
 * - 改内容（分类、标签、草稿）逐篇「读 → 改 frontmatter → 写回」，单篇失败不中断整批
 * - 删除是「先全部读出来（留撤销副本）→ 一次提交删掉」，
 *   逐个 DELETE 会刷出 N 条提交、触发 N 轮 Actions 构建（见 deletePathsBatch）
 *
 * 多个提交时只把最后一个 commit sha 交回去轮询：Actions 只跑最新那次。
 */

export type BulkAction =
  | { kind: 'category'; value: string }
  | { kind: 'tags'; add: string[]; remove: string[] }
  | { kind: 'draft'; value: boolean }
  | { kind: 'transfer'; to: 'zh' | 'en' }
  | { kind: 'delete'; cover: boolean };

export interface BulkOutcome {
  ok: number;
  /** 失败的 slug（带一句原因） */
  failed: string[];
  /** 给发布面板轮询构建用的 commit sha */
  commit: string | null;
}

export interface BulkOptions {
  lang: string;
  slugs: string[];
  action: BulkAction;
  token: string;
  onProgress?: (done: number, total: number, slug: string) => void;
}

const LABEL: Record<BulkAction['kind'], string> = {
  category: '改分类',
  tags: '改标签',
  draft: '改状态',
  transfer: '复制到另一语言',
  delete: '删除',
};

export function bulkLabel(action: BulkAction): string {
  return LABEL[action.kind];
}

/** 标签合并：去掉要删的，补上要加的（忽略大小写与空白） */
function mergeTags(current: string[], add: string[], remove: string[]): string[] {
  const drop = new Set(remove.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const out = current.filter((tag) => !drop.has(tag.toLowerCase()));
  for (const tag of add) {
    const value = tag.trim();
    if (value && !out.some((t) => t.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out;
}

async function runDelete(
  opts: BulkOptions,
  action: Extract<BulkAction, { kind: 'delete' }>
): Promise<BulkOutcome> {
  const { lang, slugs, token } = opts;
  const failed: string[] = [];
  const targets: {
    slug: string;
    path: string;
    text: string;
    title: string;
    cover?: { path: string; b64: string };
  }[] = [];

  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    opts.onProgress?.(i, slugs.length, slug);
    const path = paths.post(lang, slug);
    try {
      const file = await readFile(repo as Repo, path, token);
      if (!file) {
        failed.push(`${slug}（仓库里没有这个文件）`);
        continue;
      }
      const parsed = parsePostFile(file.text);
      const coverPath = action.cover ? paths.illustrationFromUrl(parsed.data.cover ?? '') : null;
      const cover = coverPath ? await readBase64(repo as Repo, coverPath, token) : null;
      targets.push({
        slug,
        path,
        text: file.text,
        title: parsed.data.title || slug,
        ...(cover && coverPath ? { cover: { path: coverPath, b64: cover.b64 } } : {}),
      });
    } catch (e) {
      failed.push(`${slug}（${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  if (!targets.length) {
    opts.onProgress?.(slugs.length, slugs.length, '');
    return { ok: 0, failed, commit: null };
  }

  // 本地副本先落袋：删完才有后悔药
  try {
    for (const target of targets) {
      await pushTrash(
        makeTrashItem({
          lang,
          slug: target.slug,
          title: target.title,
          path: target.path,
          text: target.text,
          ...(target.cover ? { cover: target.cover } : {}),
        })
      );
    }
  } catch {
    // 存不下就不存：删除本身不该被本地存储卡住
  }

  const allPaths = targets.flatMap((t) => [t.path, ...(t.cover ? [t.cover.path] : [])]);
  opts.onProgress?.(slugs.length, slugs.length, '');
  const commit = await deletePathsBatch(
    repo as Repo,
    allPaths,
    token,
    `delete post(s): ${targets.length} file(s)`
  );
  return { ok: targets.length, failed, commit };
}

export async function runBulk(opts: BulkOptions): Promise<BulkOutcome> {
  const { lang, slugs, action, token } = opts;
  if (action.kind === 'delete') return runDelete(opts, action);

  let ok = 0;
  let commit: string | null = null;
  const failed: string[] = [];

  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    opts.onProgress?.(i, slugs.length, slug);
    const path = paths.post(lang, slug);

    try {
      const file = await readFile(repo as Repo, path, token);
      if (!file) {
        failed.push(`${slug}（仓库里没有这个文件）`);
        continue;
      }
      const parsed = parsePostFile(file.text);

      if (action.kind === 'transfer') {
        // 别覆盖目标语言里已有的那篇：那是另一个人的心血（也可能是你半年前的）
        const targetPath = paths.post(action.to, slug);
        if (await statFile(repo as Repo, targetPath, token)) {
          failed.push(`${slug}（${action.to} 目录里已经有同名文件）`);
          continue;
        }
        const sha = await saveFile(
          repo as Repo,
          targetPath,
          token,
          file.text,
          `copy post to ${action.to}: ${slug}`
        );
        if (sha) commit = sha;
        ok += 1;
        continue;
      }

      const data =
        action.kind === 'category'
          ? { ...parsed.data, category: action.value }
          : action.kind === 'tags'
            ? { ...parsed.data, tags: mergeTags(parsed.data.tags, action.add, action.remove) }
            : { ...parsed.data, draft: action.value };

      const message =
        action.kind === 'category'
          ? `set category: ${slug} → ${action.value || '（空）'}`
          : action.kind === 'tags'
            ? `set tags: ${slug}`
            : `set ${action.value ? 'draft' : 'published'}: ${slug}`;

      const sha = await saveFile(
        repo as Repo,
        path,
        token,
        buildPostFile({ data, body: parsed.body }),
        message
      );
      if (sha) commit = sha;
      ok += 1;
    } catch (e) {
      failed.push(`${slug}（${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  opts.onProgress?.(slugs.length, slugs.length, '');
  return { ok, failed, commit };
}

/** 导出所选文章为 Markdown 打包（无依赖的 store-only zip，见 zip.ts） */
export async function exportPosts(
  lang: string,
  slugs: string[],
  token: string
): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const slug of slugs) {
    const file = await readFile(repo as Repo, paths.post(lang, slug), token);
    if (file) out.push({ name: `${slug}.md`, text: file.text });
  }
  return out;
}

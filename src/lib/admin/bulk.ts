import { repo, paths } from '../../data/admin';
import { readFile, readBase64, saveFile, deleteFile, type Repo } from './github';
import { buildPostFile, parsePostFile } from './serialize';
import { makeTrashItem, pushTrash } from './trash';

/**
 * 批量操作：改分类 / 转草稿 / 删除。
 *
 * 每篇都要「读文件 → 改 frontmatter → 写回」，所以是逐篇串行
 * （写操作本来就在 github.ts 里排队，这里再并发只会白白撞限流）。
 * 单篇失败不中断整批，失败的 slug 收集起来一次性报给用户。
 *
 * 整批只会有多个提交，但 Actions 只会跑最后一次那条，所以只把最后一个
 * commit sha 交回去给发布面板轮询。
 */

export type BulkAction =
  | { kind: 'category'; value: string }
  | { kind: 'draft'; value: boolean }
  | { kind: 'delete'; cover: boolean };

export interface BulkOutcome {
  ok: number;
  /** 失败的 slug（带一句原因） */
  failed: string[];
  /** 最后一个成功写入的 commit sha：给发布面板轮询构建用 */
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
  draft: '改状态',
  delete: '删除',
};

export function bulkLabel(action: BulkAction): string {
  return LABEL[action.kind];
}

export async function runBulk(opts: BulkOptions): Promise<BulkOutcome> {
  const { lang, slugs, action, token } = opts;
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

      if (action.kind === 'delete') {
        // 删之前留一份本地副本：封面要先读出来，删掉就再也拿不到了
        const coverPath = action.cover ? paths.illustrationFromUrl(parsed.data.cover ?? '') : null;
        const cover = coverPath ? await readBase64(repo as Repo, coverPath, token) : null;

        // 本地存不下不该卡住删除本身，存失败就当没有「后悔药」
        try {
          await pushTrash(
            makeTrashItem({
              lang,
              slug,
              title: parsed.data.title || slug,
              path,
              text: file.text,
              ...(cover && coverPath ? { cover: { path: coverPath, b64: cover.b64 } } : {}),
            })
          );
        } catch {
          // 忽略：IndexedDB 不可用时降级为「删了就没了」
        }

        const sha = await deleteFile(repo as Repo, path, token, `delete post: ${slug}`);
        if (sha) commit = sha;
        if (cover && coverPath) {
          await deleteFile(repo as Repo, coverPath, token, `delete cover: ${slug}`);
        }
      } else {
        const data =
          action.kind === 'category'
            ? { ...parsed.data, category: action.value }
            : { ...parsed.data, draft: action.value };
        const text = buildPostFile({ data, body: parsed.body });
        const sha = await saveFile(
          repo as Repo,
          path,
          token,
          text,
          action.kind === 'category'
            ? `set category: ${slug} → ${action.value || '（空）'}`
            : `set ${action.value ? 'draft' : 'published'}: ${slug}`
        );
        if (sha) commit = sha;
      }
      ok += 1;
    } catch (e) {
      failed.push(`${slug}（${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  opts.onProgress?.(slugs.length, slugs.length, '');
  return { ok, failed, commit };
}

import { defineCollection } from 'astro:content';
// z 从 astro/zod 取：astro:content 的 z 已废弃，会在 Astro 8 移除
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * 文章集合：语言靠目录区分（`zh/xxx.md` / `en/xxx.md`），
 * 因此 entry.id 形如 `zh/hello-world`，首段就是语言，其余是 slug。
 *
 * 两个约定（踩过坑，别改）：
 * - frontmatter 里不要写 `slug`：glob loader 会用它覆盖 id，双语同名文件会撞车
 * - 文件名用 ASCII：id 会过 github-slugger，中文会被清空
 */
const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    // 草稿：生产构建不输出，dev 下仍可见
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };

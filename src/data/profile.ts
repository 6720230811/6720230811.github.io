/**
 * ============================================================
 *  个人信息：数据的读取入口
 * ============================================================
 *
 *  【内容在哪】
 *    中文：src/data/profile.zh.json
 *    英文：src/data/profile.en.json
 *    字段含义与校验规则：src/data/profile.schema.ts
 *
 *  【结构说明】
 *    - 每个字段都有 zh / en 两份，切换语言时自动读取对应版本
 *    - publications 用 authors 数组 + selfIndex 标记自己（渲染时自动加粗）
 *    - 所有板块均为数组，删除条目直接删对象，调整顺序直接移动对象
 *    - 若某个板块暂时没有内容，把数组清空为 [] 即可，该板块会自动隐藏
 *
 *  改 JSON 后构建会做一次校验，字段不对会直接构建失败并打印出问题的路径。
 *  也可以直接访问 /admin 在线编辑（写回的就是这两个 JSON 文件）。
 */

import zhJson from './profile.zh.json';
import enJson from './profile.en.json';
import { ProfileSchema, formatIssues } from './profile.schema';

/**
 * 数据放在 `profile.{zh,en}.json` 里（后台 /admin 也是读写这两个文件），
 * 这里只负责取出来校验一次再导出，所以 27 个引用方完全不用改。
 *
 * 校验失败直接抛错让构建红掉：宁可部署失败，也不要线上少一块内容。
 * 返回的是 zod 构造的对象，key 顺序与 schema 声明顺序一致，
 * 后台写回时用同样的顺序，diff 才是干净的。
 */
function load(locale: 'zh' | 'en', raw: unknown): Profile {
  const result = ProfileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `src/data/profile.${locale}.json 与 profile.schema.ts 不一致：\n${formatIssues(result.error)}`
    );
  }
  return result.data;
}

import type {
  Profile,
  NewsItem,
  Publication,
  TimelineEntry,
  SkillGroup,
  Project,
  Award,
} from './profile.schema';

export type {
  Profile,
  NewsItem,
  Publication,
  TimelineEntry,
  SkillGroup,
  Project,
  Award,
};

/** 按语言取内容 */
export const profile: Record<'zh' | 'en', Profile> = {
  zh: load('zh', zhJson),
  en: load('en', enJson),
};

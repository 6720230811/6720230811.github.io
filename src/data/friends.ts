import friendsJson from './friends.json';
import { FriendsSchema, formatIssues } from './profile.schema';
import type { Friend } from './profile.schema';
import type { Locale } from '../i18n/ui';

/**
 * 友链数据放在 `src/data/friends.json`，后台 /admin 也是读写这个文件。
 * 结构在 `profile.schema.ts` 的 FriendsSchema 里（name / url / desc 三个必填字符串）。
 */
function load(locale: Locale, raw: unknown): readonly Friend[] {
  const result = FriendsSchema.array().safeParse(raw);
  if (!result.success) {
    throw new Error(
      `src/data/friends.json 的 ${locale} 部分不符合 FriendsSchema：\n${formatIssues(result.error)}`
    );
  }
  return result.data;
}

export type { Friend };

export const friends: Record<'zh' | 'en', readonly Friend[]> = {
  zh: load('zh', friendsJson.zh),
  en: load('en', friendsJson.en),
};

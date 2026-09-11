/**
 * 头像地址解析。前台（Sidebar）和后台镜像预览共用同一套规则，
 * 免得两边各写一遍、改一边忘一边。纯函数，node 里可直接测。
 *
 * 规则：
 * - 留空 → public/avatar.jpg（站点一直以来的默认头像，什么都不填时行为不变）
 * - http(s):// 开头 → 当作外链原样用
 * - 其余 → 当成 public/ 下的文件名，拼上站点 base（换图时文件名带时间戳，天然绕缓存）
 */
export function resolveAvatar(avatar: string | undefined, base: string): string {
  if (!avatar) return `${base}avatar.jpg`;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  return `${base}${avatar}`;
}

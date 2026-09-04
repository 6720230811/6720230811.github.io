import type { UIKey } from '../i18n/ui';

export interface NavItem {
  /** 标题的 i18n key */
  key: UIKey;
  /**
   * 相对站点根的路由段，会交给 getRelativeLocaleUrl 补上语言与 base 前缀。
   * 空串表示站点根（即「首页 / About」）。
   */
  path: string;
}

/**
 * 顶栏导航项，顺序即展示顺序。
 * 只放主要入口——归档 / 分类 / 标签是「翻找方式」而不是目的地，
 * 它们的入口放在博客列表页顶部（见 PostBrowse 组件）。
 */
export const navItems: readonly NavItem[] = [
  { key: 'nav.home', path: '' },
  { key: 'nav.blog', path: 'blog' },
  { key: 'nav.gallery', path: 'gallery' },
  { key: 'nav.friends', path: 'friends' },
];

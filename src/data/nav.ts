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

/** 顶栏导航项，顺序即展示顺序 */
export const navItems: readonly NavItem[] = [
  { key: 'nav.home', path: '' },
  { key: 'nav.archive', path: 'archive' },
  { key: 'nav.categories', path: 'categories' },
  { key: 'nav.tags', path: 'tags' },
  { key: 'nav.friends', path: 'friends' },
  { key: 'nav.blog', path: 'blog' },
];

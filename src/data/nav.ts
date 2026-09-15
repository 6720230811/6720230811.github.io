import type { UIKey } from '../i18n/ui';

export interface NavItem {
  /** 标题的 i18n key */
  key: UIKey;
  /**
   * 相对站点根的路由段，会交给 getRelativeLocaleUrl 补上语言与 base 前缀。
   * 空串表示站点根（即「首页」）。
   */
  path: string;
}

/**
 * 顶栏导航项，顺序即展示顺序。
 * 只放主要入口——归档 / 分类 / 标签是「翻找方式」而不是目的地，
 * 它们的入口是博客页顶部那排浏览选项卡（见 PostPanels 组件）。
 *
 * 「关于」紧随首页：它讲的是「这个人」，是第二重要的入口。
 * 首页改版成沉浸式门面后，原来的简历式内容整体搬去了 /about。
 */
export const navItems: readonly NavItem[] = [
  { key: 'nav.home', path: '' },
  { key: 'nav.about', path: 'about' },
  { key: 'nav.blog', path: 'blog' },
  { key: 'nav.gallery', path: 'gallery' },
  { key: 'nav.friends', path: 'friends' },
];

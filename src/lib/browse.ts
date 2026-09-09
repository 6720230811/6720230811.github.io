import { href } from './posts';
import { useTranslations, type Locale } from '../i18n/ui';

/**
 * 博客的四种浏览方式。以前是四个互不相干的页面（点一下整页跳转），
 * 现在四个面板都渲染在同一页里，点选项卡只换下面那块，URL 用 pushState 同步。
 *
 * 四个页面本身保留：直接访问 /archive/ 这类地址时，对应面板是默认展开的那个。
 */
export type BrowseTab = 'all' | 'archive' | 'categories' | 'tags';

export interface BrowseTabMeta {
  id: BrowseTab;
  /** 选项卡文字，同时也是板块标题 */
  label: string;
  icon: string;
  /** 无 JS 时靠它跳转，有 JS 时用它 pushState */
  href: string;
  /** 板块所属页面：/blog/ 等，用来判断当前该展开哪个面板 */
  path: string;
}

export function browseTabs(locale: Locale): BrowseTabMeta[] {
  const t = useTranslations(locale);
  return [
    { id: 'all', label: t('blog.title'), icon: '✍️', href: href(locale, 'blog'), path: 'blog' },
    {
      id: 'archive',
      label: t('archive.title'),
      icon: '🗂',
      href: href(locale, 'archive'),
      path: 'archive',
    },
    {
      id: 'categories',
      label: t('categories.title'),
      icon: '📚',
      href: href(locale, 'categories'),
      path: 'categories',
    },
    { id: 'tags', label: t('tags.title'), icon: '🏷', href: href(locale, 'tags'), path: 'tags' },
  ];
}

export function browseTab(locale: Locale, id: BrowseTab): BrowseTabMeta {
  const found = browseTabs(locale).find((tab) => tab.id === id);
  // id 是字面量联合类型，找不到只可能是写错了键 —— 早失败比静默渲染空标题好
  if (!found) throw new Error(`未知的浏览方式：${id}`);
  return found;
}

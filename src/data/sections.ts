import type { Profile } from './profile';
import type { UIKey } from '../i18n/ui';

export interface SectionDef {
  /** 同时用作 DOM id 与锚点 */
  id: string;
  /** 标题的 i18n key */
  key: UIKey;
}

/** 页面板块顺序：导航栏与正文共用，改动此处即可调整顺序 */
export const sections: readonly SectionDef[] = [
  { id: 'about', key: 'section.about' },
  { id: 'publications', key: 'section.publications' },
  { id: 'skills', key: 'section.skills' },
  { id: 'projects', key: 'section.projects' },
  { id: 'education', key: 'section.education' },
  { id: 'contact', key: 'section.contact' },
];

/**
 * 内容为空的板块会自动隐藏。
 * 导航栏和正文都用这个函数判断，避免出现指向不存在锚点的链接。
 * 合并后的板块（如「项目与实习」）只要其中任一子块有内容就显示。
 */
export function visibleSections(profile: Profile): readonly SectionDef[] {
  return sections.filter(({ id }) => {
    switch (id) {
      case 'publications':
        return profile.publications.length > 0 || profile.research.length > 0;
      case 'skills':
        return profile.skills.length > 0;
      case 'projects':
        return profile.projects.length > 0 || profile.internships.length > 0;
      case 'education':
        return profile.education.length > 0 || profile.awards.length > 0;
      default:
        // 个人简介与联系方式始终显示
        return true;
    }
  });
}

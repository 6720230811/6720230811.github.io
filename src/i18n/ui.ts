export const locales = ['zh', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh';

/** 中文文案作为「基准」，英文靠类型约束强制与之一一对应，避免漏翻 */
const zh = {
  // 侧边栏
  'sidebar.status': '申博 & 求职中',
  'sidebar.cv': '下载简历',
  'sidebar.contact': '联系方式',

  // 导航栏
  'nav.aria': '页面板块导航',

  // 板块标题
  'section.about': '个人简介',
  'section.interests': '研究方向',
  'section.news': '最新动态',
  'section.publications': '论文发表',
  'section.research': '科研经历',
  'section.skills': '技术栈',
  'section.projects': '项目经历',
  'section.internships': '实习经历',
  'section.education': '教育背景',
  'section.awards': '荣誉奖项',
  'section.contact': '联系方式',

  // 链接与标签
  'link.pdf': 'PDF',
  'link.code': '代码',
  'link.project': '项目主页',
  'link.video': '视频',
  'link.slides': '幻灯片',
  'label.advisor': '导师',
  'label.supervisor': '主管',
  'label.stack': '技术栈',
  'label.citations': '引用',
  'label.present': '至今',
  'label.more': '查看更多',
} as const;

const en: Record<keyof typeof zh, string> = {
  // 侧边栏
  'sidebar.status': 'Open to PhD & SWE Opportunities',
  'sidebar.cv': 'Download CV',
  'sidebar.contact': 'Contact',

  // 导航栏
  'nav.aria': 'Section navigation',

  // 板块标题
  'section.about': 'About',
  'section.interests': 'Research Interests',
  'section.news': 'News',
  'section.publications': 'Publications',
  'section.research': 'Research Experience',
  'section.skills': 'Skills',
  'section.projects': 'Projects',
  'section.internships': 'Internships',
  'section.education': 'Education',
  'section.awards': 'Honors & Awards',
  'section.contact': 'Contact',

  // 链接与标签
  'link.pdf': 'PDF',
  'link.code': 'Code',
  'link.project': 'Project',
  'link.video': 'Video',
  'link.slides': 'Slides',
  'label.advisor': 'Advisor',
  'label.supervisor': 'Supervisor',
  'label.stack': 'Stack',
  'label.citations': 'Citations',
  'label.present': 'Present',
  'label.more': 'More',
};

export const ui = { zh, en } as const;

export type UIKey = keyof typeof zh;

/** 生成翻译函数。t('section.about') → 当前语言下的「个人简介 / About」 */
export function useTranslations(lang: Locale | undefined) {
  const l: Locale = lang ?? defaultLocale;
  const dict = (ui[l] ?? ui[defaultLocale]) as Record<UIKey, string>;
  return function t(key: UIKey): string {
    return dict[key];
  };
}

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/** 把可能是 string 的 locale 安全收敛为 Locale（来自 Astro.currentLocale） */
export function toLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : defaultLocale;
}

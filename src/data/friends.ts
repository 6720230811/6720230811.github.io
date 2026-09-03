export interface Friend {
  name: string;
  url: string;
  /** 一句话介绍 */
  desc: string;
}

/**
 * 友链：中英文各一份（内容不同就分开写，相同的可以共用）。
 * 目前是占位示例，替换成你自己的链接即可。
 */
export const friends: Record<'zh' | 'en', readonly Friend[]> = {
  zh: [
    {
      name: 'Astro 官方文档',
      url: 'https://docs.astro.build',
      desc: '这个站点用的框架，文档写得比大多数框架都清楚。',
    },
    {
      name: 'Fuwari',
      url: 'https://github.com/saicaca/fuwari',
      desc: '本博客的布局与观感参考来源。',
    },
  ],
  en: [
    {
      name: 'Astro Docs',
      url: 'https://docs.astro.build',
      desc: 'The framework behind this site — better docs than most.',
    },
    {
      name: 'Fuwari',
      url: 'https://github.com/saicaca/fuwari',
      desc: 'Where this blog took its layout and visual language from.',
    },
  ],
};

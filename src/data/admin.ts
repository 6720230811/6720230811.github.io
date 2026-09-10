/**
 * /admin 后台的仓库配置。
 * 静态站没有后端，发布就是让浏览器直接调 GitHub API 写这个仓库。
 *
 * 换仓库/换分支只改这里（分支名要和 deploy workflow 里触发部署的分支一致）。
 */
export const repo = {
  owner: '6720230811',
  repo: '6720230811.github.io',
  branch: 'main',
};

/** 后台要读写的仓库内路径 */
export const paths = {
  postsDir: (lang: string) => `src/content/posts/${lang}`,
  post: (lang: string, slug: string) => `src/content/posts/${lang}/${slug}.md`,
  profile: (lang: string) => `src/data/profile.${lang}.json`,
  friends: () => 'src/data/friends.json',
  // 静态目录下的配图目录：public/ 里的东西按原样发布，
  // 所以 public/illustrations/x.png ↔ /illustrations/x.png
  illustrationsDir: () => 'public/illustrations',
  illustration: (name: string) => `public/illustrations/${name}`,
};

/**
 * 线上站点地址：发布成功后给「点击直达线上文章」用。
 * 与 astro.config.mjs 里的 SITE 保持一致（那边是构建期常量，这里要跑在浏览器里）。
 */
export const site = {
  url: 'https://6720230811.github.io',
  /** 文章线上地址：中文站 /blog/<slug>，英文站 /en/blog/<slug> */
  post: (lang: string, slug: string) => `${site.url}${lang === 'zh' ? '' : `/${lang}`}/blog/${slug}`,
  actions: () => `https://github.com/${repo.owner}/${repo.repo}/actions`,
};

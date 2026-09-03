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
};

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
  /** 简历：profile.cvFile 只是文件名，实际放在 public/cv/ 下 */
  cv: (name: string) => `public/cv/${name}`,
  /** 画廊数据（素材页扫引用时要用它，见 lib/admin/assets.ts） */
  gallery: () => 'src/data/gallery.json',
  /**
   * 封面 URL → 仓库里的路径；不是站内配图（外链 / 没写封面）返回 null。
   * 只匹配 /illustrations/ 之后那一段：站点挂在子路径时 URL 会带 base 前缀。
   */
  illustrationFromUrl: (url: string): string | null => {
    const match = /(?:^|\/)illustrations\/([^/?#]+)/.exec(url.trim());
    return match ? `${paths.illustrationsDir()}/${decodeURIComponent(match[1])}` : null;
  },
};

/**
 * 仓库文件的原始直链（raw.githubusercontent）。
 *
 * 后台列表的缩略图走这里，而不是线上站点地址：刚上传/刚改的图不必等
 * Actions 部署完就能看到，而且拿到的永远是仓库当前状态。
 * 注意：仓库私有的话这条路走不通（raw 需要鉴权，会 404），
 * 所以调用方都挂了 onerror 兜底，失败了顶多是没缩略图。
 */
export const rawUrl = (path: string): string =>
  `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.branch}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

/**
 * 线上站点地址：发布成功后给「点击直达线上文章」用。
 * 与 astro.config.mjs 里的 SITE 保持一致（那边是构建期常量，这里要跑在浏览器里）。
 */
export const site = {
  url: 'https://6720230811.github.io',
  /** 文章线上地址：中文站 /blog/<slug>，英文站 /en/blog/<slug> */
  post: (lang: string, slug: string) => `${site.url}${lang === 'zh' ? '' : `/${lang}`}/blog/${slug}`,
  /** 博客列表页：删除文章之后没有单篇可跳，就跳这里 */
  blog: (lang: string) => `${site.url}${lang === 'zh' ? '' : `/${lang}`}/blog`,
  actions: () => `https://github.com/${repo.owner}/${repo.repo}/actions`,
};

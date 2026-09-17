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
  /**
   * 拾遗 · 收藏夹。**整份是一份 JSON，不是目录制**（对比 galleryDir）：
   * 每条就七八个字段、进出一整个文件，写回时按 schema 顺序稳定序列化。
   * 主题键取 `src/data/gleanings/topics.ts` 的词表，写进去之前先过滤一遍。
   */
  gleaningsLinks: () => 'src/data/gleanings/links.json',
  // 静态目录下的配图目录：public/ 里的东西按原样发布，
  // 所以 public/illustrations/x.png ↔ /illustrations/x.png
  illustrationsDir: () => 'public/illustrations',
  illustration: (name: string) => `public/illustrations/${name}`,
  /** 简历：profile.cvFile 只是文件名，实际放在 public/cv/ 下 */
  cv: (name: string) => `public/cv/${name}`,
  /** 头像放 public/ 根下（页面用 /<文件名> 引用）；换图时换个文件名就能绕开缓存 */
  avatar: (name: string) => `public/${name}`,
  /**
   * 画廊：一个合集 = public/gallery/<合集 id>/ 一个目录
   * （目录里是图片 + meta.json；构建期扫描，见 src/data/gallery.ts）。
   * 所以没有「一份画廊数据文件」可改，改的是各目录下的 meta.json。
   */
  galleryDir: () => 'public/gallery',
  galleryMeta: (id: string) => `public/gallery/${id}/meta.json`,
  galleryPhoto: (id: string, file: string) => `public/gallery/${id}/${file}`,
  galleryThumb: (id: string, file: string) => `public/gallery/${id}/thumbs/${file}`,
  /** 合集改名后旧地址的登记表（后台写入，构建期读，见 data/gallery.ts 的 legacyRoutes） */
  galleryRedirects: () => 'src/data/gallery-redirects.json',
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

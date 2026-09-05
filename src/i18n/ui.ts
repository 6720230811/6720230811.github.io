export const locales = ['zh', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh';

/** 中文文案作为「基准」，英文靠类型约束强制与之一一对应，避免漏翻 */
const zh = {
  // 侧边栏
  'sidebar.status': '申博 & 求职中',
  'sidebar.cv': '下载简历',
  'sidebar.contact': '联系方式',

  // 时间与位置组件（顶栏时钟：按访客 IP 定位）
  'clock.label': '你所在的城市与当地时间',
  'clock.labelLocal': '你的当地时间',

  // 导航栏（跨页面链接）
  'nav.aria': '主导航',
  'nav.menu': '打开导航菜单',
  'nav.home': '首页',
  'nav.friends': '友链',
  'nav.blog': '博客',
  'nav.gallery': '画廊',

  // 画廊（/gallery）
  'gallery.title': '画廊',
  'gallery.desc': '九种照着真实艺术厅复刻的展厅，墙上挂着自己的照片。走过拱门换一间，凑近看。',
  'gallery.view.theme': '按主题布展',
  'gallery.view.year': '按时间布展',
  'gallery.view.hall': '自由展厅',
  // 九种展厅形制的名字（3D 里那间厅长什么样）
  'gallery.style.kimbell': '金贝尔筒拱厅',
  'gallery.style.louvre': '卢浮宫大画廊',
  'gallery.style.uffizi': '乌菲齐长廊',
  'gallery.style.sistine': '西斯廷礼拜堂',
  'gallery.style.whitecube': '现代白盒子',
  'gallery.style.versailles': '凡尔赛镜厅',
  'gallery.style.neue': '新国家美术馆',
  'gallery.style.shoin': '东方木构厅堂',
  'gallery.style.guggenheim': '古根海姆中庭',

  // 采光验证（/gallery/kimbell/）：单摆线拱的那间验证场景
  'gallery.light.title': '采光验证 · 单摆线拱',
  'gallery.light.desc': '照金贝尔美术馆的单拱尺寸复刻的一间空厅：30.48 × 6.1 m，拱顶一条 0.6 m 通长天窗缝，缝下挂着翼形穿孔铝反射器。拖时间滑块，看一天里太阳怎么把光送到拱面上。',
  'gallery.light.entry': '采光验证',
  'gallery.light.slider': '一天里的时间',
  'gallery.light.hint': '拖动鼠标转视角，滚轮拉近推远；拖上面的滑块换时间。',
  'gallery.light.fallback': '这个设备跑不动 WebGL，场景没能挂起来。',
  'gallery.light.stats.fps': '帧率',
  'gallery.light.stats.segments': '摆线断面段数',
  'gallery.light.stats.vertices': '顶点数',
  'gallery.light.stats.triangles': '三角形',
  'gallery.light.stats.calls': 'Draw call',
  'gallery.light.spec.span': '跨度',
  'gallery.light.spec.rise': '摆线矢高',
  'gallery.light.spec.spring': '起拱线',
  'gallery.light.spec.length': '拱长',
  'gallery.light.spec.slot': '天窗缝宽',
  'gallery.itemCount': '件作品',
  'gallery.back': '所有房间',
  'gallery.hint.look': '拖拽鼠标看向四周',
  'gallery.hint.move': 'WASD / 方向键移动，穿过拱门去别的展厅',
  'gallery.hint.touch': '滑动看向，点地面走过去，点画作走近',
  'gallery.hint.reset': 'R 键回正视角',
  'gallery.reset': '回正视角',
  'gallery.here': '现在在',
  'gallery.roomCount': '间展厅',
  'gallery.immersive': '沉浸模式',
  'gallery.exit': '退出',
  'gallery.gridMode': '切换为网格',
  'gallery.roomMode': '切换为房间',
  'gallery.loading': '正在挂画…',
  'gallery.fallback.notice': '这个设备跑不动 3D 展厅，已自动换成网格浏览。',
  'gallery.close': '关闭',
  'gallery.prev': '上一件',
  'gallery.next': '下一件',
  'gallery.meta.camera': '器材',
  'gallery.empty': '还没有作品，去 /admin 的「画廊」里加几件。',

  // 博客与文章
  'blog.title': '博客',
  'blog.empty': '还没有文章，写完第一篇就会出现在这里。',
  'post.published': '发布于',
  'post.updated': '更新于',
  'post.minRead': '分钟阅读',
  'post.next': '下一篇',
  'post.prev': '上一篇',
  'post.missingTranslation': '这篇文章还没有英文版。',

  // 归档 / 分类 / 标签
  'browse.aria': '按归档、分类或标签浏览',
  'archive.title': '归档',
  'archive.count': '篇文章',
  'categories.title': '分类',
  'tags.title': '标签',
  'tag.label': '标签',
  'category.label': '分类',

  // 友链
  'friends.title': '友链',
  'friends.desc': '下面是一些常看的博客，排名不分先后。',
  'friends.empty': '还没有添加友链。',

  // 搜索（pagefind）
  'search.open': '搜索文章',
  'search.placeholder': '搜索文章标题与正文…',
  'search.empty': '没有匹配的文章，换个关键词试试。',
  'search.hint': '输入关键词开始搜索',
  'search.results': '找到 {n} 条结果',
  'search.devOnly': '搜索索引在构建时生成，开发模式下不可用。',
  'search.failed': '搜索索引加载失败，请稍后重试。',

  // 卡片与目录
  'widget.contents': '目录',
  'toc.aria': '页面目录导航',

  // 主题切换
  'theme.toggle': '切换深浅色主题',
  'theme.light': '浅色模式',
  'theme.dark': '深色模式',

  // 板块标题
  'section.about': '个人简介',
  'section.interests': '研究方向',
  'section.news': '最新动态',
  'section.publications': '论文发表',
  'section.research': '科研经历',
  'section.skills': '技术栈',
  'section.projects': '项目与实习',
  'section.internships': '实习经历',
  'section.education': '教育与荣誉',
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

  // 时间与位置组件（顶栏时钟：按访客 IP 定位）
  'clock.label': 'Your city and local time',
  'clock.labelLocal': 'Your local time',

  // 导航栏（跨页面链接）
  'nav.aria': 'Main navigation',
  'nav.menu': 'Open navigation menu',
  'nav.home': 'Home',
  'nav.friends': 'Friends',
  'nav.blog': 'Blog',
  'nav.gallery': 'Gallery',

  // 画廊（/gallery）
  'gallery.title': 'Gallery',
  'gallery.desc': 'Nine halls rebuilt after real museum rooms, with my pictures on the walls. Walk through an arch into the next one.',
  'gallery.view.theme': 'By theme',
  'gallery.view.year': 'By year',
  'gallery.view.hall': 'Curated halls',
  // 九种展厅形制的名字（3D 里那间厅长什么样）
  'gallery.style.kimbell': 'Kimbell Vault',
  'gallery.style.louvre': 'Grande Galerie',
  'gallery.style.uffizi': 'Uffizi Corridor',
  'gallery.style.sistine': 'Sistine Chapel',
  'gallery.style.whitecube': 'White Cube',
  'gallery.style.versailles': 'Hall of Mirrors',
  'gallery.style.neue': 'Neue Nationalgalerie',
  'gallery.style.shoin': 'Timber Hall',
  'gallery.style.guggenheim': 'Guggenheim Rotunda',

  // 采光验证（/en/gallery/kimbell/）：单摆线拱的那间验证场景
  'gallery.light.title': 'Daylight Study · Cycloid Vault',
  'gallery.light.desc': 'An empty hall built to the Kimbell’s single-vault dimensions: 30.48 × 6.1 m, a 0.6 m continuous skylight slot, and a perforated aluminium wing reflector hung below it. Drag the time slider to watch the sun move light onto the vault.',
  'gallery.light.entry': 'Daylight study',
  'gallery.light.slider': 'Time of day',
  'gallery.light.hint': 'Drag to look around, scroll to zoom; drag the slider above to change the hour.',
  'gallery.light.fallback': 'This device cannot run WebGL, so the scene did not start.',
  'gallery.light.stats.fps': 'FPS',
  'gallery.light.stats.segments': 'Cycloid segments',
  'gallery.light.stats.vertices': 'Vertices',
  'gallery.light.stats.triangles': 'Triangles',
  'gallery.light.stats.calls': 'Draw calls',
  'gallery.light.spec.span': 'Span',
  'gallery.light.spec.rise': 'Cycloid rise',
  'gallery.light.spec.spring': 'Springing line',
  'gallery.light.spec.length': 'Vault length',
  'gallery.light.spec.slot': 'Skylight slot',
  'gallery.itemCount': 'works',
  'gallery.back': 'All rooms',
  'gallery.hint.look': 'Drag to look around',
  'gallery.hint.move': 'WASD / arrows to walk, go through an arch into the next hall',
  'gallery.hint.touch': 'Swipe to look, tap the floor to walk, tap a work to approach',
  'gallery.hint.reset': 'press R to reset the view',
  'gallery.reset': 'Reset view',
  'gallery.here': 'Now in',
  'gallery.roomCount': 'halls',
  'gallery.immersive': 'Immersion mode',
  'gallery.exit': 'Exit',
  'gallery.gridMode': 'Grid view',
  'gallery.roomMode': 'Room view',
  'gallery.loading': 'Hanging the pictures…',
  'gallery.fallback.notice': 'This device cannot run the 3D halls, so the grid is shown instead.',
  'gallery.close': 'Close',
  'gallery.prev': 'Previous',
  'gallery.next': 'Next',
  'gallery.meta.camera': 'Camera',
  'gallery.empty': 'No works yet — add some under “Gallery” in /admin.',

  // 博客与文章
  'blog.title': 'Blog',
  'blog.empty': 'No posts yet — the first one will show up here.',
  'post.published': 'Published',
  'post.updated': 'Updated',
  'post.minRead': 'min read',
  'post.next': 'Next',
  'post.prev': 'Previous',
  'post.missingTranslation': 'This post is not available in English yet.',

  // 归档 / 分类 / 标签
  'browse.aria': 'Browse by archive, category or tag',
  'archive.title': 'Archive',
  'archive.count': 'posts',
  'categories.title': 'Categories',
  'tags.title': 'Tags',
  'tag.label': 'Tag',
  'category.label': 'Category',

  // 友链
  'friends.title': 'Friends',
  'friends.desc': 'Blogs I read regularly, in no particular order.',
  'friends.empty': 'No links yet.',

  // 搜索（pagefind）
  'search.open': 'Search posts',
  'search.placeholder': 'Search titles and content…',
  'search.empty': 'No matching posts. Try another keyword.',
  'search.hint': 'Type to start searching',
  'search.results': '{n} result(s) found',
  'search.devOnly': 'The search index is generated at build time and is unavailable in dev mode.',
  'search.failed': 'Failed to load the search index. Please try again later.',

  // 卡片与目录
  'widget.contents': 'Contents',
  'toc.aria': 'Table of contents',

  // 主题切换
  'theme.toggle': 'Toggle color theme',
  'theme.light': 'Light mode',
  'theme.dark': 'Dark mode',

  // 板块标题
  'section.about': 'About',
  'section.interests': 'Research Interests',
  'section.news': 'News',
  'section.publications': 'Publications',
  'section.research': 'Research Experience',
  'section.skills': 'Skills',
  'section.projects': 'Projects & Internships',
  'section.internships': 'Internships',
  'section.education': 'Education & Honors',
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

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
  'nav.about': '关于',
  'nav.friends': '友链',
  'nav.blog': '博客',
  'nav.gallery': '画廊',

  // 沉浸式首页（/）—— 原来的简历式内容整体搬去了 /about
  'home.scroll': '向下滚动',
  'home.entries': '从这里开始',
  // 首屏刊头那两行小字：**只描述这个站在收什么，不描述人**。
  // 单位 / 地点 / 学位那三样原来就挂在首屏刊头上（affiliation / location /
  // title），看着像把简历抬头搬上了封面 —— 现在一律撤掉，它们只留在 /about。
  'home.eyebrow': '个人数字花园',
  'home.kicker': '笔记 · 照片 · 书签',
  // 首屏右栏那句「站点自己的话」。刻意与 profile.bio 无关 ——
  // 首屏是刊头不是简历，自我介绍只留给 /about（改文案不用碰组件）
  'home.lede.1': '写下来的东西，比记得住的更可靠。',
  'home.lede.2': '所以想到的、看见的，都留在这里。',
  'home.latest': '最新文章',
  'home.gallery': '画廊精选',
  'home.viewAll': '查看全部',
  'home.card.about': '简介、论文、技术栈与经历',
  'home.card.blog': '技术笔记与读书摘录',
  'home.card.gallery': '按主题布展的 3D 展厅，另有一页艺术平铺',
  'home.card.friends': '常看的博客，排名不分先后',

  // 画廊（/gallery）
  'gallery.title': '画廊',
  'gallery.entry.rooms': '3D 艺术展厅',
  'gallery.spread.intro': '全部作品一页摊开。左侧目录与画面互相点亮，点开任意一张看大图。',
  'gallery.dir.title': '目录',
  'gallery.note.title': '展览前言',
  'gallery.note.body': '城市三张都在夜里，海三张赶在清晨与退潮。两年里挑出这几张，摊在一页上。',
  'gallery.meta.total': '合计',
  'gallery.meta.years': '年份',
  'gallery.meta.gear': '器材',
  'gallery.meta.tags': '关键词',
  // 合集制（2026-09-15）：画廊首页 = 合集封面索引，一个合集一个目录
  'gallery.nav.index': '合集',
  'gallery.enter.collection': '进入合集',
  'gallery.enter.hall': '进入展厅',
  'gallery.mode.3d': '3D 展厅',
  'gallery.mode.flat': '平铺',
  'gallery.meta.collections': '合集',
  'gallery.meta.photos': '照片',
  'gallery.meta.mode': '陈展方式',
  'gallery.collectionUnit': '个',
  'gallery.rooms.intro': '带 3D 形制的合集在这里排成门面，点门进去走动、凑近看。',
  'gallery.rooms.note':
    '门后是一间能走动的展厅：带 3D 形制的合集布置成连通的房间，走过拱门就换了一间。想看哪本合集的照片，去「合集」索引点它的封面。',
  'gallery.screening.note': '把画廊里的照片按顺序放一遍，也可以选本地的图片或视频投上去。',
  'gallery.detail.noteFallback': '这个合集还没有写前言（在它的 meta.json 里补 note 就会出现在这里）。',

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

  'gallery.itemCount': '件作品',
  'gallery.hint.touch': '滑动看向，点地面走过去，点画作走近',
  'gallery.reset': '回正视角',
  'gallery.minimap': '展厅平面图，点开看大图并传送',
  'gallery.map.title': '展厅平面图',
  'gallery.map.hint': '在图上点一下，直接传送到那儿（会落到最近的一处能站的地方）',
  'gallery.map.hall': '大厅',
  'gallery.map.collapse': '地图',
  'gallery.chapter': '章节',
  'gallery.leave': '离开展厅',
  'gallery.intro': '拖拽看向四周 · WASD / 方向键走动 · 点地面走过去 · 点作品走近 · R 回正视角',
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
  // 序厅墙上的字（画进 3D 场景里）
  'gallery.wall.title': '两间展室',
  'gallery.wall.curator': '照真实艺术厅复刻，墙上挂着自己的照片。',
  'gallery.wall.hint': '点地面走过去 · 点作品走近 · R 回正视角',

  // 私人放映室（/gallery/screening-room/）
  'screening.title': '暮色放映室',
  'screening.desc': '走近右侧放映机，亲手开机、选片和调焦，再回到沙发观看。支持馆藏图片系列、本地图片和视频。',
  'screening.entry': '私人放映室',
  'screening.canvas': '可交互的三维私人放映室',
  'screening.fallback': '这个设备无法启动三维放映室。',
  'screening.hint': '拖拽看向四周 · 点击右侧放映机操作 · 滚轮轻微拉近',
  'screening.power': '电源',
  'screening.source': '选择内容',
  'screening.play': '开始放映',
  'screening.pause': '暂停',
  'screening.focus': '镜头对焦',
  'screening.autoFocus': '自动对焦',
  'screening.seat': '回到沙发',
  'screening.projector': '前往放映机',
  'screening.clarity': '清晰观影',
  'screening.immersive': '沉浸观看',
  'screening.standby': '放映机已关闭',
  'screening.starting': '放映机启动中',
  'screening.ready': '放映机已就绪',
  'screening.playing': '正在放映',
  'screening.paused': '放映已暂停',
  'screening.cooling': '放映机正在散热',
  'screening.chooseTitle': '选择放映内容',
  'screening.gallerySeries': '馆藏图片系列',
  'screening.gallerySeriesDesc': '按当前画廊顺序逐张放映',
  'screening.localImages': '选择本地图片',
  'screening.localVideo': '选择本地视频',
  'screening.playlist': '片单',
  'screening.interval': '图片轮播间隔',
  'screening.selected': '已选择',
  'screening.noSource': '请先选择放映内容',
  'screening.uploadFailed': '无法读取所选文件',
  'screening.lowResolution': '片源分辨率低于 720P，放大后可能模糊',
  'screening.lowQuality': '清晰度偏低',

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
  'rail.aria': '站点小挂件',
  'rail.aboutMe': '关于我',
  'rail.footprint': '写作足迹',
  'rail.footprintHint': '当月足迹；单篇直接打开，一天多篇点开当天列表',
  'rail.expandHint': '点开当天列表',
  'rail.stats': '本站速览',
  'rail.postsUnit': '篇文章',
  'rail.charsUnit': '字',
  'rail.tagsUnit': '个标签',
  'rail.collectedUnit': '篇摘录',
  'rail.sourcesUnit': '个来源站',
  'rail.random': '随便看看',

  // 换页载入提示
  'nav.loading': '载入中…',

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

  // 页面宠物（右下角常驻的土豆仔，见 src/components/Pet.astro）
  'pet.sprite': '页面宠物：点我说话，按住可以拖动',
  'pet.poke': '戳一下',
  'pet.feed': '喂零食',
  'pet.placeholder': '问它一句…',
  'pet.send': '发送',
  'pet.settings': '设置',
  'pet.hide': '隐藏宠物',
  'pet.panel': '宠物设置',
  'pet.close': '关闭',
  'pet.groupLook': '外观',
  'pet.labelBubbles': '互动气泡',
  'pet.labelLive2D': 'Live2D 形象',
  'pet.groupModel': '对话模型',
  'pet.needsKey': '需自备 Key',
  'pet.reloadHint': '切换会重新加载页面',
  'pet.hintShort': '本机保存 · 填基址会自动补全',
  'pet.tips': '填写提示',
  'pet.dismiss': '关掉这句',
  'pet.show': '叫我出来',
  'pet.affection': '好感度',
  'pet.mood': '心情',
  'pet.source': '这句来自',
  'pet.key': 'API Key',
  'pet.keyHint': '只存在这台浏览器里，不会进仓库；地址填到 /v1 这类基址会自动补全 /chat/completions；模型挑快的（qwen-turbo / qwen-plus / kimi-k2.5），思考型模型会让它等很久',
  'pet.endpoint': '接口地址',
  'pet.model': '模型',
  'pet.save': '保存',
  'pet.clear': '清除配置',
  'pet.test': '测试连接',
  'pet.testing': '正在测试…',
  'pet.testSuggest': '更合适的模型：',
  'pet.saved': '已保存到本浏览器',
  'pet.cleared': '配置已清除，退回台词库',
  'pet.members': '成员',
  'pet.roleLead': '主角',
  'pet.roleCompanion': '同伴',
  'pet.solo': '独自',
  'pet.companionHint': '首次召唤会下载约 3.4 MB 模型',
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
  'nav.about': 'About',
  'nav.friends': 'Friends',
  'nav.blog': 'Blog',
  'nav.gallery': 'Gallery',

  // 沉浸式首页（/）—— 原来的简历式内容整体搬去了 /about
  'home.scroll': 'Scroll down',
  'home.entries': 'Start here',
  // 首屏刊头那两行小字：只描述这个站在收什么，不描述人（详见 zh 段注释）
  'home.eyebrow': 'A personal digital garden',
  'home.kicker': 'Notes · Photos · Bookmarks',
  // 首屏右栏那句「站点自己的话」。刻意与 profile.bio 无关 ——
  // 首屏是刊头不是简历，自我介绍只留给 /about
  'home.lede.1': 'What I write down outlasts what I remember.',
  'home.lede.2': 'So the thoughts and the pictures all stay here.',
  'home.latest': 'Latest posts',
  'home.gallery': 'From the gallery',
  'home.viewAll': 'View all',
  'home.card.about': 'Bio, publications, skills and experience',
  'home.card.blog': 'Notes on systems, reading and everything else',
  'home.card.gallery': 'Halls curated by theme, plus a flat sheet of every work',
  'home.card.friends': 'Blogs I read regularly, in no particular order',

  // 画廊（/gallery）
  'gallery.title': 'Gallery',
  'gallery.entry.rooms': '3D halls',
  'gallery.spread.intro': 'Every work spread across one page. The index on the left and the frames light each other up; click any one to enlarge.',
  'gallery.dir.title': 'Index',
  'gallery.note.title': 'Foreword',
  'gallery.note.body': 'The city frames were made at night; the sea frames at dawn and low tide. A few kept from two years, spread across one page.',
  'gallery.meta.total': 'Total',
  'gallery.meta.years': 'Years',
  'gallery.meta.gear': 'Cameras',
  'gallery.meta.tags': 'Tags',
  // Collections (2026-09-15): the gallery index is a cover sheet, one directory per collection
  'gallery.nav.index': 'Collections',
  'gallery.enter.collection': 'Enter the collection',
  'gallery.enter.hall': 'Enter the hall',
  'gallery.mode.3d': '3D hall',
  'gallery.mode.flat': 'Flat',
  'gallery.meta.collections': 'Collections',
  'gallery.meta.photos': 'Photos',
  'gallery.meta.mode': 'Display',
  'gallery.collectionUnit': 'collections',
  'gallery.rooms.intro': 'Collections with a 3D form line up here as doorways — step through and walk.',
  'gallery.rooms.note':
    'Behind each door is a walkable hall: the collections with a 3D form become connected rooms, and an arch takes you to the next one. To browse a collection as photos, open its cover under Collections.',
  'gallery.screening.note': 'Runs the gallery pictures in order, or put your own local images or video on the screen.',
  'gallery.detail.noteFallback': 'No foreword for this collection yet (add a note to its meta.json).',

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

  'gallery.itemCount': 'works',
  'gallery.hint.touch': 'Swipe to look, tap the floor to walk, tap a work to approach',
  'gallery.reset': 'Reset view',
  'gallery.minimap': 'Floor plan — open the full map and teleport',
  'gallery.map.title': 'Floor plan',
  'gallery.map.hint': 'Click anywhere on the map to teleport there (you land on the nearest spot you can stand)',
  'gallery.map.hall': 'Main hall',
  'gallery.map.collapse': 'Map',
  'gallery.chapter': 'Chapter',
  'gallery.leave': 'Leave',
  'gallery.intro': 'Drag to look · WASD / arrows to walk · click the floor to go · click a work to approach · R to reset',
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
  // Writing on the entrance walls (drawn into the 3D scene)
  'gallery.wall.title': 'Two halls',
  'gallery.wall.curator': 'Rebuilt after real museum rooms, my own pictures on the walls.',
  'gallery.wall.hint': 'Click the floor to walk · click a work to approach · R to reset',

  // Private screening room (/en/gallery/screening-room/)
  'screening.title': 'Twilight Screening Room',
  'screening.desc': 'Approach the projector to power it on, choose a source and focus the lens, then return to the sofa. Plays gallery series, local images and video.',
  'screening.entry': 'Private screening room',
  'screening.canvas': 'Interactive 3D private screening room',
  'screening.fallback': 'This device cannot start the 3D screening room.',
  'screening.hint': 'Drag to look · click the projector on the right to operate it · scroll to nudge the view',
  'screening.power': 'Power',
  'screening.source': 'Choose source',
  'screening.play': 'Start screening',
  'screening.pause': 'Pause',
  'screening.focus': 'Lens focus',
  'screening.autoFocus': 'Auto focus',
  'screening.seat': 'Return to sofa',
  'screening.projector': 'Approach projector',
  'screening.clarity': 'Clarity view',
  'screening.immersive': 'Immersive view',
  'screening.standby': 'Projector off',
  'screening.starting': 'Projector starting',
  'screening.ready': 'Projector ready',
  'screening.playing': 'Screening',
  'screening.paused': 'Screening paused',
  'screening.cooling': 'Projector cooling',
  'screening.chooseTitle': 'Choose what to screen',
  'screening.gallerySeries': 'Gallery image series',
  'screening.gallerySeriesDesc': 'Screen every gallery image in order',
  'screening.localImages': 'Choose local images',
  'screening.localVideo': 'Choose a local video',
  'screening.playlist': 'Playlist',
  'screening.interval': 'Slideshow interval',
  'screening.selected': 'Selected',
  'screening.noSource': 'Choose a source first',
  'screening.uploadFailed': 'The selected file could not be read',
  'screening.lowResolution': 'Source is below 720p and may look soft when enlarged',
  'screening.lowQuality': 'Low resolution',

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

  // Cards and table of contents
  'widget.contents': 'Contents',
  'toc.aria': 'Table of contents',
  'rail.aria': 'Site widgets',
  'rail.aboutMe': 'About me',
  'rail.footprint': 'Writing footprint',
  'rail.footprintHint': 'This month; one post opens it, a busy day lists them',
  'rail.expandHint': 'click to list that day',
  'rail.stats': 'At a glance',
  'rail.postsUnit': 'posts',
  'rail.charsUnit': 'chars',
  'rail.tagsUnit': 'tags',
  'rail.collectedUnit': 'digests',
  'rail.sourcesUnit': 'sources',
  'rail.random': 'Surprise me',

  // 换页载入提示
  'nav.loading': 'Loading…',

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

  // Page pet (the potato living in the bottom-right corner, see src/components/Pet.astro)
  'pet.sprite': 'Page pet — click to chat, drag to move',
  'pet.poke': 'Poke it',
  'pet.feed': 'Give a snack',
  'pet.placeholder': 'Ask it something…',
  'pet.send': 'Send',
  'pet.settings': 'Settings',
  'pet.hide': 'Hide pet',
  'pet.panel': 'Pet settings',
  'pet.close': 'Close',
  'pet.groupLook': 'Appearance',
  'pet.labelBubbles': 'Interaction bubbles',
  'pet.labelLive2D': 'Live2D model',
  'pet.groupModel': 'Chat model',
  'pet.needsKey': 'Bring your own key',
  'pet.reloadHint': 'Switching reloads the page',
  'pet.hintShort': 'Stored locally · base URL gets completed',
  'pet.tips': 'Setup tips',
  'pet.dismiss': 'Dismiss',
  'pet.show': 'Come back',
  'pet.affection': 'Affection',
  'pet.mood': 'Mood',
  'pet.source': 'Answered by',
  'pet.key': 'API key',
  'pet.keyHint': 'Stays in this browser, never committed. A base URL like .../v1 gets /chat/completions appended. Pick a fast model (qwen-turbo / qwen-plus / kimi-k2.5) — thinking models make it wait a long time',
  'pet.endpoint': 'Endpoint',
  'pet.model': 'Model',
  'pet.save': 'Save',
  'pet.clear': 'Clear config',
  'pet.test': 'Test connection',
  'pet.testing': 'Testing…',
  'pet.testSuggest': 'Better options: ',
  'pet.saved': 'Saved to this browser',
  'pet.cleared': 'Config cleared — back to local lines',
  'pet.members': 'Members',
  'pet.roleLead': 'Lead',
  'pet.roleCompanion': 'Companion',
  'pet.solo': 'Alone',
  'pet.companionHint': 'First summon downloads about 3.4 MB',
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

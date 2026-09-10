import { initTokenPanel } from './token';
import { initPost, refreshPostList } from './post';
import { initProfile } from './profile';
import { initFriends } from './friends';
import { initAssets } from './assets';
import { initUnsavedGuard } from './unsaved';
import { pruneDrafts } from './drafts';
import { initDropGuard } from './upload';
import { $, readFlag, writeFlag, activeSection, setTopbarPath } from './dom';
import { onDirtyChange } from './unsaved';
import { initShortcuts, registerShortcut, openShortcutHelp } from './shortcuts';

/**
 * 后台入口：只负责把三栏装配起来。
 * 各栏的逻辑分别在 post.ts / profile.ts / friends.ts，
 * 共用工具在 dom.ts，token 的胶囊与抽屉在 token.ts，
 * 快捷键注册表在 shortcuts.ts（各模块自己往里加键）。
 */

const found = document.querySelector<HTMLElement>('.workbench');
if (!found) throw new Error('页面缺少 .workbench');
const workbench: HTMLElement = found;

const sidebarKey = 'admin_sidebar_open';
const inspectorKey = 'admin_inspector_open';

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar__tab'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('.canvas__panel'));

function showTab(name: string): void {
  for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
  for (const tab of tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  // 只有写文章时才需要右侧检查器
  workbench.dataset.section = name;
  // 顶栏中间那行跟着分区走（各分区自己也可能覆盖它，比如载入了具体文章）
  setTopbarPath(SECTION_PATH[name] ?? '');
  // 各分区按需载入自己的数据（个人信息 / 友链都不在启动路径上读仓库）
  document.dispatchEvent(new CustomEvent<string>('admin:section', { detail: name }));
}

/** 顶栏路径的兜底文案：具体文件由各分区载入后覆盖（见 setTopbarPath） */
const SECTION_PATH: Record<string, string> = {
  post: 'src/content/posts/',
  profile: 'src/data/profile.{zh,en}.json',
  friends: 'src/data/friends.json',
  assets: 'public/illustrations',
};

for (const tab of tabs) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab ?? 'post'));
}

function setSidebar(open: boolean): void {
  workbench.dataset.sidebar = open ? 'open' : 'closed';
  $('sidebar-toggle').setAttribute('aria-expanded', String(open));
  writeFlag(sidebarKey, open);
}

function setInspector(open: boolean): void {
  workbench.dataset.inspector = open ? 'open' : 'closed';
  $('inspector-toggle').setAttribute('aria-expanded', String(open));
  writeFlag(inspectorKey, open);
}

$('sidebar-toggle').addEventListener('click', () => setSidebar(workbench.dataset.sidebar !== 'open'));
$('inspector-toggle').addEventListener('click', () => setInspector(workbench.dataset.inspector !== 'open'));

// 拖着文件在页面上乱放时别让浏览器把文件当页面打开（正文会丢）
initDropGuard();

initTokenPanel(() => {
  refreshPostList();
  // token 刚配好：把当前分区的内容也拉进来（各分区自己判断要不要响应）
  document.dispatchEvent(new CustomEvent<string>('admin:section', { detail: activeSection() }));
});

initShortcuts();
// ⌘K：跳到文章分区并把焦点放进搜索框
registerShortcut({
  keys: 'mod+k',
  label: '搜索文章',
  group: '导航',
  allowInInput: true,
  run: () => {
    document.querySelector<HTMLButtonElement>('.sidebar__tab[data-tab="post"]')?.click();
    const search = $<HTMLInputElement>('post-filter');
    search.focus();
    search.select();
  },
});
// 「?」只在非输入框里生效：正文里敲问号得能正常打出来
registerShortcut({
  keys: 'shift+/',
  label: '快捷键一览',
  group: '通用',
  run: openShortcutHelp,
});
$('shortcut-help-btn').addEventListener('click', openShortcutHelp);
$('shortcut-help-close').addEventListener('click', () => {
  $<HTMLDialogElement>('shortcut-help').close();
});

initPost();
initProfile();
initFriends();
initAssets();
initUnsavedGuard('有未保存的改动，确定离开吗？');

showTab('post');
setSidebar(readFlag(sidebarKey, true));
setInspector(readFlag(inspectorKey, true));

// 顶栏那盏「未保存」小灯（订阅时会立刻同步一次当前状态）
onDirtyChange((dirty) => {
  $('topbar-dirty').hidden = !dirty;
});

void pruneDrafts();

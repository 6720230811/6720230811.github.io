import { initTokenPanel } from './token';
import { initPost, refreshPostList } from './post';
import { initProfile } from './profile';
import { initFriends } from './friends';
import { initUnsavedGuard } from './unsaved';
import { pruneDrafts } from './drafts';
import { initDropGuard } from './upload';
import { $, readFlag, writeFlag } from './dom';

/**
 * 后台入口：只负责把三栏装配起来。
 * 各栏的逻辑分别在 post.ts / profile.ts / friends.ts，
 * 共用工具在 dom.ts，token 的胶囊与抽屉在 token.ts。
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
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  // 只有写文章时才需要右侧检查器
  workbench.dataset.section = name;
}

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

initTokenPanel(refreshPostList);
initPost();
initProfile();
initFriends();
initUnsavedGuard('有未保存的改动，确定离开吗？');

showTab('post');
setSidebar(readFlag(sidebarKey, true));
setInspector(readFlag(inspectorKey, true));

void pruneDrafts();

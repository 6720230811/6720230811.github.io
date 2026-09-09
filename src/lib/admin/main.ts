import { initTokenBar } from './token';
import { initPost, refreshPostList } from './post';
import { initProfile } from './profile';
import { initFriends } from './friends';
import { pruneDrafts } from './drafts';

/**
 * 后台入口：只负责把三栏装配起来。
 * 各栏的逻辑分别在 post.ts / profile.ts / friends.ts，
 * 共用工具在 dom.ts，token 的存取在 token.ts。
 */

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('.tab-panel'));

function showTab(name: string): void {
  for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
  for (const tab of tabs) {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab ?? 'post'));
}

initTokenBar(refreshPostList);
initPost();
initProfile();
initFriends();

showTab('post');
void pruneDrafts();

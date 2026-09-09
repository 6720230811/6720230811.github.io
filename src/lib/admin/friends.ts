import { $, setStatus, setFieldError, run } from './dom';
import { repo, paths } from '../../data/admin';
import { readFile, saveFile, GhError, type Repo } from './github';
import { stableFriendsFileJson } from './serialize';
import { requireToken } from './token';

/** 「友链」这一栏：编辑 src/data/friends.json 里当前语言的那一份 */

const friendsLang = $<HTMLSelectElement>('friends-lang');

async function loadFriends(): Promise<void> {
  const token = requireToken();
  if (!token) return;
  try {
    const file = await readFile(repo as Repo, paths.friends(), token);
    const all = file ? (JSON.parse(file.text) as Record<string, unknown[]>) : {};
    $<HTMLTextAreaElement>('friends-json').value = JSON.stringify(
      all[friendsLang.value] ?? [],
      null,
      2
    );
    setFieldError('e-friends-json', '');
    setStatus('已载入 friends.json', 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  }
}

export function initFriends(): void {
  $('friends-reload').addEventListener('click', () => run(loadFriends));
  friendsLang.addEventListener('change', () => run(loadFriends));

  $('friends-save').addEventListener('click', () => {
    void (async () => {
      const token = requireToken();
      if (!token) return;
      try {
        const current = JSON.parse($<HTMLTextAreaElement>('friends-json').value || '[]');
        setFieldError('e-friends-json', '');
        // 文件里是 zh/en 两份，只替换当前编辑的这一份
        const file = await readFile(repo as Repo, paths.friends(), token);
        const all = file ? (JSON.parse(file.text) as Record<string, unknown>) : {};
        all[friendsLang.value] = current;
        const text = stableFriendsFileJson(all.zh ?? [], all.en ?? []);

        setStatus('正在写入仓库…', 'busy');
        await saveFile(
          repo as Repo,
          paths.friends(),
          token,
          text,
          `update friends: ${friendsLang.value}`
        );
        setStatus('已保存 friends.json，Actions 大约 1 分钟后上线。', 'ok');
      } catch (e) {
        setStatus(e instanceof GhError ? e.hint : (e as Error).message || String(e), 'error');
      }
    })();
  });
}

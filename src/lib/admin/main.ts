import { repo, paths } from '../../data/admin';
import type { Profile } from '../../data/profile.schema';
import {
  readFile,
  listDir,
  saveFile,
  actionsUrl,
  GhError,
  type Repo,
} from './github';
import {
  buildPostFile,
  parsePostFile,
  isValidSlug,
  toSlug,
  today,
  stableProfileJson,
  stableFriendsFileJson,
  sanitizeInline,
  type PostFrontmatter,
} from './serialize';
import { saveDraft, loadDraft, clearDraft, pruneDrafts, isFallback } from './drafts';
import { updatePreview, autoHeight } from './preview';

const TOKEN_KEY = 'admin_token';

/** 取元素：后台是固定结构的单页，少了哪个元素说明模板改了，直接报错比静默失败好 */
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`页面缺少元素 #${id}`);
  return el as T;
}

const statusEl = $('status');
const noticeEl = $('draft-notice');

function setStatus(message: string, kind: 'ok' | 'error' | 'info' | 'busy' = 'info'): void {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status status--${kind}`;
}

/** 异步入口的统一兜底：GhError 显示中文提示，避免错误被 Promise 静默吞掉 */
function run(task: () => Promise<void>): void {
  void task().catch((e: unknown) => {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  });
}

function setNotice(message: string): void {
  noticeEl.hidden = !message;
  noticeEl.textContent = message;
}

// ---------------------------------------------------------------- Token
const tokenInput = $<HTMLInputElement>('token-input');

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeToken(value: string): void {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 隐私模式下 localStorage 会抛异常，本次会话内用内存里的值即可
  }
}

/** 没有 token 就提示，返回 null 让调用方直接退出 */
function requireToken(): string | null {
  const token = readToken();
  if (!token) setStatus('请先在上方保存 GitHub Token。', 'error');
  return token || null;
}

$('token-save').addEventListener('click', () => {
  const value = tokenInput.value.trim();
  if (!value) {
    setStatus('Token 不能为空。', 'error');
    return;
  }
  writeToken(value);
  tokenInput.value = '';
  const masked = `${value.slice(0, 8)}…（共 ${value.length} 位）`;
  setStatus(`Token 已保存到本浏览器：${masked}`, 'ok');
  run(() => refreshPostList());
});

$('token-clear').addEventListener('click', () => {
  writeToken('');
  setStatus('Token 已清除。', 'info');
});

// ---------------------------------------------------------------- 分区切换
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

// ---------------------------------------------------------------- 文章
const postLang = $<HTMLSelectElement>('post-lang');
const postSelect = $<HTMLSelectElement>('post-file');
const slugInput = $<HTMLInputElement>('post-slug');
const titleInput = $<HTMLInputElement>('post-title');
const descInput = $<HTMLInputElement>('post-desc');
const dateInput = $<HTMLInputElement>('post-date');
const categoryInput = $<HTMLInputElement>('post-category');
const tagsInput = $<HTMLInputElement>('post-tags');
const draftInput = $<HTMLInputElement>('post-draft');
const bodyInput = $<HTMLTextAreaElement>('post-body');
const previewFrame = $<HTMLIFrameElement>('post-preview');
const postError = $('post-error');

let currentSlug = ''; // 空串表示新建

const draftKey = () => `post:${postLang.value}/${currentSlug || '__new__'}`;

function showPostError(message: string): void {
  postError.hidden = !message;
  postError.textContent = message;
}

function collectPost(): PostFrontmatter {
  return {
    title: titleInput.value.trim(),
    description: descInput.value.trim(),
    date: dateInput.value || today(),
    category: categoryInput.value.trim(),
    tags: tagsInput.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    draft: draftInput.checked,
  };
}

function fillPost(data: PostFrontmatter, body: string): void {
  titleInput.value = data.title;
  descInput.value = data.description;
  dateInput.value = data.date;
  categoryInput.value = data.category;
  tagsInput.value = data.tags.join(', ');
  draftInput.checked = data.draft;
  bodyInput.value = body;
  updatePreview(previewFrame, body);
}

function resetPost(): void {
  fillPost(
    { title: '', description: '', date: today(), category: '', tags: [], draft: false },
    ''
  );
}

async function refreshPostList(): Promise<void> {
  const token = requireToken();
  if (!token) return;

  const entries = await listDir(repo as Repo, paths.postsDir(postLang.value), token);
  const slugs = entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
    .sort();

  postSelect.textContent = '';
  postSelect.append(new Option('＋ 新建文章', ''));
  for (const slug of slugs) postSelect.append(new Option(slug, slug));
}

async function loadPost(slug: string): Promise<void> {
  const token = requireToken();
  if (!token) return;

  currentSlug = slug;
  slugInput.value = slug;
  // 已有文章的 slug 就是文件名，改了等于新建一篇，所以直接锁住
  slugInput.disabled = slug !== '';
  $('post-path').textContent = slug
    ? paths.post(postLang.value, slug)
    : paths.postsDir(postLang.value);
  setNotice('');
  showPostError('');

  if (!slug) {
    resetPost();
    await restoreDraft();
    return;
  }

  try {
    const file = await readFile(repo as Repo, paths.post(postLang.value, slug), token);
    if (!file) {
      setStatus('这个文件在仓库里不存在了，可能是刚被删掉。', 'error');
      return;
    }
    const parsed = parsePostFile(file.text);
    fillPost(parsed.data, parsed.body);
    setStatus(`已载入 ${slug}`, 'ok');
    await restoreDraft();
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  }
}

interface PostDraft {
  data: PostFrontmatter;
  body: string;
}

async function restoreDraft(): Promise<void> {
  const draft = await loadDraft<PostDraft>(draftKey());
  if (!draft) return;
  fillPost(draft.data.data, draft.data.body);
  const minutes = Math.max(1, Math.round((Date.now() - draft.updatedAt) / 60000));
  setNotice(`已恢复 ${minutes} 分钟前的本地草稿，发布成功后会自动清除。`);
}

$('post-reload').addEventListener('click', () => {
  run(async () => {
    await refreshPostList();
    await loadPost(postSelect.value);
  });
});

postLang.addEventListener('change', () => {
  run(async () => {
    await refreshPostList();
    await loadPost('');
  });
});

postSelect.addEventListener('change', () => run(() => loadPost(postSelect.value)));

// 标题变 slug：只在新建时自动填，用户改过就不再覆盖
let slugTouched = false;
slugInput.addEventListener('input', () => {
  slugTouched = true;
});
titleInput.addEventListener('input', () => {
  if (slugTouched || currentSlug) return;
  // 纯中文标题提不出 ASCII 字符，退化成 post-日期，用户再自己改
  slugInput.value = toSlug(titleInput.value) || `post-${today()}`;
});

// 预览 + 草稿自动保存
let previewTimer: number | undefined;
let draftTimer: number | undefined;

bodyInput.addEventListener('input', () => {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => updatePreview(previewFrame, bodyInput.value), 200);
});

for (const el of [titleInput, descInput, dateInput, categoryInput, tagsInput, draftInput, bodyInput, slugInput]) {
  el.addEventListener('input', () => {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      void saveDraft(draftKey(), { data: collectPost(), body: bodyInput.value });
    }, 800);
  });
}

$('post-save').addEventListener('click', () => {
  void (async () => {
    const token = requireToken();
    if (!token) return;

    const slug = currentSlug || slugInput.value.trim();
    if (!isValidSlug(slug)) {
      showPostError('slug 只能用小写字母、数字和连字符，例如 my-new-post。文件名必须是 ASCII。');
      return;
    }
    const data = collectPost();
    if (!data.title) {
      showPostError('title 不能为空。');
      return;
    }
    if (!data.category) {
      showPostError('category 不能为空（schema 里是必填）。');
      return;
    }
    showPostError('');

    const text = buildPostFile({ data, body: bodyInput.value.trimEnd() });
    try {
      setStatus('正在写入仓库…', 'busy');
      await saveFile(
        repo as Repo,
        paths.post(postLang.value, slug),
        token,
        text,
        `${currentSlug ? 'update' : 'add'} post: ${data.title}`
      );
      await clearDraft(draftKey());
      setNotice('');
      currentSlug = slug;
      slugInput.disabled = true;
      setStatus(
        `已发布 ${slug}。Actions 大约 1 分钟后上线，可以去 ${actionsUrl(repo as Repo)} 看进度。`,
        'ok'
      );
      await refreshPostList();
      postSelect.value = slug;
    } catch (e) {
      setStatus(e instanceof GhError ? e.hint : String(e), 'error');
    }
  })();
});

// ---------------------------------------------------------------- 个人信息
const profileLang = $<HTMLSelectElement>('profile-lang');
const ARRAY_KEYS = [
  'news',
  'publications',
  'research',
  'skills',
  'projects',
  'internships',
  'education',
  'awards',
] as const;

const lines = (value: string) =>
  value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function setJsonError(id: string, message: string): void {
  const el = document.getElementById(`e-${id}`);
  if (!el) return;
  el.hidden = !message;
  el.textContent = message;
}

function readJson(id: string): unknown {
  const raw = $<HTMLTextAreaElement>(id).value.trim();
  if (!raw) {
    setJsonError(id, '');
    return [];
  }
  try {
    setJsonError(id, '');
    return JSON.parse(raw);
  } catch (e) {
    setJsonError(id, `JSON 解析失败：${(e as Error).message}`);
    throw new Error(`${id} 不是合法 JSON`);
  }
}

function fillProfile(profile: Profile): void {
  const set = (id: string, value: string) => {
    $<HTMLInputElement>(id).value = value ?? '';
  };
  set('p-name', profile.name);
  set('p-title', profile.title);
  set('p-affiliation', profile.affiliation);
  set('p-affiliationLink', profile.affiliationLink ?? '');
  set('p-lab', profile.lab ?? '');
  set('p-location', profile.location);
  set('p-timezone', profile.timezone);
  set('p-email', profile.email);
  set('p-citationSummary', profile.citationSummary ?? '');
  set('p-cvFile', profile.cvFile);
  set('p-link-github', profile.links.github ?? '');
  set('p-link-scholar', profile.links.scholar ?? '');
  set('p-link-linkedin', profile.links.linkedin ?? '');
  set('p-link-blog', profile.links.blog ?? '');

  $<HTMLTextAreaElement>('p-bio').value = profile.bio.join('\n');
  $<HTMLTextAreaElement>('p-interests').value = profile.interests.join('\n');

  for (const key of ARRAY_KEYS) {
    $<HTMLTextAreaElement>(key).value = JSON.stringify(profile[key], null, 2);
    setJsonError(key, '');
  }
}

/** 合并表单与 JSON 编辑框的内容，产出完整的 Profile 对象 */
function collectProfile(): unknown {
  const value = (id: string) => $<HTMLInputElement>(id).value.trim();

  const profile: Record<string, unknown> = {
    name: value('p-name'),
    title: value('p-title'),
    affiliation: value('p-affiliation'),
    location: value('p-location'),
    timezone: value('p-timezone'),
    email: value('p-email'),
    cvFile: value('p-cvFile'),
    bio: lines($<HTMLTextAreaElement>('p-bio').value),
    interests: lines($<HTMLTextAreaElement>('p-interests').value),
    links: {
      github: value('p-link-github') || undefined,
      scholar: value('p-link-scholar') || undefined,
      linkedin: value('p-link-linkedin') || undefined,
      blog: value('p-link-blog') || undefined,
    },
  };

  // 可选字段：空着就整个省略，JSON 里不出现 undefined 键
  const optional = (key: string, val: string) => {
    if (val) profile[key] = val;
  };
  optional('affiliationLink', value('p-affiliationLink'));
  optional('lab', value('p-lab'));
  optional('citationSummary', value('p-citationSummary'));

  // 字段顺序要跟 schema 一致，所以最后再按 schema 的顺序重建（见 stableProfileJson）
  const ordered: Record<string, unknown> = {};
  const order = [
    'name', 'title', 'affiliation', 'affiliationLink', 'lab', 'location', 'timezone', 'email',
    'bio', 'interests', 'links', 'citationSummary', 'cvFile', ...ARRAY_KEYS,
  ];
  for (const key of ARRAY_KEYS) profile[key] = readJson(key);
  for (const key of order) {
    if (key in profile) ordered[key] = profile[key];
  }

  // news.text 用 set:html 渲染，保存前过一遍白名单
  const news = ordered.news as { date: string; text: string }[] | undefined;
  if (Array.isArray(news)) {
    for (const item of news) {
      if (typeof item?.text === 'string') item.text = sanitizeInline(item.text);
    }
  }
  return ordered;
}

async function loadProfile(): Promise<void> {
  const token = requireToken();
  if (!token) return;
  $('profile-path').textContent = paths.profile(profileLang.value);
  try {
    const file = await readFile(repo as Repo, paths.profile(profileLang.value), token);
    if (!file) {
      setStatus('仓库里没有这个文件。', 'error');
      return;
    }
    fillProfile(JSON.parse(file.text) as Profile);
    setStatus(`已载入 profile.${profileLang.value}.json`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  }
}

$('profile-reload').addEventListener('click', () => run(loadProfile));
profileLang.addEventListener('change', () => run(loadProfile));
for (const key of ARRAY_KEYS) {
  $<HTMLTextAreaElement>(key).addEventListener('input', () => {
    try {
      readJson(key);
    } catch {
      // 错误已经显示在编辑框下方，这里只是触发校验
    }
  });
}

$('profile-save').addEventListener('click', () => {
  void (async () => {
    const token = requireToken();
    if (!token) return;
    try {
      const json = stableProfileJson(collectProfile());
      setStatus('正在写入仓库…', 'busy');
      await saveFile(
        repo as Repo,
        paths.profile(profileLang.value),
        token,
        json,
        `update profile: ${profileLang.value}`
      );
      setStatus(`已保存 profile.${profileLang.value}.json，Actions 大约 1 分钟后上线。`, 'ok');
    } catch (e) {
      setStatus(e instanceof GhError ? e.hint : (e as Error).message || String(e), 'error');
    }
  })();
});

// ---------------------------------------------------------------- 友链
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
    setJsonError('friends-json', '');
    setStatus('已载入 friends.json', 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  }
}

$('friends-reload').addEventListener('click', () => run(loadFriends));
friendsLang.addEventListener('change', () => run(loadFriends));

$('friends-save').addEventListener('click', () => {
  void (async () => {
    const token = requireToken();
    if (!token) return;
    try {
      const current = JSON.parse($<HTMLTextAreaElement>('friends-json').value || '[]');
      setJsonError('friends-json', '');
      // 文件里是 zh/en 两份，只替换当前编辑的这一份
      const file = await readFile(repo as Repo, paths.friends(), token);
      const all = file ? (JSON.parse(file.text) as Record<string, unknown>) : {};
      all[friendsLang.value] = current;
      const text = stableFriendsFileJson(all.zh ?? [], all.en ?? []);

      setStatus('正在写入仓库…', 'busy');
      await saveFile(repo as Repo, paths.friends(), token, text, `update friends: ${friendsLang.value}`);
      setStatus('已保存 friends.json，Actions 大约 1 分钟后上线。', 'ok');
    } catch (e) {
      setStatus(e instanceof GhError ? e.hint : (e as Error).message || String(e), 'error');
    }
  })();
});

// ---------------------------------------------------------------- 启动
autoHeight(previewFrame);
updatePreview(previewFrame, '');
resetPost();
showTab('post');

void pruneDrafts();
// 启动时也试着恢复草稿：没有 token 也能接着写，等填了 token 再发布
void restoreDraft();
if (isFallback()) {
  setNotice('本地存储不可用（隐私模式？），草稿只会保留在当前标签页。');
}

if (readToken()) {
  run(() => refreshPostList());
} else {
  setStatus('先保存 GitHub Token 才能读写仓库。', 'info');
}

import { $, setStatus, setNotice, setFieldError, run } from './dom';
import { repo, paths } from '../../data/admin';
import {
  readFile,
  listDir,
  saveFile,
  actionsUrl,
  GhError,
  type Repo,
} from './github';
import { buildPostFile, parsePostFile, isValidSlug, today, toSlug } from './serialize';
import type { PostFrontmatter } from './serialize';
import { saveDraft, loadDraft, clearDraft, isFallback } from './drafts';
import { updatePreview, autoHeight } from './preview';
import { requireToken } from './token';

/**
 * 「文章」这一栏：载入、编辑、本地草稿、发布。
 * 只管这一栏，个人信息与友链在 profile.ts / friends.ts。
 */

const postLang = $<HTMLSelectElement>('post-lang');
const postSelect = $<HTMLSelectElement>('post-file');
const slugInput = $<HTMLInputElement>('post-slug');
const titleInput = $<HTMLInputElement>('post-title');
const descInput = $<HTMLInputElement>('post-desc');
const dateInput = $<HTMLInputElement>('post-date');
const categoryInput = $<HTMLInputElement>('post-category');
const tagsInput = $<HTMLInputElement>('post-tags');
const coverInput = $<HTMLInputElement>('post-cover');
const draftInput = $<HTMLInputElement>('post-draft');
const bodyInput = $<HTMLTextAreaElement>('post-body');
const previewFrame = $<HTMLIFrameElement>('post-preview');

let currentSlug = ''; // 空串表示新建

const draftKey = () => `post:${postLang.value}/${currentSlug || '__new__'}`;

function showPostError(message: string): void {
  setFieldError('post-error', message);
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
    // 留空就不写进 frontmatter：文章页会自动退回正文第一张图
    cover: coverInput.value.trim() || undefined,
    draft: draftInput.checked,
  };
}

function fillPost(data: PostFrontmatter, body: string): void {
  titleInput.value = data.title;
  descInput.value = data.description;
  dateInput.value = data.date;
  categoryInput.value = data.category;
  tagsInput.value = data.tags.join(', ');
  coverInput.value = data.cover ?? '';
  draftInput.checked = data.draft;
  bodyInput.value = body;
  updatePreview(previewFrame, body);
}

function resetPost(): void {
  fillPost({ title: '', description: '', date: today(), category: '', tags: [], draft: false }, '');
}

export async function refreshPostList(): Promise<void> {
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

export async function loadPost(slug: string): Promise<void> {
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

export function initPost(): void {
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

  autoHeight(previewFrame);
  updatePreview(previewFrame, '');
  resetPost();

  // 启动时也试着恢复草稿：没有 token 也能接着写，等填了 token 再发布
  void restoreDraft();
  if (isFallback()) {
    setNotice('本地存储不可用（隐私模式？），草稿只会保留在当前标签页。');
  }
  if (requireToken()) {
    run(() => refreshPostList());
  } else {
    setStatus('先保存 GitHub Token 才能读写仓库。', 'info');
  }
}

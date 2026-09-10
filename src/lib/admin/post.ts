import { $, setStatus, setNotice, setFieldError, run, debounce, activeSection } from './dom';
import { registerShortcut } from './shortcuts';
import { repo, paths, site } from '../../data/admin';
import { readFile, saveFile, statFile, deleteFile, readBase64, GhError, type Repo } from './github';
import { buildPostFile, parsePostFile, today, toSlug, isValidSlug } from './serialize';
import type { PostFrontmatter } from './serialize';
import { loadDraft, clearDraft, isFallback } from './drafts';
import { updatePreview, onPreviewLoad, initPreviewLoad, watchTheme, type PreviewView } from './preview';
import { renderStats } from './stats';
import { initMdToolbar, initTabIndent, initSaveShortcut } from './toolbar';
import { initImageDrop } from './upload';
import { initPostList, type PostList } from './postlist';
import { markDirty, markClean, isDirty } from './unsaved';
import { validatePost, showIssues } from './validate';
import { requireToken, flagTokenProblem } from './token';
import { initChips, rememberTags, type Chips } from './chips';
import { quickSlug, suggestSlug } from './slugify';
import { initCoverDrop } from './coverdrop';
import { createAutosave } from './autosave';
import { waitForBuild } from './actions';
import { createPublishPanel } from './publish';
import { Mirror } from './mirror';
import { createSync, renderWithLines } from './sync';
import { initBubble } from './bubble';
import { resolveCoverFields } from '../cover';
import { initTrash, rememberDeletion, makeTrashItem, refreshTrash, restoreTrashItem } from './trash';
import { runBulk, bulkLabel, type BulkAction } from './bulk';
import type { Locale } from '../../i18n/ui';

/**
 * 中间那一栏：标题、正文、预览，以及发布。
 * Frontmatter 那堆字段在右侧检查器里，但取值与校验都在这里
 * （两边是同一份状态，没必要拆成两个 store）。
 */

const postLang = $<HTMLSelectElement>('post-lang');
const titleInput = $<HTMLInputElement>('post-title');
const slugInput = $<HTMLInputElement>('post-slug');
const slugLock = $<HTMLButtonElement>('slug-lock');
const slugOverwrite = $<HTMLButtonElement>('slug-overwrite');
const slugHint = $('slug-hint');
const dateInput = $<HTMLInputElement>('post-date');
const updatedInput = $<HTMLInputElement>('post-updated');
const deleteBtn = $<HTMLButtonElement>('post-delete');
const deleteBox = $('delete-confirm');
const deleteName = $('delete-name');
const deleteOk = $<HTMLButtonElement>('delete-ok');
const deleteCancel = $<HTMLButtonElement>('delete-cancel');
const deleteCover = $<HTMLInputElement>('delete-cover');
const deleteCoverRow = $('delete-cover-row');
const deleteCoverName = $('delete-cover-name');
const duplicateBtn = $<HTMLButtonElement>('post-duplicate');
const categoryInput = $<HTMLInputElement>('post-category');
const tagBox = $('tag-chips');
const tagInput = $<HTMLInputElement>('tag-input');
const tagSuggest = $('tag-suggest');
const coverInput = $<HTMLInputElement>('post-cover');
const descInput = $<HTMLTextAreaElement>('post-desc');
const draftInput = $<HTMLInputElement>('post-draft');
const bodyInput = $<HTMLTextAreaElement>('post-body');
const previewFrame = $<HTMLIFrameElement>('post-preview');
const statsEl = $('post-stats');
const editorEl = $<HTMLElement>('editor');
const writePane = $<HTMLElement>('editor-write');
const bubbleEl = $<HTMLElement>('md-bubble');

const panel = createPublishPanel();

let currentSlug = ''; // 空串表示新建
let view: PreviewView = 'body';
let slugLocked = true;
let overwriteAck = false;
let touched = false;
let list: PostList | null = null;
let chips: Chips | null = null;
let aliasChips: Chips | null = null;
let cover: { refresh: () => void } | null = null;
/** 自动暂存句柄：initPost 里建好，duplicatePost 也要用 */
let autosaveRef: ReturnType<typeof createAutosave<PostDraft>> | null = null;

/** 仓库里已有的 slug：发布前查重用（改过语言或重新载入时刷新） */
const knownSlugs = new Set<string>();

const draftKey = () => `post:${postLang.value}/${currentSlug || '__new__'}`;

function showPostError(message: string): void {
  setFieldError('post-error', message);
}

function collectPost(): PostFrontmatter {
  return {
    title: titleInput.value.trim(),
    description: descInput.value.trim(),
    date: dateInput.value || today(),
    // 留空就不写进 frontmatter：没有 updated 时列表里显示的是发布日期
    updated: updatedInput.value.trim() || undefined,
    category: categoryInput.value.trim(),
    tags: chips?.get() ?? [],
    // 留空就不写进 frontmatter：文章页会自动退回正文第一张图
    cover: coverInput.value.trim() || undefined,
    // 别名留空就不写：没有别名时不生成多余的跳转页
    aliases: aliasChips?.get() ?? [],
    draft: draftInput.checked,
  };
}

// ---------------------------------------------------------------- 渲染
const mirror = new Mirror(bodyInput, writePane);
const sync = createSync(bodyInput, mirror, () => previewFrame.contentWindow);
let syncOn = true;

function renderNow(): void {
  const body = bodyInput.value;
  updatePreview(previewFrame, {
    view,
    data: collectPost(),
    body,
    bodyHtml: body.trim() ? renderWithLines(body) : '',
    locale: postLang.value as Locale,
  });
  renderStats(statsEl, body, postLang.value as Locale);
  mirror.sync();
  if (sync.isEnabled()) sync.align();
}

function fillPost(data: PostFrontmatter, body: string): void {
  touched = false;
  markClean();
  showPostError('');
  titleInput.value = data.title;
  descInput.value = data.description;
  dateInput.value = data.date;
  updatedInput.value = data.updated ?? '';
  categoryInput.value = data.category;
  chips?.set(data.tags);
  aliasChips?.set(data.aliases ?? []);
  coverInput.value = data.cover ?? '';
  draftInput.checked = data.draft;
  bodyInput.value = body;
  cover?.refresh();
  renderNow();
}

function resetPost(): void {
  fillPost(
    { title: '', description: '', date: today(), category: '', tags: [], draft: true },
    ''
  );
}

export async function refreshPostList(): Promise<void> {
  const token = requireToken();
  if (!token || !list) return;

  await list.rebuild(postLang.value, token);
  knownSlugs.clear();
  for (const slug of list.slugs()) knownSlugs.add(slug);
}

export async function loadPost(slug: string, opts: { keepPanel?: boolean } = {}): Promise<void> {
  const token = requireToken();
  if (!token) return;

  currentSlug = slug;
  slugInput.value = slug;
  overwriteAck = false;
  slugOverwrite.hidden = true;
  list?.setActive(slug);
  // slug 默认锁住：跟标题走（新文章）或保持原文件名（老文章）。
  // 解锁后就是「改名」——发布时会先写新文件、再删掉旧的那个。
  slugLocked = true;
  paintLock();
  hideDeleteConfirm();
  deleteBtn.disabled = !slug;
  duplicateBtn.disabled = !slug;
  $('post-path').textContent = slug
    ? paths.post(postLang.value, slug)
    : paths.postsDir(postLang.value);
  setNotice('');
  showPostError('');
  // keepPanel：删完文章要留着「已删除 / 构建进度」那条反馈，不能被这次重载清掉
  if (!opts.keepPanel) panel.reset();

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

// ---------------------------------------------------------------- 删除
function showDeleteConfirm(): void {
  if (!currentSlug) return;
  deleteName.textContent = `${currentSlug}.md`;
  // 只有站内的配图才谈得上「顺手删掉」：外链和「留空取正文首图」都不在仓库里
  const coverPath = paths.illustrationFromUrl(coverInput.value);
  deleteCoverRow.hidden = !coverPath;
  deleteCover.checked = Boolean(coverPath);
  if (coverPath) deleteCoverName.textContent = coverPath;
  deleteBox.hidden = false;
  deleteBtn.hidden = true;
}

function hideDeleteConfirm(): void {
  deleteBox.hidden = true;
  deleteBtn.hidden = false;
}

/**
 * 删掉仓库里这篇文章。
 * 删除也是一次提交，所以同样走一遍构建反馈：删完能看到 Actions 什么时候跑完。
 */
const removePost = async (): Promise<void> => {
  const token = requireToken();
  if (!token || !currentSlug) return;

  const slug = currentSlug;
  // 存一份原文再删：编辑器里可能是没保存过的版本，那个才是用户想找回的
  const data = collectPost();
  const text = buildPostFile({ data, body: bodyInput.value.trimEnd() });

  panel.busy(true);
  panel.commit('正在从仓库删除…');
  try {
    // 封面要在删掉之前读出来，之后就再也拿不到了
    const coverPath = deleteCover.checked ? paths.illustrationFromUrl(data.cover ?? '') : null;
    const cover = coverPath ? await readBase64(repo as Repo, coverPath, token) : null;

    const commitSha = await deleteFile(
      repo as Repo,
      paths.post(postLang.value, slug),
      token,
      `delete post: ${slug}`
    );
    await clearDraft(draftKey());
    knownSlugs.delete(slug);
    markClean();
    setNotice('');

    if (!commitSha) {
      panel.note('仓库里本来就没有这个文件。');
      await refreshPostList();
      await loadPost('', { keepPanel: true });
      return;
    }

    // 删完先留一份本地副本：侧栏「最近删除」里可以一键还原
    const trashItem = makeTrashItem({
      lang: postLang.value,
      slug,
      title: data.title || slug,
      path: paths.post(postLang.value, slug),
      text,
      ...(cover && coverPath ? { cover: { path: coverPath, b64: cover.b64 } } : {}),
    });
    await rememberDeletion(trashItem);
    if (cover && coverPath) {
      await deleteFile(repo as Repo, coverPath, token, `delete cover: ${slug}`);
    }

    // 提示条上直接给后悔药（和侧栏「最近删除」的还原是同一条代码路径）
    const undo = {
      label: '撤销删除',
      run: () => {
        void restoreTrashItem(trashItem, { onDone: () => void refreshPostList() });
      },
    };

    panel.poll();
    const result = await waitForBuild(commitSha);
    if (result.phase === 'success') {
      panel.done(site.blog(postLang.value));
      setStatus(`已删除 ${slug}，线上已生效${cover ? '（封面一起删了）' : ''}。`, 'ok', undo);
    } else if (result.phase === 'failure') {
      panel.fail(`删除已提交，但构建在第 ${result.seconds} 秒失败`, {
        steps: result.steps,
        logUrl: result.run?.html_url,
        retry: () => void removePost(),
      });
      setStatus(`已删除 ${slug}（构建失败的那次与此无关）。`, 'info', undo);
    } else if (result.phase === 'timeout') {
      panel.note('删除已提交，构建 4 分钟还没结束，去 Actions 页面看进度。');
      setStatus(`已删除 ${slug}。`, 'info', undo);
    } else {
      panel.note('已删除；读不到 Actions 状态（Token 缺 Actions 读权限）。');
      setStatus(`已删除 ${slug}。`, 'info', undo);
    }

    await refreshPostList();
    await loadPost('', { keepPanel: true });
  } catch (e) {
    const hint = e instanceof GhError ? e.hint : String(e);
    if (e instanceof GhError && (e.status === 401 || e.status === 403)) {
      flagTokenProblem(hint);
      panel.reset();
    } else {
      panel.fail(hint, { logUrl: site.actions(), retry: () => void removePost() });
    }
    setStatus(hint, 'error');
  } finally {
    hideDeleteConfirm();
    panel.busy(false);
  }
};

/** 复制一份当前内容为新的草稿：slug 加 -copy，默认草稿，改好再发布 */
function duplicatePost(): void {
  const data = collectPost();
  const body = bodyInput.value;
  const base = toSlug(data.title) || currentSlug || 'post';

  currentSlug = '';
  slugLocked = false;
  overwriteAck = false;
  fillPost(
    {
      ...data,
      title: data.title ? `${data.title}（副本）` : '',
      date: today(),
      updated: undefined,
      // 副本不该继承原名那些旧链接：它们是属于原文章的
      aliases: [],
      draft: true,
    },
    body
  );
  slugInput.value = `${base}-copy`;
  $('post-path').textContent = paths.postsDir(postLang.value);
  list?.setActive('');
  hideDeleteConfirm();
  deleteBtn.disabled = true;
  duplicateBtn.disabled = true;
  paintLock();
  markDirty();
  autosaveRef?.markDirty();
  renderNow();
  setStatus('已复制成一份新草稿，改好 slug 再发布。', 'ok');
}

// ---------------------------------------------------------------- slug
function paintLock(): void {
  slugLock.setAttribute('aria-pressed', String(slugLocked));
  slugLock.title = slugLocked
    ? currentSlug
      ? '锁住了（点一下解锁：可以改文件名）'
      : '跟随标题自动更新（点一下解锁手改）'
    : '已解锁，可手动编辑';
  slugInput.disabled = slugLocked;
  // 已解锁 + 已有文章 = 改名，这件事得说清楚，不然发布后凭空多一个文件
  slugHint.hidden = slugLocked || !currentSlug;
  slugHint.textContent = '改名：发布时写入新文件、删掉旧的，并把旧 slug 记进别名（旧地址自动跳转）。';
}

/**
 * 标题 → slug。
 * 先同步填 ASCII 部分（拼音表是动态加载的，等它加载完再补中文那部分），
 * 这样敲英文标题时 slug 是立刻跟着走的。
 */
const syncSlug = debounce(() => {
  if (!slugLocked || currentSlug) return;
  const title = titleInput.value;
  const quick = quickSlug(title);
  if (quick) slugInput.value = quick;

  void suggestSlug(title).then((suggested) => {
    // 异步回来时标题可能已经改了、或者用户已经解锁手改，这两种情况都不该覆盖
    if (!slugLocked || currentSlug || title !== titleInput.value) return;
    if (suggested) slugInput.value = suggested;
  });
}, 400);

/** 失焦时预检同名文件：等 GitHub 报冲突再发现，白写的东西已经丢了 */
async function checkConflict(): Promise<void> {
  const slug = slugInput.value.trim();
  overwriteAck = false;
  slugOverwrite.hidden = true;

  if (!slug || slug === currentSlug || !isValidSlug(slug)) {
    setFieldError('slug-error', '');
    return;
  }
  const token = requireToken();
  if (!token) return;

  try {
    const exists = await statFile(repo as Repo, paths.post(postLang.value, slug), token);
    if (exists) {
      setFieldError('slug-error', '该文件名已被占用，覆盖会替掉原来的那篇。');
      slugOverwrite.hidden = false;
    } else {
      setFieldError('slug-error', '');
    }
  } catch (e) {
    // 查重只是提前预警，查不动就算了：发布时 saveFile 自己会带上 sha 处理冲突
    if (!(e instanceof GhError && (e.status === 401 || e.status === 403))) {
      setFieldError('slug-error', '');
    }
  }
}

// ---------------------------------------------------------------- 初始化
export function initPost(): void {
  // 左侧列表：点一篇就载入它，点「新建」就清空；勾选后可批量操作
  list = initPostList((slug) => run(() => loadPost(slug)), {
    onBulk: (slugs, action) => applyBulk(slugs, action),
  });

  chips = initChips({
    box: tagBox,
    input: tagInput,
    suggest: tagSuggest,
    onChange: () => {
      touched = true;
      markDirty();
      autosave.markDirty();
      schedulePreview();
    },
  });

  // 别名不记历史、不给候选：旧 slug 是一次性的东西，混进标签历史只会干扰输入
  aliasChips = initChips({
    box: $('alias-chips'),
    input: $<HTMLInputElement>('alias-input'),
    historyKey: null,
    onChange: () => {
      touched = true;
      markDirty();
      autosave.markDirty();
      schedulePreview();
    },
  });

  cover = initCoverDrop({
    zone: $('cover-drop'),
    file: $<HTMLInputElement>('cover-file'),
    thumb: $<HTMLImageElement>('cover-thumb'),
    badge: $('cover-badge'),
    url: coverInput,
    hint: $('cover-hint'),
    onChange: () => {
      touched = true;
      markDirty();
      autosave.markDirty();
      schedulePreview();
    },
    emptyHint: () => {
      const lifted = resolveCoverFields(undefined, bodyInput.value);
      return lifted ? `留空 → 用正文第一张图：${lifted.src}` : '';
    },
  });

  const autosave = (autosaveRef = createAutosave<PostDraft>({
    key: draftKey,
    collect: () => ({ data: collectPost(), body: bodyInput.value }),
  }));

  initPreviewLoad(previewFrame);
  onPreviewLoad(() => sync.attach());
  initBubble(bodyInput, mirror, writePane, bubbleEl);
  initMdToolbar(document, bodyInput);
  initTabIndent(bodyInput);
  // 配图：拖进正文或粘贴即上传，文件名用当前 slug 当前缀
  initImageDrop(
    bodyInput,
    () => slugInput.value.trim() || toSlug(titleInput.value) || 'image',
    writePane
  );

  $('post-reload').addEventListener('click', () => {
    run(async () => {
      await refreshPostList();
      await loadPost(currentSlug);
    });
  });

  postLang.addEventListener('change', () => {
    run(async () => {
      await refreshPostList();
      await loadPost('');
    });
  });

  titleInput.addEventListener('input', syncSlug);
  slugInput.addEventListener('input', () => {
    // 手改过就自动解锁：不然下一次敲标题又把人写的覆盖掉
    if (slugLocked) {
      slugLocked = false;
      paintLock();
    }
  });
  slugInput.addEventListener('blur', () => run(checkConflict));
  slugLock.addEventListener('click', () => {
    slugLocked = !slugLocked;
    paintLock();
    if (slugLocked) syncSlug();
  });
  $('slug-reset').addEventListener('click', () => {
    slugLocked = true;
    paintLock();
    syncSlug();
  });
  slugOverwrite.addEventListener('click', () => {
    overwriteAck = true;
    setFieldError('slug-error', '已确认覆盖：发布时会替掉同名文件。');
    slugOverwrite.hidden = true;
  });

  /**
   * 所有字段走同一条总线：改任何一个都同时驱动预览、统计、草稿。
   * 之前只有正文会刷新预览，改标题/标签/封面看不到变化，预览等于半残。
   * input 之外也听 change：日期选择器选值、checkbox 在某些浏览器只发 change。
   */
  const schedulePreview = debounce(renderNow, 250);

  /** 校验并显示在第一个出错的字段上 */
  function checkNow(): boolean {
    return showIssues(
      validatePost({
        slug: slugInput.value.trim(),
        currentSlug,
        data: collectPost(),
        known: knownSlugs,
        overwrite: overwriteAck,
      }),
      showPostError
    );
  }

  const fields = [
    slugInput,
    titleInput,
    descInput,
    dateInput,
    categoryInput,
    coverInput,
    draftInput,
    bodyInput,
  ];

  const onChange = () => {
    touched = true;
    markDirty();
    autosave.markDirty();
    schedulePreview();
    scheduleValidate();
  };
  const scheduleValidate = debounce(() => {
    if (touched) checkNow();
  }, 400);

  for (const el of fields) {
    el.addEventListener('input', onChange);
    el.addEventListener('change', onChange);
  }

  // 视图切换：正文 / 列表卡片 / 文章页
  const viewBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.view-switch__btn'));
  for (const btn of viewBtns) {
    btn.addEventListener('click', () => {
      view = (btn.dataset.view ?? 'body') as PreviewView;
      for (const other of viewBtns) other.setAttribute('aria-pressed', String(other === btn));
      renderNow();
    });
  }

  // 布局模式：纯编辑 / 双栏预览 / 全真渲染
  const modeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'));
  function setMode(mode: string): void {
    editorEl.dataset.mode = mode;
    for (const btn of modeBtns) btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    // 只有两栏都在的时候谈得上同步滚动
    sync.setEnabled(mode === 'split' && syncOn);
    requestAnimationFrame(() => {
      mirror.sync();
      if (sync.isEnabled()) sync.align();
    });
  }
  for (const btn of modeBtns) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode ?? 'split'));
  }

  const syncBtn = $<HTMLButtonElement>('sync-toggle');
  syncBtn.addEventListener('click', () => {
    syncOn = !syncOn;
    syncBtn.setAttribute('aria-pressed', String(syncOn));
    syncBtn.textContent = syncOn ? '同步滚动：开' : '同步滚动：关';
    sync.setEnabled(syncOn && editorEl.dataset.mode === 'split');
  });

  // 主题变了要重渲染：iframe 拿不到父页面的 data-theme
  watchTheme(renderNow);
  window.addEventListener('resize', debounce(() => mirror.sync(), 200));

  const publish = async (): Promise<void> => {
    // 先校验：字段的问题当场指出来，比「没 token」这种环境问题更该先看到
    touched = true;
    if (!checkNow()) return;

    const token = requireToken();
    if (!token) return;

    const slug = slugInput.value.trim() || currentSlug;
    const renaming = Boolean(currentSlug) && slug !== currentSlug;
    const data = collectPost();
    // 改名：把旧 slug 记进别名，构建时给旧地址生成一个跳转页，老链接不 404
    if (renaming) {
      // 换回一个曾经的旧名字时，那个别名就该退场了（不然真身和别名会撞车）
      const aliases = (data.aliases ?? []).filter((a) => a !== slug);
      if (!aliases.includes(currentSlug)) aliases.push(currentSlug);
      data.aliases = aliases;
      aliasChips?.set(aliases);
    }
    const text = buildPostFile({ data, body: bodyInput.value.trimEnd() });

    panel.busy(true);
    panel.commit(renaming ? '正在写入新文件名…' : undefined);
    try {
      const commitSha = await saveFile(
        repo as Repo,
        paths.post(postLang.value, slug),
        token,
        text,
        `${renaming ? 'rename' : currentSlug ? 'update' : 'add'} post: ${data.title}`
      );

      // 改名：新文件写好了再把旧的删掉。顺序反过来会有一瞬间两篇都在
      if (renaming && commitSha) {
        await deleteFile(
          repo as Repo,
          paths.post(postLang.value, currentSlug),
          token,
          `rename post: ${currentSlug} -> ${slug}`
        );
        knownSlugs.delete(currentSlug);
      }

      await clearDraft(draftKey());
      setNotice('');
      markClean();
      rememberTags(data.tags);
      currentSlug = slug;
      slugLocked = true;
      paintLock();
      $('post-path').textContent = paths.post(postLang.value, slug);
      await refreshPostList();
      list?.setActive(slug);

      // 内容没变时 GitHub 不产生提交，也就不会触发构建
      if (!commitSha) {
        panel.note('内容没有变化，没有产生新的提交。');
        setStatus('内容没变，仓库这边没动。', 'info');
        return;
      }

      panel.poll();
      const result = await waitForBuild(commitSha);

      if (result.phase === 'success') {
        panel.done(site.post(postLang.value, slug));
        setStatus(`已发布 ${slug}，线上已生效。`, 'ok');
        return;
      }
      if (result.phase === 'failure') {
        panel.fail(`构建在第 ${result.seconds} 秒失败`, {
          steps: result.steps,
          logUrl: result.run?.html_url,
          retry: () => void publish(),
        });
        return;
      }
      if (result.phase === 'timeout') {
        panel.note('构建 4 分钟还没结束，去 Actions 页面看进度。');
        setStatus('提交成功了，构建还在排队。', 'info');
        return;
      }
      panel.note('已提交，但读不到 Actions 状态（Token 缺 Actions 读权限）。');
      setStatus('已提交；Actions 状态查不到，去 Actions 页面确认。', 'info');
    } catch (e) {
      const hint = e instanceof GhError ? e.hint : String(e);
      if (e instanceof GhError && (e.status === 401 || e.status === 403)) {
        flagTokenProblem(hint);
        panel.reset();
      } else {
        panel.fail(hint, { logUrl: site.actions(), retry: () => void publish() });
      }
      setStatus(hint, 'error');
    } finally {
      panel.busy(false);
    }
  };

  /**
   * 批量操作：改分类 / 转草稿 / 删除。
   * 逐篇串行（见 bulk.ts），整批跑完统一刷一次列表并跟一次构建。
   */
  async function applyBulk(slugs: string[], action: BulkAction): Promise<void> {
    const token = requireToken();
    if (!token || !slugs.length) return;
    // 批量操作会重建列表，编辑中那篇的未保存改动要提醒一句
    if (isDirty() && !window.confirm('有未保存的改动，批量操作会刷新文章列表，继续吗？')) return;

    const label = bulkLabel(action);
    panel.busy(true);
    panel.commit(`正在批量${label}（0/${slugs.length}）…`);
    try {
      const outcome = await runBulk({
        lang: postLang.value,
        slugs,
        action,
        token,
        onProgress: (done, total) => {
          if (done < total) panel.commit(`正在批量${label}（${done}/${total}）…`);
        },
      });

      await refreshPostList();
      await refreshTrash();

      const summary = `批量${label}完成：成功 ${outcome.ok} 篇${
        outcome.failed.length ? `，失败 ${outcome.failed.length} 篇（${outcome.failed.join('；')}）` : ''
      }。`;

      if (action.kind === 'delete') {
        list?.clearSelection();
        // 正在编辑的这篇被删掉了：回到新建状态，别停在已消失的文件上
        if (slugs.includes(currentSlug)) await loadPost('', { keepPanel: true });
      }

      if (!outcome.commit) {
        panel.note(`${summary}没有产生新的提交（内容没变）。`);
        setStatus(summary, 'info');
        return;
      }

      panel.poll();
      const result = await waitForBuild(outcome.commit);
      if (result.phase === 'success') {
        panel.done(site.blog(postLang.value));
        setStatus(`${summary}线上已生效。`, 'ok');
        return;
      }
      if (result.phase === 'failure') {
        panel.fail(`已提交，但构建在第 ${result.seconds} 秒失败`, {
          steps: result.steps,
          logUrl: result.run?.html_url,
          retry: () => void applyBulk(slugs, action),
        });
        return;
      }
      if (result.phase === 'timeout') {
        panel.note(`${summary}构建 4 分钟还没结束，去 Actions 页面看进度。`);
        return;
      }
      panel.note(`${summary}已提交；读不到 Actions 状态（Token 缺 Actions 读权限）。`);
    } catch (e) {
      const hint = e instanceof GhError ? e.hint : String(e);
      panel.fail(hint, { logUrl: site.actions(), retry: () => void applyBulk(slugs, action) });
      setStatus(hint, 'error');
    } finally {
      panel.busy(false);
    }
  }

  $('publish-btn').addEventListener('click', () => void publish());
  // Cmd/Ctrl+S 发布：只在文章栏拦这个键，别在友链栏也拦
  initSaveShortcut(() => void publish(), () => activeSection() === 'post');

  // 视图切换：用 Alt+数字，⌘1/2/3 是浏览器切标签页、页面拦不住
  const viewShortcuts: [string, string, string][] = [
    ['alt+1', '纯编辑', 'write'],
    ['alt+2', '双栏预览', 'split'],
    ['alt+3', '全真渲染', 'render'],
  ];
  for (const [keys, label, mode] of viewShortcuts) {
    registerShortcut({
      keys,
      label: `视图：${label}`,
      group: '视图',
      when: () => activeSection() === 'post',
      run: () => setMode(mode),
    });
  }
  registerShortcut({
    keys: 'mod+shift+p',
    label: '发布到 GitHub',
    group: '发布',
    allowInInput: true,
    when: () => activeSection() === 'post',
    run: () => void publish(),
  });

  deleteBtn.addEventListener('click', showDeleteConfirm);
  deleteCancel.addEventListener('click', hideDeleteConfirm);
  deleteOk.addEventListener('click', () => void removePost());
  duplicateBtn.addEventListener('click', () => {
    if (isDirty() && !window.confirm('有未保存的改动，复制之后当前这篇的改动会留在副本里，继续吗？')) {
      return;
    }
    duplicatePost();
  });

  $('post-save-local').addEventListener('click', () => {
    void autosave.flush().then(() => setStatus('已存成本地草稿，换台机器看不到。', 'ok'));
  });

  // 「最近删除」：还原后刷新列表，同一语言下顺手把这篇载回编辑器
  initTrash({
    onRestored: (item) => {
      void refreshPostList().then(() => {
        // 编辑器里有没保存的改动时不抢焦点：还原的文章已经在列表里了，想看再点
        if (item.lang === postLang.value && !isDirty()) void loadPost(item.slug);
      });
    },
  });

  paintLock();
  setMode('split');
  syncBtn.setAttribute('aria-pressed', 'true');
  resetPost();

  // 启动时也试着恢复草稿：没有 token 也能接着写，等填了 token 再发布
  void restoreDraft();
  if (isFallback()) {
    setNotice('本地存储不可用（隐私模式？），草稿只会保留在当前标签页。');
  }
  if (requireToken()) {
    run(() => refreshPostList());
  }
}

import { $, setStatus, setNotice, run, debounce, activeSection, setTopbarPath } from './dom';
import { z } from 'zod';
import { repo, paths } from '../../data/admin';
import { readFile, saveFile, saveBinaryFile, GhError, type Repo } from './github';
import { stableProfileJson, sanitizeInline, toSlug } from './serialize';
import { requireToken } from './token';
import { markDirty, markClean } from './unsaved';
import { createAutosave } from './autosave';
import { loadDraft, clearDraft } from './drafts';
import { registerShortcut } from './shortcuts';
import type { Profile } from '../../data/profile.schema';
import { loadSchemas } from './schemas';
import { getProfile, getLang, setLang, setState, mutate, subscribe } from './profileState';
import { initProfileCards } from './profileCards';
import { updateMirror, registerLocalAvatar, avatarUrlFor } from './profilePreview';
import { compressToWebp, stamp } from './upload';
import type { Locale } from '../../i18n/ui';

/**
 * 「个人信息」编辑器的主控。
 *
 * 数据流是单向的：
 *   输入框 / 卡片 / JSON 源码 / BibTeX 导入 ──改──▶ profileState ──emit──▶
 *   镜像预览（防抖 300ms）＋ schema 校验（防抖 500ms）＋ 卡片重画（仅结构变化）
 * 保存时再整体 parse 一遍：宁可当场拦下，也别让构建红掉才发现。
 */

const profileLang = $<HTMLSelectElement>('profile-lang');
const previewFrame = $<HTMLIFrameElement>('profile-preview');

const BASE_FIELDS = [
  'avatar',
  'name',
  'title',
  'affiliation',
  'affiliationLink',
  'lab',
  'location',
  'email',
  'citationSummary',
  'cvFile',
] as const;

const OPTIONAL_BASE = new Set(['avatar', 'affiliationLink', 'lab', 'citationSummary']);

const LINK_FIELDS = ['github', 'scholar', 'linkedin', 'blog'] as const;

function readState(): Profile | null {
  return getProfile();
}

/** 已经载入过仓库内容：切回分区不用再读一遍 */
let loaded = false;
/** 正在整体替换状态（载入 / 恢复草稿）：这段时间的 emit 不该记成「用户改了东西」 */
let loading = false;

function draftKey(): string {
  return `profile:${getLang()}`;
}

/** zod 的 issue path → `publications[2].title` 这样的人话 */
function issuePath(path: PropertyKey[]): string {
  return path
    .map((seg, i) => (typeof seg === 'number' ? `[${seg}]` : i === 0 ? String(seg) : `.${String(seg)}`))
    .join('');
}

// ---------------------------------------------------------------- 载入
async function loadProfile(): Promise<void> {
  const token = requireToken();
  if (!token) return;
  const lang = profileLang.value;
  $('profile-path').textContent = paths.profile(lang);
  setTopbarPath(paths.profile(lang));
  loading = true;
  try {
    const file = await readFile(repo as Repo, paths.profile(lang), token);
    if (!file) {
      setStatus('仓库里没有这个文件。', 'error');
      return;
    }
    const raw = JSON.parse(file.text) as unknown;
    const { ProfileSchema, formatIssues } = await loadSchemas();
    const parsed = ProfileSchema.safeParse(raw);
    if (!parsed.success) {
      setStatus(`profile.${lang}.json 与 schema 不一致（先显示出来，保存时会被拦）：\n${formatIssues(parsed.error)}`, 'error');
    }
    // 校验不过也照常填：有问题的字段在卡片里看得见，改对了才能保存
    setState(parsed.success ? parsed.data : (raw as Profile));

    // 本地还有没发布的改动就先顶上（和文章一致：草稿优先，保存成功后清）
    const draft = await loadDraft<Profile>(`profile:${lang}`);
    if (draft) {
      setState(draft.data);
      const minutes = Math.max(1, Math.round((Date.now() - draft.updatedAt) / 60000));
      setNotice(`已恢复 ${minutes} 分钟前的本地草稿（profile.${lang}），保存成功后自动清除。`);
    } else {
      setNotice('');
    }

    fillBaseInputs();
    markClean();
    loaded = true;
    setStatus(`已载入 profile.${lang}.json`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  } finally {
    loading = false;
  }
}

/** 打开「个人信息」分区时按需载入：没配 token、或者已经载入过就什么都不做 */
export function ensureProfileLoaded(): void {
  if (loaded || loading) return;
  if (!requireToken()) return;
  void loadProfile();
}

// ---------------------------------------------------------------- 基本信息绑定
function fillBaseInputs(): void {
  const p = readState();
  if (!p) return;
  for (const key of BASE_FIELDS) {
    const input = document.getElementById(`p-${key}`) as HTMLInputElement | null;
    if (input) input.value = String((p[key] as string | undefined) ?? '');
  }
  for (const key of LINK_FIELDS) {
    const input = document.getElementById(`p-link-${key}`) as HTMLInputElement | null;
    if (input) input.value = String(p.links[key] ?? '');
  }
  $<HTMLTextAreaElement>('p-bio').value = p.bio.join('\n');
  $<HTMLTextAreaElement>('p-interests').value = p.interests.join('\n');
  const cvText = $('cv-text');
  cvText.textContent = p.cvFile ? `当前：public/cv/${p.cvFile}，拖入新 PDF 可替换` : '拖入 PDF 或点击上传，写入 public/cv/';

  // 头像缩略图与当前值说明：刚上传的那张用本地 blob，站点重建前也看得见
  const thumb = document.getElementById('avatar-thumb') as HTMLImageElement | null;
  if (thumb) thumb.src = avatarUrlFor(p.avatar);
  const avatarText = document.getElementById('avatar-text');
  if (avatarText) {
    avatarText.textContent = p.avatar
      ? `当前：${p.avatar}，拖入新图可替换`
      : '拖入图片或点击更换头像（留空用 avatar.jpg）';
  }
}

function bindBaseInputs(): void {
  for (const key of BASE_FIELDS) {
    const input = document.getElementById(`p-${key}`);
    if (!input) continue;
    input.addEventListener('input', () => {
      const value = (input as HTMLInputElement).value.trim();
      mutate((p) => {
        if (OPTIONAL_BASE.has(key) && !value) delete p[key];
        else (p[key] as string) = value;
      });
    });
  }

  for (const key of LINK_FIELDS) {
    const input = document.getElementById(`p-link-${key}`);
    if (!input) continue;
    input.addEventListener('input', () => {
      const value = (input as HTMLInputElement).value.trim();
      mutate((p) => {
        if (value) p.links[key] = value;
        else delete p.links[key];
      });
    });
  }

  const bindLines = (id: string, apply: (p: Profile, list: string[]) => void) => {
    const ta = $<HTMLTextAreaElement>(id);
    ta.addEventListener('input', () => {
      const list = ta.value
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      mutate((p) => apply(p, list));
    });
  };
  bindLines('p-bio', (p, list) => {
    p.bio = list;
  });
  bindLines('p-interests', (p, list) => {
    p.interests = list;
  });
}

// ---------------------------------------------------------------- 简历上传
async function uploadCv(file: File): Promise<void> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    setStatus('简历只收 PDF：先把 Word / LaTeX 导出成 PDF 再来。', 'error');
    return;
  }
  const token = requireToken();
  if (!token) return;

  const stem = toSlug(file.name.replace(/\.pdf$/i, '')) || 'cv';
  const name = `${stem}.pdf`;
  const path = paths.cv(name);
  setStatus(`正在上传 ${path}…`, 'busy');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await saveBinaryFile(repo as Repo, path, token, bytes, `add cv: ${path}`);
    mutate((p) => {
      p.cvFile = name;
    });
    const input = document.getElementById('p-cvFile') as HTMLInputElement | null;
    if (input) input.value = name;
    fillBaseInputs();
    setStatus(`已上传 ${path}，cvFile 已指向它。若换了文件名，旧的 PDF 还在仓库里，可自行清理。`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : `上传失败：${(e as Error).message}`, 'error');
  }
}

function bindCvDrop(): void {
  const zone = $('cv-drop');
  const input = $<HTMLInputElement>('cv-file');
  const handle = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void uploadCv(file);
  };

  zone.addEventListener('click', () => input.click());
  // div 不是原生按钮：补上键盘路径，Tab 到它 + 回车/空格也能选文件
  zone.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    input.click();
  });
  input.addEventListener('change', () => handle(input.files));
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-dropping');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dropping'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dropping');
    handle(e.dataTransfer?.files ?? null);
  });
}

// ---------------------------------------------------------------- 头像上传
/** 头像压到长边 512 就够（资料卡显示量级就这么大），别把几 MB 的原图塞进仓库 */
const AVATAR_EDGE = 512;

/**
 * 换头像：压缩后写进 public/，并把 avatar 字段指向新文件名。
 *
 * 文件名带时间戳（avatar-20260911-0935.webp）而不是覆盖 avatar.jpg：
 * 一来浏览器/CDN 的缓存自然失效，二来外链地址也能直接填在 avatar 字段里。
 */
async function uploadAvatar(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    setStatus('头像只收图片（png / jpg / webp）。', 'error');
    return;
  }
  const token = requireToken();
  if (!token) return;

  setStatus('正在压缩并上传头像…', 'busy');
  try {
    const { blob, ext } = await compressToWebp(file, AVATAR_EDGE);
    const name = `avatar-${stamp()}.${ext}`;
    const path = paths.avatar(name);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await saveBinaryFile(repo as Repo, path, token, bytes, `update avatar: ${name}`);
    // 站点还没重建：镜像预览和缩略图先用本地 blob 顶上，否则会显示 404
    registerLocalAvatar(name, URL.createObjectURL(blob));
    mutate((p) => {
      p.avatar = name;
    });
    fillBaseInputs();
    setStatus(`头像已上传为 ${name}，保存后站点就用它。旧图仍在仓库里，可自行清理。`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : `头像上传失败：${(e as Error).message}`, 'error');
  }
}

function bindAvatarDrop(): void {
  const zone = $('avatar-drop');
  const input = $<HTMLInputElement>('avatar-file');
  const handle = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void uploadAvatar(file);
  };

  zone.addEventListener('click', () => input.click());
  // div 不是原生按钮：补上键盘路径，Tab 到它 + 回车/空格也能选文件
  zone.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    input.click();
  });
  input.addEventListener('change', () => handle(input.files));
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-dropping');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dropping'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dropping');
    handle(e.dataTransfer?.files ?? null);
  });
}

// ---------------------------------------------------------------- 校验展示
async function validateNow(): Promise<void> {
  const p = readState();
  const box = $('profile-issues');
  if (!p) {
    box.hidden = true;
    return;
  }
  try {
    const { ProfileSchema } = await loadSchemas();
    const result = ProfileSchema.safeParse(p);
    if (result.success) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    const lines = result.error.issues.slice(0, 8).map((i) => `${issuePath(i.path)}: ${i.message}`);
    const more =
      result.error.issues.length > lines.length ? `\n… 共 ${result.error.issues.length} 处` : '';
    box.hidden = false;
    box.textContent = `保存会被 schema 拦下：\n${lines.join('\n')}${more}`;
  } catch {
    // schema 分块没加载出来（离线 / 刚部署换了文件名）：保存时还会再校验一次，静默即可
    box.hidden = true;
  }
}

// ---------------------------------------------------------------- 双语对照
interface DiffLine {
  level: 'ok' | 'warn';
  text: string;
}

/**
 * 中英两份逐块对条数、对空缺：
 * 英文版少一条论文 / 漏了一段简介，在这里一眼就能看到，不用两边点开数。
 */
async function runBilingualCheck(): Promise<void> {
  const token = requireToken();
  if (!token) return;

  const box = $('bilingual-report');
  const body = $('bilingual-body');
  box.hidden = false;
  body.textContent = '正在读取两份 profile…';
  setStatus('正在对照 profile.zh.json 与 profile.en.json…', 'busy');

  try {
    const files = await Promise.all(
      (['zh', 'en'] as const).map(async (lang) => {
        const file = await readFile(repo as Repo, paths.profile(lang), token);
        return file ? (JSON.parse(file.text) as unknown) : null;
      })
    );
    const { ProfileSchema, formatIssues } = await loadSchemas();
    const zhResult = ProfileSchema.safeParse(files[0]);
    const enResult = ProfileSchema.safeParse(files[1]);
    const showSchemaError = (lang: string, error: z.ZodError): void => {
      body.textContent = `${lang === 'zh' ? '中文' : '英文'}那份不符合 schema，没法对照：\n${formatIssues(error)}`;
      setStatus('双语对照：先修好 schema 问题再来。', 'error');
    };
    if (!zhResult.success) {
      showSchemaError('zh', zhResult.error);
      return;
    }
    if (!enResult.success) {
      showSchemaError('en', enResult.error);
      return;
    }

    const zh = zhResult.data;
    const en = enResult.data;
    const lines: DiffLine[] = [];

    const blocks: { key: keyof Profile & string; label: string }[] = [
      { key: 'bio', label: '个人简介（段）' },
      { key: 'interests', label: '研究方向' },
      { key: 'news', label: '最新动态' },
      { key: 'publications', label: '论文' },
      { key: 'research', label: '科研经历' },
      { key: 'skills', label: '技术栈分组' },
      { key: 'projects', label: '项目' },
      { key: 'internships', label: '实习' },
      { key: 'education', label: '教育' },
      { key: 'awards', label: '奖项' },
    ];

    for (const { key, label } of blocks) {
      const a = zh[key];
      const b = en[key];
      const na = Array.isArray(a) ? a.length : 0;
      const nb = Array.isArray(b) ? b.length : 0;
      if (na === 0 && nb === 0) continue;
      if (na !== nb) {
        lines.push({ level: 'warn', text: `${label}：中文 ${na} 条 / 英文 ${nb} 条 —— 数量对不上` });
        continue;
      }
      lines.push({ level: 'ok', text: `${label}：两边都是 ${na} 条` });
    }

    // 逐条看空缺：结构对齐了不代表翻译填了
    en.publications.forEach((pub, i) => {
      if (!pub.title.trim()) lines.push({ level: 'warn', text: `论文[${i}]：英文标题是空的` });
      else if (zh.publications[i] && zh.publications[i].title === pub.title) {
        // 中英同名很正常（论文本来就是英文的），不算问题
      }
    });
    en.news.forEach((n, i) => {
      if (!n.text.trim()) lines.push({ level: 'warn', text: `动态[${i}]：英文内容是空的` });
    });
    (['research', 'internships', 'education'] as const).forEach((key) => {
      en[key].forEach((entry, i) => {
        if (!entry.org.trim() || !entry.role.trim())
          lines.push({ level: 'warn', text: `${labelOf(key)}[${i}]：英文缺机构或身份` });
      });
    });
    en.projects.forEach((project, i) => {
      if (!project.description.trim()) lines.push({ level: 'warn', text: `项目[${i}]：英文描述是空的` });
    });

    const warns = lines.filter((l) => l.level === 'warn');
    body.textContent = '';
    const head = body.appendChild(document.createElement('p'));
    head.className = 'bilingual__head';
    head.textContent = warns.length
      ? `发现 ${warns.length} 处可疑：`
      : '中英两份结构对齐，没发现空缺。';
    for (const line of warns.length ? warns : lines.filter((l) => l.level === 'ok').slice(0, 6)) {
      const item = body.appendChild(document.createElement('p'));
      item.className = `bilingual__line${line.level === 'warn' ? ' bilingual__line--warn' : ''}`;
      item.textContent = `${line.level === 'warn' ? '⚠ ' : '✓ '}${line.text}`;
    }
    setStatus(warns.length ? `双语对照：发现 ${warns.length} 处问题。` : '双语对照：没有发现问题。', warns.length ? 'info' : 'ok');
  } catch (e) {
    body.textContent = `对照失败：${e instanceof GhError ? e.hint : String(e)}`;
    setStatus('双语对照失败。', 'error');
  }
}

function labelOf(key: 'research' | 'internships' | 'education'): string {
  return key === 'research' ? '科研' : key === 'internships' ? '实习' : '教育';
}

// ---------------------------------------------------------------- 保存
async function saveProfile(): Promise<void> {
  const token = requireToken();
  if (!token) return;
  const state = readState();
  if (!state) {
    setStatus('还没有载入数据，先点「重新载入」。', 'error');
    return;
  }

  // news.text 用 set:html 渲染，保存前过一遍行内 HTML 白名单
  for (const item of state.news) item.text = sanitizeInline(item.text);

  try {
    // 校验用的 schema 按需加载（zod 不进首包）；解析失败会抛 ZodError，下面统一报
    const { ProfileSchema } = await loadSchemas();
    const json = stableProfileJson(state, ProfileSchema);
    setStatus('正在写入仓库…', 'busy');
    await saveFile(
      repo as Repo,
      paths.profile(getLang()),
      token,
      json,
      `update profile: ${getLang()}（后台可视化编辑）`
    );
    await clearDraft(draftKey());
    setNotice('');
    markClean();
    setStatus(`已保存 profile.${getLang()}.json，Actions 大约 1 分钟后上线。`, 'ok');
  } catch (e) {
    // strict() 会拒绝未知键 / schema 校验失败，把人话报出来
    const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    if (issues?.length) {
      setStatus(
        `保存被拦：${issues
          .slice(0, 5)
          .map((i) => `${issuePath(i.path)}: ${i.message}`)
          .join('；')}`,
        'error'
      );
      return;
    }
    setStatus(e instanceof GhError ? e.hint : (e as Error).message || String(e), 'error');
  }
}

// ---------------------------------------------------------------- 初始化
export function initProfile(): void {
  bindBaseInputs();
  bindCvDrop();
  bindAvatarDrop();
  initProfileCards();

  // 本地暂存：和文章共用一套（IndexedDB + localStorage 镜像），刷新不再丢半份档案
  const autosave = createAutosave<Profile>({
    key: draftKey,
    collect: () => readState() as Profile,
  });

  // 镜像预览：改动防抖后整文档重建（内部有 key 比对，没变就不重写）
  const refresh = debounce(() => {
    const p = readState();
    if (p) updateMirror(previewFrame, p, getLang() as Locale);
  }, 300);
  subscribe(refresh);
  watchProfileTheme(refresh);

  // 校验：敲字时别每键都跑 zod
  const scheduleValidate = debounce(validateNow, 500);
  subscribe(() => {
    scheduleValidate();
    // 载入 / 恢复草稿也算 emit，但那不是「用户改了东西」
    if (loading) return;
    markDirty();
    autosave.markDirty();
  });

  $('profile-reload').addEventListener('click', () => run(loadProfile));
  profileLang.addEventListener('change', () => {
    // 先把当前语言的内容落盘，否则会写进另一个语言的 key 里
    void autosave.flush();
    setLang(profileLang.value as 'zh' | 'en');
    run(loadProfile);
  });

  registerShortcut({
    keys: 'mod+s',
    label: '保存个人信息到仓库',
    group: '发布',
    allowInInput: true,
    when: () => activeSection() === 'profile',
    run: () => void saveProfile(),
  });

  // 切到「个人信息」分区时才去读仓库（不在启动路径上付这份开销）
  if (activeSection() === 'profile') ensureProfileLoaded();
  document.addEventListener('admin:section', (e) => {
    if ((e as CustomEvent<string>).detail === 'profile') ensureProfileLoaded();
  });
  $('profile-save').addEventListener('click', () => void saveProfile());
  $('profile-bilingual').addEventListener('click', () => void runBilingualCheck());
  $('bilingual-close').addEventListener('click', () => {
    $('bilingual-report').hidden = true;
  });
}

/**
 * 主题切换没有事件（ThemeToggle 直接改 <html data-theme>），盯属性变化。
 * 预览 iframe 是独立文档，主题变了必须整份重渲染。
 */
function watchProfileTheme(onChange: () => void): void {
  new MutationObserver(onChange).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

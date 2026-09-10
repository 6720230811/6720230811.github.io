import { $, setStatus, run, debounce } from './dom';
import { z } from 'zod';
import { repo, paths } from '../../data/admin';
import { readFile, saveFile, saveBinaryFile, GhError, type Repo } from './github';
import { stableProfileJson, sanitizeInline, toSlug } from './serialize';
import { requireToken } from './token';
import { markDirty, markClean } from './unsaved';
import { ProfileSchema, formatIssues, type Profile } from '../../data/profile.schema';
import { getProfile, getLang, setLang, setState, mutate, subscribe } from './profileState';
import { initProfileCards } from './profileCards';
import { updateMirror } from './profilePreview';
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

const OPTIONAL_BASE = new Set(['affiliationLink', 'lab', 'citationSummary']);

const LINK_FIELDS = ['github', 'scholar', 'linkedin', 'blog'] as const;

function readState(): Profile | null {
  return getProfile();
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
  try {
    const file = await readFile(repo as Repo, paths.profile(lang), token);
    if (!file) {
      setStatus('仓库里没有这个文件。', 'error');
      return;
    }
    const raw = JSON.parse(file.text) as unknown;
    const parsed = ProfileSchema.safeParse(raw);
    if (!parsed.success) {
      setStatus(`profile.${lang}.json 与 schema 不一致（先显示出来，保存时会被拦）：\n${formatIssues(parsed.error)}`, 'error');
    }
    // 校验不过也照常填：有问题的字段在卡片里看得见，改对了才能保存
    setState(parsed.success ? parsed.data : (raw as Profile));
    fillBaseInputs();
    markClean();
    setStatus(`已载入 profile.${lang}.json`, 'ok');
  } catch (e) {
    setStatus(e instanceof GhError ? e.hint : String(e), 'error');
  }
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
function validateNow(): void {
  const p = readState();
  const box = $('profile-issues');
  if (!p) {
    box.hidden = true;
    return;
  }
  const result = ProfileSchema.safeParse(p);
  if (result.success) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  const lines = result.error.issues.slice(0, 8).map((i) => `${issuePath(i.path)}: ${i.message}`);
  const more = result.error.issues.length > lines.length ? `\n… 共 ${result.error.issues.length} 处` : '';
  box.hidden = false;
  box.textContent = `保存会被 schema 拦下：\n${lines.join('\n')}${more}`;
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
    const json = stableProfileJson(state);
    setStatus('正在写入仓库…', 'busy');
    await saveFile(
      repo as Repo,
      paths.profile(getLang()),
      token,
      json,
      `update profile: ${getLang()}（后台可视化编辑）`
    );
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
  initProfileCards();

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
    markDirty();
    scheduleValidate();
  });

  $('profile-reload').addEventListener('click', () => run(loadProfile));
  profileLang.addEventListener('change', () => {
    setLang(profileLang.value as 'zh' | 'en');
    run(loadProfile);
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

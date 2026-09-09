import { $, setStatus, setFieldError, run } from './dom';
import { repo, paths } from '../../data/admin';
import { readFile, saveFile, GhError, type Repo } from './github';
import { stableProfileJson, sanitizeInline } from './serialize';
import { requireToken } from './token';
import type { Profile } from '../../data/profile.schema';

/** 「个人信息」这一栏：读 src/data/profile.{lang}.json，编辑后写回 */

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

function readJson(id: string): unknown {
  const raw = $<HTMLTextAreaElement>(id).value.trim();
  if (!raw) {
    setFieldError(`e-${id}`, '');
    return [];
  }
  try {
    setFieldError(`e-${id}`, '');
    return JSON.parse(raw);
  } catch (e) {
    setFieldError(`e-${id}`, `JSON 解析失败：${(e as Error).message}`);
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
    setFieldError(`e-${key}`, '');
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
    'name', 'title', 'affiliation', 'affiliationLink', 'lab', 'location', 'email',
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

export function initProfile(): void {
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
}

import type { Locale } from '../../i18n/ui';
import { useTranslations } from '../../i18n/ui';
import { visibleSections } from '../../data/sections';
import type { Profile, Publication, TimelineEntry, Project } from '../../data/profile.schema';

/**
 * 「个人信息」的实时镜像预览。
 *
 * 结构照抄前台 Sidebar.astro / HomeContent.astro（含子组件），
 * 类名一字不差：父页面的样式表会被整份复制进 iframe（同 preview.ts 的做法），
 * 所以 .card--profile / .pub / .tl-item / .skill-group 在预览里就是线上那套样式。
 *
 * 两点与前台刻意不同：
 * - 链接用 <a> 但不写 href 跳转目标之外的东西（预览里点了会开新页，无妨）
 * - 所有插值过 escapeHtml：JSON 里粘贴 <script> 也只是显示成文本
 */

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function e(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESC[c]);
}

const parentStyles = (): string =>
  Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((link) => `<link rel="stylesheet" href="${link.href}" />`)
    .join('');

const EXTRA_CSS = `
html { background: transparent; }
/* admin.css 是给三栏布局用的（html overflow:hidden），预览里要能滚 */
html, body { height: auto; overflow: visible !important; }
body { margin: 0; padding: 1.25rem 1.5rem; min-height: 100%; background: var(--c-bg-soft); }
.pv { display: flex; gap: 1.5rem; align-items: flex-start; max-width: 72rem; margin: 0 auto; }
.pv__side { flex: 0 0 16rem; }
.pv__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1.1rem; }
.pv__empty { color: var(--c-text-faint); font-size: 0.9rem; }
@media (max-width: 900px) { .pv { flex-direction: column; } .pv__side { flex: none; width: 100%; } }
`;

type TFn = (key: string) => string;

function section(title: string, icon: string, inner: string): string {
  if (!inner.trim()) return '';
  return `<section class="section"><h2 class="section__title"><span class="icon">${icon}</span><span>${e(title)}</span></h2>${inner}</section>`;
}

function profileCard(p: Profile): string {
  const base = import.meta.env.BASE_URL || '/';
  const { links } = p;
  const link = (label: string, href?: string) =>
    href ? `<a class="icon-link" href="${e(href)}" target="_blank" rel="noopener noreferrer" title="${label}">${label}</a>` : '';

  return `<div class="card card--profile">
    <img class="sidebar__avatar" src="${e(`${base}avatar.jpg`)}" alt="${e(p.name)}" width="512" height="512" />
    <div class="sidebar__name">${e(p.name)}</div>
    <div class="profile__divider"></div>
    <div class="sidebar__title">${e(p.title)}</div>
    <div class="sidebar__meta">
      <div class="meta-row">${e(p.affiliation)}</div>
      ${p.lab ? `<div class="meta-row">${e(p.lab)}</div>` : ''}
      <div class="meta-row"><span>${e(p.location)}</span></div>
      <div class="meta-row"><a href="mailto:${e(p.email)}">${e(p.email)}</a></div>
      ${p.citationSummary ? `<div class="meta-row meta-row--muted">${e(p.citationSummary)}</div>` : ''}
    </div>
    <div class="sidebar__links">
      ${link('GitHub', links.github)}${link('Scholar', links.scholar)}${link('LinkedIn', links.linkedin)}${link('Blog', links.blog)}
    </div>
  </div>`;
}

function aboutSection(p: Profile, t: TFn): string {
  let inner = `<div class="bio">${p.bio.map((para) => `<p>${e(para)}</p>`).join('')}</div>`;
  if (p.interests.length) {
    inner += `<h3 class="sub-title">${t('section.interests')}</h3><ul class="interest-list">${p.interests
      .map((i) => `<li>${e(i)}</li>`)
      .join('')}</ul>`;
  }
  if (p.news.length) {
    inner += `<h3 class="sub-title">${t('section.news')}</h3><ul class="news-list">${p.news
      .map((n) => `<li><span class="news-list__date">${e(n.date)}</span><span>${n.text}</span></li>`)
      .join('')}</ul>`;
  }
  return inner;
}

function pubItem(pub: Publication, t: TFn): string {
  const { links } = pub;
  const authors = pub.authors
    .map((a, i) => `<span${i === pub.selfIndex ? ' class="self"' : ''}>${e(a)}${i < pub.authors.length - 1 ? ', ' : ''}</span>`)
    .join('');
  const chips = links
    ? ([
        [links.pdf, 'link.pdf'],
        [links.code, 'link.code'],
        [links.project, 'link.project'],
        [links.slides, 'link.slides'],
        [links.video, 'link.video'],
      ] as const)
        .filter(([href]) => !!href)
        .map(([href, key]) => `<a href="${e(href ?? '')}" target="_blank" rel="noopener noreferrer">${t(key)}</a>`)
        .join('')
    : '';

  return `<article class="pub">
    <div class="pub__title">${links?.pdf ? `<a href="${e(links.pdf)}" target="_blank" rel="noopener noreferrer">${e(pub.title)}</a>` : e(pub.title)}</div>
    <div class="pub__authors">${authors}</div>
    <div class="pub__venue"><span>${e(pub.venue)}</span>${pub.note ? `<span class="pub__note">${e(pub.note)}</span>` : ''}${
    pub.citations !== undefined ? `<span class="pub__citations">· ${pub.citations} ${t('label.citations' as never)}</span>` : ''
  }</div>
    ${chips ? `<div class="pub__links">${chips}</div>` : ''}
  </article>`;
}

function timeline(entries: TimelineEntry[]): string {
  return `<div class="timeline">${entries
    .map(
      (entry) => `<article class="tl-item">
      <div class="tl-item__period">${e(entry.period)}</div>
      <div class="tl-item__body">
        <div class="tl-item__role">${e(entry.role)}</div>
        <div class="tl-item__org">${e(entry.org)}</div>
        ${entry.extra ? `<div class="tl-item__extra">${e(entry.extra)}</div>` : ''}
        ${
          entry.details?.length
            ? `<ul class="tl-item__details">${entry.details.map((d) => `<li>${e(d)}</li>`).join('')}</ul>`
            : ''
        }
      </div>
    </article>`
    )
    .join('')}</div>`;
}

function projectCard(project: Project): string {
  return `<article class="project">
    <div class="project__head"><span class="project__name">${
      project.link ? `<a href="${e(project.link)}" target="_blank" rel="noopener noreferrer">${e(project.name)}</a>` : e(project.name)
    }</span>${project.period ? `<span class="project__period">${e(project.period)}</span>` : ''}</div>
    <p class="project__desc">${e(project.description)}</p>
    ${
      project.highlights?.length
        ? `<ul class="project__highlights">${project.highlights.map((h) => `<li>${e(h)}</li>`).join('')}</ul>`
        : ''
    }
    <div class="project__stack"><ul class="tag-list">${project.stack.map((s) => `<li class="tag">${e(s)}</li>`).join('')}</ul></div>
  </article>`;
}

/** 组装整个 About 页的镜像 */
export function buildProfileMirror(p: Profile, lang: Locale): string {
  const t = useTranslations(lang) as unknown as TFn;
  const visible = new Set(visibleSections(p).map((s) => s.id));
  const has = (id: string) => visible.has(id);

  const sortedPubs = [...p.publications].sort((a, b) => b.year - a.year);

  let main = '';
  main += section(t('section.about'), '👤', aboutSection(p, t));

  if (has('publications')) {
    let inner = sortedPubs.length
      ? `<div class="pub-list">${sortedPubs.map((pub) => pubItem(pub, t)).join('')}</div>`
      : '';
    if (p.research.length) {
      inner += `<h3 class="sub-title">${t('section.research')}</h3>${timeline(p.research)}`;
    }
    main += section(t('section.publications'), '📝', inner);
  }

  if (has('skills')) {
    const inner = `<div class="skills">${p.skills
      .map(
        (g) =>
          `<div class="skill-group"><div class="skill-group__title">${e(g.category)}</div><ul class="tag-list">${g.items
            .map((i) => `<li class="tag">${e(i)}</li>`)
            .join('')}</ul></div>`
      )
      .join('')}</div>`;
    main += section(t('section.skills'), '🛠', inner);
  }

  if (has('projects')) {
    let inner = p.projects.length
      ? `<div class="projects">${p.projects.map(projectCard).join('')}</div>`
      : '';
    if (p.internships.length) {
      inner += `<h3 class="sub-title">${t('section.internships')}</h3>${timeline(p.internships)}`;
    }
    main += section(t('section.projects'), '🚀', inner);
  }

  if (has('education')) {
    let inner = p.education.length ? timeline(p.education) : '';
    if (p.awards.length) {
      inner += `<h3 class="sub-title">${t('section.awards')}</h3><ul class="news-list">${p.awards
        .map((a) => `<li><span class="news-list__date">${e(a.date)}</span><span>${e(a.text)}</span></li>`)
        .join('')}</ul>`;
    }
    main += section(t('section.education'), '🎓', inner);
  }

  const contact = [`<a href="mailto:${e(p.email)}">${e(p.email)}</a>`];
  if (p.links.github) contact.push('<a>GitHub</a>');
  if (p.links.scholar) contact.push('<a>Google Scholar</a>');
  if (p.links.linkedin) contact.push('<a>LinkedIn</a>');
  if (p.links.blog) contact.push('<a>Blog</a>');
  main += section(t('section.contact'), '✉️', `<div class="contact-grid">${contact.join('')}</div>`);

  if (!main) main = `<p class="pv__empty">还没有内容。</p>`;

  return `<div class="pv"><div class="pv__side">${profileCard(p)}</div><div class="pv__main">${main}</div></div>`;
}

let lastKey = '';

/** 内容或主题变了才重写 srcdoc：整文档重建挺贵，敲字时要顺滑 */
export function updateMirror(iframe: HTMLIFrameElement, profile: Profile, lang: Locale): void {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const key = `${lang}|${theme}|${JSON.stringify(profile)}`;
  if (key === lastKey) return;
  lastKey = key;

  iframe.srcdoc = `<!doctype html>
<html lang="${lang}" data-theme="${theme}">
  <head>
    <meta charset="utf-8" />
    ${parentStyles()}
    <style>${EXTRA_CSS}</style>
  </head>
  <body>${buildProfileMirror(profile, lang)}</body>
</html>`;
}

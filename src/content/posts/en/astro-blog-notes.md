---
title: Three Things That Bit Me Building an Astro Blog
description: Content collection ids, dynamic routes under i18n, and light/dark code block themes — the three things that actually cost me time.
date: 2026-09-01
category: Tech
tags: [Astro, frontend, meta]
---

Turning a single-page homepage into a blog, the layout was the easy part. These three things were not.

## 1. A collection id is a path, not a filename

With the `glob()` loader, `src/content/posts/en/hello-world.md` gets the id `en/hello-world` — **directory separators are kept**, the extension is dropped, and every segment goes through a slugger.

Two consequences:

1. If you split posts by language directory, you parse the language yourself from the first segment:

```ts
const lang = entry.id.split('/')[0]; // 'en'
const slug = entry.id.slice(lang.length + 1); // 'hello-world'
```

2. **Don't put `slug` in frontmatter.** The glob loader uses it to override the generated id, so same-named files in different languages collide immediately. Same reason: avoid non-ASCII filenames — the slugger strips them and you end up with an id of just `en/`.

## 2. Don't trust `Astro.currentLocale` with `prefixDefaultLocale: false`

The site is bilingual: Chinese at `/`, English at `/en/`. Inside `getStaticPaths()`, `Astro.currentLocale` is not reliable — **pass the locale explicitly through props**:

```ts
export const getStaticPaths = async () => {
  const posts = await postsOf('en');
  return posts.map((entry) => ({
    params: { slug: entry.slug },
    props: { entry, locale: 'en' as const },
  }));
};
```

Read `Astro.props.locale` in the page and stop guessing. You also need two page files per route (`pages/blog/[...slug].astro` and `pages/en/blog/[...slug].astro`) — Astro does not mirror localized routes for you.

One more: never let the first slug segment be `zh` or `en`, or the router treats it as a locale prefix.

## 3. Don't hand-write dark-mode colors for code blocks

Shiki highlights code blocks at build time. The common mistake is maintaining a second color set for dark mode, which means two palettes to keep in sync.

The right move is to have Shiki emit both themes as CSS variables and let CSS pick one:

```js
// astro.config.mjs
markdown: {
  shikiConfig: {
    themes: { light: 'github-light', dark: 'github-dark' },
  },
}
```

```css
pre {
  color: var(--shiki-light);
  background: var(--shiki-light-bg);
}
:root[data-theme='dark'] pre {
  color: var(--shiki-dark);
  background: var(--shiki-dark-bg);
}
```

Shiki still owns the palette; CSS just selects one. Toggling the theme doesn't re-highlight anything.

## Summary

| Gotcha | Rule of thumb |
| --- | --- |
| Collection ids | It's `directory/filename` — slice the language off the front |
| Bilingual dynamic routes | Pass locale via props, ignore `Astro.currentLocale` |
| Code block themes | Emit both themes, select one in CSS |

All three are obvious once you look them up, and cost half an hour each if you don't.

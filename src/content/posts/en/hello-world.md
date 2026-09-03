---
title: Hello, Blog
description: This site went from a single résumé page to a blog plus an about page — here's why, and what the new structure looks like.
date: 2026-08-28
category: Notes
tags: [notes, meta]
---

This site used to be a single page: bio, publications, skills, projects, and education stacked vertically, navigated by anchor links. As it grew, one page stopped being enough for the things I actually want to *write* — paper notes, project postmortems, that sort of thing.

So here's the new structure:

- `/` is the about page — the original résumé content, unchanged
- `/blog/` is the post list, where everything new goes
- `/archive/`, `/categories/`, `/tags/` are three ways to browse the same posts
- the magnifier in the navbar does full-text search

## Why Astro

There are plenty of blog frameworks. I picked Astro mostly because it **ships zero JavaScript by default**. Posts are static; there's no reason to send a runtime to the browser just to render Markdown.

The few interactive bits — theme toggle, search, the mobile menu — get their own small scripts. Everything else is plain HTML and CSS.

## How posts are organized

Posts are Markdown files under `src/content/posts/`, one directory per language:

```
src/content/posts/
├── zh/
│   └── hello-world.md
└── en/
    └── hello-world.md
```

The filename becomes the URL: `en/hello-world.md` → `/en/blog/hello-world/`. Adding a post means creating a new `.md` with frontmatter:

```yaml
---
title: Title
description: One-line summary, shown on the list page and in search results
date: 2026-08-28
category: Category
tags: [tag1, tag2]
---
```

> Prefer ASCII filenames. Non-ASCII characters in URLs turn into long percent-encoded strings that nobody can read or retype.

## What's next

A few things I've been meaning to write up: notes on multimodal retrieval papers, performance traps I keep hitting in Python projects, and how I put together my PhD applications. Whatever comes to mind first.

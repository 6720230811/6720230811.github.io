---
title: 用 Astro 搭博客踩到的几个坑
description: 内容集合的 id 规则、i18n 路由下的动态路径、Markdown 代码块的明暗主题，记录一下这次搭建时真正卡住我的三件事。
date: 2026-09-01
category: 技术
tags: [Astro, 前端, 建站]
---

这次把单页主页改成博客，真正卡住我的不是布局，而是下面三件小事。

## 一、内容集合的 id 是路径，不是文件名

用 `glob()` loader 时，一篇 `src/content/posts/zh/hello-world.md` 的 `id` 是 `zh/hello-world`——**中间的路径分隔符会保留**，扩展名会去掉，每一段还会过一遍 slugger。

这带来两个后果：

1. 想按语言分目录，就得自己从 `id` 的第一段解析语言：

```ts
const lang = entry.id.split('/')[0]; // 'zh'
const slug = entry.id.slice(lang.length + 1); // 'hello-world'
```

2. **frontmatter 里不要写 `slug`**。glob loader 会拿它覆盖掉自动生成的 id，中英文同名文件立刻撞车。同理，文件名别用中文——slugger 会把中文清成空串，最后 id 只剩一个 `zh/`。

## 二、`prefixDefaultLocale: false` 下别信 `Astro.currentLocale`

站点配了中英双语，中文在 `/`、英文在 `/en/`。在 `getStaticPaths()` 里读 `Astro.currentLocale` 是不可靠的，**语言要由 props 显式传进去**：

```ts
export const getStaticPaths = async () => {
  const posts = await postsOf('zh');
  return posts.map((entry) => ({
    params: { slug: entry.slug },
    props: { entry, locale: 'zh' as const },
  }));
};
```

页面里一律用 `Astro.props.locale`，不要再去猜。双语页面文件也要建两份（`pages/blog/[...slug].astro` 和 `pages/en/blog/[...slug].astro`），Astro 不会自动镜像路由。

顺便：slug 的第一段**不要叫 `zh` 或 `en`**，会被路由判定成语言前缀。

## 三、代码块的暗色主题别手写配色

Markdown 里的代码块由 Shiki 高亮。最常见的错误做法是为暗色模式单独写一套颜色，结果和维护两套配色。

正确的做法是让 Shiki 一次输出两套主题的变量，再用 CSS 切换：

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

配色仍然由 Shiki 维护，CSS 只负责选一套，明暗切换也不用重新高亮页面。

## 小结

| 坑 | 记法 |
| --- | --- |
| 内容集合 id | 是「目录/文件名」，语言得自己切第一段 |
| 双语动态路由 | locale 走 props，不要读 `Astro.currentLocale` |
| 代码块主题 | 输出双主题变量，CSS 选一套 |

都是查一遍就懂、但不查就会卡半小时的东西。

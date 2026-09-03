import { defineConfig } from 'astro/config';

const SITE = 'https://6720230811.github.io';

// 部署路径说明（重要）：
// - 若仓库名为 `<username>.github.io`（用户主页仓库）→ 站点在根路径，BASE 保持 ''，不要设置 base
// - 若仓库名是普通名字（如 `homepage`）→ 站点在子路径，把 BASE 改成 '/homepage'（仓库名，带前导斜杠）
const BASE = '';

export default defineConfig({
  site: SITE,
  ...(BASE ? { base: BASE } : {}),

  i18n: {
    locales: ['zh', 'en'],
    defaultLocale: 'zh',
    routing: {
      // false = 默认语言(中文)不带前缀 →  `/`；英文带前缀 → `/en/`
      prefixDefaultLocale: false,
    },
  },

  // 让 esbuild 保留传统的 @media (max-width: …) 写法。
  // 默认它会转写成较新的范围语法 @media (width<=1024px)，Safari 16.4 以下直接忽略，
  // 窄屏就会既没有汉堡菜单、又塞不下导航链接。
  vite: {
    build: {
      cssTarget: 'safari15',
    },
  },
});

# 分类与标签：一份受控词表（分类受控 + 标签自由归一化）

日期：2026-09-16
状态：**设计已定（方案 C）**。P1 的第一刀（画廊题材 `theme`）**已实现**，进度与验证见 §十；
文章的分类 / 标签仍是待做。本文件写「要做成什么样」，不含实现细节的最终代码。

相关代码：`src/content.config.ts`、`src/lib/posts.ts`、`src/pages/{categories,tags}/**`、
`src/pages/en/{categories,tags}/**`、`src/data/gallery.{ts,schema.ts}`、
`src/lib/admin/{post,chips,gallery}.ts`、`src/i18n/ui.ts`、`src/lib/gallery/blueprint.ts`
拟新增：`src/data/taxonomy.ts`（词表：**纯数据、零 import**）、`src/lib/taxonomy.ts`（zod 校验 + 显示名 +
旧地址映射）、词条旧地址跳转页（复用 `src/components/PostRedirect.astro` 的做法）。两层怎么分见 §3.1

## 一、问题（2026-09-16 实测，不是推测）

站点现有 9 篇文章（zh 7 / en 2），逐篇扫 frontmatter 得到：

| | 分类 | 标签 |
|---|---|---|
| zh（7 篇） | **5 个**：`技术`×3、`新闻`×1、`agent`×1、`随笔`×1、`tailscale`×1 | **9 个 / 10 次**，其中 **8 个只出现一次**（只有 `建站` ×2） |
| en（2 篇） | **2 个**：`Tech`×1、`Notes`×1 | **4 个 / 5 次**，其中 **3 个只出现一次** |

四条结论：

1. **分类在自由输入下退化成标签。** zh 的 5 个分类里 4 个只有 1 篇；`agent`、`tailscale` 是**软件名**，
   本该是标签。真正承担导航的只有 `技术`（3 篇）。
2. **标签几乎全是单例。** 13 个标签里 11 个只出现 1 次（**85%**）。单例标签的落地页只挂一篇文章，
   检索价值接近 0，却各自占一条地址、一个页面。
3. **双语靠人肉对齐，5 对里已经漂了 4 对。** 同一位作者、同一篇文章的两个语言版本：

   | 中文 | 英文 | 字面相同？ |
   |---|---|---|
   | `技术` | `Tech` | ✗ |
   | `前端` | `frontend` | ✗ |
   | `建站` | `meta` | ✗（连语义都看不出来） |
   | `随笔` | `notes` | ✗ |
   | `Astro` | `Astro` | ✓ |

   没有任何机制保证它们是一对，切语言时分类页对不上。
4. **没有归一化，词表不可见。** `Astro` 首字母大写、`docker`/`git`/`vpn` 小写、`Tech` 大写 ——
   下次写 `Docker` / `ASTRO` 就凭空多出两个词条。而**站点里没有任何地方能看到「我一共有哪些词」**。

**根因只有一条：值本身就是显示名，同时也是 URL。** 没有中间层，于是
改显示名 = 换地址、双语各写一套、同义词无法合并、拼错无法发现。

画廊那边是同一根源的另一个极端：`theme: 'city'` 是 ASCII 键 —— **有地址、没显示名**
（i18n 里根本没有 `gallery.theme.<key>`，`gallery.schema.ts` 的注释还写着「显示名在 i18n 里」，已失效），
而它同时被 3D 展墙配色认着：`blueprint.ts` 的 `THEME_COLOR` 只认 `city` / `sea` 两个键，
写别的键 3D 展厅退回默认配色且**不报错**（静默失效）。

## 二、方案：分而治之（方案 C）

| | 分类 `category` | 标签 `tag` |
|---|---|---|
| 角色 | 信息架构：这个站有哪几个栏目 | 检索索引：这篇讲什么 |
| 规模 | 少（10~20 个） | 多，随手加 |
| 变更频率 | 一年几次 | 每写一篇几次 |
| 治理 | **受控**：只能从词表里选 | **自由**：随便写，但**归一化后**入表 |
| 顺序 | 有意义，后台可调 | 按使用次数 |
| 落地页 | 必须有 | 有，但单例的可不单独收录 |

理由不是「大家都这么做」，而是**这两件事的变更频率差一个数量级**：
分类改一次要重想整个站的结构，值得受控，也值得给它描述、图标、排序；
标签是随想随加的，受控只会让写文章时被词表卡住。

**双语共用一套词表**（key + zh/en 两个显示名）。理由：上表 5 对已漂 4 对；
共用之后「中英对不上」在结构上不可能发生 —— 同一篇文章的两个语言版本引用同一个 key。

## 三、数据模型

### 3.1 词表 `src/data/taxonomy.ts`（单一来源）

**为什么是 `.ts` 不是 `.json`**（实现时定的）：这份文件是要**手改**的，而 JSON 不能写注释；
`src/data/` 下本来也全是 `.ts`（`friends.ts` / `profile.ts` / `nav.ts`）。分成两层：

| 文件 | 内容 | 硬约束 |
|---|---|---|
| `src/data/taxonomy.ts` | **纯数据** + 派生常量（`THEME_KEYS` / `THEME_COLOR`） | **不许 import 任何东西** —— 3D 展厅的客户端代码（`lib/gallery/blueprint.ts`）也引它，一旦带上 zod 之类的依赖就会被打进浏览器包 |
| `src/lib/taxonomy.ts` | zod 校验 + 显示名 + 报错信息 | 只跑构建期（Node），可以引 zod |

已实现的题材块（其余是计划形状）：

```ts
export const THEMES: Record<string, ThemeTerm> = {
  misc: { zh: '其它', en: 'Misc' },                    // 兜底：meta.json 不写 theme 就落到它
  city: { zh: '城市', en: 'City', color: '#364852' },   // color = 3D 展墙主题色，不填就是不参与
  sea:  { zh: '海',   en: 'Sea',  color: '#30494B' },
};
export const THEME_KEYS = Object.keys(THEMES);
/** 只有配了色的题材在里头；blueprint 的展墙色从这里派生，不再手写一张表 */
export const THEME_COLOR: Record<string, string> = /* … */;
```

计划中的分类与标签块（迁文章时加进同一个文件）：

```ts
export const CATEGORIES: CategoryTerm[] = [
  { key: 'tech', zh: '技术', en: 'Tech', order: 10, icon: '🛠',
    desc: { zh: '工程与工具', en: 'Engineering and tooling' } },
];
export const TAGS: Record<string, TagTerm> = {
  astro:    { zh: 'Astro', en: 'Astro', alias: ['Astro.js', 'astrojs'], scope: ['post', 'gallery'] },
  frontend: { zh: '前端', en: 'frontend', scope: ['post'] },
};
```

| 字段 | 作用 | 必填 |
|---|---|---|
| `key` | 唯一标识，**同时是 URL 段**，ASCII slug（`^[a-z0-9]+(?:-[a-z0-9]+)*$`） | ✓ |
| `zh` / `en` | 显示名，按语言取。**两个都必填**：本站是中英双语站，少一边就是少内容（原方案写的「缺一个就两边都用另一个」在实现时改成了硬要求） | ✓ |
| `color` | 3D 展墙主题色（`#rrggbb`）。只有题材有；不填 = 不参与挑色，展墙走默认配色 | |
| `order` | 分类排序（小的在前） | 分类 ✓ |
| `alias` | 旧名 / 异名，只用于归一化与生成旧地址跳转，**不显示**；不许与任何 key 或别的别名相撞（撞了构建就红） | |
| `scope` | `post` / `gallery`，限定这个词能出现在哪 | ✓ |
| `desc` | 一句说明，给索引页与后台用 | |
| `icon` | 分类图标（现在写死在 `categories/index.astro` 的 `📚`） | |

**`misc` 必须在表里**：`meta.json` 不写 `theme` 时 schema 的默认值就是它，漏登记会让每一本没写题材的合集都构建失败。

### 3.2 引用只写 key

| 位置 | 现在 | 改后 |
|---|---|---|
| 文章 frontmatter | `category: "技术"` | `category: tech` |
| 文章 frontmatter | `tags: ["Astro", "前端"]` | `tags: [astro, frontend]` |
| 画廊 `meta.json`（合集级） | `theme: "city"` | 值不变，但纳入词表（`scope: ["gallery"]`） |
| 画廊 `meta.json`（单张） | `theme: "city"` | 值不变，同上 |

`key` 格式：`^[a-z0-9]+(?:-[a-z0-9]+)*$`（与 `gallery.schema.ts` 的 `SLUG` 同一套）。

**归一化规则**（标签自由但不失控）：输入先 `trim` → 小写 → 空格/下划线换连字符 →
去掉非 `[a-z0-9-]` → 合并连续连字符。中文与其它非 ASCII **不在这里处理**：
中文显示名必须登记成词条 —— 因为 key 只能是 ASCII。这正是「分类必须受控、
标签也得归一到已有词条」的技术原因，不是洁癖。

### 3.3 显示名解析：`src/lib/taxonomy.ts`

```ts
type Kind = 'category' | 'tag';

function termLabel(locale: Locale, kind: Kind, key: string): string;    // 取不到就回退 key
function termHref(locale: Locale, kind: Kind, key: string): string;     // /categories/<key>/ · /tags/<key>/
function allTerms(kind: Kind, scope: Scope): Term[];                    // 按 order / 篇数排
function legacyTermPaths(locale: Locale, kind: Kind): { from: string; key: string }[];
```

**页面代码里再也不许把裸的 `post.data.category` 当显示名用** —— 一律过 `termLabel`。
`lib/posts.ts` 的 `collectTags` / `collectCategories` 改成基于词表返回
`{ key, label, count, href }`：现在返回的 `name` 同时是显示名与 href 的输入，正是病根。

`postHref` 那一族的 `tagHref` / `categoryHref` 里不再需要 `encodeURIComponent`（key 是 ASCII），
顺手去掉一处隐形复杂度。

### 3.4 保留段

`rooms` / `screening-room` 已是画廊的保留段（`src/data/gallery.ts` 的 `RESERVED_SEGMENTS`）；
词表的 key 要再加一层自己的保留集（`index`、`all` 之类，避免 `/tags/index/` 顶掉 `/tags/index.astro`）。
**凡是「目录名本身就是路由」的地方都得有这张表** —— 这是同一个坑的第二次。

## 四、构建期校验（宁可构建失败）

对齐本站既有做法（`RESERVED_SEGMENTS` 抛错、`browseTab` 抛错）：**错了就别让产物生成**。

| 情况 | 处理 | 为什么 |
|---|---|---|
| 引用了未登记的 key | **抛错**，列出最近的 3 个候选 | 拼错一个字母会长出一个孤儿页 |
| `alias` 指向不存在的词条 / 两个词条重复 | **抛错** | 归一化会把文章悄悄归错类 |
| `scope` 越界（文章的 tags 里出现 `scope:["gallery"]` 的词） | **抛错** | 否则「画廊专用词」会污染文章标签云 |
| 词条登记了但**零引用** | **警告**，不抛错 | 预登记是正常的；删一篇文章不该让构建挂掉。后台给「未使用」清单 |
| 分类总数 > 15，或出现单篇分类 | **警告** | 长尾分类是「分类退化成标签」的早期症状 |
| 画廊 `theme` 不在 `THEME_COLOR` 的键集里 | **警告** | 3D 展墙会静默退回默认配色，肉眼很难发现 |

## 五、URL 与迁移

### 5.1 地址用 key

`/categories/技术/` → `/categories/tech/`；`/tags/前端/` → `/tags/frontend/`。
好处：URL 里不再有百分号编码、改显示名不动地址、外链稳定。

### 5.2 旧地址靠词表自己映射

**词表本身就是那张映射表**：`zh` / `en` / `alias` 三个字段就是历史显示名的全集。
构建期为每个词条生成跳转页（静态站没有服务端重定向，只能落地一个 HTML）：

- `/categories/技术/`（zh）与 `/categories/Tech/`（en）→ `/categories/tech/`
- `/tags/前端/`（zh）与 `/tags/frontend/`（en）→ 同一个 `/tags/frontend/`

于是**迁移旧地址是零额外维护的**：加词条时顺手写全 `zh`/`en`/`alias`，历史地址自动兜住。
中文目录名在产物里就是 `dist/categories/技术/index.html`，GitHub Pages 能正常服务。

### 5.3 迁移顺序：先画廊 `theme`，后文章

先切画廊，理由是它**最破也最小**：一个键、一本合集在用、没有双语问题，
却同时缺显示名、又暗中和 `THEME_COLOR` 耦合。拿它把「词表 → 校验 → 显示名 → 旧地址」
这条链路跑通，再回头迁 9 篇文章的 5 + 9 个词条，风险最小。
站点现在只有 9 篇、十几个词条 —— **这是迁移成本最低的时刻**，越往后越贵。

## 六、后台

1. **分类改成 `<select>`**，选项来自词表、按 `order` 排。现在是一个裸 `<input id="post-category">`
   （`src/lib/admin/post.ts:64`），想打什么打什么 —— 这就是 `agent` / `tailscale` 混进分类的入口。
2. **标签候选从词表来**，不是 localStorage。`chips.ts` 的历史记的是「你打过什么」
   （换台机器就丢，也不筛合法性）；词表记的是「什么是合法的」。两者都要：
   词表在前（合规候选），历史在后（最近用过）。
3. **输入未登记的词 → 就地「新建并登记」**：一个小确认（key 自动 slug 化、zh/en 显示名、勾 scope），
   确认后写进 `src/data/taxonomy.ts` 并提交。**不用离开编辑器去改数据文件** ——
   这是「标签自由」能真正落地的关键，否则摩擦会把人推回乱写。
4. **新增「分类与标签」分区**：一张表列每个词条的 **key / zh / en / 篇数 / 最后使用**，支持
   改显示名（自动写旧地址跳转）、调分类顺序、合并同义词（自动写 301 并改写引用）、
   删除（**有引用的删不掉**，先让你去改文章）。还要能一眼看见「零引用词条」——
   这是清理长尾标签的唯一入口。

## 七、分期

| 期 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| **P1 数据契约** | `data/taxonomy.ts` + `lib/taxonomy.ts` + 构建期校验 + 引用改 key + 旧地址跳转页 + 迁移现有 14 个词条（**画廊 `theme` 那一刀已做**，见 §十） | 无 | 中（动 URL） |
| **P2 后台输入** | 分类 select、标签候选从词表、未登记词就地登记 | P1 | 低 |
| **P3 词表管理界面** | 词条表、改名、排序、合并、删除、零引用清单 | P1 | 低 |

先切画廊 `theme`（属于 P1，单独一刀，可独立验证）。

## 八、验收

离线可测（不依赖网络）：

1. **构建期校验**：故意写一个未登记的 key → `npm run build` **必须失败**，错误信息里带候选；
   改回 → 通过。
2. **词条页存在性**：`find dist/categories -maxdepth 1 -type d | wc -l` = 词表里
   `scope` 含 `post` 的分类数 + 1（索引页）。**别用 HTTP 状态码判** ——
   `serve.mjs` 对未知路径回落 `index.html` 且回 200，那种 200 是假的（已踩）。
3. **旧地址**：`dist/categories/技术/index.html` 存在，且其中 `url=` / `href=` 指向 `/categories/tech/`。
4. **显示名**：产物里 `/categories/tech/` 的标题是「技术」而不是 `tech`；`/en/categories/tech/` 是 `Tech`。
5. **双语对称**：同一 slug 的 zh / en 两篇，`category` 与 `tags` 的 **key 集合必须相等** ——
   这是「共用词表」这条设计唯一值得写的断言（现在 5 对里 4 对不上）。
6. **`THEME_COLOR` 对齐**：词表里 `scope:["gallery"]` 的主题 key ⊇ 3D 正在用的 theme 值。

e2e（`web-e2e-harness` 那套，独立端口）：

7. 文章页的分类/标签芯片链接指向 `/categories/<key>/`、`/tags/<key>/`（不是百分号编码的旧地址）。
8. 后台：分类是 `<select>` 且选项数 = 词表分类数；打一个未登记的词 → 出现「新建并登记」；
   点它后**词表文件真的多一条**（读仓库返回值断言，不能只看 toast）。

## 九、不做的事（非目标）

- 不改文章 URL（`/blog/<slug>/` 与 `aliases` 机制原样保留）。
- 不做多层分类（父子、树）。9 篇的站不需要。
- 不给标签加落地页增强 / SEO 收编；单例标签的收录问题留到有真实流量再说。
- 不把 `gallery.style.*`（形制）并进词表：它已有 i18n 显示名，且是 3D 几何体的固定枚举，
  属于「有显示名的枚举」，跟词表是两回事。

## 十、实现进度

### 已做：第一刀 = 画廊题材 `theme`（2026-09-16）

| 文件 | 改了什么 | 增删 |
|---|---|---|
| `src/data/taxonomy.ts` | **新建 63 行**。`THEMES`（misc / city / sea）+ `THEME_KEYS` + 派生的 `THEME_COLOR` | 新 |
| `src/lib/taxonomy.ts` | **新建 136 行**。zod 校验词表结构与别名、`themeLabel()` 按语言取显示名、`assertTheme()` 未登记就抛（带最近候选）、`warnThemeColor()` 没配色只警告 | 新 |
| `src/data/gallery.ts` | 读完 `meta.json` 就 `assertTheme`；`mode:'3d'` 且题材没配色 → 警告 | +6 −0 |
| `src/lib/gallery/blueprint.ts` | `THEME_COLOR` 改成从词表派生（原来硬编码 `{ city, sea }`） | +4 −4 |
| `src/components/gallery/CollectionIndex.astro` | 封面小字兜底改用 `themeLabel(locale, theme)` —— 原来把 `city` 这种键名直接给访客看 | +7 −2 |
| `src/data/gallery.schema.ts` | 注释纠错：那组 `gallery.theme.<key>` 的 i18n 键**从来不存在** | +7 −1 |
| `src/components/admin/GalleryPanel.astro` + `src/lib/admin/gallery.ts` | 后台题材从自由文本框改成词表下拉（写错的键现在会让构建红，所以不能给自由输入） | +12 −4 |

这一刀**没动 URL、没动文章数据** —— 所以迁移成本是零。

### 验证（当天，逐条都是跑出来的）

| 验的是什么 | 怎么验的 | 结果 |
|---|---|---|
| 显示名按语言取 | 仓里没有测试框架，用 esbuild 把 `lib/taxonomy.ts` 单独 bundle 成 Node 模块跑断言 | **20 / 20 通过** |
| 未登记的题材会抛、且带候选 | Node 直接 import `src/data/gallery.ts`（跑的是真实数据层，不是整站构建），临时把 night-walk 的 theme 改成 `citi` | 抛错：「…里的 theme 是「citi」…是不是想写：city、misc、sea？」 |
| 没配色只警告、不抛 | 同上，临时改成 `misc` | 打印「题材「misc」没有配色…会用默认配色」，import 照样成功 |
| 前台兜底不再给裸键名 | 三本合集都写了 `subtitle`，那条分支本来走不到 —— 临时摘掉 `tide` 的 `subtitle` 后 dev 渲染 | 封面小字变成「海」；页面里**没有**裸键名 `sea`；随后按 md5 还原 |
| 没把别处弄坏 | `astro build` + 单独跑 `pagefind` | exit 0 / **71 个 HTML（70 页）/ 构建日志无题材警告** |
| 画廊那一套行为没回归 | `gallery.mjs` e2e（真点击穿页、宽高比对、sticky 前提…） | **156 / 156 通过** |
| 类型 | `astro check` | 仍是 3 个 error，**全部是既有问题**，本轮改动一个没新增 |

**既有类型错误**（本轮核对过：不在本轮 diff 范围内；`astro build` 不做类型检查，所以一直没红）：

- `src/components/gallery/GalleryFloor.astro:49` —— `place` 不在 `GalleryItem` 上（`item.place` 恒为 `undefined`，
  3D 那层拿到的 `place` 永远是 null）
- `src/lib/admin/gallery.ts:290` —— `field()` 的返回类型与 `$<HTMLInputElement>` 不兼容
- `src/lib/admin/gallery.ts:586` —— `current` 可能为 null

**没验的**：后台那个题材下拉没有浏览器端验证 —— 仓里没有 admin 的 e2e 脚手架。
产物静态核对了：`<select id="gal-theme">` 在，admin bundle 里带上了词表 chunk。

### 待做

文章的 `CATEGORIES` / `TAGS` 块 + 引用改 key + 旧地址 301 + 后台 P2 / P3。

**复跑方式**：探针脚本在隔壁 `D:/homepage/.pet-e2e-dual/probe-taxonomy.mjs`（23 条断言，
其中一节直接驱动真实数据层），运行命令写在文件头注释里 —— 秒级，不需要整站构建。
改动词表或 `gallery` 数据层之后跑一遍。


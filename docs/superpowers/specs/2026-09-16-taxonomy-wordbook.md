# 分类与标签：一份受控词表（分类受控 + 标签自由归一化）

日期：2026-09-16
状态：**设计已定（方案 C）**。三件事的进度不同：P1 的第一刀（画廊题材 `theme`）**已实现**
（见 §十一）；blog 的**分类骨架（四类）已定**（见 §十）；文章 frontmatter 的迁移、后台 P2/P3
仍是待做。本文件写「要做成什么样」，不含实现细节的最终代码。

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

**同一个 kind 内，双语共用一套 key**（key + zh/en 两个显示名）。理由：上表 5 对已漂 4 对；
共用之后「中英对不上」在结构上不可能发生 —— 同一篇文章的两个语言版本引用同一个 key。

**但三种 kind 是三份彼此独立的数据，不是一份**（2026-09-16 修正）。原方案写的是
「画廊的 `theme` 就是分类，改用同一个 key」—— 看过真实数据后，这句站不住：

| kind | 回答的问题 | 例 |
|---|---|---|
| 分类 `CATEGORIES` | **我写的是什么领域** | `paper` 论文笔记、`tech` 技术与工具 |
| 标签 `TAGS` | 这篇具体讲什么 | `docker`、`astro`、`networking` |
| 画廊题材 `THEMES` | **作品拍的是什么** | `city` 城市、`sea` 海 |

三者维度不同，硬并成一份会互相污染：`city` 不是一种写作领域，`paper` 也不是一种拍摄题材。
共用的是**同一套机制**（key + zh/en + 校验 + 旧地址），不是同一份词条。

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

计划中的分类与标签块（迁文章时加进同一个文件）。**分类骨架的理由与迁移映射见 §十**：

```ts
export const CATEGORIES: CategoryTerm[] = [
  { key: 'paper', zh: '论文笔记',    en: 'Paper Notes', order: 10, icon: '📄',
    desc: { zh: '论文阅读、方法梳理、复现记录', en: 'Paper reading, method notes, reproductions' } },
  { key: 'ai',    zh: '智能体与 AI', en: 'AI & Agents', order: 20, icon: '🤖',
    desc: { zh: 'Agent 原理与工程、模型能力、行业事件', en: 'Agents, model capability, industry events' } },
  { key: 'tech',  zh: '技术与工具',  en: 'Tech & Tools', order: 30, icon: '🛠',
    desc: { zh: '命令行、容器、组网、框架踩坑', en: 'CLI, containers, networking, framework pitfalls' } },
  { key: 'notes', zh: '随笔',       en: 'Notes', order: 40, icon: '✎',
    desc: { zh: '站务、生活、杂记', en: 'Site log, life, miscellany' } },
];
export const TAGS: Record<string, TagTerm> = {
  astro:      { zh: 'Astro',      en: 'Astro',      alias: ['Astro.js', 'astrojs'], scope: ['post', 'gallery'] },
  frontend:   { zh: '前端',       en: 'Frontend',   scope: ['post'] },
  site:       { zh: '建站',       en: 'Site',       scope: ['post'] },
  networking: { zh: '组网',       en: 'Networking', alias: ['vpn'],  scope: ['post'] },
  git:        { zh: 'Git',        en: 'Git',        scope: ['post'] },
  docker:     { zh: 'Docker',     en: 'Docker',     scope: ['post'] },
  tailscale:  { zh: 'Tailscale',  en: 'Tailscale',  scope: ['post'] },
  agent:      { zh: 'Agent',      en: 'Agent',      scope: ['post'] },
  openai:     { zh: 'OpenAI',     en: 'OpenAI',     scope: ['post'] },
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
| 分类总数 > 5，或出现单篇分类 | **警告** | 上限 2026-09-16 定为 **4 个 + 1 个增长位**（§十）；超了就该往标签走 —— 长尾分类是「分类退化成标签」的早期症状 |
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
| **P1 数据契约** | `data/taxonomy.ts` + `lib/taxonomy.ts` + 构建期校验 + 引用改 key + 旧地址跳转页 + 迁移现有词条（分类骨架见 §十；**画廊 `theme` 那一刀已做**，见 §十一） | 无 | 中（动 URL） |
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
   这是「同一 kind 内双语共用一个 key」这条设计唯一值得写的断言（现在 5 对里 4 对不上）。
6. **分类骨架落地**：产物里 `/categories/` 索引恰好 4 项，且顺序是 paper → ai → tech → notes
   （即 `order` 生效）；`paper` 暂时 0 篇是**预期**，不是 bug。
7. **`THEME_COLOR` 对齐**：词表里 `scope:["gallery"]` 的主题 key ⊇ 3D 正在用的 theme 值。

e2e（`web-e2e-harness` 那套，独立端口）：

8. 文章页的分类/标签芯片链接指向 `/categories/<key>/`、`/tags/<key>/`（不是百分号编码的旧地址）。
9. 后台：分类是 `<select>` 且选项数 = 词表分类数；打一个未登记的词 → 出现「新建并登记」；
   点它后**词表文件真的多一条**（读仓库返回值断言，不能只看 toast）。

## 九、不做的事（非目标）

- 不改文章 URL（`/blog/<slug>/` 与 `aliases` 机制原样保留）。
- 不做多层分类（父子、树）。9 篇的站不需要。
- 不给标签加落地页增强 / SEO 收编；单例标签的收录问题留到有真实流量再说。
- 不把 `gallery.style.*`（形制）并进词表：它已有 i18n 显示名，且是 3D 几何体的固定枚举，
  属于「有显示名的枚举」，跟词表是两回事。

## 十、blog 分类骨架（2026-09-16 定）

### 10.1 四个分类

| key | zh | en | 收什么 | **不收什么** | 现有落点 |
|---|---|---|---|---|---|
| `paper` | 论文笔记 | Paper Notes | 论文阅读、方法梳理、复现记录 | 关于论文的新闻报道 | —（新增位，暂空） |
| `ai` | 智能体与 AI | AI & Agents | Agent 原理与工程、模型能力、行业事件与评论 | 自己写的论文笔记 | Agent 入门、Navier-Stokes |
| `tech` | 技术与工具 | Tech & Tools | CLI／容器／组网、框架踩坑、工程实践 | — | Astro 踩坑 ×2、Git、Docker、Tailscale |
| `notes` | 随笔 | Notes | 站务、生活、杂记 | 任何技术内容 | 开博第一篇 ×2 |

**为什么是这四个** —— 是从 9 篇的真实成分里长出来的，不是拍脑袋：

- 现有 9 条里 **5 篇是转载**（`source` 字段都有值）且集中在「命令 / 教程手册」，
  这块必须有一个类接着，也就是 `tech`。
- 作者明确会继续加**论文中看到的内容**，所以 `paper` 是预置位 —— 现在空着是对的。
- 「建站与前端」被否掉：不会持续写前端，为 2 篇（还是同一内容的双语版）单开一类不值。

**落点判定不靠领域、靠动作** —— 这是四个类不打架的关键：

| 我正在做什么 | 落点 |
|---|---|
| 在读一篇论文 —— 不管它是什么领域 | `paper` |
| 动手做 AI 的事，或评价一个 AI 事件 | `ai` |
| 查工具、记命令、踩框架的坑 | `tech` |
| 不是技术内容 | `notes` |

于是 `ai` 与 `paper` 的边界是**来源**而不是**领域**：AI 论文的阅读笔记进 `paper`
（它的形态是「读论文」），自己动手做的 Agent 工程与模型调用进 `ai`。
不这样切的话，`ai` 与 `paper` 会因为「论文大多是 AI 方向」而互相抢食，最后总有一个永远是空的。

**命名上三处是刻意的**：key 全 ASCII 好做 URL 段（`/categories/tech/`）；
`tech` 叫「技术与工具」而不是「工具与命令」—— 因为 Astro 踩坑要进来，「命令」装不下它；
用 `ai` 而不是 `agent` —— `agent` 是这两年的潮，`ai` 十年后还在。

### 10.2 现有 9 条的迁移映射

| 文章 | 旧 category | 新 category | 标签变化 |
|---|---|---|---|
| zh/en 开博第一篇 / Hello, Blog | `随笔` / `Notes` | `notes` | `随笔`/`notes` **删**（与分类重复）；`建站`/`meta` → `site` |
| zh/en 用 Astro 搭博客踩到的几个坑 | `技术` / `Tech` | `tech` | `Astro` → `astro`；`前端`/`frontend` → `frontend`；`建站`/`meta` → `site` |
| Git 指令看这一篇就够 | `技术` | `tech` | `git` → `git` |
| Docker 常用命令大全 | `技术` | `tech` | `docker` → `docker` |
| Tailscale 完全指南 | `tailscale` | `tech` | `vpn`、`组网` → `networking`（`vpn` 作 alias） |
| AI Agent 教程｜菜鸟教程 | `agent` | `ai` | `AI Agent(智能体) 教程` → `agent` |
| 10,000 个 Agent、88 小时… | `新闻` | `ai` | （无）→ `agent`、`openai` |

三个旧分类 `agent` / `tailscale` / `新闻` **全部下沉为标签** —— 前两个本来就是软件名，
第三个是体裁（「这是新闻」），两者都不该占着分类层。

旧标签 13 个 → 归一后 **9 个 key**；重复表达同一件事的（`随笔` vs 分类 `notes`、
`前端` vs `frontend`、`vpn` vs `组网`）合并，`建站`/`meta` 统一成 `site`。

### 10.3 论文类文章的出处字段（可选，本轮一起定）

`src/content.config.ts` 的 posts schema 加一个全可选字段：

```ts
paper: z.object({
  arxiv: z.string().optional(),          // arXiv 号，如 2609.01234
  venue: z.string().optional(),          // 会议 / 期刊，如 NeurIPS
  year:  z.coerce.number().optional(),
}).optional(),
```

现在加是**零成本**（`paper` 类本来就没有文章），将来想按年份排序、或做「读过的论文」
列表页时，不用回头改已有文章的 frontmatter。约定：只在 `category: paper` 时使用。

### 10.4 约束

- 分类数量上限 **5**（现 4 个 + 1 个增长位）。超了就往标签走 —— 这正是 `agent` / `tailscale` 的来历。
- **「转载」不设分类**：`source` 有值就是转载，列表页给个徽章即可，数据已经在了。
  体裁（原创 / 手册 / 资讯）将来真要独立，也是新开一个受控字段，不是塞进这里。
- 中英同一篇的两个语言版本必须落在**同一个 key**（§八 第 5 条断言）。

## 十一、实现进度

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

### 已做：第二刀 = 文章分类 / 标签（2026-09-16）

第一刀（画廊 `theme`）没动 URL，这一刀**动了 URL** —— 所以多出「旧地址怎么办」这一半。
分类与标签从「值本身就是显示名、也是 URL」改成**引用词表的 ASCII key**：
`category: 技术` → `category: tech`，地址随之从 `/categories/技术/` 变成 `/categories/tech/`。
好处是显示名可以随便改（改「技术与工具」不动地址），且中英共用同一个 key（不再有 `技术` / `Tech` 两套地址）。

| 文件 | 改了什么 |
|---|---|
| `src/data/taxonomy.ts` | 补 `CATEGORIES`（4：paper / ai / tech / notes，带 `order` 与一句话 `desc`）+ `TAGS`（8：astro / frontend / site / git / docker / networking / agent / openai，`alias` 存旧中文/大写/带括号写法）+ `LEGACY_TERM_ROUTES`（13 条旧地址→新地址，**手维护**，推不出来） |
| `src/lib/taxonomy.ts` | 词表结构的 zod 校验 + 别名撞车守卫 + `order` 不许重复 + `categoryLabel()` / `tagLabel()`（未登记就抛）+ `orderedCategories()`（按 order 排，含 0 篇的）+ `assertCategory()` / `assertTags()`（能认出旧别名，报错给出「是不是想写 X」）+ `legacyTermRoutes()` |
| `src/lib/posts.ts` | `postsOf()` 里挂上 `assertCategory` / `assertTags` —— 所有文章视图都过这里，key 写错就是构建红；删掉 `collectTags` / `collectCategories` / `groupByTerms`，换成 `categoryGroups()` / `tagGroups()` / `tagKeysIn()` |
| `src/pages/categories/[category].astro` + `en/…` | 一条路由出两类页：词表里**每个**分类一页（含 0 篇的 paper）+ 旧地址的跳转页 |
| `src/pages/tags/[tag].astro` + `en/…` | 同上；但标签页**只给文章里真正用到的 key** 出页（标签是检索索引，不是信息架构） |
| `src/layouts/PostLayout.astro`、`src/components/PostPanels.astro` | 链接指 key、文本取显示名 |
| `src/components/admin/AdminInspector.astro` + `src/lib/admin/post.ts` + `chips.ts` + `validate.ts` | 后台分类从自由文本框改成词表下拉；标签输入框拿到 `vocab` 词表 + `normalize` 归一（写「前端」自动落 `frontend`）；校验层拦未登记的 key |
| `src/i18n/ui.ts`、`src/content.config.ts` | 空分类那句话（中英各一）；`category` / `tags` 两字段的注释写明存的是 key |
| 9 篇 frontmatter + 2 篇正文示例 | 按 §10.2 的映射迁移；`hello-world` 正文里那段 frontmatter 示例还在教旧写法，一并改掉 |

**这一刀在显示名上抓出 4 处漏改**（`PostCard` / `Rail` 的 tooltip / `Pet` 的检索 / 后台列表），
症状都是产品里直接印裸 key（`tech`、`#networking`）。这四处**构建不会红、断言也不会响**
—— 它们都算得出「变量写对了」，只是写错了变量。是靠**扫产物 HTML**发现的，
所以 e2e 里专门有一条全站扫描守着它。

空分类还顺手去了一句废话：原来「0 篇文章」与「这个分类下还没有文章。」两句话都在说「没有」，
现在只有后者（非空时才报篇数）。

#### 旧地址：为什么只保留 13 条

迁移前的旧地址共 20 个，但有 **7 个与现有 key 只差大小写**（`/en/categories/Tech/`、`/tags/Astro/` …）。
在 Windows / macOS 这种大小写不敏感的文件系统上，`tags/Astro/` 与 `tags/astro/` 是**同一个目录**
—— 跳转页会顶掉真页面，而它跳的目标就是它自己，变成自指死循环（比 404 更糟，浏览器会空转）。
所以这 7 条**刻意放弃**，由加载期守卫 + e2e 两侧守着「别哪天又被加回来」。

守卫在这一轮是真的拦下了东西：第一版 20 条写下去，探针立刻红在 `docker` 上
（`docker` 既是旧地址、又是现有 tag key，同样撞车）。表从 20 条收敛到 13 条就是这么来的。

#### 验证（当天，逐条都是跑出来的）

| 验的是什么 | 怎么验的 | 结果 |
|---|---|---|
| 词表本身（显示名 / 别名 / order / 旧地址表 / 真实文章落点） | esbuild 打包 `probe-taxonomy.mjs` 跑断言 | **60 / 60 通过** |
| 构建与产物 | `mv dist` 走 → `astro build` → 单独跑 `pagefind` | exit 0 / **83 个 HTML**（70 真页 + 13 跳转页）/ 构建日志无词表警告 |
| 13 条旧地址逐条跳对 | 从产物里读 `meta refresh` 目标，与词表里现读的期望比对 | 13 / 13 一致（含跨类目 `/tags/随笔/` → `/categories/notes/`） |
| 全站没有裸 key | 扫 82 个非 admin HTML，抓「胶囊 / 标签链接」里的文本 | 0 命中 |
| 真实点击 + 跨语言 + 落地 | `terms.mjs` e2e（本地 serve + 无头 Chrome + CDP 真点击） | **38 / 38 通过** |
| 类型 | `astro check` | 仍是 3 个 error，**全部是既有问题**（§上一刀列过），本轮一个没新增 |

e2e 里几条**落在机制上**的判据（避开「断言只给得出『没打开』」这类假绿）：

- 「换页发生了」用轮询 `location.pathname` 判，**不用** `Page.navigate` —— 后者会整页刷新，绕过 View Transitions，测不出真实的点击路径
- 「与 key 只差大小写的旧地址不存在」读**父目录的名字列表**精确比对，**不用** `fs.existsSync` —— 它在 NTFS 上大小写不敏感，会给出假阳性
- 分类索引的顺序断言写的是「词表的 order」而不是篇数 —— 顺序错了和篇数错了是两回事

**没验的**：后台那两处（分类下拉、标签归一）仍然只有产物静态核对，仓里没有 admin 的 e2e 脚手架。

### 待做

- 后台 P2 / P3（编辑器里的词表联动、批量改词条的迁移工具）
- §10.3 那个可选的 `paper` 出处字段（`arxiv` / `venue` / `year`）—— 现在加是零成本
- **改 key 就要补旧地址**：`LEGACY_TERM_ROUTES` 是手维护的，它推不出来（只有迁移前的产物知道 `技术` 曾经是地址）

**复跑方式**（两个脚本都在隔壁 `D:/homepage/.pet-e2e-dual/`）：

- **词表探针** `probe-taxonomy.mjs`（60 条断言，其中一节直接驱动真实数据层）。
  仓里没有测试框架，要先 esbuild 打包再跑，命令写在文件头注释里 —— 秒级，不需要整站构建。
  ⚠️ esbuild 是原生 Win32 程序，**不认 Git Bash 的 `/d/...` 路径**，参数一律写 `D:/...`；
  而 `--define:import.meta.env.BASE_URL` 那一段不能省，否则 `mediaUrl` 会在 Node 里炸掉。
- **词条 e2e** `terms.mjs`（38 条，含无头浏览器真点击）。改成 `node terms.mjs` 即可；
  它会自己起 `serve.mjs` 端 `dist/`，所以**要先构建**。

改动词表、`gallery` 数据层、文章 frontmatter 之后，两个都跑一遍。


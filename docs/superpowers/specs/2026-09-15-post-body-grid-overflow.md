# 正文列被超长代码行撑破 · 缺陷分析

> 2026-09-15 定位并修复。症状是「文章内容压到右侧目录上」。
> 一句话根因：`.post__body` 的**隐式网格轨道**尺寸函数是 `auto`，其下限是内容的
> **min-content**，而正文里 `white-space: pre` 的代码块 min-content 就是最长那一行 ——
> 一篇文章里粘一段几千字符的单行终端记录，轨道就被撑到 **16116px**，
> 之后 `overflow-x: auto` 因为包含块同样宽而彻底失效。

## 1. 症状

`/blog/docker/` 在 ≥1536px（右侧目录出现的断点）下，正文里的代码块**横向甩出去**，
浅灰底色和代码文字一直延伸到视口右缘，压在右侧目录的链接上。
用户截图里能直接看到被切碎的代码片断（`1424`、`4 root root 1264`）叠在目录条目之间。

更早的症状是**页面级横向滚动条**：文档 `scrollWidth` 比视口宽 14761px。

## 2. 复现

- 页面：`/blog/docker/`（`src/content/posts/zh/docker.md`）
- 视口：`width ≥ 1536`（低于此宽度目录整栏 `display: none`，症状不可见）
- 触发内容：该文第 352–354 行、第 363–365 行两个围栏代码块。
  它们各是**一次 `ls -l` / `docker images` 输出被拍扁成了单行**（换行丢失），
  分别约 2090 与 1050 字符 —— 单行 16116px。

## 3. 根因

### 3.1 量出来的链条

`getBoundingClientRect()` 逐层向上量（1600×900 视口）：

| 元素 | 实测宽度 | 关键计算值 |
|---|---|---|
| `pre.astro-code` | **16116px** | `overflow-x: auto`，但 `clientWidth == scrollWidth == 16114` |
| `div.prose` | **16116px** | `min-width: auto` |
| `div.post__body` | 1110px（盒） | `display: grid`，**`grid-template-columns` 解析为 `16116.2px`** |
| `article.page` 以上 | 1168 / 1200 / 1600 | 都正常 |

注意第二行：`.prose` 比它的父容器 `.post__body` 宽 15 倍，**父盒只有 1110px 但轨道是 16116px**。

### 3.2 为什么 `overflow-x: auto` 没兜住

`overflow` 只在**包含块比内容窄**时才有可滚动的余地。

那条规则早就写在 `src/styles/prose.css` 的 `.prose pre` 上，看起来「已经处理过了」。
但它拿到的包含块（`.prose`）本身就等于内容宽 —— 盒子被撑到 16116px，
`scrollWidth == clientWidth`，没有 1px 可滚，内容就直着画出盒外、压到目录上。

**这也是这个 bug 容易漏掉的原因**：光看代码块自己的样式，`overflow-x: auto` 明明在，
像是「不可能出问题」；只有往上量一层，才发现是**父级没约束住宽度**。

### 3.3 罪魁是隐式 `auto` 轨道

`src/styles/global.css` 里的 `.post__body` 基础规则原本只有：

```css
.post__body {
  display: grid;
  gap: 1.5rem;
}
```

没写 `grid-template-columns` → 这一列是**隐式轨道**，尺寸函数为 `auto`。
`auto` 轨道的**增长上限**是 max-content，但**下限**是 min-content，
而 `<pre>` 是 `white-space: pre`，它的 min-content = 最长那一行的宽度。

同一个文件里 `@media (min-width: 900px)` 的 `.post__body--split`（有配图那一版）
**早就**写了 `minmax(0, 1fr) minmax(0, 15rem)` —— 作者是知道这个坑的，
**漏的只是「没有配图」这条路径**。docker 这篇没有 `cover:`，正好走漏掉的一路。

> 同类陷阱在 flexbox 里的版本是 flex item 的 `min-width: auto`。
> 记住一句：**`1fr` 不是「等分剩余」，它是 `minmax(auto, 1fr)`**。

## 4. 修法

### 4.1 改动（`src/styles/global.css`，一行 + 注释）

```css
.post__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.5rem;
}
```

把轨道下限钉成 `0`，轨道就等于容器宽，`.prose` 和 `<pre>` 跟着回到 1110px，
`overflow-x: auto` 才真正生效（`clientWidth 1108 / scrollWidth 16114`）。

### 4.2 为什么修在轨道上，而不是给 `.prose` 加 `min-width: 0`

给 `.prose` 加 `min-width: 0` 也能治（网格项自动最小尺寸的另一半），
但**问题出在轨道的尺寸函数**：轨道被算成 16116px 之后，
任何 `min-width` 都只是让子元素在该轨道内不被撑开，轨道本身仍然是错的，
后续再加别的列 / 别的子元素会再次踩到。**在下限那一处修，才是修在因上。**

### 4.3 为什么不是把代码块改成 `white-space: pre-wrap`

那是**改行为**而不是改 bug：全站所有代码块都会从「横向滚动」变成「软换行」。
`overflow-x: auto` 是 `prose.css` 里刻意的选择（和 `.prose table` 同一套），
为了这一篇的脏数据去动全站代码块的排版不划算。

**真正别扭的是内容**（见 §7.2），不是排版规则。

## 5. 验证

### 5.1 A/B（同一滚动位置，1600×900，`window.scrollTo(0, 1625)`）

| | `pre` 宽 | `pre` 右缘 | 目录左缘 | 文档横向溢出 |
|---|---|---|---|---|
| **改前**（旧产物） | 16116 | 16361 | 1416 | **14761** |
| **改后** | 1110 | 1355 | 1416 | **0** |

改后 `pre` 右缘 1355 < 目录左缘 1416，留 61px 空隙。
「代码块 × 目录链接」两两求交：**改前 5 处相交，改后 0 处**。

### 5.2 全站扫描

新增 `D:/homepage/.pet-e2e-dual/overflow.mjs`（复用 serve.mjs + CDP）：
遍历 `dist` 下所有页面，逐页量「文档 `scrollWidth` − 视口」和「有没有元素的
右缘/左缘伸出视口且**未被祖先裁剪**」。

```
1600×900  → 33 页 · 有问题 0
1280×900  → 33 页 · 有问题 0
1024×900  → 33 页 · 有问题 0
 480×900  → 33 页 · 有问题 0
```

### 5.3 扫描器的灵敏度校验（这一步不能省）

「33 页全干净」只有在**它能抓到旧 bug** 时才说明问题。

`serve.mjs` 与 `overflow.mjs` 都支持 `SITE_ROOT`（默认行为不变），
于是可以把改前产物（`D:/homepage/.dist-old-0915-092022`）指过去跑**同一套判据**：

| 产物 | `.post__body` 规则 | 扫描结果 |
|---|---|---|
| 改前 | `.post__body{gap:1.5rem;display:grid}` | **BAD `/blog/docker/` · docOverflow=14761 · stray=169** |
| 改后 | `.post__body{grid-template-columns:minmax(0,1fr);…}` | 33 页全干净 |

同一套判据、同一视口，只换产物，信号从「169 个越界元素」翻到「0」——
这才叫判据有灵敏度。**只报「全绿」而不证明它会红，等于没验证。**

### 5.4 回归

- 首页 e2e（`home.mjs`）：**113 通过 · 0 失败 · 0 跳过**
- Lenis（`scroll.mjs`）：**34 通过 · 0 失败**
- 两栏版式（`/blog/astro-blog-notes/`，有封面）在 1600 / 1000 / 880 / 700 四档视口
  逐档量过：≥900px 时 `846+240`、`646+240` 并排，<900px 退回单列 —— 与改动前一致，
  `grid-template-columns` 的媒体查询覆盖了基础规则（同特异度、源序在后）。
- 产物哈希随内容变化（`ThemeToggle.-hBDGiYL.css` → `ThemeToggle.D32x_UTc.css`），
  内容寻址生效，无缓存隐患。

## 6. 写判据时的两个坑（否则必是误报）

第一版扫描器报了 5 个页面「有问题」，其中 4 个是误报，都是「**度量越界、视觉正常**」：

1. **`<pre>` 里面那层 `<code>`**：它是 `pre` 的滚动内容，`getBoundingClientRect()`
   如实给出 16079px —— 但它被 `pre` 的滚动视口裁掉了，屏幕上不可见。
2. **首屏那三个 `.hh__layer`**：本来就被**故意**往左右各溢出 56px（`--hh-bleed`），
   用来避免图层横向漂移时露出硬边，被 `.hh { overflow: hidden }` 裁掉。

**处置**：判据里加一步「祖先里有视口内的裁剪/滚动容器 → 跳过」。
不加这一步，扫描器会被自己的噪声淹掉，然后被人关掉。

另外固定 / 吸顶定位（宠物浮层、吸顶栏）一律跳过 —— 它们本来就压在内容上。

## 7. 遗留（未处置，等裁定）

### 7.1 宠物浮层压住右侧目录

量出来的事实（1600×900，`/blog/docker/`）：

- `.toc__inner` 盒子：`left 1416 · right 1584`，纵向 331 → 1127
- 宠物（`.pet.pet--l2d`）：`left 1392 · right 1584`，纵向 596 → 884
- 相交宽 168px（= 目录整宽）、高 288px，**盖住 7 条目录链接**

那 7 条链接点不到。这是既有问题（与本次改动无关），但在「压住目录」这件事上
和本次同源，一并记下来。修法涉及宠物锚点策略（左移 / 躲开目录列 / 目录出现时收起），
是设计决策，未擅自改。

### 7.2 `docker.md` 里那两行「拍扁的终端输出」

排版修好之后，那两个代码块是**可横向滚**的 2000 字符单行 —— 能看，但难用。
根源是内容：`ls -l` / `docker images` 的表格式输出在转载时丢了换行。

按 shell 提示符与列边界重新断行即可还原，但那是**改文章正文**，
需要自己确认后再动。

## 8. 涉及文件

| 文件 | 改动 |
|---|---|
| `src/styles/global.css` | `.post__body` 补 `grid-template-columns: minmax(0, 1fr)` + 一段说明为什么不能省 |
| `D:/homepage/.pet-e2e-dual/overflow.mjs` | **新建**：全站横向溢出扫描（含祖先裁剪判据） |
| `D:/homepage/.pet-e2e-dual/serve.mjs` | 站点根目录支持 `SITE_ROOT` 覆盖（供 A/B 对照，默认不变） |
| `docs/superpowers/specs/2026-09-15-post-body-grid-overflow.md` | 本文件 |

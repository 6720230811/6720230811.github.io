# 双宠物与互动系统 · 设计规格

> 日期：2026-09-12
> 状态：**已实现 · 已端到端验证**（§8.1 九条用例 63 项断言全过；§9 五条假设实测通过）
> 关联代码：`src/lib/pet/*`、`src/components/Pet.astro`、`src/styles/pet.css`、`public/live2d/*`

## 1. 目标

让页面宠物支持**同时出现两只**（主角 + 召唤来的同伴），并且它们之间**能互相交流**：

- **形象**：两只都是**真 Live2D**，不是精灵替身
- **互动**：默认走本地台词对撞（零成本、零延迟）；访客配了 API Key 时，由模型接管，两只真正对话
- **参与**：访客可以随时插话，两只分别回应
- **默认态**：仍然只有一只。第二只由访客在面板里**手动召唤**

## 2. 关键约束：为什么必须 iframe

`public/live2d/js/live2d.js`（Cubism 2 的 web 运行时，来自 `imuncle/live2d`）是**模块级单例**。实测四处全局状态（原文摘自该文件）：

| 位置 | 原文 | 后果 |
|---|---|---|
| 画布引用 | `C=document.getElementById(t)` | 模块级单变量，第二次赋值覆盖第一次 |
| 渲染循环 | `b\|\|(b=!0,function t(){...}())` | 一次性启动标志，只有第一次真的启动循环 |
| WebGL 上下文 | `window.Live2D.setGL(F)` / `setContext(F)` | 全局唯一，后来者抢占 |
| 输入监听 | `window.addEventListener("click",g)` 等 | 绑在整个 `window` 上，多实例各再绑一套 |

同一 `window` 内 `loadlive2d` 调两次 = **要么第二个不渲染，要么第一个被顶掉**。

**「同页加载两份运行时」这条路也堵死**：运行时把 `window.Live2D`、`window.Live2DModelWebGL`、`window.LDGL` 等命名空间挂到共享的 `window` 上，且后续**通过 `window.Live2D` 访问**（如 `window.Live2D.setGL(F)`、`window.Live2D.captureFrame`），而非闭包内引用 —— 两份实例仍共享同一个对象。

**结论**：要让两只都是真 Live2D，唯一干净路径是**给每只一个独立的浏览上下文**，即 iframe。

## 3. 架构总览

三层职责：

| 层 | 内容 |
|---|---|
| **主页面（逻辑层）** | 状态、气泡、拖拽、台词、对话编排、设置面板 |
| **渲染器（iframe × N）** | 一个 canvas + 一份运行时 + 一个消息监听 |
| **通信** | `postMessage` |

**核心设计原则：iframe 只画，不思考。**

这条原则的价值在于：主页面已有的复杂逻辑与踩过的坑（气泡排版契约、字数与链接分开算、`max-height` 内滚、关闭键定位、i18n 双语对齐、拖拽 clamp）**一行都不用重写**，因为它们全留在主页面。iframe 里只有约 40 行。

**交互模式复用**：现有 Live2D 层就是 `pointer-events: none`、事件绑在共同父节点上。iframe 照抄这套 —— 设 `pointer-events: none`，拖拽/点击全由主页面接收，不必为第二只重写任何 pointer 逻辑。

## 4. 组件设计

### 4.1 状态层 `state.ts`

现状是单只（`character` / `offset` / `hidden` / `live2d` 各一份）。改成：

```ts
interface PetState {
  lead: string;                            // 主角 id（原 character）
  companion: string | null;                // 同伴 id，null = 独自
  affectionById: Record<string, number>;   // 已按角色分开，不动
  positions: Record<string, PetOffset>;    // 每只自己的位置（原单个 offset）
  hidden: boolean;                         // 整组隐藏（语义不变）
  chipsHidden: boolean;
  live2d: boolean;
}
```

**迁移**（沿用 `migrateAffection` 的套路，分三种情况）：

1. 已有 `lead` → 直接用（当前版本）
2. 只有 `character`（上一版）→ `lead = character`、`companion = null`、`positions = { [character]: offset }`
3. 更老、只有 `affection` → 交给现有迁移链继续管

**向后兼容是硬要求**：访客 localStorage 里可能存着任意历史版本，读不出来会让宠物白屏。为 `positions` 提供读取回落（缺键时用默认位置），与 `affectionById` 缺键回落 `INITIAL_AFFECTION` 同理。

### 4.2 渲染器 `public/live2d/render.html`（新增）

极简页面，只做三件事：

```html
<canvas id="stage"></canvas>
<script src="/live2d/js/live2d.js"></script>
<script>
  // 1. 监听父级消息（校验 event.origin === location.origin）
  // 2. load    → 调 loadlive2d('stage', modelUrl)
  // 3. pointer → 合成 mousemove 事件，喂给运行时做眼神跟随
  // 并回传 ready / fail
</script>
```

**协议**（全部走 `postMessage`，只认同源）：

| 方向 | 消息 | 说明 |
|---|---|---|
| 主 → iframe | `{t:'load', modelUrl}` | 加载 / 切换模型 |
| 主 → iframe | `{t:'pointer', x, y}` | **iframe 坐标内**的归一化位置，用于眼神跟随 |
| iframe → 主 | `{t:'ready'}` | 模型已就绪（父级可淡入） |
| iframe → 主 | `{t:'fail', reason}` | 加载失败，父级退回 SVG |

iframe 页面**不谈台词、不管气泡、不存状态**。配色由渲染器页面自带一份极简变量（按模型 id 切），因为它拿不到主页面的 `--c-*` / `--pet-*`。

### 4.3 舞台实例 `mount.ts`

**本次最实质的重构。** 现状 `bindOnce(root)` 内所有状态都是闭包里的单实例（一个 stage、一个 bubble、一个 sprite、一个 canvas）。拆成三部分：

| 部分 | 作用域 | 说明 |
|---|---|---|
| `createStage(rootEl, characterId)` | **每只一个** | 气泡、位置、拖拽、点/喂、sprite↔canvas 切换 |
| `bindPanel(panelEl)` | **全局一份** | 设置面板（成员、外观、API 配置） |
| `createOrchestrator(stages)` | **全局一份** | 对话编排（谁跟谁说） |

**关键决策：面板从「宠物的一部分」提升为「全局设置」。** 面板配置的是整个宠物系统（哪几只在、API Key、外观开关），不属于某一只有。齿轮按钮留在**主角**身上 —— 同伴是来访的，不带设置入口。

会话标记 `onceFlag('pet_greeted')` 需要**按角色分键**（如 `pet_greeted:blanc`），否则同伴登场时不会打招呼。

### 4.4 设置面板

现有面板已改造过（标题栏 / 角色 / 外观 / 对话模型 / 底部动作）。本次改动集中在「角色」分区：

- 分区升级为**「成员」**：
  - 第一行「主角」：四个 chip（现状不变）
  - 第二行「同伴」：`独自` + **其余三只**（自动排除主角，从数据上避免选重）
  - 切主角时，若同伴与新主角相同 → 自动回落 `独自`
- 同伴行下方一行轻提示：首次召唤会下载约 3.4 MB 模型
- **外观分区不加开关**：窄屏缩放是自动行为，不给访客多一个要理解的开关

### 4.5 对话编排器 `orchestrator.ts`（新增）

职责：决定**谁在什么时候跟谁说、说几轮**。三种触发：

| 触发 | 行为 |
|---|---|
| 空闲（沿用 `idleAfterMs`） | 主角先开口，同伴接一句，可能再回一句。每轮**随机取 2–4 次发言，硬上限 4 次** |
| 戳 / 喂某一只 | 被戳的那只抱怨一声，另一只**吐槽它**（最有趣的路径） |
| 访客提问 | 被问的那只正常回答；同伴在场时**插一句评价** |

**两级降级**（与现有宠物的三级降级思路一致）：

1. **本地层**（无 Key 也能跑）：`lines.ts` 新增对撞表
   ```ts
   banter: Record<CharacterId, Record<CharacterId, string[]>>
   // banter['neptune']['noire'] = ['诺瓦露你又认真了～', ...]
   ```
   零延迟、零成本、可预测。表里查不到就回落到「对谁都一样」的通用兜底。
2. **LLM 层**（配了 Key）：把上一句当作对话上下文喂给下一只
   - `chat.ts` 的 `ask()` 已收 `character` 参数 —— 只需多传一段「你正在跟 X 说话」的上下文
   - **轮数必须设上限**（4 轮），否则每次空闲都在烧 token

**气泡轮转**：同一时刻**只有一只在说话**（对话本质是轮流的），所以气泡天然不重叠 —— 不需要为「两个气泡并排」设计排版。若访客插话导致两只都想回应，编排器把它们**排成队列**逐条说。

### 4.6 台词层 `lines.ts`

现有四套表（blanc / neptune / noire / vert，各 9 种 kind）**不变**，新增：

- `banter` 对撞表（4×4 + 通用兜底）
- `companionGreet`：同伴登场时的问候

## 5. 数据流：召唤一只同伴

```
用户点「同伴 = 涅普顿」
  → setCompanion('neptune')                    // 落盘
  → 创建 .pet[data-pet-id="neptune"]            // 实例化 createStage
  → 创建 iframe，src=/live2d/render.html        // 懒加载：只有被召唤才建
  → iframe 加载 → postMessage {t:'load', modelUrl}
  → iframe 回 {t:'ready'} → 主页面淡入
  → 编排器：同伴先打招呼（companionGreet）
```

## 6. 交互细节

### 6.1 召唤与懒加载
同伴的 iframe **只在被召唤时创建** → 不召唤的访客零额外流量。模型 3.4 MB，首次召唤显示轻量加载态（复用现有淡入）。

### 6.2 眼神跟随（跨 iframe）
- 主页面在 `.pet-layer` 上监听 `pointermove`，用 **rAF 节流**
- 换算成**每只 iframe 各自坐标系内**的坐标，`postMessage` 给该只
- iframe 内 `window.dispatchEvent(new MouseEvent('mousemove', {...}))` —— 运行时监听的是它自己的 `window`，合成事件能直接喂进去
- 坐标变化小于 **2px** 时**不发消息**，避免每帧两条无效 postMessage

### 6.3 位置与缩放
- 每只一个 `.pet` 实例，绝对定位在 `.pet-layer` 内
- 默认位置：主角在右下角；同伴在主角**左侧**，水平间距 = 主角宽度 × 1.05（错开约半只身位，不重叠）
- **窄屏（< 640px）**：两只**一起按比例缩小**。缩放比 = `min(1, (可用宽度 − 间距) / 两只并排所需宽度)`，**下限 0.6**；触底后仍放不下，允许部分重叠
- 拖拽：沿用现有 `pointerdown/move/up` + `clampOffset`，**每只独立**

### 6.4 隐藏与召回
- `hidden` 是**整组**语义（隐藏整个宠物系统），保持现状：`.pet-layer` 整体收起，只留 `.pet__tab` 召回
- chips 开关：每只各自的芯片行可以收起，但**齿轮只在主角上**

## 7. 错误处理与降级

**每只独立降级**：

| 条件 | 行为 |
|---|---|
| iframe 加载失败 / 收到 `fail` | 该只退回内置 SVG 精灵 |
| 无 WebGL | 该只退回 SVG（探测必须**另开一张临时 canvas**，现有约定） |
| `prefers-reduced-motion` / `saveData` / 2G-3G | 该只退回 SVG（沿用 `shouldSkip()`） |
| `postMessage` 超时（迟迟无 `ready`） | 该只退回 SVG |
| 编排器本轮 API 失败 | 静默退回本地台词，**页面上不出现错误**（与现有一致） |
| 访客无 Key | 全部走本地对撞表，功能完整、不报错 |

**「一只 Live2D、一只 SVG」是被允许的稳定状态，不是错误。**

## 8. 测试策略

沿用 `web-e2e-harness`（本地假网关 + 无头 Chrome + CDP 真实交互），新增用例：

1. 召唤同伴 → 第二个 `.pet` 实例出现，且网络只请求新角色的模型
2. 两只都渲染（iframe 内 canvas 尺寸非零、`.pet--l2d` 生效）
3. `postMessage` 协议：`load` 发出、`ready` 收回
4. 眼神跟随：父页面移动鼠标 → iframe 收到坐标
5. **可逆性**：取消同伴 → iframe 被移除、状态回落、无残留（上次「关气泡丢入口」的教训）
6. 好感度独立：戳主角 → 同伴好感度不变
7. 降级隔离：拦掉一只的 iframe → 该只退回 SVG，**另一只不受影响**
8. 窄屏：视口 375px → 两只都在、都缩小、不重叠
9. i18n：新增文案中英成对（沿用 `i18n-diff` 脚本）

### 8.1 端到端验证结果（2026-09-12 已完成 · 63 通过 / 0 失败 / 1 跳过）

用 CDP 驱动真实无头 Chrome（真鼠标、真网络、真帧），驱动脚本与同源假网关放在
仓库外的 `.pet-e2e-dual/`（`serve.mjs` + `drive.mjs`）。上面 9 条全部落地成断言：

| # | 用例 | 结果 | 证据（关键一条） |
|---|---|---|---|
| 1 | 召唤同伴、只下新模型 | ✅ | 同伴 `data-pet-id=neptune`；`neptune_classic` 请求 +2，`blanc_classic` 计数不变 |
| 2 | 两只都真渲染 | ✅ | 两只都进 `.pet--l2d`；主角画布 `id=pet-canvas-blanc`，同伴是 `IFRAME` 且内部 `#stage` 已就绪 |
| 3 | postMessage 协议 | ✅ | 同伴的 `.pet--l2d` 只在收到 `ready` 后才加上；iframe 是同源可访问上下文 |
| 4 | 眼神跟随 | ✅ | 父页真实指针移动 → 同伴 iframe 内运行时的副作用 `sessionStorage.Sleepy` 1→0（贯穿 rAF → postMessage → 合成 mousemove） |
| 5 | 可逆性 | ✅ | 送走后 `.pet` 数 1、`.pet__frame` 0、落盘 `companion=null`、`has-l2d` 重算 |
| 6 | 好感度独立 | ✅ | 戳主角 30→31，同伴仍 30；落盘的 `affectionById` 只动 `blanc` |
| 7 | 降级隔离 | ✅ | 拦掉 `neptune_classic` → 同伴退回**可见的** SVG 精灵且不留空 iframe，主角仍是 Live2D |
| 8 | 窄屏 375px | ✅ | 两只宽均 163.4px，`lead[199.6,363]` / `comp[24.0,187.4]`，间隙 12.2px |
| 9 | i18n 成对 | ✅ | 两端 38 个键完全一致；英文页渲染 `Members / Lead / Companion / Alone`，无中文残留 |

外加两条工程性的：**本站 0 条未捕获异常**、**0 条意外失败的请求**（主动取消的不算）。
跳过的那条是「直接读同伴模型的 `PARAM_EYE_BALL_X`」—— 运行时没有暴露模型实例句柄
（`Live2D.getModel` 不存在），已有第 4 条的副作用证据，不再强求。

#### e2e 抓出来的两个真 bug（都已修）

1. **每次召唤同伴都会克隆一份主角的画布**。`cloneCompanion` 用 `[data-pet-canvas]`
   去找那张画布，而它是运行时创建的、身上**没有**这个 data 属性 → 同伴里多一个空画布，
   而且 `id="pet-canvas-blanc"` **与主角重复** —— 运行时恰恰是按 `getElementById`
   找画布的。改用类名 `.pet__canvas` / `.pet__frame` 摘除。
2. **窄屏下同伴被推去撞主角**。`clampOffset` 把「气泡向左展开所需的 256px」当硬约束，
   而窄屏 CSS 已把气泡收到 192px，多算的 64px 就变成「把靠左的那只往右推」64px，
   与主角重叠 64px。修法两条：气泡宽度改成**从 CSS 量**（不硬编码），且下限取
   `min(气泡所需, 不超出视口)` —— **多只同时在场时，泊位稳定优先于气泡完整**。

#### 已知表现（留作设计取舍，未擅自改）

窄屏双宠时，两只能看到**芯片行中间交错约 16px**：气泡/芯片宽 192px 大于泊位间距
163.4px，而泊位优先保证宠物本体不重叠。影响仅是遮住对方某个按钮的边缘，
点击仍可达。若要彻底分开，需把窄屏 `.pet__chips` 的 max-width 再收到 10rem 以下 ——
那会改变观感，属于设计决策。

#### 一条方法论：网络记录不能当「资源加载了没有」的判据

缓存命中的请求在 `Network.*` 里**看不见**，会让「模型有没有被拉」这类断言随机变成
0 条记录。这次统一用 `Network.setCacheDisabled(true)` 关掉缓存，才让「网络记录 ==
真实发生的请求」。另外 `Network.loadingFailed` 的参数里**没有 URL**，必须自己维护
`requestId → url` 映射，否则会把页面里无关第三方的失败算到自己头上。

## 9. 假设验证结果（2026-09-12 已实测 · 全部通过）

设计的地基是「iframe 里能跑一份独立的 Live2D 运行时」。开工前用最小页面
（`dist/_spike.html`，两只 iframe 并排，各加载一只模型）逐条验掉了。**9/9 + 3/3 通过**：

| # | 假设 | 结果 | 证据 |
|---|---|---|---|
| 1 | iframe 内 `loadlive2d` 能渲染 | ✅ | 两只 iframe 内 `typeof loadlive2d === 'function'`；各自回报 `ready`（0.5–0.7s） |
| 2 | 两个 WebGL 上下文共存 | ✅ | 两只画布均拿到 webgl 上下文；像素非空白（sd≈85 / 88）；A↔B 画面差异 39（确为两只不同模型） |
| 3 | `pointer-events:none` 时父页能拖 | ✅ | 真实 CDP 鼠标拖拽，外层位移 dx=150 dy=60，`pointerdown` 落在外层（`DIV#wrapB`），未被 iframe 吃掉 |
| 4 | 合成 `mousemove` 驱动眼神跟随 | ✅ | 见下 |
| 5 | `transition:persist` 下 iframe 不重建 | ✅ | 真实点击站内跳转后，探针 iframe **是同一个 DOM 节点**（自定义属性存活）、加载次数仍为 1、仍在 `#pet-root` 内 |

### 4 的证据链（这条最容易验成假信号）

合成事件要驱动跟随，中间隔着四层，必须**逐层取到证据**，否则很容易把
「我们的监听器收到了」误当成「运行时跟着动了」：

| 层次 | 观测手段 | 实测 |
|---|---|---|
| 消息送达 | 在 iframe 上下文里装计数监听器 | 5/5 条 `pointer` 消息送达 |
| 运行时处理器执行 | 借运行时自身的副作用：它的 `mousemove` 处理器会把 `sessionStorage.Sleepy` 由 `1` 置 `0` | `1 → 0`，确为运行时内部那行代码所为 |
| 面部目标点 | — | （`L2DTargetPoint` 在 webpack 模块作用域内，外部不可达，故跳过） |
| **模型参数** | 钩 `Live2DModelWebGL.prototype.addToParamFloat`（`window` 上可达，原型链拦截对已有实例立即生效） | **`PARAM_EYE_BALL_X` −0.969 → +1.107（Δ2.08）**；`PARAM_ANGLE_X` −29.07° → +33.21°（**Δ62.3°**）；`PARAM_BODY_ANGLE_X` Δ20.8 |

运行时渲染循环的原文（`live2d.js`）——这正是上面那条链的中间段：

```js
N.update(); R.setDrag(N.getX(), N.getY());            // 面部目标点 → dragX/dragY
// 随后每帧写进模型：
this.live2DModel.addToParamFloat("PARAM_EYE_BALL_X",   this.dragX, 1);
this.live2DModel.addToParamFloat("PARAM_ANGLE_X",      30*this.dragX, 1);
this.live2DModel.addToParamFloat("PARAM_BODY_ANGLE_X", 10*this.dragX, 1);
```

**⚠️ 像素比对在这台环境里不可用作判据。** 模型会**自动播空闲动作**，画面随时间
抖动：相隔 0.5s 的抖动约 3.8–7.2，而相隔约 1.5s 就升到 **11–22**，与跨指针位置的
差异（22–23）同量级 —— 噪声淹没信号。所以本项目的视觉验证一律走
「读模型参数」这条无噪声路径，**不要**用截图差异判断跟随是否生效。
（截图仍可用于判断「有没有渲染出来」——那是静态属性，不受抖动影响。）

结论：**iframe 路线成立，不需要换 Cubism 4/5 SDK。** 现有 13 MB Cubism 2 模型保留。

## 10. 范围

**做**：主角 + 一只同伴 · 真 Live2D ×2 · 本地对撞 + LLM 接力 · 访客插话 · 窄屏缩放 · 眼神跟随

**不做**（YAGNI）：
- 3 只及以上（已确认 2 只）
- 同伴之间的多人会议式编排
- 宠物移动 / 寻路（原地不动）
- 每只独立的设置面板（面板全局一份）

## 11. 涉及文件

| 文件 | 改动 |
|---|---|
| `src/lib/pet/state.ts` | 单只 → 一群（`lead`/`companion`/`positions`），加迁移 |
| `src/lib/pet/mount.ts` | `bindOnce` 拆成 `createStage` + `bindPanel` + `createOrchestrator` |
| `src/lib/pet/orchestrator.ts` | **新增** 对话编排 |
| `src/lib/pet/stage-iframe.ts` | **新增** iframe 渲染器的父侧封装（创建 / postMessage / 超时） |
| `src/lib/pet/lines.ts` | 新增 `banter` 对撞表 + `companionGreet` |
| `src/lib/pet/chat.ts` | `ask()` 支持传入「对话上下文」 |
| `public/live2d/render.html` | **新增** 渲染器页面 |
| `src/components/Pet.astro` | DOM 改为 `.pet-layer` + 可复制的 `.pet` 结构；面板加「同伴」行 |
| `src/styles/pet.css` | 新增 `.pet-layer`、同伴位置、窄屏缩放规则 |
| `src/i18n/ui.ts` | 新增同伴相关文案（中英成对） |

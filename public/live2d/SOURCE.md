# Live2D 资源来源与许可

这个目录下的运行时与模型**不是本仓库原创**。来源与许可状态如下，上线前请自行确认。

## 来源

| 本地路径 | 上游 |
|---|---|
| `js/live2d.js` | [imuncle/live2d](https://github.com/imuncle/live2d) 的 `js/live2d.js` |
| `model/HyperdimensionNeptunia/blanc_classic/*` | 同上（布兰 / Blanc） |
| `model/HyperdimensionNeptunia/neptune_classic/*` | 同上（涅普顿 / Neptune） |
| `model/HyperdimensionNeptunia/noir_classic/*` | 同上（诺瓦露 / Noire，上游拼作 `noir`） |
| `model/HyperdimensionNeptunia/vert_classic/*` | 同上（贝露 / Vert） |
| `model/HyperdimensionNeptunia/general/*` | 同上 —— 共享的站姿与待机动作 |
| `model/HyperdimensionNeptunia/nepnep/general/*` | 同上 —— **neptune_classic 的动作与表情** |

同步脚本：`scripts/fetch_live2d.py`（幂等，文件已存在就跳过，可反复跑）。

## 文件构成（约 13 MB）

四只由访客**按需加载**：只有被选中的那一只会被下载，另外三只不占访客流量，只占仓库体积。

- `js/live2d.js` —— 148 KB。Cubism 2 的 Web 运行时，**内含 core**，不依赖 `LAppDefine.js`
- 每个模型：`model.moc`（模型本体，271～706 KB）+ `textures.1024/*.png`（贴图，2～3 MB）
- `general/`、`nepnep/general/` —— 站姿、物理、待机动作、表情，多个模型共用

⚠️ **贴图张数因模型而异**：blanc 与 vert 是 4 张，neptune 与 noir 是 3 张。
所以同步脚本的文件清单必须从 `index.json` 解析出来，不能手写 ——
手写一份写死「4 张」的清单，换模型时必然漏。

## 引用的目录不止 `general/`

`index.json` 里写的是相对引用，而且**不一定指向同级的 `general/`**：

- `blanc_classic` → `"pose": "../general/pose.json"`
- `neptune_classic` → `../nepnep/general/mtn/*.mtn`（指的是**另一个模型**的目录）

所以目录结构必须与上游保持 1:1，清单也只能来自 `index.json` 的解析结果 ——
一旦拆散或改名，这两处会 404，而表现是**画布空白、控制台却不报错**，排查很费时间。

## 对上游做的改动：`layout.center_y` 归零

四个模型这个值的原值各不相同（blanc `-0.6` / neptune `-0.4` / noir `-0.8` / vert `-0.7`），
效果是把角色整体往下推、在画布**顶部**留出一块空白。那块空白不只是难看 ——
WebGL 画布整块都吃指针事件，它会挡住右下角那一片正文。

四个都已改成 `0`，实测四只角色都基本填满画布、没有顶部空白。

**这个改动由同步脚本自动完成**（见 `fetch_live2d.py` 的 `CENTER_Y`），不是手动改的文件。
手动改的下场是下次 `--force` 重下就没了，而表现是「某一只有块空白挡着正文」——
很难联想到是资源被覆盖回去了。

## 许可状态（需要注意）

- **上游仓库没有 License 文件。**
- 四名角色（Blanc / Neptune / Noire / Vert）都出自《Hyperdimension Neptunia》，
  版权属 Compile Heart / Idea Factory，这些模型是从游戏中提取的资源。
  从一只扩到四只，风险面也相应扩大。
- `js/live2d.js` 内含 Live2D Cubism Core，是 Live2D Inc. 的专有软件，随其 SDK 分发。

个人主页当彩蛋风险很低。但一旦这个站开始挂商业内容或接广告，建议把模型整套换掉：
改 `src/data/pet.ts` 里各 `characters[].model` 指向别的模型，或者直接把 `live2d.enabled`
关掉退回内置 SVG —— 四套配色变量已经按角色备好了。

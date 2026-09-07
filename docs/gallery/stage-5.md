# S5 — 交互与 UI

## 做了什么

### 真实的路线行走（`routeTo`）

把 S1 的"走直线"stub 换成了网格 BFS + 视线简化：

- **静态缓存的 0.5 m 网格**（~4712 格）`containsPoint` 一次，存 Uint8Array
- 点击地面先 `clearLine` 试直线（每 0.35 m 取样）；能直走就直接去
- 不能直走 → BFS 在能走的格子里找一条最短路
- 视线简化抹掉中间拐点（用 `clearLine` 检查能直连就跳过），最后保留拐弯处的几个点
- **房间与长廊的桥接**自然成立：从房间的点出发，BFS 通过门洞进走廊、再沿走廊到目标房间附近、从门洞进房间

注：方案并不是 A*，但 BFS 对几千格的网格足够快（点一下地面 < 5 ms）。网格和 containsPoint 是同一个数据，分摊到一次加载里。

### 新的 HUD（按规格 11 节）

| 位置 | 内容 |
|---|---|
| **左上** | 章节编号 + 展区名称（如「01 夜行长廊」/「潮汐之间」） |
| **右上** | 折叠的小地图 + 顶上的「地图」胶囊，点了就折/展 |
| **左下** | 靠近作品时浮出（标题 / 描述 / 器材），走开就淡掉（CSS 0.25s 过渡） |
| **右下** | 回正视角 / 切换为网格 / 沉浸 / **离开展厅**（跳到当前策展视图的索引页） |
| **底部居中（5s）** | 首次进入的操作说明，5 秒后自己淡掉 |

### 靠近检测（`updateProximity`）

每帧 `applyCamera` 跑一次（不只是 `moved` 之后 — 传送完也得重算）：
- 3.5 m 内 + 作品法线对着相机（dot > 0.35，"背后的作品不该弹信息"）
- 找出最近的那张，更新 `#gal-info` 的标题/描述/器材
- 走开就 `delete dataset.open`，靠 CSS 淡出

## 自测结果

`npm run check`：**0 errors / 0 warnings / 3 hints**。`npm run build`：通过。

视觉自测（headless chromium + swiftshader）：
- 章节 HUD 在不同区正确切换：「入口序厅」/「中央大厅」/「沉浸展厅」/「临展厅」/「大型作品厅」/「潮汐之间」/「城市长廊」
- 靠近 `潮汐之间` 的 hero「渔港清晨」1.6 m 时，左下角弹出「渔港清晨 / 五点半，雾还没散，船都在原地。/ 器材：Sony A7C · 55mm」
- 走到大厅中央（4 m 内无作品）信息面板自动淡出（`data-open` 被删）
- 右上「地图」胶囊折叠后小地图消失，胶囊文字 + 折叠态都通过 `aria-expanded` 同步
- 首次提示 5 秒后 `data-faded="true"`，再 0.9 s 整个 `hidden`
- 0 console errors

## 改动清单

- `src/lib/gallery/plan.ts`：`routeTo` 换成 BFS + 视线简化（占 ~80 行）
- `src/components/gallery/GalleryFloor.astro`：新 HUD 结构（章节 / 折叠地图 / 左下信息 / 右下 4 按钮 / 首次提示 / 进展条保留）
- `src/styles/gallery.css`：4 个新组件 + 折叠态
- `src/i18n/ui.ts`：新 key（`gallery.chapter` / `gallery.leave` / `gallery.intro` / `gallery.map.collapse`）
- `src/lib/gallery/index.ts`：HUD 数据流（章节 / 靠近 / 折叠 / 首次 / 退出 URL 通过 props 传进来）
- `src/pages/gallery/[room].astro` + `src/pages/en/gallery/[room].astro`：传 `exitUrl={indexUrl[found.view]}`

## 接下来做什么 — S6 性能与降级 + 验收

- **InstancedMesh**：墙 / 踢脚 / 灯槽已经全是 InstancedMesh（S2 做的）✓；需要复查是否还有可以合并的 mesh（门的 arch / lintel 现在是独立 mesh，但总共 13 个门，影响不大）
- **纹理释放**：`floor.dispose()` 已经会逐张释放画布的 map ✓
- **LOD**：S4 已加（缩略图立刻挂，原图走近 14 m 才换）✓
- **远距离降亮**：远端长廊用低强度的环境光 + emissive 灯槽已经实现了（S3）✓
- **低性能自动降级到网格浏览**：保留 `degrade()` 路径，但目前**不会自动触发**（因为 3D 跑得动就不降级）—— 需要加一个轻量的帧率检测（连续 N 帧 < 30 fps 就降级），或加一个"切换为网格"按钮的自动提示
- **10 条验收**：8 条已经过了（章节、6 章、8-12 m 节点、长廊贯通、支线可换内容、层次明确、灯带/小地图导航、作品不重复、移动端可走、网格降级）—— 剩下的：低性能自动降级（上面那条）

构建：**0 errors / 0 warnings**。已提交并推送（`stage-5`），完整报告在本文档。

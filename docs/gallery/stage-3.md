# S3 — 灯光

## 做了什么

按规格的「夜间叙事感，但作品本身保持准确、清晰的颜色」配置灯光。

**环境光**：从 S2 的「HemisphereLight 0.8 + env 0.85」压暗成 0.42 / 0.55——给作品灯的 1.8–2.5 倍对比让出空间。「夜间叙事感」靠明暗对比造出来，不是把整间厅调暗。

- HemisphereLight：天光 `#ffd9b0`（3500 K 那一档），地面反弹 `#3a3733`（深暖灰）
- `scene.environmentIntensity = 0.55`，环境贴图来源 `#f6f3ec/#8b877f`（PMREMGenerator 烘焙）

**灯槽**：从 `MeshBasicMaterial({color})` 升级成 `MeshStandardMaterial({emissive, emissiveIntensity: 1.8, toneMapped: false})`——规格要求「连续灯槽主要使用 emissive 材质表达」。

**作品灯**：一池 6 盏 `SpotLight`（不投影）+ 一个跟着相机的指派函数。规格允许 2-3 盏投影，但动态阴影在这个尺度收益小、代价大；空间层次靠墙色与天花高度，不靠阴影。

- 颜色 `#fff1de`（3800–4200 K，规格）
- 强度 18（普通）/ 26（hero），距离 7.5，decay 1.3，angle 0.58 rad（33°）/ 0.42 rad（24°），penumbra 0.55
- 位置：画心 + 法线 × 0.95 m（规格 0.8–1.1），高度 = `min(3.05, 天花 - 0.4)`
- 永远只照相机附近 ≤ 18 m 内的画；走够 1.5 m 才重排（`updateLighting(x, z)`，内部节流）

**中央大厅**：3×3 m 的柔光顶棚 + 周边两条隐藏轨道灯槽 + 一盏很弱的顶光。

- 顶棚：emissive plane `#FFF3DC` × 1.5
- 轨道：两条 0.12 m × 8 m 的 emissive 条
- 顶光 PointLight 0xfff1de 强度 6 距离 14，让厅里不闷

**沉浸展厅**：不设大面积环境照明，只在 4 个墙角放地脚灯（`#3A3F42` 矮座 + `#F0C48A` emissive 2.2）——等 S4 挂上作品再补作品灯。

**大型作品厅**：净高 5.5 m，顶上两条平行轨道灯槽（0.1 m × 6.6 m），留出悬挂大型装置的视觉高度。

## 接口变更

`FloorHandle` 加了一个方法：

```ts
updateLighting(x: number, z: number): void;  // 走够 1.5 m 才重排作品灯
```

`index.ts` 的 `applyCamera()` 调用它。

## 自测结果

`npm run check`：**0 errors / 0 warnings / 4 hints**。`npm run build`：通过。

视觉（headless chromium + swiftshader）：
- **潮汐之间**：三盏 SpotLight 洗墙清楚可见——左右两幅作品各被一盏照亮，中间那幅距离略远没排上。墙底色是 `#627775`（自然长廊主题），作品区被灯光提亮，对比 2× 左右。
- **中央大厅**：进门后能看到 3×3 柔光顶棚（中央），门洞外的走廊灯槽。
- **大型作品厅**：左右两面墙各有 SpotLight 洗墙，远处走廊白光 + 灯槽隐约透出来；厅里净高 5.5 m 的空旷感通过顶面深灰 `#363837` + 灯槽 + 远处门洞的白光对比出来。
- **临展厅**：一面墙被 SpotLight 洗得很亮，柔白底色 `#E5E1D9` 偏暖，4.2 m 净高的空阔。
- **入口序厅**：走廊深处能看到 SpotLight 的锥形灯束（光的体积感），地面被近处灯槽和洗墙灯同时打亮。

## 注意点

- 灯槽的 emissive 材质在 headless 截图里亮度比真实 GPU 略弱（swiftshader 渲染差异）。在真实显卡上会更突出。如果还觉得不够亮，emissiveIntensity 可调到 2.5。
- 沉浸展厅看起来不够「暗」：沉浸黑 `#202325` 在 `envMapIntensity 0.6` 下被环境贴图微微提亮了。如果你要更暗，把沉浸分区的 `envMapIntensity` 降到 0.25（plan.ts 没有这种字段；需要再写一遍 floor.ts 的材质构造）——或者就把环境光压到 0.3。
- 走廊里 SpotLight 是按 `nearestArc` 跟着相机重新指派——一进入长廊，几个最近的画就会陆续被照亮。

## 接下来做什么 — S4 作品自动排布

按规格第九节补齐完整排展：

- 作品视觉中心 1.5–1.55 m ✓（现在 1.52）
- 距墙角 ≥ 1.2 m ✓（现在 reservedStart/End = 1.2）
- 距门洞 ≥ 0.8–1 m ✓（reservedStart 1.2 已包含门洞距离）
- 相邻净距 0.8–1.4 m（当前 1.0） ✓
- 同一作品组连续 ≤ 5 件
- 不同组之间留 2–3 m 空墙
- 普通横幅 1.6–2.2 m（当前 1.9 m） ✓
- 普通竖幅 0.9–1.3 m（当前 1.1 m） ✓
- 重点 2.6–3.4 m（S4 才加 hero 类型）
- 每段长廊只一个 hero（重点作品）
- 重点作品优先放在走廊尽端、转角正对面、空间放宽节点
- 留白 ≥ 30%（当前 S1 是按步距填满，会改成只填 ~70%）
- 作品加载：缩略图先上、靠近再切高清；释放；placeholder 维持中性
- zoomToView(id) 移动到最近的那张实例（之前已实现）

构建：**0 errors / 0 warnings**。已提交并推送（`stage-3`），完整报告在本文档。
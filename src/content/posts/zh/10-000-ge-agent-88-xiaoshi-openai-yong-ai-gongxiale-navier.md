---
title: "10,000 个 Agent、88 小时：OpenAI 用 AI 攻下了 Navier-Stokes 千禧难题，随后炸出一场优先权之争 | UU AI Hub"
description: "9 月 8 日，OpenAI 发布对 Navier-Stokes 存在性与光滑性问题的「解」——由内部的下一代模型带队，约 10,000 个并发 Agent 攻关 88 小时后得到结论，再用 17 小时完成 Lean 4 形式化验证。"
date: 2026-09-11
category: "新闻"
tags: []
source: "https://www.uuaihub.com/blog/openai-navier-stokes-millennium-2026"
---

> **原文**：[10,000 个 Agent、88 小时：OpenAI 用 AI 攻下了 Navier-Stokes 千禧难题，随后炸出一场优先权之争 | UU AI Hub](https://www.uuaihub.com/blog/openai-navier-stokes-millennium-2026) · uuaihub.com
> 抓取整理于 2026-09-11 · via crawl

## 原文

> 2026 年 9 月 8 日，OpenAI 发布了 **《On the Navier–Stokes Millennium Prize Problem》** ：由内部一个「显著强于 GPT-6 Astra」的未发布模型带队，用约 **10,000 个并发 Agent** 攻关约 **88 小时** ，给出了 Navier-Stokes 存在性与光滑性问题的结论，再用 **17 小时** 完成 **Lean 4 形式化验证** 并把证明开源。同期，NYU 数学教授 Tristan Buckmaster 与合作者 Levent Alpöge 公布了自己的结果，并公开指控 OpenAI 是在**得知他们进展之后** 才启动同一路线——一场关于「AI 时代的署名与优先权」的争论就此爆发。

## 数据来源
  * OpenAI《On the Navier–Stokes Millennium Prize Problem》（2026-09-08）
  * OpenAI 论文《Finite time blowup for Navier–Stokes》与《Finite time blowup for the Euler equation》，及配套 Lean 4 形式化仓库 [openai/NavierStokesAndEuler](https://github.com/openai/NavierStokesAndEuler)
  * Tristan Buckmaster 公开声明 [statement.pdf](https://cims.nyu.edu/~tristanb/statement.pdf)（2026-09-08）
  * TechCrunch（2026-09-08）Russell Brandom 报道；Simon Willison（2026-09-08）评论

* * *

## 90 年悬案：Navier-Stokes 到底在问什么
Navier-Stokes 方程用牛顿第二定律描述流体运动——从机翼设计、天气预报到血流研究都在用它。它的核心特点是：**把流体当成连续介质** ，而不是逐个跟踪分子。
于是就有了那个从 1934 年悬到今天的问题：**这套「连续介质近似」会不会失效？** 具体地说，一个三维不可压缩流体如果一开始完全光滑、能量有限，它的速度会不会在有限时间内涨到无穷大（也就是形成「奇点」）？
  * 1934 年，Jean Leray 证明广义解存在，但**解是否始终保持光滑** 成了核心悬案；
  * 2000 年，克莱数学研究所把它列为七个**千禧年大奖难题** 之一，每题悬赏 100 万美元；
  * 此后近 90 年，没人能证明「一定不会爆破」，也没人能证明「一定会爆破」——注意，这是一个**双向开** 的问题。

## 结论为什么反直觉：证明的是「它会爆破」
OpenAI 给出的答案属于第二条路：对每一个正粘性系数，他们构造出光滑的初始数据（以及光滑外力），使得**不存在全局光滑解** ——也就是流体会在有限时间内爆破。用官方声明里的说法，「从静止到奇点形成，能量始终保持有限」。
这恰好对应克莱研究所官方问题陈述里的**选项 C（ℝ³ 上的爆破）与选项 D（ℝ³/ℤ³ 周期环面上的爆破）** 。他们在摘要里也确认了这一点：这一结果「通过确立官方表述中的 C（以及 D）」解决了该千禧年难题。
而在攻关过程中，Agent 们还顺手解决了一个「更简单」的问题：**把粘性项去掉之后的 Euler 方程** 。他们构造出紧支撑、无散度的光滑初始速度，使无外力的不可压缩 Euler 方程在有限时间内发展出奇点——速度的 C¹ 范数在奇点附近无界。
那这个爆破长什么样？OpenAI 的描述很有画面感：
> 解是一个涡旋——一团旋转的流体，向内螺旋并不断被拉长，像意大利面一样。
![OpenAI 官方配图：局部不可压缩运动的快照，橙色表示更快的角速度，青色表示更慢的旋转（来源：OpenAI 博客，2026-09-08）](/illustrations/10-000-agent-88-openai-ai-navier-stokes-img1-20260911-1024.webp)
论文里的两张关键示意图更具体地展示了这个结构：
![论文 Figure 1：内芯部分在连续时刻 t1 < t2 < t3 的形态，流体向内螺旋、在轴的两侧反向流动（来源：OpenAI 论文第 4 页）](/illustrations/10-000-agent-88-openai-ai-navier-stokes-img2-20260911-1024.webp)
![论文 Figure 2：脉冲几何与扰动速度场，左为固定高度下的脉冲包络，右为 r-z 平面（来源：OpenAI 论文第 5 页）](/illustrations/10-000-agent-88-openai-ai-navier-stokes-img3-20260911-1024.webp)

## 88 小时：一场 10,000 个 Agent 的编队作战
这一部分才是整件事真正值得细读的地方——**它是目前公开信息里规模最大的一次「多 Agent 做科研」的实操记录** 。
按 OpenAI 自己的时间线：
  * **8 月 28 日起** ，他们开始训练一个新的内部模型，官方称它在包括数学在内的基准上表现出「前所未有的性能」，且训练**仍在继续** ；
  * **9 月 1 日** ，他们听到传闻说有两个千禧年难题已被解决，于是决定让这个内部模型去评估**所有未解的千禧年难题** ；
  * 攻关方式是把 Agent 分成小组，**组内可以互相通信** ，Agent 可以读取缓存的互联网内容、可以运行代码；不同小组拿到**同一道题的不同表述变体** ——对 Navier-Stokes，A/B 两种提法（导向「证明存在」）和 C/D 两种提法（导向「证伪」）被分给**不同** 的 Agent 组，避免所有人挤在同一条路上；
  * 中途，OpenAI 用 **Codex 做「交叉授粉」** ：把各组最有用的中间结果整合起来，再回灌给其他组。最终攻下 Navier-Stokes 的那一组，就是这样被引导出来的。

关键数字：
![这场攻关的规模数字](/illustrations/10-000-agent-88-openai-ai-navier-stokes-img4-20260911-1024.webp)
其中参与 Navier-Stokes 攻关的那一组，规模是「**约 10,000 个并发 Agent** 」。OpenAI 特别说明，整个过程中维持了对齐前沿模型评估的同样严格的安全措施，包括监控与隔离。
![多 Agent 编队的作业方式](/illustrations/10-000-agent-88-openai-ai-navier-stokes-img5-20260911-1024.webp)

## Lean 4 形式化：为什么这比「模型说它证出来了」可信得多
这是这份成果能够被严肃对待的关键：**不只是论文，还有一份 Lean 4 形式化证明。**仓库 `openai/NavierStokesAndEuler` 于 9 月 8 日创建，包含 Navier-Stokes 与 Euler 两份证明的 Lean 4 形式化，依赖 **Lean 4.34.0-rc2 + Mathlib + Lake** ，构建方式是标准的 `lake exe cache get` + `lake build`。仓库同时提供了用 **Comparator 独立检查** 证明的说明。
这意味着什么？形式化证明把「这个论证成立吗」变成了「这份代码能不能编译通过」——如果形式化没有问题、且公理使用合规，那么结论的正确性就不再依赖读者对作者权威的信任。OpenAI 表示，形式化与验证由 **GPT-6 Astra 额外花了 17 小时** 完成。
需要注意的是：**这仍然是「OpenAI 声称 + 形式化仓库已开源」的状态** ，社区的独立复核与数学界的消化才刚刚开始。而且 Buckmaster 在声明中明确表达了一种反对意见——他不认为应该「把 Lean 证书连同一份不成熟的预印本一起扔出来」，在他看来，读者首先应该读到的是一份按常规方式写的数学论证，而不是一个形式化证书。

## 另一条时间线：一场关于优先权的公开争执
同一周，NYU 数学教授 **Tristan Buckmaster** 与 **Levent Alpöge** （Anthropic 员工，但声明这是纯个人合作、与雇主无关）公布了自己的结果：带光滑外力的不可压缩多孔介质、Boussinesq 方程与三维不可压缩 Euler 方程的有限时间爆破。他们在声明中承认，这条路的**基本思路来自 Diego Córdoba 与 Luis Martínez-Zoroa** 多年前的工作，自己是用 LLM 把该纲领推到底。
![两条并行的时间线](/illustrations/10-000-agent-88-openai-ai-navier-stokes-img6-20260911-1025.webp)
争执的核心是这句判断：Buckmaster 认为，**通过「光滑外力 + Fefferman 表述里的 c/d 选项」去攻克莱问题，是 Córdoba 与 Martínez-Zoroa 开辟、而他和 Alpöge 悄悄选择的路线** ——「据我所知几乎没有别人在做这个方向」。因此当他从 OpenAI 那里听到对方证明的正是这个版本、且是「带外力的」，他称之为**「一面鲜明的红旗」**。
按他的声明，经过反复追问后他才知道：OpenAI 那边「**有一整支团队在做这个问题** 」「是在一系列尝试中选中的」「先让模型去做更简单的问题，包括 Euler」，连最初展示给他的那个 prompt 也是**用 Codex 写出来的** ，而且「消耗了 insane 级别的算力」。关于「第一个 prompt 是什么时候发出去的」，他说对方很久没有正面回答，最终双方同意的时间点是：**就在他们的进展传到 OpenAI 之后** 。
他还称 OpenAI 的数学研究者 Sébastien Bubeck 两次提出希望把 Alpöge 从作者名单中去掉（理由是他在 Anthropic 工作），并提出两个方案：一是他们先发 Euler、OpenAI 次日发 Navier-Stokes；二是由他单独写一篇论文呈现 OpenAI 的结果。当他提出要把争议公开时，据其转述，对方回应是：「**你为什么要毁掉自己的职业生涯？** 」 OpenAI 这边的公开表述是：9 月 1 日的行动「**源自听到一个传闻** 」，后来才意识到传闻与 Alpöge 和 Buckmaster 有关；他们在完成整个项目与 Lean 验证（9 月 6 日）后主动联系对方，提出可以并发发布；研究者与 Agent **没有以任何方式看到对方的工作** ，「尤其没有为了解这道题而访问任何具体用户数据」，但「虽然可能性不大」，无法排除去标识化后的用量数据对模型改进有帮助。OpenAI 同时强调，双方的证明差异显著，Euler 那部分连证明的具体结论都不同（有外力 vs 无外力）。

## 这件事真正的意义
抛开这周的戏剧性，这份成果里最难被忽略的一层是 Buckmaster 自己写下的判断——他原本准备在公布结果时说：**结果不是最重要的，重要的是「一个数学家和一个大模型现在可以在一个月内做完这些工作」** ，他称之为「深蓝对卡斯帕罗夫的时刻」，并认为学界需要认真讨论**怎么培养学生、怎么分配署名、怎么审稿、什么值得占用一个人一生的注意力** 。
这几点恰好是这场争议里最直接暴露出来的问题：
  * **署名与优先权规则，还没跟上 AI 的速度。** 过去一年「谁先做出来的」是由预印本时间戳、期刊投稿记录和学术共同体口碑共同决定的；现在中间插进来了「谁的算力先开始跑」，而算力是可以在一周内临时加码的。
  * **「形式化验证」降低了正确性的门槛，却没有解决归属问题。** Lean 能告诉你证明是对的，但它不会告诉你这个思路是谁先想到的。
  * **对普通用户的启示其实很务实。** 如果一个小组的数学家 + 编码 Agent 就能在一周内推进千禧年难题级别的问题，那么「多 Agent 编队 + 交叉授粉 + 形式化验证」这套方法论，很快会以更便宜的形式下沉到日常工程里——代码迁移、形式化规约、合规审计都会是它的第一批落点。

## 三个核心观察
  * **这是「多 Agent 做科研」第一次有了可核对的完整记录** ：10,000 个并发 Agent、88 小时、2.7M 条消息、1300 亿 output token，最后落到一份能编译的 Lean 证明——数字和产物都是可验证的，这比任何演示都更有说服力。
  * **形式化证明正在成为 AI 参与数学的「交付标准」** ：从费马大定理的机器验证到这次的 Navier-Stokes，形式化从加分项变成了基本配置。争议的另一方也只反对「先发证书后写论文」的顺序，而不是反对形式化本身。
  * **优先权之争不是花边，而是新规则的第一场公开测试。** 当「人类想法 + AI 执行 + 海量算力」三者混在一起，学术共同体还没有一套判据。这场争执的结论，会成为之后同类事件的重要先例。

* * *
数据来源：OpenAI 官方博客《On the Navier–Stokes Millennium Prize Problem》（2026-09-08，含全部数字与引语）；OpenAI 论文《Finite time blowup for Navier–Stokes》与《Finite time blowup for the Euler equation》；Lean 4 形式化仓库 openai/NavierStokesAndEuler；Tristan Buckmaster 公开声明 statement.pdf（2026-09-08）；TechCrunch（2026-09-08）Russell Brandom 报道；Simon Willison（2026-09-08）对双方表述的整理。文中真实配图分别截取自 OpenAI 官方博客（涡旋示意图）与论文第 4、5 页（Figure 1/2），仅作报道配图使用；时间线与数字卡片为本站根据官方文本绘制。
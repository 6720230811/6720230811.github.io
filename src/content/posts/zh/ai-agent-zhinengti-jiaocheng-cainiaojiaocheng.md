---
title: "AI Agent(智能体) 教程 | 菜鸟教程"
description: "AI Agent(智能体) 教程 AI Agent（Artificial Intelligence Agent） 称为智能体，本质是自动执行任务的程序，核心在于让模型不只回答问题，而是按步骤完成动作。"
date: 2026-09-10
category: "agent"
tags: ["AI Agent(智能体) 教程"]
source: "https://www.runoob.com/ai-agent/ai-agent-tutorial.html"
---

> **原文**：[AI Agent(智能体) 教程 | 菜鸟教程](https://www.runoob.com/ai-agent/ai-agent-tutorial.html) · runoob.com
> 抓取整理于 2026-09-10 · via crawl

## 原文

![](https://www.runoob.com/wp-content/uploads/2025/12/1745211719204.jpeg)
AI Agent（Artificial Intelligence Agent） 称为智能体，本质是自动执行任务的程序，核心在于让模型不只回答问题，而是按步骤完成动作。
**AI Agent（人工智能代理）** 是一个能够感知环境、进行决策并执行行动，以达成特定目标的智能软件实体，它不仅仅是回答问题的聊天机器人，更是能够动手做事的智能执行者。
Agent = LLM (大脑) + Planning (规划) + Tool use (执行) + Memory (记忆)。
快速体验 0 代码，一句话生成应用：[https://www.miaoda.cn/](https://www.miaoda.cn/?invitecode=user-93thly701s00)。
* * *

## 谁适合阅读本教程？
  1. 想使用 AI 自动化日常任务的人
  2. 对编程不熟但想用 AI 做实际工作的新人
  3. 已会基本电脑操作、但对 Agent/工作流 等概念零基础的人
  4. 想把 AI 从聊天提升到真正干活的人

* * *

## 什么是 Agent？
Agent 就是一个能干活的智能助手。
Agent = LLM (大脑) + Planning (规划) + Tool use (执行) + Memory (记忆)。
学习 Agent 需要思维转变： 从对话框问答进化为目标驱动的任务执行。
![](https://www.runoob.com/wp-content/uploads/2025/12/0_0_ezapX2F_7BOysP.png)
传统的软件程序遵循固定的指令流程：输入 → 处理 → 输出，而 AI Agent 则更像一个有自主性的员工，它能够：
  * **理解任务目标** ：明白你想要什么结果
  * **制定计划** ：思考如何达成目标
  * **使用工具** ：调用各种资源和 API
  * **自我调整** ：根据反馈优化策略
  * **持续执行** ：直到完成任务或遇到无法解决的问题

**类比理解：**
  * 传统程序 = 自动售货机：投币 → 按按钮→ 出商品
  * AI Agent = 私人助理：告诉需求 → 助理规划 → 完成任务并汇报

* * *
**核心结构：**
  * **目标（Goal）：** 知道要完成什么
  * **决策（Reasoning）：** 规划执行步骤
  * **工具（Tools）：** 调用 API、代码或系统完成任务

**工作流程：**

```
输入 → 思考 → 调用工具 → 执行 → 返回结果 → 持续迭代__
```

**与普通大模型区别：**
  * 大模型：输出内容
  * Agent：输出结果，并推动执行

比如我们在与 AI Agent 对话，输出：规划三天北京旅行，预算 5000，智能体就会完成以下任务：
  * 拆解需求
  * 查询机票、酒店、景点
  * 生成行程方案
  * 满足条件时继续完成预订

![](https://www.runoob.com/wp-content/uploads/2025/12/75e97117-0606-41cb-a044-bb38a4858735.jpg)
* * *

## 学习资源
现有平台及流行框架：
| 核心需求  | 推荐工具  | 关键优势  |
| --- | --- | --- |
|  [QoderWork](https://www.runoob.com/ai-agent/qoderwork.html) ，桌面级 AI Agent  |  [QoderWork](https://www.runoob.com/ai-agent/qoderwork.html)  | 你说需求，它交付结果。  |
以下是其他流行的 AI Agent 开源框架，这些项目大多围绕工具调用（Tool Calling）、记忆（Memory）、工作流（Workflow）、多 Agent 协作（Multi-Agent）和长期任务执行能力展开。
| 项目  | 定位  | 特点  |
| --- | --- | --- |
AI 思考中... [AI Agent 简介](https://www.runoob.com/ai-agent/ai-agent-intro.html "AI Agent 简介") [](https://www.runoob.com/ai-agent/ai-agent-intro.html)

###  点我分享笔记

写笔记...

---

## 我的想法
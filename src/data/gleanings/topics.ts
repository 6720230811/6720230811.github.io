/**
 * 拾遗（gleanings）的主题词表 —— 收藏夹与仓库**共用**这一张。
 *
 * 为什么不并进 `src/data/taxonomy.ts`：
 * 那张表回答的是**「这篇文章属于什么领域」**（只有 4 类，是文章导航）；
 * 这张表回答的是**「我从外面捡回来的东西是什么方向」**（9 类，是索引柜的抽屉）。
 * 两者粒度与用途都不同，硬合并只会让博客那 4 类被稀释成 9 类。
 *
 * 为什么收藏夹与仓库共用一张：
 * 一个关于自托管的**链接**和一个关于自托管的**仓库**，本来就该待在一起。
 * 共用同一套 key，整合层的筛选才有统一维度，加一个主题也只改这一处。
 *
 * 沿用 `taxonomy.ts` 的三条规矩：key 是 ASCII（它同时是锚点与筛选值）、
 * 显示名按语言取、**每个 key 都出组（含 0 条的）** —— 主题是信息架构，先于内容存在。
 *
 * ⚠️ 这个文件**不许 import 任何东西**，理由同 `taxonomy.ts`：
 * 数据与校验分家，校验在 `src/lib/gleanings.ts`（只跑构建期）。
 *
 * 规格：docs/superpowers/specs/2026-09-16-gleanings-design.md
 */

export interface TopicTerm {
  /** 中文显示名 */
  zh: string;
  /** 英文显示名 */
  en: string;
  /** 排序，小的在前。彼此留 10 的间隔，中间插新主题不用重排 */
  order: number;
  /**
   * 收什么（**中文，单语**）。给自己看的落点依据，不显示给访客 ——
   * 所以不做双语：只写一边、另一边永远没人读，比单语更糟（同 taxonomy.ts 的 desc）。
   */
  desc: string;
}

/**
 * 主题词表。
 *
 * 这 9 个不是拍出来的，是从**你的 57 个真实 star** 的分布里定的：
 * `agent`（Skill 生态）是最大的一簇，`llm` / `ai-app` 次之，
 * 剩下的是文档、爬虫、自托管、设计、视觉、量化各成一类。
 *
 * 加主题时顺手写全 zh/en —— 漏了会在构建期抛错（见 `src/lib/gleanings.ts`）。
 */
export const TOPICS: Record<string, TopicTerm> = {
  agent: {
    zh: '智能体与 Skill',
    en: 'Agents & Skills',
    order: 10,
    desc: 'Skill、Agent 框架，以及能直接装进助手的能力包。',
  },
  llm: {
    zh: '模型与训练',
    en: 'Models & Training',
    order: 20,
    desc: '从零训练、论文清单、模型的原理与拆解。',
  },
  'ai-app': {
    zh: 'AI 应用',
    en: 'AI Apps',
    order: 30,
    desc: '能直接用的 AI 产品，以及它们的开源实现。',
  },
  doc: {
    zh: '文档与 OCR',
    en: 'Docs & OCR',
    order: 40,
    desc: '扫描件、PDF、标注工具 —— 把纸和图片变成能搜的数据。',
  },
  crawl: {
    zh: '抓取与语料',
    en: 'Crawling & Corpora',
    order: 50,
    desc: '爬虫、数据集、语料库。自己不产数据，但得知道去哪拿。',
  },
  selfhost: {
    zh: '自托管与网络',
    en: 'Self-hosting & Network',
    order: 60,
    desc: '跑在自己机器上的服务，以及把它们连起来的组网。',
  },
  design: {
    zh: '设计与前端',
    en: 'Design & Frontend',
    order: 70,
    desc: '界面、配色、可视化、架构图 —— 东西好不好看、好不好读。',
  },
  vision: {
    zh: '图像与视频',
    en: 'Vision & Video',
    order: 80,
    desc: '换脸、数字人、图像与视频模型。',
  },
  quant: {
    zh: '量化与金融',
    en: 'Quant & Finance',
    order: 90,
    desc: '回测、投研、金融数据。',
  },
};

/** 全部主题 key，顺序即表里的书写顺序（真正排序看在 lib 里按 order 排） */
export const TOPIC_KEYS = Object.keys(TOPICS);

/**
 * ============================================================
 *  内容主文件 —— 你需要修改的唯一文件
 * ============================================================
 *
 *  【占位符约定】替换时全局搜索以下标记即可：
 *    张三 / San Zhang  → 你的姓名
 *    XX 大学 / XX University → 你的学校
 *    your.email@example.com → 你的邮箱
 *    GITHUB_ID / SCHOLAR_ID / LINKEDIN_ID → 你的账号 ID
 *
 *  【结构说明】
 *    - 每个字段都有 zh / en 两份，切换语言时自动读取对应版本
 *    - publications 用 authors 数组 + selfIndex 标记自己（渲染时自动加粗）
 *    - 所有板块均为数组，删除条目直接删对象，调整顺序直接移动对象
 *    - 若某个板块暂时没有内容，把数组清空为 [] 即可，该板块会自动隐藏
 */

// ---------- 类型定义 ----------

export interface NewsItem {
  /** 时间，如 '2025.06' */
  date: string;
  /** 动态正文，支持行内 HTML（如 <b>、<a href>） */
  text: string;
}

export interface Publication {
  title: string;
  /** 作者列表，按论文署名顺序 */
  authors: string[];
  /** 你在 authors 中的下标（从 0 开始），渲染时自动加粗 */
  selfIndex: number;
  /** 会议/期刊名，如 'MLSys 2025' */
  venue: string;
  year: number;
  /** 可选备注，如 'Oral'、'Spotlight'、'最佳论文提名' */
  note?: string;
  /** 手动填引用数（暂未接 Google Scholar 自动更新） */
  citations?: number;
  links?: {
    pdf?: string;
    code?: string;
    project?: string;
    video?: string;
    slides?: string;
  };
}

/** 时间线条目：教育 / 科研 / 实习 共用 */
export interface TimelineEntry {
  /** 时间段，如 '2023.09 — 2026.06' */
  period: string;
  /** 机构名（学校 / 公司 / 实验室） */
  org: string;
  /** 机构主页链接，可选 */
  orgLink?: string;
  /** 身份：学位 / 岗位 / 职位 */
  role: string;
  /** 补充说明，如导师、部门 */
  extra?: string;
  /** 要点列表，每条一行 */
  details?: string[];
}

export interface SkillGroup {
  /** 分类名，如 '编程语言' */
  category: string;
  /** 该分类下的技能标签 */
  items: string[];
}

export interface Project {
  name: string;
  /** 项目链接（GitHub / 演示地址），可选 */
  link?: string;
  /** 一句话描述 */
  description: string;
  /** 技术栈标签 */
  stack: string[];
  /** 亮点/产出要点，可选 */
  highlights?: string[];
  /** 时间，可选 */
  period?: string;
}

export interface Award {
  date: string;
  text: string;
}

export interface Profile {
  name: string;
  /** 身份头衔，如 '计算机科学与技术 · 硕士研究生' */
  title: string;
  affiliation: string;
  affiliationLink?: string;
  /** 实验室 / 课题组，可选 */
  lab?: string;
  location: string;
  email: string;
  /** 个人简介，每个元素一个段落 */
  bio: string[];
  /** 研究方向标签 */
  interests: string[];
  /** 学术/社交链接，留空字符串则自动隐藏该图标 */
  links: {
    github?: string;
    scholar?: string;
    linkedin?: string;
    blog?: string;
  };
  /** Google Scholar 引用概览，如 'Google Scholar 引用 120+'；留空则不显示 */
  citationSummary?: string;
  /** 该语言对应的简历文件名（放在 public/cv/ 下） */
  cvFile: string;
  news: NewsItem[];
  publications: Publication[];
  research: TimelineEntry[];
  skills: SkillGroup[];
  projects: Project[];
  internships: TimelineEntry[];
  education: TimelineEntry[];
  awards: Award[];
}

// ---------- 中文内容 ----------

const zh: Profile = {
  name: '张三',
  title: '计算机科学与技术 · 硕士研究生',
  affiliation: 'XX 大学',
  affiliationLink: 'https://example.edu.cn',
  lab: 'XX 实验室',
  location: '中国 · 北京',
  email: 'your.email@example.com',
  bio: [
    '我是 XX 大学计算机科学与技术专业的硕士研究生，师从 XX 教授，主要研究方向为高效机器学习与大模型推理优化。',
    '我的研究关注如何在受限算力下提升大模型的推理效率，包括显存管理、调度策略与分布式推理系统设计。',
    '目前我正在同时准备博士申请与工业界求职，欢迎就科研合作、实习与工作机会与我联系。',
  ],
  interests: [
    '大模型推理优化',
    '分布式系统',
    '机器学习系统（MLSys）',
    '高性能计算',
  ],
  links: {
    github: 'https://github.com/GITHUB_ID',
    scholar: 'https://scholar.google.com/citations?user=SCHOLAR_ID',
    linkedin: 'https://www.linkedin.com/in/LINKEDIN_ID',
    blog: 'https://example.com',
  },
  citationSummary: 'Google Scholar 引用 120+',
  cvFile: 'cv-zh.pdf',

  news: [
    {
      date: '2025.12',
      text: '论文《XXX》被 <b>MLSys 2025</b> 接收。',
    },
    {
      date: '2025.09',
      text: '获得 <b>国家奖学金</b>。',
    },
    {
      date: '2025.06',
      text: '开始在 XX 公司实习，参与大模型推理引擎优化。',
    },
  ],

  publications: [
    {
      title: 'Efficient KV Cache Management for Long-Context LLM Inference',
      authors: ['San Zhang', 'Si Li', 'Wu Wang'],
      selfIndex: 0,
      venue: 'MLSys 2025',
      year: 2025,
      note: 'Oral',
      citations: 42,
      links: {
        pdf: 'https://example.com/paper.pdf',
        code: 'https://github.com/GITHUB_ID/project',
      },
    },
    {
      title: 'A Scheduling Framework for Heterogeneous GPU Clusters',
      authors: ['San Zhang', 'Wu Wang'],
      selfIndex: 0,
      venue: 'IEEE TPDS 2024',
      year: 2024,
      citations: 18,
      links: {
        pdf: 'https://example.com/paper2.pdf',
      },
    },
    {
      title: 'Rethinking Memory Allocation in Distributed Training',
      authors: ['Si Li', 'San Zhang', 'Wu Wang'],
      selfIndex: 1,
      venue: 'arXiv preprint',
      year: 2024,
      links: {
        pdf: 'https://example.com/paper3.pdf',
        code: 'https://github.com/GITHUB_ID/project3',
      },
    },
  ],

  research: [
    {
      period: '2023.09 — 至今',
      org: 'XX 实验室 · XX 大学',
      orgLink: 'https://example.edu.cn',
      role: '科研助理 / 硕士研究生',
      extra: '导师：XX 教授',
      details: [
        '研究长上下文大语言模型的 KV Cache 显存管理，提出分层缓存策略，显存占用降低 35%。',
        '设计面向异构 GPU 集群的推理任务调度框架，吞吐量提升 2.1 倍。',
      ],
    },
    {
      period: '2022.03 — 2023.06',
      org: 'XX 课题组 · XX 大学',
      role: '本科科研助理',
      extra: '导师：XX 教授',
      details: ['参与分布式训练框架的内存优化工作，相关成果发表于 IEEE TPDS。'],
    },
  ],

  skills: [
    {
      category: '编程语言',
      items: ['Python', 'C++', 'CUDA', 'Rust', 'Go', 'SQL'],
    },
    {
      category: '机器学习',
      items: ['PyTorch', 'vLLM', 'TensorRT', 'Transformers', 'DeepSpeed'],
    },
    {
      category: '系统与工具',
      items: ['Linux', 'Docker', 'Kubernetes', 'Ray', 'CUDA Profiling', 'Git'],
    },
    {
      category: '领域方向',
      items: ['大模型推理优化', '分布式系统', '性能剖析', '编译器优化'],
    },
  ],

  projects: [
    {
      name: 'FastInfer —— 高性能大模型推理引擎',
      link: 'https://github.com/GITHUB_ID/fastinfer',
      description: '面向长上下文场景的 LLM 推理加速引擎，核心为分页显存管理与批处理调度。',
      stack: ['C++', 'CUDA', 'Python', 'PyTorch'],
      highlights: [
        '实现 PagedAttention 变体，长文本场景显存占用降低 35%',
        '连续批处理调度使吞吐提升 2.1 倍',
        'GitHub 400+ stars，被 3 个开源项目集成',
      ],
      period: '2024.03 — 2025.06',
    },
    {
      name: 'ClusterScheduler —— 异构 GPU 集群调度器',
      link: 'https://github.com/GITHUB_ID/cluster-scheduler',
      description: '支持多优先级与抢占的 GPU 集群任务调度系统，适配异构显卡混部场景。',
      stack: ['Go', 'Kubernetes', 'gRPC', 'Prometheus'],
      highlights: ['基于 Kubernetes Operator 实现自定义调度策略', '集群整体 GPU 利用率从 58% 提升至 81%'],
    },
    {
      name: 'PaperNote —— 论文管理与知识图谱工具',
      link: 'https://github.com/GITHUB_ID/papernote',
      description: '个人学术论文管理工具，支持引用关系可视化与笔记检索。',
      stack: ['TypeScript', 'React', 'Neo4j'],
      highlights: ['自动抓取论文引用关系并构建知识图谱'],
    },
  ],

  internships: [
    {
      period: '2025.06 — 2025.12',
      org: 'XX 科技有限公司',
      orgLink: 'https://example.com',
      role: '算法工程实习生 · 大模型推理组',
      extra: '主管：XX',
      details: [
        '参与公司自研推理引擎的显存优化，线上服务 P99 延迟下降 22%。',
        '搭建推理性能回归测试流水线，覆盖 12 个主流模型。',
      ],
    },
    {
      period: '2024.07 — 2024.12',
      org: 'XX 研究院',
      role: '系统研发实习生',
      details: ['负责分布式训练任务的容错与弹性伸缩模块开发。'],
    },
  ],

  education: [
    {
      period: '2023.09 — 2026.06（预期）',
      org: 'XX 大学',
      orgLink: 'https://example.edu.cn',
      role: '工学硕士 · 计算机科学与技术',
      extra: '导师：XX 教授',
      details: ['GPA：3.9/4.0', '核心课程：高级算法、分布式系统、机器学习系统'],
    },
    {
      period: '2019.09 — 2023.06',
      org: 'XX 大学',
      role: '工学学士 · 计算机科学与技术',
      details: ['GPA：3.8/4.0', '校级优秀毕业生'],
    },
  ],

  awards: [
    { date: '2025.09', text: '国家奖学金' },
    { date: '2024.11', text: 'XX 学术竞赛 一等奖' },
    { date: '2023.06', text: '校级优秀毕业生' },
  ],
};

// ---------- 英文内容 ----------

const en: Profile = {
  name: 'San Zhang',
  title: "Master's Student · Computer Science & Technology",
  affiliation: 'XX University',
  affiliationLink: 'https://example.edu.cn',
  lab: 'XX Lab',
  location: 'Beijing · China',
  email: 'your.email@example.com',
  bio: [
    "I am a Master's student in Computer Science at XX University, advised by Prof. XX. My research focuses on efficient machine learning and large language model inference optimization.",
    'My work aims to improve LLM inference efficiency under limited compute, spanning memory management, scheduling strategies, and distributed inference system design.',
    'I am currently preparing for PhD applications while also exploring industry opportunities. Feel free to reach out regarding research collaboration or job openings.',
  ],
  interests: [
    'LLM Inference Optimization',
    'Distributed Systems',
    'Machine Learning Systems (MLSys)',
    'High-Performance Computing',
  ],
  links: {
    github: 'https://github.com/GITHUB_ID',
    scholar: 'https://scholar.google.com/citations?user=SCHOLAR_ID',
    linkedin: 'https://www.linkedin.com/in/LINKEDIN_ID',
    blog: 'https://example.com',
  },
  citationSummary: 'Google Scholar Citations 120+',
  cvFile: 'cv-en.pdf',

  news: [
    {
      date: '2025.12',
      text: 'Our paper "XXX" has been accepted by <b>MLSys 2025</b>.',
    },
    {
      date: '2025.09',
      text: 'Awarded the <b>National Scholarship</b>.',
    },
    {
      date: '2025.06',
      text: 'Started an internship at XX, working on LLM inference engine optimization.',
    },
  ],

  publications: [
    {
      title: 'Efficient KV Cache Management for Long-Context LLM Inference',
      authors: ['San Zhang', 'Si Li', 'Wu Wang'],
      selfIndex: 0,
      venue: 'MLSys 2025',
      year: 2025,
      note: 'Oral',
      citations: 42,
      links: {
        pdf: 'https://example.com/paper.pdf',
        code: 'https://github.com/GITHUB_ID/project',
      },
    },
    {
      title: 'A Scheduling Framework for Heterogeneous GPU Clusters',
      authors: ['San Zhang', 'Wu Wang'],
      selfIndex: 0,
      venue: 'IEEE TPDS 2024',
      year: 2024,
      citations: 18,
      links: {
        pdf: 'https://example.com/paper2.pdf',
      },
    },
    {
      title: 'Rethinking Memory Allocation in Distributed Training',
      authors: ['Si Li', 'San Zhang', 'Wu Wang'],
      selfIndex: 1,
      venue: 'arXiv preprint',
      year: 2024,
      links: {
        pdf: 'https://example.com/paper3.pdf',
        code: 'https://github.com/GITHUB_ID/project3',
      },
    },
  ],

  research: [
    {
      period: '2023.09 — Present',
      org: 'XX Lab · XX University',
      orgLink: 'https://example.edu.cn',
      role: 'Research Assistant / Master Student',
      extra: 'Advisor: Prof. XX',
      details: [
        'Studied KV cache memory management for long-context LLMs; proposed a tiered caching strategy reducing memory footprint by 35%.',
        'Designed a scheduling framework for heterogeneous GPU clusters, improving throughput by 2.1×.',
      ],
    },
    {
      period: '2022.03 — 2023.06',
      org: 'XX Group · XX University',
      role: 'Undergraduate Research Assistant',
      extra: 'Advisor: Prof. XX',
      details: [
        'Worked on memory optimization for distributed training frameworks; results published in IEEE TPDS.',
      ],
    },
  ],

  skills: [
    {
      category: 'Languages',
      items: ['Python', 'C++', 'CUDA', 'Rust', 'Go', 'SQL'],
    },
    {
      category: 'Machine Learning',
      items: ['PyTorch', 'vLLM', 'TensorRT', 'Transformers', 'DeepSpeed'],
    },
    {
      category: 'Systems & Tools',
      items: ['Linux', 'Docker', 'Kubernetes', 'Ray', 'CUDA Profiling', 'Git'],
    },
    {
      category: 'Domains',
      items: ['LLM Inference', 'Distributed Systems', 'Performance Profiling', 'Compiler Optimization'],
    },
  ],

  projects: [
    {
      name: 'FastInfer — High-Performance LLM Inference Engine',
      link: 'https://github.com/GITHUB_ID/fastinfer',
      description:
        'An LLM inference acceleration engine for long-context scenarios, featuring paged memory management and continuous batching.',
      stack: ['C++', 'CUDA', 'Python', 'PyTorch'],
      highlights: [
        'Implemented a PagedAttention variant, reducing memory footprint by 35% on long-context workloads',
        'Continuous batching scheduler improved throughput by 2.1×',
        '400+ GitHub stars; integrated into 3 open-source projects',
      ],
      period: '2024.03 — 2025.06',
    },
    {
      name: 'ClusterScheduler — Heterogeneous GPU Cluster Scheduler',
      link: 'https://github.com/GITHUB_ID/cluster-scheduler',
      description:
        'A GPU cluster scheduler supporting multi-priority and preemption for mixed heterogeneous GPU deployments.',
      stack: ['Go', 'Kubernetes', 'gRPC', 'Prometheus'],
      highlights: [
        'Implemented custom scheduling policies via a Kubernetes Operator',
        'Raised overall cluster GPU utilization from 58% to 81%',
      ],
    },
    {
      name: 'PaperNote — Paper Management & Knowledge Graph Tool',
      link: 'https://github.com/GITHUB_ID/papernote',
      description: 'A personal academic paper management tool with citation graph visualization and note search.',
      stack: ['TypeScript', 'React', 'Neo4j'],
      highlights: ['Automatically crawls citation relations and builds a knowledge graph'],
    },
  ],

  internships: [
    {
      period: '2025.06 — 2025.12',
      org: 'XX Technology',
      orgLink: 'https://example.com',
      role: 'Algorithm Engineering Intern · LLM Inference Team',
      extra: 'Supervisor: XX',
      details: [
        'Optimized memory usage of the in-house inference engine, reducing online P99 latency by 22%.',
        'Built an inference performance regression pipeline covering 12 mainstream models.',
      ],
    },
    {
      period: '2024.07 — 2024.12',
      org: 'XX Research Institute',
      role: 'Systems Development Intern',
      details: ['Developed fault-tolerance and elastic scaling modules for distributed training jobs.'],
    },
  ],

  education: [
    {
      period: '2023.09 — 2026.06 (Expected)',
      org: 'XX University',
      orgLink: 'https://example.edu.cn',
      role: "M.Eng. in Computer Science & Technology",
      extra: 'Advisor: Prof. XX',
      details: ['GPA: 3.9/4.0', 'Core courses: Advanced Algorithms, Distributed Systems, Machine Learning Systems'],
    },
    {
      period: '2019.09 — 2023.06',
      org: 'XX University',
      role: 'B.Eng. in Computer Science & Technology',
      details: ['GPA: 3.8/4.0', 'Outstanding Graduate'],
    },
  ],

  awards: [
    { date: '2025.09', text: 'National Scholarship' },
    { date: '2024.11', text: 'First Prize, XX Academic Competition' },
    { date: '2023.06', text: 'Outstanding Graduate' },
  ],
};

/** 按语言取内容 */
export const profile: Record<'zh' | 'en', Profile> = { zh, en };

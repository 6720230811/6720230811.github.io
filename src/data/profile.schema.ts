import { z } from 'zod';

/**
 * 个人信息的数据契约（唯一真源）。
 *
 * 以前这些结构是手写 interface，JSON 化之后改成 zod schema：
 * - 构建时用它校验 `profile.{zh,en}.json`，不一致直接构建失败（见 profile.ts）
 * - 后台 /admin 用它校验编辑结果，类型也由它推断
 * 所以改字段只要改这里。
 *
 * 字段顺序 = 输出 JSON 的 key 顺序（zod 按 schema 声明顺序构造对象），
 * 不要随意调整，否则每次保存都会产生一大片无意义的 diff。
 */

export const NewsItemSchema = z.object({
  /** 时间，如 '2025.06' */
  date: z.string(),
  /** 动态正文，支持行内 HTML（<b>、<a href>）；保存前会过白名单过滤 */
  text: z.string(),
});

export const PublicationSchema = z
  .object({
    title: z.string().min(1),
    /** 作者列表，按论文署名顺序 */
    authors: z.array(z.string()).min(1),
    /** 你在 authors 中的下标（从 0 开始），渲染时自动加粗 */
    selfIndex: z.number().int().min(0),
    /** 会议/期刊名，如 'MLSys 2025' */
    venue: z.string().min(1),
    year: z.number().int(),
    /** 可选备注，如 'Oral'、'Spotlight'、'最佳论文提名' */
    note: z.string().optional(),
    /** 手动填引用数（暂未接 Google Scholar 自动更新） */
    citations: z.number().int().min(0).optional(),
    links: z
      .object({
        pdf: z.string().optional(),
        code: z.string().optional(),
        project: z.string().optional(),
        video: z.string().optional(),
        slides: z.string().optional(),
      })
      .optional(),
  })
  // selfIndex 越界不会报错、只会静默地谁都不加粗，所以在校验阶段就拦住
  .refine((p) => p.selfIndex < p.authors.length, {
    message: 'selfIndex 必须落在 authors 的下标范围内',
  });

/** 时间线条目：教育 / 科研 / 实习 共用 */
export const TimelineEntrySchema = z.object({
  /** 时间段，如 '2023.09 — 2026.06' */
  period: z.string(),
  /** 机构名（学校 / 公司 / 实验室） */
  org: z.string(),
  /** 机构主页链接，可选 */
  orgLink: z.string().optional(),
  /** 身份：学位 / 岗位 / 职位 */
  role: z.string(),
  /** 补充说明，如导师、部门 */
  extra: z.string().optional(),
  /** 要点列表，每条一行 */
  details: z.array(z.string()).optional(),
});

export const SkillGroupSchema = z.object({
  /** 分类名，如 '编程语言' */
  category: z.string(),
  /** 该分类下的技能标签 */
  items: z.array(z.string()),
});

export const ProjectSchema = z.object({
  name: z.string(),
  /** 项目链接（GitHub / 演示地址），可选 */
  link: z.string().optional(),
  /** 一句话描述 */
  description: z.string(),
  /** 技术栈标签 */
  stack: z.array(z.string()),
  /** 亮点/产出要点，可选 */
  highlights: z.array(z.string()).optional(),
  /** 时间，可选 */
  period: z.string().optional(),
});

export const AwardSchema = z.object({
  date: z.string(),
  /** 纯文本：与 NewsItem.text 不同，这里是普通插值渲染，不支持 HTML */
  text: z.string(),
});

export const ProfileSchema = z.object({
  name: z.string(),
  /** 身份头衔，如 '计算机科学与技术 · 硕士研究生' */
  title: z.string(),
  affiliation: z.string(),
  affiliationLink: z.string().optional(),
  /** 实验室 / 课题组，可选 */
  lab: z.string().optional(),
  location: z.string(),
  email: z.string(),
  /** 个人简介，每个元素一个段落 */
  bio: z.array(z.string()),
  /** 研究方向标签 */
  interests: z.array(z.string()),
  /** 学术/社交链接，留空字符串则自动隐藏该图标 */
  links: z.object({
    github: z.string().optional(),
    scholar: z.string().optional(),
    linkedin: z.string().optional(),
    blog: z.string().optional(),
  }),
  /** Google Scholar 引用概览，如 'Google Scholar 引用 120+'；留空则不显示 */
  citationSummary: z.string().optional(),
  /** 该语言对应的简历文件名（放在 public/cv/ 下） */
  cvFile: z.string(),
  news: z.array(NewsItemSchema),
  publications: z.array(PublicationSchema),
  research: z.array(TimelineEntrySchema),
  skills: z.array(SkillGroupSchema),
  projects: z.array(ProjectSchema),
  internships: z.array(TimelineEntrySchema),
  education: z.array(TimelineEntrySchema),
  awards: z.array(AwardSchema),
});

export const FriendsSchema = z.object({
  name: z.string(),
  url: z.string(),
  /** 一句话介绍 */
  desc: z.string(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type NewsItem = z.infer<typeof NewsItemSchema>;
export type Publication = z.infer<typeof PublicationSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Award = z.infer<typeof AwardSchema>;
export type Friend = z.infer<typeof FriendsSchema>;

/** 生成给后台用的报错文案（构建失败时也能一眼看懂哪里不对） */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(根对象)'}: ${issue.message}`)
    .join('\n');
}

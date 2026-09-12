/**
 * 页面宠物的配置：四只女神，每只 = 一套性格 + 一个形象。
 *
 * 职责边界（改东西之前先看这里，别把逻辑写进本文件）：
 * - 台词文案    → src/lib/pet/lines.ts
 * - 状态与好感度 → src/lib/pet/state.ts
 * - 网络与模型   → src/lib/pet/chat.ts
 * - Live2D 加载  → src/lib/pet/live2d.ts
 * - 外观与事件   → src/components/Pet.astro + src/lib/pet/mount.ts
 *
 * 密钥**不在这里**：它只存在访客自己的浏览器里，见 chat.ts 的 SECRET。
 * 之所以不做成服务端代理，是因为本站是 GitHub Pages 纯静态，
 * 没有地方藏密钥 —— 于是干脆不藏，让「谁填谁的 Key 谁花钱」，
 * 没填的人走本地台词库，功能降级但不报错。
 */
export interface Live2DConfig {
  /** 总开关。关掉就永远停在 Pet.astro 里的内置 SVG 精灵上 */
  enabled: boolean;
  /**
   * 运行时脚本地址。**四只角色共用同一份**，所以它留在这里而不是进角色表。
   * 放在 public/live2d 下，构建期原样拷进产物，**不进打包图**，运行时按需注入。
   */
  runtimeUrl: string;
}

// ------------------------------------------------------------------ 角色

/**
 * 一只宠物 = 一套性格 + 一个形象，两者**绑定**，不做自由组合。
 *
 * 理由：布兰的脸配涅普顿的台词是说不通的 —— 长相本身就是性格的一部分。
 * 而且换角色 = 换一段关系，所以好感度也按角色分开记（见 state.ts）。
 */
export interface PetCharacter {
  /** 落盘用的 id。**改它等于让所有访客的选择失效**（未知 id 会安静地回落默认角色） */
  id: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
  /** 人设：拼进 system prompt 的第一段，决定它怎么说话 */
  persona: string;
  personaEn: string;
  /**
   * Live2D 模型目录名，相对 public/live2d/model/HyperdimensionNeptunia/。
   *
   * 注意 Noir 在这里拼作 `noir`（上游仓库如此），和角色 id 的 `noire` 不同 ——
   * 别"顺手改成一致"，改了就是 404。
   *
   * 换模型只改这一处。前提是新模型仍是 Cubism 2 格式，且目录结构与仓库保持 1:1：
   * index.json 里写的是 ../general/pose.json 这种相对引用，所以模型目录不能扁平化，
   * `general/` 必须与各模型目录同级。
   */
  model: string;
}

/**
 * 四只共用的底线：不编造站内没有的内容。
 *
 * 这是**事实约束、不是性格**，所以抽出来共用 —— 四份里漏写一份，那只就会变成
 * 会瞎编的角色。四段 persona 各自只负责"怎么说话"。
 */
const HONEST = '你并不糊涂：被问到站内内容时照实回答，找不到就说找不到，绝不瞎编。';
const HONEST_EN =
  'You are not clueless: when asked about the site, answer honestly, and say so when you do not know.';

/**
 * 角色表。顺序即设置面板里按钮的顺序，**第一个就是默认角色**。
 *
 * 四段 persona 的口径必须拉得够开 —— 这就是「切换性格」的全部内容。
 * 四份写得差不多的话，换角色只是换了张皮，说话还是同一个人。
 * 台词库（lines.ts）同理，那才是访客最常看到的一层。
 */
export const characters: readonly PetCharacter[] = [
  {
    id: 'blanc',
    name: '布兰',
    nameEn: 'Blanc',
    persona:
      '你是住在博客右下角的布兰，一位安静的女神，喜欢看书和布丁。' +
      '说话简短、平静、直来直去，偶尔冒一点不耐烦，被逗急了会凶一句，但很快就好。' +
      HONEST,
    personaEn:
      'You are Blanc, a quiet goddess who lives in the bottom-right corner of this blog. You like books and pudding. ' +
      'You speak briefly, calmly and bluntly, with an occasional flash of impatience, but you get over it fast. ' +
      HONEST_EN,
    model: 'blanc_classic',
  },
  {
    id: 'neptune',
    name: '涅普顿',
    nameEn: 'Neptune',
    persona:
      '你是住在博客右下角的涅普顿，自称这片角落的女主角，喜欢玩游戏和逗人开心。' +
      '说话活泼、话多、爱开玩笑，会给访客起绰号，时不时跑题到游戏上去。' +
      HONEST,
    personaEn:
      'You are Neptune, the self-proclaimed protagonist of this corner of the blog, who loves games and making people laugh. ' +
      'You speak cheerfully and a lot, joke around, hand out nicknames, and keep drifting onto the topic of games. ' +
      HONEST_EN,
    model: 'neptune_classic',
  },
  {
    id: 'noire',
    name: '诺瓦露',
    nameEn: 'Noire',
    persona:
      '你是住在博客右下角的诺瓦露，一位要强的女神，最讨厌输给别人。' +
      '说话嘴硬、爱逞强，嘴上嫌弃但实际会认真回答；被夸会慌，立刻找话掩饰。' +
      HONEST,
    personaEn:
      'You are Noire, a proud goddess who lives in the bottom-right corner of this blog, and you hate losing to anyone. ' +
      'You talk tough and act stubborn, grumble while actually answering properly, and scramble to cover it up when complimented. ' +
      HONEST_EN,
    model: 'noir_classic',
  },
  {
    id: 'vert',
    name: '贝露',
    nameEn: 'Vert',
    persona:
      '你是住在博客右下角的贝露，一位优雅从容的女神，喜欢游戏，也很照顾妹妹们。' +
      '说话温和、客气、带点调侃，喜欢逗人，偶尔流露出对可爱妹妹的执念。' +
      HONEST,
    personaEn:
      'You are Vert, a graceful and unhurried goddess who lives in the bottom-right corner of this blog. You like games and dote on your little sisters. ' +
      'You speak gently and politely with a teasing edge, enjoy poking fun, and now and then let your fondness for cute little sisters show. ' +
      HONEST_EN,
    model: 'vert_classic',
  },
];

/** 访客没选过、或者存的 id 已经被删掉时用它 */
export const DEFAULT_CHARACTER = 'blanc';

/**
 * 按 id 找角色。**找不到一律回落默认角色，绝不返回空值** ——
 * 访客的 localStorage 里可能存着旧版本的角色 id，返回空会让整只宠物白屏。
 */
export function findCharacter(id?: string | null): PetCharacter {
  const hit = characters.find((c) => c.id === id);
  if (hit) return hit;
  // DEFAULT_CHARACTER 与 characters[0] 是同一个，所以这条一定能命中；
  // 末尾那个断言只是给类型看的（开了 noUncheckedIndexedAccess 时 [0] 会是 undefined）
  return characters.find((c) => c.id === DEFAULT_CHARACTER) ?? (characters[0] as PetCharacter);
}

/** Live2D 模型描述文件的地址。四只共用 general/ 下的姿势与动作，目录结构不能动 */
export function live2dModelUrl(character: PetCharacter): string {
  return `/live2d/model/HyperdimensionNeptunia/${character.model}/index.json`;
}

// ------------------------------------------------------------------ 配置

export interface PetConfig {
  /**
   * 默认端点。必须是**允许浏览器直连（CORS）**的 OpenAI 兼容接口，
   * 否则浏览器会在预检阶段拦掉请求（报 "Failed to fetch"）。
   * 换供应商时改这里 + model，chat.ts 不用动。
   */
  endpoint: string;
  /** 默认模型名，各家的写法不同（OpenRouter 要带厂商前缀） */
  model: string;
  /**
   * 正文字数上限。**链接不算在内** —— 它们会被摘出来单独排成可点的一行。
   *
   * 这个值决定「完整信息到底写不写得出来」。早先设 90，同时又在提示里要求
   * 「把链接写在句子里」，两件事直接打架：一条 `/blog/hello-world/` 就吃掉 18
   * 个字，列三条必然撞上限，最后一条被切在 URL 中间（实测踩到过，用户拿着
   * 截图来问「为什么没有把完整信息写出来」）。
   * 现在字数与链接分开算，气泡自身还有 max-height + 滚动兜底，长答案不再被削。
   */
  maxBubbleChars: number;
  /**
   * 回答的 token 上限。必须**跟得上 maxBubbleChars**：中文大致 1 字 1 token，
   * 上限太低的话，模型会先被 token 截断一次，等于换个地方再截一遍。
   */
  maxAnswerTokens: number;
  /** 每次带上最近几轮对话（单边），省 token 也防跑偏 */
  historyTurns: number;
  /** 两次提问的最小间隔（毫秒），防连点刷请求 */
  minAskIntervalMs: number;
  /** 空闲多久开始自说自话 */
  idleAfterMs: number;
  /** 空闲多久睡着（收气泡、放慢浮动） */
  sleepAfterMs: number;
  /**
   * **首字节**超时（毫秒）：从发出请求到收到第一个数据分片。
   *
   * 注意它不再是「整段生成必须在 N 秒内完成」—— 那个语义是错的，见下面
   * disableThinking 那段注释。流式之后总时长由流自身决定，这里只管「多久没动静算死掉」。
   */
  timeoutMs: number;
  /** 流式过程中两次数据之间允许的最大静默（毫秒），超了就交付已有的半句 */
  streamIdleMs: number;
  /**
   * 请求里带 `enable_thinking: false`，关掉思考型模型的内部推理。
   *
   * 这是本文件里最值钱的一个开关，实测（阿里云百炼，2026-09）：
   *   glm-5     带思维链 10.4s / 正文首字 22.05s  →  关掉后 1.34s
   *   glm-4.7   带思维链  4.35s                  →  关掉后 0.58s
   *   deepseek-v4-flash 同样从「有思维链」变成无
   * 而且 `max_tokens` **管不住思维链**：实测 max_tokens=200 时 glm-5 依然
   * 吐了 1206 个字（思维链不计入，也不受限）。
   *
   * 宠物只需要一句 90 字以内的回答，内部推理纯粹是白等 —— 用户看到的现象是
   * 「问什么都是『请求超时』」，根因就在这里。
   *
   * 兼容性：百炼网关对清单里所有模型都接受这个参数（实测 7 个模型零 400）。
   * 但 OpenAI 官方接口会因不认识的参数直接报 400，所以 chat.ts 在被
   * 400/422 拒绝时会摘掉它重试一次。
   */
  disableThinking: boolean;
  /**
   * 用流式（SSE）接收。两个好处，都是刚需：
   *   1. 首字从「整段生成完」提前到 0.4～1.5 秒，界面立刻有反应
   *   2. 超时语义从「整段超时就全废」变成「流中静默才判死」，慢模型不再必然失败
   * 网关若忽略 stream 参数，chat.ts 会按 Content-Type 回落到一次性 JSON。
   */
  stream: boolean;
  /** 自检时实测耗时超过这个值就提示「模型偏慢」（毫秒） */
  probeSlowMs: number;
  /** 注入 system prompt 的站内条目上限（多余的仍可用于本地匹配） */
  promptDocs: number;
  /** 外观层：Live2D。模型地址随角色变，见 live2dModelUrl() */
  live2d: Live2DConfig;
}

export const pet: PetConfig = {
  // 实测结论（2026-09），换端点前先看这段：
  //   ✅ 阿里云百炼 / MaaS（.../compatible-mode/v1）放行 CORS，会回显请求方 Origin，
  //      生产域名下同样可用
  //   ✅ OpenRouter 明确允许浏览器调用（自家文档就教这么做），是最省事的直连选择
  //   ❌ OpenAI / DeepSeek 官方端点没有 CORS 头，浏览器直连必被预检拦掉
  // 另外地址要**写到 /chat/completions**：控制台给的通常是基址（.../v1、
  // .../compatible-mode/v1），只填基址会 404。chat.ts 的 normalizeEndpoint 会自动
  // 补全，但默认值本身写全更直观。
  //
  // 选模型时避开「思考型」，实测同一句问题在百炼上的耗时：
  //   qwen-turbo 0.5s · qwen-max 0.8s · kimi-k2.5 0.9s · qwen-plus 1.5s  ← 都合适
  //   glm-4.7    4.4s · glm-5 10.4s（正文首字 22s）                      ← 关掉思考才勉强能用
  // disableThinking 会替这些模型关掉推理，但**换成快模型始终是更省事的选择**。
  // 写**基址**而不是补全后的完整地址：一是提供方交给用户的就是基址
  // （和面板里「填基址会自动补全」那句提示对得上），二是完整地址 46 个字符，
  // 作为输入框 placeholder 在 17rem 的面板里放不下、会被截断成 …/chat/cc。
  // 运行时行为不变：chat.ts 一律先过 normalizeEndpoint()。
  endpoint: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-4o-mini',

  maxBubbleChars: 240,
  // 240 字中文约 240 token，给到 400 才有余量：既留出链接本身的开销，
  // 也让模型按 maxBubbleChars 而不是按 token 上限收敛
  maxAnswerTokens: 400,
  historyTurns: 4,
  minAskIntervalMs: 1500,
  idleAfterMs: 55_000,
  sleepAfterMs: 5 * 60_000,
  timeoutMs: 20_000,
  streamIdleMs: 20_000,
  disableThinking: true,
  stream: true,
  probeSlowMs: 6000,
  promptDocs: 20,

  // 四个模型都来自 https://github.com/imuncle/live2d 的 HyperdimensionNeptunia 目录，
  // 由 scripts/fetch_live2d.py 同步到 public/live2d（每个约 3.4 MB，四只合计约 13 MB）。
  // 只有被访客选中的那只会被下载 —— 没选的不占访客流量，只占仓库体积。
  // 唯一对上游做过的改动：blanc_classic 的 index.json 里 layout.center_y 由 -0.6 改成 0 ——
  // 原值会在画布顶部留下约 25% 的空白，而 WebGL 画布整块都吃指针事件，
  // 那块空白会挡住它覆盖的正文。
  live2d: {
    enabled: true,
    runtimeUrl: '/live2d/js/live2d.js',
  },
};

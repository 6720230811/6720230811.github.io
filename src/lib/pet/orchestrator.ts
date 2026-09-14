import { pet } from '../../data/pet';
import type { Locale } from '../../i18n/ui';
import { banterLine, type LineKind } from './lines';

/**
 * 对话编排器：决定**谁在什么时候跟谁说、说几轮**。
 *
 * ## 为什么单独一层
 *
 * 「两只宠物」真正难的不是画出两个模型，而是**让它们的对话读起来像对话**。
 * 这件事有三个独立的关注点，混在一起会互相干扰：
 *
 * | 关注点 | 落在哪 |
 * |---|---|
 * | 谁会说话、气泡怎么排、失败怎么退 | `mount.ts` 的舞台（每只一份） |
 * | **谁跟谁、什么时候、说几轮** | 本文件（全局一份） |
 * | 具体说了什么 | `lines.ts` 的对撞表 / 模型 |
 *
 * 所以这里只做调度：拿到「有哪些舞台」「这一刻能开口的有谁」，然后按规则排列组合。
 * 它**不碰 DOM、不碰气泡、不碰网络** —— 它连 `ask()` 都不调，只说
 * 「你，接着它的话说一句」，具体怎么弄是舞台的事。
 *
 * ## 三种触发（规格 §4.5）
 *
 * | 触发 | 行为 |
 * |---|---|
 * | 空闲 | 主角先开口，同伴接一句，再回一句…每轮随机 2–4 次，**硬上限 4 次** |
 * | 戳 / 喂某一只 | 被戳的那只抱怨一声（舞台自己说），另一只**吐槽它** |
 * | 访客提问 | 被问的那只正常回答（舞台自己答），同伴**插一句评价** |
 *
 * ## 两级降级
 *
 *   1. **本地层**：`banterLine()` 的对撞表。没配 Key 时全靠它 —— 零延迟、零成本
 *   2. **LLM 层**：配了 Key 时，舞台的 `replyTo()` 会把上一句当话头交给模型接力
 *
 * 轮数硬上限是刻意的：不设上限的话，每次空闲都在烧 token，而访客根本看不出来。
 *
 * ## 轮次：一次只开一个气泡，但短句不拦
 *
 * 「同一时刻只有一只在说话」这句约束的是**生成**（`running` 那把锁），
 * 显示上则分两种：
 *
 *   - **短句**（问候 / 吐槽 / 戳一下）可以并排出现。它俩宽度小、通常根本碰不到，
 *     而一条一句地等 13 秒收气泡，那就不是对话了 —— 节奏感正是这么来的。
 *   - **访客提问的回答**是「要读完的」：`speaker.whenBubbleFree()` 会让同伴的
 *     评论**排队等它读完**。不这样的话，一句吐槽会把人家刚问出来的答案顶掉，
 *     那是明确的功能倒退。
 *
 * 唯一的例外是 `say()` / `show()` 返回 false 的时候：那只说不出话（被藏起来、
 * 在忙、不在场），本轮就此收场，不会硬挤出一句。
 */

/**
 * 编排器眼里的「一只宠物」。**故意定义得很窄** ——
 * 窄到它没法顺手去碰 DOM，也没法自己发请求。
 *
 * 由 `mount.ts` 的 `createStage()` 实现。之所以在本文件里定义（而不是从
 * mount.ts 导出），是为了**不让两个模块互相 import**：mount 需要编排器，
 * 编排器需要舞台的类型，但舞台的类型只是结构 —— 谁定义都可以，定义在这里
 * 就等于 mount → orchestrator 单向依赖。
 */
export interface StageFace {
  /** 角色 id（与 data/pet.ts 的 characters[].id 一致） */
  readonly id: string;
  /** 显示名，已按当前语言取好 */
  readonly name: string;
  /**
   * 现在能不能开口：在场、醒着（不是睡着那个状态）、没在生成中。
   * 整组被访客藏起来时**一律返回 false**。
   */
  available(): boolean;
  /** 说一句自己的台词（台词库按 kind 取）。返回说了什么；空串 = 这回没说 */
  say(kind: LineKind): string;
  /** 直接显示一段文本（编排器自己挑好的对撞句）。返回 false = 开不了口 */
  show(text: string, hold?: number): boolean;
  /**
   * 接着 `prev` 那句说。**舞台内部决定走本地还是模型**：
   * 没配 Key 直接查对撞表；配了 Key 就交给模型接力，失败静默退回对撞表。
   * 返回它最终说了什么；`null` = 这回没说（在忙 / 被藏起来 / 拿不到话）。
   */
  replyTo(prev: { id: string; name: string; line: string }): Promise<string | null>;
  /**
   * 这只身上那条**要读完**的气泡（访客提问的回答）收起来了吗。
   * 短句气泡、没有气泡 → 立刻兑现。
   *
   * 有它才有「轮到谁说话」：访客问了一句，另一只的即兴评论必须等人家读完 ——
   * 否则那句答案会被一句吐槽顶掉。而两只短句之间的快速接话不受它拦，
   * 一条一句地等 13 秒收气泡，那就不叫对话了。
   */
  whenBubbleFree(): Promise<void>;
}

export interface OrchestratorOptions {
  /** 取当前语言。做成函数是为了跨页换语言后不必重建编排器 */
  locale: () => Locale;
  /** 本轮说完之后通知一声（目前只有测试与诊断用，缺省也没有副作用） */
  onRoundEnd?: () => void;
}

export interface Orchestrator {
  /** 空闲计时到点了。单只就自说自话，两只就对撞一轮 */
  onIdle(): void;
  /** 有互动发生（戳 / 喂 / 问）—— 空闲计时重来 */
  onInteract(): void;
  /** `speaker` 刚被戳/喂，它说了 `line`。让另一只吐槽它 */
  onPoke(speaker: StageFace, line: string): void;
  /** `speaker` 刚回答了访客的 `question`。让另一只插一句评价 */
  onAsk(speaker: StageFace, question: string, answer: string): void;
  /** 同伴到场了：它先说一句，另一只接一句 */
  onArrive(arrived: StageFace): void;
  destroy(): void;
}

/** 一轮对撞的硬上限。**不能再往上调** —— 每次发言都可能是一次模型调用 */
const MAX_TURNS = 4;

/** 至少说两句：一句开场、一句接话，否则算不上「交流」 */
const MIN_TURNS = 2;

/** 两只之间留一点停顿。零间隔的话像同一个人在自言自语 */
const GAP_MS = 1300;

/** 被戳的那只先说完，同伴再吐槽 —— 抢在它前面说就成了自说自话 */
const REACT_DELAY_MS = 900;

export function createOrchestrator(
  getStages: () => readonly StageFace[],
  options: OrchestratorOptions
): Orchestrator {
  /**
   * 一把锁：对话是串行的。
   * 没有它的话，「两只同时决定开口」会同时触发两段生成 —— 既烧两次 token，
   * 气泡也会你顶我我顶你，看起来像坏了。
   */
  let running = false;
  let disposed = false;
  let idleTimer = 0;

  /** 在场的、这一刻能开口的 */
  function live(): StageFace[] {
    return getStages().filter((stage) => stage.available());
  }

  /** 除自己以外能开口的。**随机挑** —— 只有两只时它也只有一个选择，但别写死索引 */
  function pick(self: StageFace): StageFace | null {
    const others = live().filter((stage) => stage.id !== self.id);
    if (!others.length) return null;
    return others[Math.floor(Math.random() * others.length)] ?? null;
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function schedule(): void {
    if (disposed) return;
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(onIdle, pet.idleAfterMs);
  }

  // ------------------------------------------------------------------ 空闲

  function onIdle(): void {
    if (disposed || running) return;
    const list = live();
    if (!list.length) {
      // 都被藏起来了（或者睡成一片）：过一会儿再看
      schedule();
      return;
    }

    // 独自一只 → 就是原来那句「隔一会儿自说自话」，一个字都没变
    const lead = list[0] as StageFace;
    const peer = pick(lead);
    if (!peer) {
      lead.say('idle');
      schedule();
      return;
    }
    void round(lead, peer);
  }

  /**
   * 一轮对撞：主角先开口（**走本地对撞表，零成本**），之后逐句交替，
   * 每一句都试着交给模型接力（`replyTo` 内部判断有没有 Key）。
   *
   * 开场句刻意不走模型：整轮的第一句只是「把话头递出去」，
   * 一次模型调用换不来更多东西，而这是每次空闲都要付的固定成本。
   */
  async function round(lead: StageFace, peer: StageFace): Promise<void> {
    if (running) return;
    running = true;
    try {
      let speaker = lead;
      let listener = peer;
      const turns = MIN_TURNS + Math.floor(Math.random() * (MAX_TURNS - MIN_TURNS + 1));
      let previous: { id: string; name: string; line: string } | null = null;

      for (let i = 0; i < turns; i++) {
        if (disposed || !speaker.available()) return;

        let said: string | null = null;
        if (previous) {
          said = await speaker.replyTo(previous);
          if (disposed) return;
        } else {
          const opening = banterLine(speaker.id, listener.id, options.locale());
          said = opening && speaker.show(opening) ? opening : null;
        }
        // 说到一半说不出话（被藏起来 / 在忙）就收场，不硬凑
        if (!said) return;

        previous = { id: speaker.id, name: speaker.name, line: said };
        // 换手：对话的本质是轮流
        [speaker, listener] = [listener, speaker];
        await wait(GAP_MS);
      }
    } finally {
      running = false;
      options.onRoundEnd?.();
      schedule();
    }
  }

  // -------------------------------------------------------- 戳 / 喂 / 提问

  /**
   * 同伴接一句。戳与问都落到这里 —— 区别只在「上一句」是怎么构造的。
   *
   * `running` 期间直接放弃：一轮对撞正说着，插进去会让两条线交替得太碎。
   * 访客的提问**不受影响** —— 那是他自己发起的，舞台会照常回答，
   * 只是同伴的评论被跳过而已。
   */
  function react(speaker: StageFace, listener: StageFace, previous: { id: string; name: string; line: string }): void {
    if (disposed || running) return;
    running = true;
    void (async () => {
      try {
        await wait(REACT_DELAY_MS);
        // 「轮到谁说话」：被接话那只还压着一条客人没读完的回答，就先等它 ——
        // 短句气泡不受影响，所以吐槽仍然是紧接着发生的
        await speaker.whenBubbleFree();
        if (disposed || !listener.available()) return;
        await listener.replyTo(previous);
      } finally {
        running = false;
        options.onRoundEnd?.();
      }
    })();
  }

  function onPoke(speaker: StageFace, line: string): void {
    if (disposed) return;
    schedule();
    const peer = pick(speaker);
    if (!peer) return;
    react(speaker, peer, { id: speaker.id, name: speaker.name, line });
  }

  function onAsk(speaker: StageFace, question: string, answer: string): void {
    if (disposed) return;
    schedule();
    const peer = pick(speaker);
    if (!peer) return;
    // 把「谁问的、它答了什么」压成一句话交过去。做成一句自由文本是刻意的：
    // 「接话」这件事本身就只需要一句上下文，不必给模型一段结构化对话
    const line =
      options.locale() === 'zh'
        ? `访客刚问「${question}」，${speaker.name}说：「${answer}」`
        : `The visitor just asked "${question}", and ${speaker.name} said: "${answer}"`;
    react(speaker, peer, { id: speaker.id, name: speaker.name, line });
  }

  // ------------------------------------------------------------------ 到场

  /**
   * 同伴被召唤到场：它先说一句 `arrive`，另一只接一句。
   *
   * 接话**固定走本地对撞表**：访客刚点完按钮，此刻要的是「立刻有反应」，
   * 而不是等一次模型往返。真想让它们真聊，等下一轮空闲就行。
   */
  function onArrive(arrived: StageFace): void {
    if (disposed) return;
    schedule();
    if (running) return;
    running = true;
    void (async () => {
      try {
        // 让它的登场动画先走起来再说第一句
        await wait(600);
        if (disposed || !arrived.available()) return;
        arrived.say('arrive');

        await wait(GAP_MS);
        if (disposed) return;
        const peer = pick(arrived);
        if (!peer || !peer.available()) return;
        const line = banterLine(peer.id, arrived.id, options.locale());
        if (line) peer.show(line);
      } finally {
        running = false;
        options.onRoundEnd?.();
      }
    })();
  }

  function destroy(): void {
    disposed = true;
    window.clearTimeout(idleTimer);
  }

  schedule();

  return { onIdle, onInteract: schedule, onPoke, onAsk, onArrive, destroy };
}

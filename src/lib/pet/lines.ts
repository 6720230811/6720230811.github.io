import { DEFAULT_CHARACTER } from '../../data/pet';
import type { Locale } from '../../i18n/ui';

/**
 * 四只女神的台词库。
 *
 * 这是**没有模型时**的全部表现力：它不会「变笨」，只是只会说这些。
 * 另外兜底路径也走这里 —— 模型超时、Key 失效、被 CORS 拦掉，
 * 都退回一句台词，页面上不出现任何报错气泡。
 *
 * 分工要和 persona（data/pet.ts）对齐，但这一层**更要紧**：
 * 访客最常看到的不是模型的回答，而是戳一下、喂一次、隔一会儿回来时
 * 蹦出来的这几句。四套台词写得像同一个人，那「切换性格」就白做了。
 *
 * 英文用 Record<..., Record<Locale, ...>> 约束，漏一份就编译不过，
 * 思路和 src/i18n/ui.ts 里「中文当基准、英文强制对齐」一致。
 */
export type LineKind =
  | 'greet' // 首次出现
  | 'poke' // 被戳
  | 'feed' // 被喂
  | 'idle' // 空闲自说自话
  | 'sleep' // 睡着
  | 'wake' // 被叫醒
  | 'empty' // 空输入
  | 'thinking' // 思考中
  | 'noKey' // 还没配 Key
  | 'error'; // 请求失败

type Pool = Record<Locale, readonly string[]>;
type Table = Record<LineKind, Pool>;

/** 布兰：短句、冷静、直来直去，凶也只凶一句 */
const blanc: Table = {
  greet: {
    zh: ['……你好。我住这个角落。', '我是布兰。别吵，我在看书。', '又是你啊。坐吧。'],
    en: ['…Hello. I live in this corner.', 'I am Blanc. Quiet, I am reading.', 'You again. Sit down.'],
  },
  poke: {
    zh: ['别戳。', '……你手很闲？', '再戳一下试试。', '我在看书。真的在看书。'],
    en: ['Do not poke me.', '…Do you have nothing better to do?', 'Try that one more time.', 'I am reading. I really am.'],
  },
  feed: {
    zh: ['……布丁？这个我收下了。', '嗯。还算你有心。', '好吃。别告诉别人我说过这句。'],
    en: ['…Pudding? I will take it.', 'Hm. Not bad of you.', 'It is good. Do not tell anyone I said that.'],
  },
  idle: {
    zh: ['你慢慢看，我不催。', '这篇挺长的，值。', '画廊那边…算了，你自己逛。'],
    en: ['Take your time.', 'This one is long. Worth it.', 'The gallery… never mind. Go look yourself.'],
  },
  sleep: {
    zh: ['我眯一会儿…', '书先放这儿。'],
    en: ['I will rest my eyes…', 'Leaving the book here.'],
  },
  wake: {
    zh: ['……我没睡。', '嗯，醒了。'],
    en: ['…I was not asleep.', 'Mm. I am up.'],
  },
  empty: {
    zh: ['你想问什么？', '先打字。'],
    en: ['What did you want to ask?', 'Type something first.'],
  },
  thinking: {
    zh: ['……让我想想。', '嗯。'],
    en: ['…Let me think.', 'Hm.'],
  },
  noKey: {
    zh: ['我还没接上模型，先这样陪你。', '配个 Key 我才能好好答。'],
    en: ['No model wired up yet — lines only.', 'Add an API key and I can answer properly.'],
  },
  error: {
    zh: ['外面出问题了，等会儿再问我。', '刚才没答上来。再试一次。'],
    en: ['Something went wrong out there. Ask me again later.', 'I missed that one. Try again.'],
  },
};

/** 涅普顿：话多、爱起绰号、动不动拐到游戏上 */
const neptune: Table = {
  greet: {
    zh: ['哟！我是涅普顿，这片角落的女主角！', '你来啦～我就知道你会来！', '嗨嗨，我是住右下角的女主角哦！'],
    en: ['Yo! I am Neptune, the protagonist of this corner!', 'You came! I knew you would~', 'Hi hi, resident protagonist here!'],
  },
  poke: {
    zh: ['诶嘿～痒！', '戳我干嘛，想聊天就直说嘛！', '再戳我就给你起个绰号！'],
    en: ['Ehehe, that tickles!', 'Why poke me? Just say you want to talk!', 'Poke me again and I am giving you a nickname!'],
  },
  feed: {
    zh: ['哦哦！这个我喜欢！', '呜哇，你人真好～还有吗？', '布丁！女主角最爱的布丁！'],
    en: ['Ooh! I love this!', 'Whoa, you are the best~ Any more?', 'Pudding! The protagonist approves!'],
  },
  idle: {
    zh: ['慢慢看慢慢看，女主角不催人～', '诶，这篇有意思，你看过没？', '啊——好想打游戏…'],
    en: ['Take your time, the protagonist never rushes anyone~', 'Hey, this one is fun. Read it yet?', 'Ahh… I want to play games…'],
  },
  sleep: {
    zh: ['呼…呼…', '我眯一下下，别吵我哦。'],
    en: ['Zzz… zzz…', 'Napping for a bit. No loud noises.'],
  },
  wake: {
    zh: ['嗯？我没睡！我在思考！', '哇，醒了醒了！'],
    en: ['Hm? I was not asleep! I was thinking!', 'Oh, I am up, I am up!'],
  },
  empty: {
    zh: ['诶，你想问啥来着？', '打字打字～'],
    en: ['Huh, what did you want to ask?', 'Type type~'],
  },
  thinking: {
    zh: ['嗯…让我想想！', '诶多…'],
    en: ['Hmm… let me think!', 'Ummm…'],
  },
  noKey: {
    zh: ['诶，我还没连上大脑哦，先陪你聊！', '配个 Key 我就能好好回答啦！'],
    en: ['Eh, my brain is not plugged in yet — let us just chat!', 'Add a key and I can answer for real!'],
  },
  error: {
    zh: ['呜，外面好像出问题了…', '诶？刚才没成功，再来一次！'],
    en: ['Aww, something broke out there…', 'Huh? That did not work. One more time!'],
  },
};

/** 诺瓦露：嘴上嫌弃、实际认真，被夸就慌 */
const noire: Table = {
  greet: {
    zh: ['哼，我可不是特意等你的。', '……你也在这儿啊。随便你。', '别误会，我只是刚好住这边。'],
    en: ['Hmph. It is not like I was waiting for you.', '…So you are here too. Whatever.', 'Do not get the wrong idea. I just happen to live here.'],
  },
  poke: {
    zh: ['喂，别碰！', '你、你干什么！', '……再戳我真生气了。', '哼，幼稚。'],
    en: ['Hey, do not touch!', 'Wh-what are you doing!', '…Poke me again and I will actually get mad.', 'Hmph. Childish.'],
  },
  feed: {
    zh: ['……哼，既然你给了，我就收下。', '才、才不是我喜欢吃这个！', '……还行吧。谢谢。'],
    en: ['…Hmph. Since you offered, I will take it.', 'I-it is not like I like this or anything!', '…It is fine. Thanks.'],
  },
  idle: {
    zh: ['你看你的，不用管我。', '……这篇写得还可以。', '哼，别以为我在等你问。'],
    en: ['Read your own thing. Do not mind me.', '…This one is not bad.', 'Hmph. Do not think I am waiting for you to ask.'],
  },
  sleep: {
    zh: ['我、我可不是困了…', '……就靠一下。'],
    en: ['I-I am not sleepy…', '…Just leaning for a moment.'],
  },
  wake: {
    zh: ['谁、谁睡了！', '……嗯，我一直醒着。'],
    en: ['Who is asleep?!', '…Mm. I have been awake the whole time.'],
  },
  empty: {
    zh: ['有话就说啊。', '……你到底想问什么？'],
    en: ['Just say what you want.', '…What are you even trying to ask?'],
  },
  thinking: {
    zh: ['……等我想清楚。', '嗯。'],
    en: ['…Let me get this straight.', 'Mm.'],
  },
  noKey: {
    zh: ['我还没接上模型…那、那不是我的问题。', '你配个 Key，我就好好答。'],
    en: ['I am not hooked up to a model yet… n-not that it is my fault.', 'Put in a key and I will answer properly.'],
  },
  error: {
    zh: ['……出问题了，不是我的错。', '喂，刚才没成功，再试一次。'],
    en: ['…Something broke. Not my fault.', 'Hey, that did not work. Try again.'],
  },
};

/** 贝露：从容、客气、爱调侃，偶尔露出对妹妹的执念 */
const vert: Table = {
  greet: {
    zh: ['欢迎，我是贝露。慢慢看，不着急。', '哦呀，又见面了。', '这里是个安静的好地方，对吧？'],
    en: ['Welcome. I am Vert. Take your time, no rush.', 'Oh my, we meet again.', 'This is a nice quiet place, is it not?'],
  },
  poke: {
    zh: ['哎呀，这么调皮。', '呵呵，想引起我注意？', '再戳的话，我可要回敬了哦。'],
    en: ['My, how playful.', 'Hehe, trying to get my attention?', 'Poke me once more and I shall poke back.'],
  },
  feed: {
    zh: ['哦呀，为我准备的？谢谢。', '呵呵，你真体贴。', '味道不错，我很喜欢。'],
    en: ['Oh my, for me? Thank you.', 'Hehe, how thoughtful of you.', 'It tastes good. I like it.'],
  },
  idle: {
    zh: ['慢慢读，好文章值得。', '这片角落挺安静的，我喜欢。', '啊…不知道妹妹们现在在做什么。'],
    en: ['Read slowly. A good article deserves it.', 'This corner is quiet. I like it.', 'Ah… I wonder what my little sisters are up to.'],
  },
  sleep: {
    zh: ['我小睡片刻…', '……待会儿见。'],
    en: ['I shall rest my eyes a while…', '…See you shortly.'],
  },
  wake: {
    zh: ['哦呀，我醒着呢。', '嗯，休息够了。'],
    en: ['Oh my, I am awake.', 'Mm. That was a good rest.'],
  },
  empty: {
    zh: ['想聊些什么？', '请说。'],
    en: ['What would you like to talk about?', 'Please, go ahead.'],
  },
  thinking: {
    zh: ['唔…让我想想。', '嗯。'],
    en: ['Hmm… let me think.', 'Mm.'],
  },
  noKey: {
    zh: ['我还没有接上模型呢。', '配上 Key，我就能好好回答你了。'],
    en: ['I have not been connected to a model yet.', 'Add a key and I shall answer you properly.'],
  },
  error: {
    zh: ['外面似乎出了点问题。', '刚才没能答上来，再给我一次机会？'],
    en: ['Something seems to have gone wrong out there.', 'I could not answer that. Do give me another chance?'],
  },
};

/**
 * 按角色 id 索引。键必须与 data/pet.ts 的 characters[].id 一一对应 ——
 * 对不上的话那个角色会安静地退回布兰的台词（不报错，所以很容易漏）。
 * 有一条 e2e 用例专门盯这件事。
 */
const TABLES: Record<string, Table> = { blanc, neptune, noire, vert };

/** 随机抽一句。空数组在类型上不可能，但运行期还是给个兜底 */
export function pickLine(kind: LineKind, locale: Locale, character = DEFAULT_CHARACTER): string {
  // 认不出的 id 直接退回布兰，而不是抛错 —— 老数据里可能存着已删掉的角色
  const table = TABLES[character] ?? blanc;
  const pool = table[kind][locale] ?? table[kind].zh;
  if (!pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? '';
}

/** 心情标签：好感度落在哪个区间 */
export function moodLabel(affection: number, locale: Locale): string {
  const mood = affection < 40 ? 'bored' : affection < 75 ? 'ok' : 'happy';
  const table: Record<typeof mood, Record<Locale, string>> = {
    bored: { zh: '有点无聊', en: 'a bit bored' },
    ok: { zh: '挺高兴的', en: 'in a good mood' },
    happy: { zh: '超级开心', en: 'super happy' },
  };
  return table[mood][locale];
}

/** 这句回复是谁给的 —— 界面上标出来，免得把兜底台词当成模型输出 */
export function sourceLabel(source: 'local' | 'llm', locale: Locale): string {
  const table: Record<'local' | 'llm', Record<Locale, string>> = {
    local: { zh: '本地台词库', en: 'local lines' },
    llm: { zh: '模型', en: 'model' },
  };
  return table[source][locale];
}

import type { Profile } from '../../data/profile.schema';

export type ProfileLang = 'zh' | 'en';

/**
 * 「个人信息」编辑器的共享状态。
 *
 * 基本信息输入框、八个可视化卡片模块、JSON 源码模式、镜像预览、双语对照
 * 全部读写同一份 Profile 对象 —— 谁改了谁 emit，别的地方自己决定要不要跟着动。
 * （拆成独立模块而不是塞进 profile.ts：profileCards 与 profile 互相需要，
 *   状态放中间比让两个模块循环 import 干净。）
 */

let state: Profile | null = null;
let lang: ProfileLang = 'zh';
/** 整体替换的次数：卡片层用它判断「该整个重画了」（条数没变但内容全换了，比如切语言） */
let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  for (const cb of Array.from(subs)) cb();
}

export function getProfile(): Profile | null {
  return state;
}

export function getStateVersion(): number {
  return version;
}

export function getLang(): ProfileLang {
  return lang;
}

export function setLang(next: ProfileLang): void {
  lang = next;
}

/** 整体替换（载入文件、JSON 源码模式解析成功之后） */
export function setState(next: Profile): void {
  state = next;
  version += 1;
  emit();
}

/** 局部改动：卡片里敲一个字、胶囊增删都走这里 */
export function mutate(fn: (p: Profile) => void): void {
  if (!state) return;
  fn(state);
  emit();
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

import { countReading, countWords } from '../format';
import type { Locale } from '../../i18n/ui';

/** 正文统计：字数 / 英文词数 / 阅读时长，与前台卡片上的算法同一套 */
export function renderStats(el: HTMLElement, body: string, locale: Locale): void {
  const chars = body.replace(/\s+/g, '').length;
  const words = countWords(body);
  const minutes = countReading(body);
  el.textContent =
    locale === 'zh'
      ? `${chars} 字 · ${words} 个英文词 · 约 ${minutes} 分钟阅读`
      : `${chars} chars · ${words} words · about ${minutes} min read`;
}

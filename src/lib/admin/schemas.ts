/**
 * 按需载入 zod schema。
 *
 * 实测：把 profile.schema 静态引进后台，首包会多出约 79KB（gzip 23KB），
 * 而首包里真正需要它的时候只有三种：保存前校验、JSON 源码模式解析、双语对照。
 * 这三件事都不在首屏路径上，所以改成动态 import —— 首包小 28%，
 * 代价只是这几个入口多一次 await（模块只下载一次，之后走缓存）。
 *
 * 类型仍然静态：用 `typeof import(...)` 取类型，运行时才去拿实现。
 */

export type SchemaModule = typeof import('../../data/profile.schema');

let cache: Promise<SchemaModule> | null = null;

export function loadSchemas(): Promise<SchemaModule> {
  cache ??= import('../../data/profile.schema');
  return cache;
}

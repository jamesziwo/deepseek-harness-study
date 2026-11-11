// 中文：组合 session-query 服务的公开配置和类型化失败。
/** Public configuration and typed failures for the combined session-query service. */

import { HarnessError } from '@deepseek-ai/dsh-llm'

// 中文：原始事件 before/after 窗口的默认最大值。
/** Default maximum `before`/`after` raw-event window. */
export const SESSION_QUERY_READ_WINDOW_MAX = 50

// 中文：一次批量读取中并发持久日志读取的默认上限。
/** Default maximum number of concurrent persisted-log reads in one batch read. */
export const SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY = 4

// 中文：保留供复用的冷准备 Session 观察结果默认上限。
/** Default maximum number of cold prepared-Session observations retained for reuse. */
export const SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE = 5

// 中文：每种 session-query 实现继承的后端无关配置。
/** Backend-independent configuration inherited by every session-query implementation. */
export interface Config {
  // 中文：接受的原始读取上下文单侧最大数量，默认 50。
  /** Maximum accepted raw read context on either side. Defaults to 50. */
  readWindowMax?: number
  // 中文：批量读取中持久日志读取的最大并发数，默认 4。
  /** Maximum concurrent persisted-log reads in one batch read. Defaults to 4. */
  persistedReadConcurrency?: number
  // 中文：按持久修订号保留的冷准备观察缓存上限，默认 5。被活动观察租约固定的条目在释放之前不计入上限。
  /**
   * Maximum cold prepared-Session observations retained for reuse, keyed by
   * durable revision. Entries pinned by active observation leases do not count
   * against this bound until released. Defaults to 5.
   */
  preparedSessionCacheSize?: number
}

// 中文：会话读取、追踪和搜索的稳定机器可路由错误分类。
/** Stable machine-routable failure taxonomy for session reads, traces, and search. */
export type SessionQueryErrorCode =
  | 'SESSION_QUERY_ABORTED'
  | 'SESSION_QUERY_CORRUPT_SESSION'
  | 'SESSION_QUERY_EVENT_NOT_FOUND'
  | 'SESSION_QUERY_INDEX_FAILED'
  | 'SESSION_QUERY_INVALID_CONFIG'
  | 'SESSION_QUERY_INVALID_CURSOR'
  | 'SESSION_QUERY_INVALID_FILTER'
  | 'SESSION_QUERY_INVALID_LIMIT'
  | 'SESSION_QUERY_INVALID_QUERY'
  | 'SESSION_QUERY_INVALID_LINEAGE'
  | 'SESSION_QUERY_INVALID_SURFACE'
  | 'SESSION_QUERY_INVALID_WINDOW'
  | 'SESSION_QUERY_PERSISTENCE_FAILED'
  | 'SESSION_QUERY_SEARCH_DISABLED'
  | 'SESSION_QUERY_SESSION_NOT_FOUND'
  | 'SESSION_QUERY_STALE_CURSOR'
  | 'SESSION_QUERY_SOURCE_CONFLICT'

// 中文：类型化查询失败，code 属于封闭分类中的一个成员。
/** Typed session-query failure whose `code` is one closed taxonomy member. */
export class SessionQueryError extends HarnessError {
  declare readonly code: SessionQueryErrorCode

  // 中文：基类保存值，此构造签名将其开放字符串 code 缩窄为指定类型。
  // The base stores the value; this signature narrows its open string code.
  // oxlint-disable-next-line typescript/no-useless-constructor
  constructor(message: string, code: SessionQueryErrorCode, options?: ErrorOptions) {
    super(message, code, options)
  }
}

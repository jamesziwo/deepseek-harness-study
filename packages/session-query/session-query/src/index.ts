// 中文：组合会话历史读取、追踪、过滤及全文搜索的服务定义。
/**
 * Service Definition for combined session-history reads, traces, filters, and full-text search.
 *
 * @module @deepseek-ai/dsh-session-query
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  Session,
  SessionSeq,
  snapshotSessionEvent,
  type SessionId,
  type SessionSeq as SessionSeqType,
} from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import type {
  SessionEventResultFilter,
  SessionEventSearchPage,
  SessionEventReadRequest,
  SessionEventRecord,
  SessionEventSearchDocument,
  SessionEventSearchRequest,
  SessionEventTraceObservation,
  SessionEventTraceRequest,
  SessionEventWindow,
  SessionLineageTrace,
  SessionLogSnapshot,
  SessionRecord,
  SessionResultFilter,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
  SessionSurfaceSnapshot,
  SessionTitleObservation,
  SessionTitleObservationResult,
} from './types.ts'
import {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
  type Config,
} from './config.ts'
import { SessionCorpus } from './corpus.ts'
import {
  SessionObservationReader,
  type SessionObservation,
  type SessionObservationOptions,
} from './observation.ts'
import { buildSessionEventSearchDocuments } from './documents.ts'
import {
  filterSessionEventDocuments,
  filterSessionResults,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
} from './filters.ts'
import * as tracing from './tracing.ts'

export type * from './types.ts'
export { SessionSearchCursor } from './cursor.ts'
export type { Config, SessionQueryErrorCode } from './config.ts'
export {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
} from './config.ts'
export { readColdSessionLog } from './cold-read.ts'
export type { ColdSessionLog } from './cold-read.ts'
export { extractSessionEventText } from './extraction.ts'
export { buildSessionEventRecords, buildSessionEventSearchDocuments } from './documents.ts'
export {
  compileSessionTextFilter,
  filterSessionEventDocuments,
  filterSessionResults,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
} from './filters.ts'
export { assertSessionHeadersCompatible } from './sources.ts'
export type { SessionObservation, SessionObservationOptions } from './observation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionQuery: SessionQueryEngine
  }
}

// 中文：统一的优先存活数据会话查询服务。精确读取、过滤和追踪是与后端无关的具体行为；后端在同一 ctx.sessionQuery 上实现全文观察、协调、排名、游标代次及查询
// 执行。
/**
 * Unified live-preferred session query service.
 *
 * Exact reads, filters, and traces are backend-independent concrete behavior.
 * A backend implements full-text observation, reconciliation, ranking, cursor
 * generations, and query execution on the same `ctx.sessionQuery` service.
 */
export abstract class SessionQueryEngine extends Service {
  static inject = ['sessions']

  private readonly _readWindowMax: number
  private readonly _corpus: SessionCorpus
  private readonly _observations: SessionObservationReader

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionQuery')
    this._readWindowMax = config.readWindowMax ?? SESSION_QUERY_READ_WINDOW_MAX
    if (!Number.isInteger(this._readWindowMax) || this._readWindowMax < 0) {
      throw new SessionQueryError(
        'session-query: readWindowMax must be a non-negative integer',
        'SESSION_QUERY_INVALID_CONFIG',
      )
    }
    const persistedReadConcurrency = config.persistedReadConcurrency
      ?? SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY
    if (!Number.isSafeInteger(persistedReadConcurrency) || persistedReadConcurrency < 1) {
      throw new SessionQueryError(
        'session-query: persistedReadConcurrency must be a positive safe integer',
        'SESSION_QUERY_INVALID_CONFIG',
      )
    }
    const preparedSessionCacheSize = config.preparedSessionCacheSize
      ?? SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE
    if (!Number.isSafeInteger(preparedSessionCacheSize) || preparedSessionCacheSize < 1) {
      throw new SessionQueryError(
        'session-query: preparedSessionCacheSize must be a positive safe integer',
        'SESSION_QUERY_INVALID_CONFIG',
      )
    }
    this._corpus = new SessionCorpus(ctx, persistedReadConcurrency)
    this._observations = new SessionObservationReader(ctx, preparedSessionCacheSize)
  }

  // 中文：无需持久化列表预检，直接观察精确的存活或已准备 Session。sessionId 为逻辑身份，options 指定取消和投影选择；返回调用方拥有的观察租约。
  /**
   * Observe one exact live or prepared Session without a persistence listing preflight.
   * @param sessionId - logical Session identity.
   * @param options - cancellation and projection selection for this read.
   * @returns a caller-owned observation lease.
   */
  observeSession(
    sessionId: SessionId,
    options: SessionObservationOptions = {},
  ): Promise<SessionObservation> {
    return this._observations.read(sessionId, options)
  }

  // 中文：搜索优先存活数据的逻辑语料并按会话分组。request 含查询文本、元数据过滤、页大小和游标；exec 为可选取消控制；按最强匹配事件对会话命中排序。
  /**
   * Search the live-preferred logical corpus and group by session.
   * @param request - query text, metadata filters, page size, and cursor.
   * @param exec - optional cancellation control.
   * @returns session hits ranked by their strongest matching event.
   */
  abstract searchSessions(
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>>

  // 中文：在一个优先存活数据的逻辑会话中搜索事件。request 含目标、文本、过滤、页大小及游标，exec 为可选取消；返回同一索引代次中的事件命中及目标文件头。
  /**
   * Search events within one live-preferred logical session.
   * @param request - target session, query text, filters, page size, and cursor.
   * @param exec - optional cancellation control.
   * @returns matching event hits and their target header from one indexed generation.
   */
  abstract searchEvents(
    request: SessionEventSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionEventSearchPage>

  // 中文：使用优先存活记录列出完整逻辑语料。signal 可取消持久化枚举；返回克隆记录，按确定性的最新优先顺序排列。
  /**
   * List the complete logical corpus using live-preferred records.
   * @param signal - optional cancellation for persistence listing.
   * @returns deterministic newest-first cloned session records.
   */
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    return this._corpus.listSessions(signal)
  }

  // 中文：读取并重放校验完整逻辑会话日志，不将其变成存活会话。sessionId 可存活或已持久化；返回同次观察的克隆文件头及完整原始日志。持久化、头兼容性或重放校验失败时抛
  // 错。
  /**
   * Read and replay-validate one complete logical session log without making it live.
   * @param sessionId - live or persisted session id to read.
   * @returns cloned header and complete raw event log from one observation.
   * @throws when persistence, header compatibility, or replay validation fails.
   */
  async readSession(sessionId: SessionId): Promise<SessionLogSnapshot> {
    const loaded = await this._corpus.load(sessionId)
    Session.create(
      sessionId,
      loaded.events,
      loaded.header,
      loaded.inheritedEventCount,
    )
    return {
      session: structuredClone(loaded.header),
      inheritedEventCount: loaded.inheritedEventCount,
      events: loaded.events.map(snapshotSessionEvent),
    }
  }

  // 中文：使用与提供方无关的谓词过滤完整逻辑语料。filters 的会话元数据及可用性条件取 AND；signal 可取消持久化枚举；返回匹配克隆记录，确定性最新优先排序。
  /**
   * Filter the complete logical corpus with provider-independent predicates.
   * @param filters - ANDed session metadata and availability clauses.
   * @param signal - optional cancellation for persistence listing.
   * @returns matching cloned records in deterministic newest-first order.
   */
  async filterSessions(
    filters: readonly SessionResultFilter[],
    signal?: AbortSignal,
  ): Promise<SessionRecord[]> {
    const ownedFilters = materializeSessionResultFilters(filters)
    return this._filterSessions(ownedFilters, signal)
  }

  // 中文：从优先存活的逻辑会话日志折叠最新标题。sessionId 可存活或已存储，signal 取消来源解析与标题折叠；返回最新标题快照，无标题事件则 undefined。
  /**
   * Fold the latest log-backed title from one live-preferred logical session.
   * @param sessionId - live or persisted session id to read.
   * @param signal - optional cancellation for source resolution and title folding.
   * @returns latest title snapshot, or `undefined` when the log has no title event.
   */
  async readTitle(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionTitleSnapshot | undefined> {
    return (await this.readTitleSnapshot(sessionId, signal)).title
  }

  // 中文：从一次语料观察折叠最新标题并返回来源文件头。sessionId 为目标，signal 可取消解析与折叠；返回克隆来源头及可选最新标题。
  /**
   * Fold the latest title and return its source header from one corpus observation.
   * @param sessionId - live or persisted session id to read.
   * @param signal - optional cancellation for source resolution and title folding.
   * @returns cloned source header and optional latest title snapshot.
   */
  async readTitleSnapshot(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionTitleObservation> {
    const result = (await this.readTitleSnapshots([sessionId], signal))[0] as SessionTitleObservationResult
    if (result.status === 'rejected') throw result.reason
    return result.value
  }

  // 中文：从一次可取消语料观察为去重会话折叠标题，结果保持输入首次出现顺序。操作失败按会话隔离，取消则拒绝整个操作。sessionIds 为待观察 ID，signal 由所有
  // 读取共享；每个唯一 ID 返回 fulfilled 或 rejected 结果。
  /**
   * Fold titles for unique sessions from one cancellable corpus observation.
   *
   * Results preserve first-occurrence input order. Operational failures stay
   * isolated per session, while cancellation rejects the complete operation.
   * @param sessionIds - live or persisted session ids to observe.
   * @param signal - optional cancellation shared by all source reads.
   * @returns one fulfilled or rejected result per unique requested id.
   */
  async readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<SessionTitleObservationResult[]> {
    return this._corpus.projectMany(sessionIds, (source): SessionTitleObservation => {
      const title = foldSessionTitle(source.events)
      return {
        session: structuredClone(source.header),
        ...title === undefined ? {} : { title },
      }
    }, signal)
  }

  // 中文：列出逻辑会话的轻量原始日志事件记录。sessionId 优先取存活来源；记录按 seq 升序返回。
  /**
   * List lightweight raw-log event records for one logical session.
   * @param sessionId - live-preferred session id to read.
   * @returns event records in ascending seq order.
   */
  async listEvents(sessionId: SessionId): Promise<SessionEventRecord[]> {
    const loaded = await this._corpus.load(sessionId)
    return tracing.eventRecords(sessionId, loaded.events)
  }

  // 中文：用与提供方无关的过滤条件扫描第一方语义事件文档。sessionId 优先取存活来源，filters 为 AND 组合的元数据及字面文本条件；返回按 seq 升序的匹
  // 配文档。
  /**
   * Scan first-party semantic event documents with provider-independent filters.
   * @param sessionId - live-preferred session id to scan.
   * @param filters - ANDed metadata and literal-text predicates.
   * @returns matching semantic documents in ascending seq order.
   */
  async filterEvents(
    sessionId: SessionId,
    filters: readonly SessionEventResultFilter[],
  ): Promise<SessionEventSearchDocument[]> {
    const ownedFilters = materializeSessionEventResultFilters(filters)
    return this._filterEvents(sessionId, ownedFilters)
  }

  private async _filterSessions(
    filters: readonly SessionResultFilter[],
    signal?: AbortSignal,
  ): Promise<SessionRecord[]> {
    return filterSessionResults(await this._corpus.listSessions(signal), filters)
  }

  private async _filterEvents(
    sessionId: SessionId,
    filters: readonly SessionEventResultFilter[],
  ): Promise<SessionEventSearchDocument[]> {
    const loaded = await this._corpus.load(sessionId)
    const documents = buildSessionEventSearchDocuments(sessionId, loaded.events)
    return filterSessionEventDocuments(documents, filters)
  }

  // 中文：从一次语料观察读取会话当前完整模型可见内容。sessionId 优先取存活来源；返回克隆头、当前可见内容及原始日志捕获包含的末 seq。来源解析失败或可见内容无效时
  // 抛错。
  /**
   * Read one session's complete current model surface from one corpus observation.
   * @param sessionId - live-preferred session id to read.
   * @returns cloned header, current surface, and the last sequence number included in the raw-log capture.
   * @throws when source resolution fails or the session surface is invalid.
   */
  async readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot> {
    const loaded = await this._corpus.load(sessionId)
    return {
      session: structuredClone(loaded.header),
      inheritedEventCount: loaded.inheritedEventCount,
      capturedThroughSeq: loaded.events.at(-1)?.seq ?? null,
      events: tracing.currentSurfaceEvents(sessionId, loaded.events),
    }
  }

  // 中文：从一次语料观察追踪已知祖先和后代。sessionId 为目标，signal 可取消持久化枚举；返回完整血缘或首个无法解析的父节点。语料解析失败、目标缺失或已知祖先成
  // 环时抛错。
  /**
   * Trace known ancestry and descendants from one corpus observation.
   * @param sessionId - logical session id to trace.
   * @param signal - optional cancellation for persistence listing.
   * @returns a complete lineage or the first parent that could not be resolved.
   * @throws when corpus resolution fails, the target is absent, or its known ancestry cycles.
   */
  async traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace> {
    const records = await this._corpus.listSessions(signal)
    signal?.throwIfAborted()
    return tracing.traceSession(records, sessionId)
  }

  // 中文：追踪事件的直接位置替换及引用来源事件。request 含会话 ID 和 seq，signal 可取消持久来源解析；返回来源头、直接链接及目标位置替换链。解析失败、目
  // 标缺失或内容／来源校验失败时抛错。
  /**
   * Trace one event's direct positional replacements and cited source events.
   * @param request - target session id and event seq.
   * @param signal - optional cancellation for persisted source resolution.
   * @returns source header, direct links, and the target's positional replacement chain.
   * @throws when source resolution fails, the target is absent, or surface/source-event validation fails.
   */
  async traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation> {
    const loaded = await this._corpus.load(request.sessionId, signal)
    signal?.throwIfAborted()
    return {
      session: loaded.header,
      ...tracing.traceEvent(request.sessionId, loaded.events, request.seq),
    }
  }

  // 中文：读取完整事件及有界原始日志上下文窗口。request 含目标会话、seq 及窗口大小，signal 可取消持久来源解析；返回克隆目标及邻近事件。
  /**
   * Read one full event plus a bounded raw-log context window.
   * @param request - target session/seq and context sizes.
   * @param signal - optional cancellation for persisted source resolution.
   * @returns cloned target and neighboring events.
   */
  async readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow> {
    const before = this._readWindow('before', request.before)
    const after = this._readWindow('after', request.after)
    const sessionId = request.sessionId
    const seq = request.seq
    return this._readEvent(sessionId, seq, before, after, signal)
  }

  private async _readEvent(
    sessionId: SessionId,
    seq: SessionSeqType,
    before: number,
    after: number,
    signal?: AbortSignal,
  ): Promise<SessionEventWindow> {
    const loaded = await this._corpus.load(sessionId, signal)
    signal?.throwIfAborted()
    const target = loaded.events[seq]
    if (target === undefined || target.seq !== seq) {
      throw new SessionQueryError(
        `session "${sessionId}" has no event at seq ${seq}`,
        'SESSION_QUERY_EVENT_NOT_FOUND',
      )
    }
    const startSeq = SessionSeq(Math.max(0, seq - before))
    const endSeq = SessionSeq(Math.min(loaded.events.length - 1, seq + after))
    const targetSnapshot = snapshotSessionEvent(target)
    const events = loaded.events.slice(startSeq, endSeq + 1)
      .map(event => event === target
        ? targetSnapshot
        : snapshotSessionEvent(event))
    return {
      session: structuredClone(loaded.header),
      inheritedEventCount: loaded.inheritedEventCount,
      target: targetSnapshot,
      events,
      startSeq,
      endSeq,
    }
  }

  private _readWindow(name: 'before' | 'after', value: number | undefined): number {
    if (value === undefined) return 0
    if (!Number.isInteger(value) || value < 0 || value > this._readWindowMax) {
      throw new SessionQueryError(
        `${name} must be an integer between 0 and ${this._readWindowMax}`,
        'SESSION_QUERY_INVALID_WINDOW',
      )
    }
    return value
  }
}

export default SessionQueryEngine

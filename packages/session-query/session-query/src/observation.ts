// 中文：供 Session 页面和生命周期消费者共享的存活／准备观察结果。
/** Shared live/prepared observations for Session page and lifecycle consumers. */

import type { Context } from '@deepseek-ai/cordis'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId , SessionLogOffset as SessionLogOffsetType , SessionSeqCursor } from '@deepseek-ai/dsh-session'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionPersistenceRevision,
  SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE, SessionQueryError } from './config.ts'
import { readColdSessionLog, type ColdSessionLog } from './cold-read.ts'

// 中文：为调用方读取生命周期保留的精确不可变 Session 截面。
/** One exact immutable Session cut retained for the caller's read lifetime. */
export interface SessionObservation extends Disposable {
  // 中文：截面来自已附接 Session 还是保留的准备结果。
  /** Whether the cut came from an attached Session or a retained preparation. */
  readonly source: 'live' | 'prepared'
  // 中文：不可变的 Session 身份元数据。
  /** Immutable Session identity metadata. */
  readonly header: SessionHeader
  // 中文：与 header 配对的精确分叉继承事件数。
  /** Exact fork-inherited event count paired with {@link header}. */
  readonly inheritedEventCount: SessionLogOffsetType
  // 中文：cursor 位置的不可变连续事件。存活观察首次读取时才实体化数组；只读头、游标或投影的消费者不会复制日志。
  /**
   * Immutable contiguous events at {@link cursor}. A live observation
   * materializes this array on first read, so a consumer that reads only the
   * header, cursor, or projections never copies the log.
   */
  readonly events: readonly SessionEvent[]
  // 中文：最后观察到的事件 seq，空日志为 -1。
  /** Last observed event seq, or -1 for an empty log. */
  readonly cursor: SessionSeqCursor
  // 中文：冷准备观察的持久来源修订号。
  /** Durable source revision for a cold prepared observation. */
  readonly revision?: SessionPersistenceRevision
  // 中文：投影注册表已挂载时，cursor 位置的精确投影基线。
  /** Exact projection baseline at {@link cursor}, when the registry is mounted. */
  readonly projections?: ProjectionSnapshot
  // 中文：为另一宿主所有者保留同一个不可变截面，返回可独立释放的观察租约。
  /**
   * Retain the same immutable cut for another Host owner.
   * @returns an independently disposable lease over this observation.
   */
  retain(): SessionObservation
}

// 中文：精确观察所需的投影工作和取消控制。
/** Projection work and cancellation requested for one exact observation. */
export interface SessionObservationOptions {
  // 中文：解析冷来源时的可选取消信号。
  /** Optional cancellation while resolving a cold source. */
  readonly signal?: AbortSignal
  // 中文：是否计算所有投影，或完全不触碰投影状态。
  /** Whether to compute every projection or leave projection state untouched. */
  readonly projectionMode?: 'all' | 'none'
}

// 中文：可复用冷观察：未发布的恢复 Session 及其代表的精确平衡日志，只在生成它的持久化实例仍报告相同修订时有效。
/**
 * One reusable cold observation: an unpublished restored Session plus the
 * exact balanced log it represents, valid while the producing persistence
 * instance still reports the same revision.
 */
interface PreparedEntry {
  // 中文：stat 产生 revision 的持久化实例；不同实例修订号不可比较。
  /** The persistence instance whose `stat` produced {@link revision}; revisions from another instance are incomparable. */
  readonly persistence: SessionPersistence
  // 中文：读取日志紧前由 stat 观察到的持久修订号。
  /** Durable revision observed by `stat` immediately before the log read. */
  readonly revision: SessionPersistenceRevision
  // 中文：从平衡日志恢复的未发布 Session，从未加入存储。
  /** Unpublished Session restored from the balanced log; never entered into the store. */
  readonly session: Session
  // 中文：不可变平衡日志，包含存储事件和内存中断轮次结束记录。
  /** Immutable balanced log (stored events plus in-memory interrupted-turn closers). */
  readonly events: readonly SessionEvent[]
  // 中文：活动观察租约计数；refs>0 的固定条目永不淘汰。
  /** Active observation leases; a pinned entry (`refs > 0`) is never evicted. */
  refs: number
}

// 中文：无需语料列表预检即可构建点观察。冷读取按会话 ID 缓存，以持久化实例和读日志前的 stat 修订为键；修订不变时复用恢复 Session，无需重读。缓存有界，超容
// 量淘汰最久未用的未固定条目；活动租约固定条目可跨淘汰和替换继续存活，即使有新修订，租约截面在其生命周期内仍有效。
/**
 * Builds point observations without a corpus listing preflight.
 *
 * Cold reads are cached per session id, keyed by the persistence instance and
 * the `stat` revision observed before the log read: an unchanged revision
 * reuses the restored Session without re-reading the log. The cache is bounded
 * (least-recently-used unpinned entries are evicted past the capacity), and
 * entries pinned by active leases survive eviction and replacement — a lease's
 * cut stays valid for the lease lifetime even after a newer revision lands.
 */
export class SessionObservationReader {
  private readonly cache = new Map<SessionId, PreparedEntry>()

  // 中文：ctx 带 Session 及可选持久化／投影服务；cacheCapacity 为保留复用的未固定冷观察最大数。
  /**
   * @param ctx - context carrying Session and optional persistence/projection services.
   * @param cacheCapacity - maximum unpinned cold observations retained for reuse.
   */
  constructor(
    private readonly ctx: Context,
    private readonly cacheCapacity: number = SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  ) {}

  // 中文：观察优先存活的 Session，并保留冷准备结果直到释放。sessionId 为逻辑身份，options 包含取消及全算或全不算投影选择；返回精确不可变观察。
  /**
   * Observe one live-preferred Session and retain a cold preparation until disposal.
   * @param sessionId - logical Session identity.
   * @param options - cancellation and all-or-none projection computation for this read.
   * @returns one exact immutable observation.
   */
  async read(
    sessionId: SessionId,
    options: SessionObservationOptions = {},
  ): Promise<SessionObservation> {
    const { signal, projectionMode = 'all' } = options
    for (;;) {
      throwIfObservationAborted(signal)
      const live = this.ctx.sessions.get(sessionId)
      if (live !== undefined) return this.live(live, projectionMode)
      const persistence = this.ctx.get('sessionPersistence')
      if (persistence === undefined) throw notFound(sessionId)

      const snapshot = await this.statSource(persistence, sessionId, signal)
      const attachedDuringStat = this.ctx.sessions.get(sessionId)
      if (attachedDuringStat !== undefined) return this.live(attachedDuringStat, projectionMode)
      let entry = this.cachedEntry(persistence, sessionId, snapshot.revision)
      if (entry === undefined) {
        const loaded = await this.loadSource(persistence, sessionId, signal)
        throwIfObservationAborted(signal)
        const attached = this.ctx.sessions.get(sessionId)
        if (attached !== undefined) return this.live(attached, projectionMode)
        // 中文：句柄标记持久事件可接管，合成结束记录归本次读取所有，因此合并种子无需复制。
        // The handle marks persisted events as adoptable; synthetic closers
        // are owned by this read, so the combined seed needs no copy.
        const seed = loaded.events
        let session: Session
        try {
          session = this.ctx.sessions.prepare(sessionId, {
            seed,
            meta: structuredClone(loaded.header),
            inheritedEventCount: loaded.inheritedEventCount,
            eventState: loaded.eventState,
          })
        } catch (error: unknown) {
          // 中文：存储拒绝已有存活所有者的 ID；该所有者是更新来源，应重试存活路径。其他拒绝则说明存储日志未通过恢复校验。
          // The store rejects an id with a live owner: that owner is the
          // fresher source, so retry the live path. Any other rejection means
          // the stored log failed restore validation.
          if (this.ctx.sessions.get(sessionId) !== undefined) continue
          throw new SessionQueryError(
            `stored session "${sessionId}" is corrupt: ${errorMessage(error)}`,
            'SESSION_QUERY_CORRUPT_SESSION',
            { cause: error },
          )
        }
        entry = {
          persistence,
          revision: snapshot.revision,
          session,
          events: Object.freeze(seed),
          refs: 0,
        }
        this.store(sessionId, entry)
      }

      let projections: ProjectionSnapshot | undefined
      try {
        projections = projectionMode === 'none' ? undefined : this.preparedProjections(entry)
      } catch (error: unknown) {
        throw new SessionQueryError(
          `failed to project session "${sessionId}": ${errorMessage(error)}`,
          'SESSION_QUERY_CORRUPT_SESSION',
          { cause: error },
        )
      }
      return this.preparedLease(sessionId, entry, projections)
    }
  }

  // 中文：观察存储快照，把缺失和后端失败映射到查询错误分类。
  /** Observe the stored snapshot, mapping absence and backend failures to the query taxonomy. */
  private async statSource(
    persistence: SessionPersistence,
    sessionId: SessionId,
    signal: AbortSignal | undefined,
  ): Promise<SessionPersistenceSnapshot> {
    let snapshot: SessionPersistenceSnapshot | undefined
    try {
      snapshot = await persistence.stat(sessionId, signal === undefined ? undefined : { signal })
    } catch (error: unknown) {
      throwIfObservationAborted(signal)
      throw mapPersistenceFailure(sessionId, error)
    }
    throwIfObservationAborted(signal)
    if (snapshot === undefined) throw notFound(sessionId)
    if (snapshot.header.id !== sessionId) {
      throw new SessionQueryError(
        `session persistence returned "${snapshot.header.id}" for "${sessionId}"`,
        'SESSION_QUERY_SOURCE_CONFLICT',
      )
    }
    return snapshot
  }

  // 中文：读取完整平衡冷日志，把后端失败映射到查询错误分类。
  /** Read the complete balanced cold log, mapping backend failures to the query taxonomy. */
  private async loadSource(
    persistence: SessionPersistence,
    sessionId: SessionId,
    signal: AbortSignal | undefined,
  ): Promise<ColdSessionLog> {
    try {
      return await readColdSessionLog(persistence, sessionId, signal)
    } catch (error: unknown) {
      throwIfObservationAborted(signal)
      throw mapPersistenceFailure(sessionId, error)
    }
  }

  // 中文：返回仍有效的缓存条目，并标记为最近使用。
  /** Return a still-valid cached entry and mark it most recently used. */
  private cachedEntry(
    persistence: SessionPersistence,
    sessionId: SessionId,
    revision: SessionPersistenceRevision,
  ): PreparedEntry | undefined {
    const cached = this.cache.get(sessionId)
    if (cached === undefined || cached.persistence !== persistence || cached.revision !== revision) {
      return undefined
    }
    this.cache.delete(sessionId)
    this.cache.set(sessionId, cached)
    return cached
  }

  // 中文：插入或替换某 ID 的条目，再淘汰超容量部分。
  /** Insert or replace the entry for one id, then evict past the capacity. */
  private store(sessionId: SessionId, entry: PreparedEntry): void {
    // 中文：替换过期修订只移除映射引用，活动租约通过自身引用继续保留旧条目。
    // Replacing a stale revision only drops the map's reference; live leases
    // keep the old entry alive through their own references.
    this.cache.delete(sessionId)
    this.cache.set(sessionId, entry)
    this.evictPastCapacity(entry)
  }

  // 中文：淘汰最旧未固定条目直至满足容量；存储以及租约释放使条目解除固定时都会执行，避免所有候选曾被固定而永久超预算。keep 为正在存储、即将租用的条目，不淘汰。
  /**
   * Evict oldest unpinned entries until the cache fits its capacity again.
   * Runs on store and whenever a lease release unpins an entry, so leases
   * that pinned every candidate cannot leave the cache over budget for good.
   * @param keep - the entry being stored, about to be leased; never evicted.
   */
  private evictPastCapacity(keep?: PreparedEntry): void {
    if (this.cache.size <= this.cacheCapacity) return
    for (const [id, candidate] of this.cache) {
      if (candidate === keep || candidate.refs > 0) continue
      this.cache.delete(id)
      if (this.cache.size <= this.cacheCapacity) return
    }
  }

  // 中文：为缓存条目构建可释放租约，所有租约释放前一直固定该条目。
  /** Build one disposable lease over a cached entry, pinning it until every lease releases. */
  private preparedLease(
    sessionId: SessionId,
    entry: PreparedEntry,
    projections: ProjectionSnapshot | undefined,
  ): SessionObservation {
    entry.refs += 1
    const lease = (): SessionObservation => {
      let disposed = false
      return {
        source: 'prepared',
        header: entry.session.header,
        inheritedEventCount: entry.session.inheritedEventCount,
        events: entry.events,
        cursor: entry.events.at(-1)?.seq ?? -1,
        revision: entry.revision,
        ...projections === undefined ? {} : { projections },
        retain: () => {
          if (disposed) throw new Error(`session observation "${sessionId}" is disposed`)
          entry.refs += 1
          return lease()
        },
        [Symbol.dispose]: () => {
          if (disposed) return
          disposed = true
          entry.refs -= 1
          if (entry.refs === 0) this.evictPastCapacity()
        },
      }
    }
    return lease()
  }

  private live(
    session: Session,
    projectionMode: NonNullable<SessionObservationOptions['projectionMode']>,
  ): SessionObservation {
    // 中文：截面是当前日志长度。日志只追加，所以无论消费者何时首次读取 events，seq 以下前缀都相同。
    // The cut is the log length now. The log only appends, so the prefix
    // below `seq` is the same array whenever a consumer first reads `events`.
    const seq = session.seq
    let materialized: readonly SessionEvent[] | undefined
    const projections = projectionMode === 'none'
      ? undefined
      : this.ctx.get('sessionProjections')?.snapshot(session)
    const lease = (): SessionObservation => {
      let disposed = false
      return {
        source: 'live',
        header: session.header,
        inheritedEventCount: session.inheritedEventCount,
        get events() {
          // 中文：静态检查例外：读取现有 Session 历史，迁移延后。
          // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
          materialized ??= session.snapshotEvents(SessionLogOffset(0), seq)
          return materialized
        },
        cursor: seq === 0 ? -1 : SessionSeq(seq - 1),
        ...projections === undefined ? {} : { projections },
        retain: () => {
          if (disposed) throw new Error(`session observation "${session.id}" is disposed`)
          return lease()
        },
        [Symbol.dispose]: () => { disposed = true },
      }
    }
    return lease()
  }

  private preparedProjections(entry: PreparedEntry): ProjectionSnapshot | undefined {
    const registry = this.ctx.get('sessionProjections')
    if (registry === undefined) return undefined
    const cache = this.ctx.get('sessionProjectionCache')
    return cache === undefined
      ? registry.hydrate(entry.session, {}, entry.events, SessionLogOffset(0))
      : cache.hydratePrepared(entry.session, entry.events)
  }
}

function throwIfObservationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw new SessionQueryError(
    'session observation was aborted',
    'SESSION_QUERY_ABORTED',
    { cause: signal.reason },
  )
}

function mapPersistenceFailure(sessionId: SessionId, error: unknown): SessionQueryError {
  if (hasErrorName(error, 'SessionPersistenceNotFoundError')) return notFound(sessionId, error)
  if (hasErrorName(error, 'SessionPersistenceCorruptionError')) {
    return new SessionQueryError(
      `stored session "${sessionId}" is corrupt: ${error.message}`,
      'SESSION_QUERY_CORRUPT_SESSION',
      { cause: error },
    )
  }
  return new SessionQueryError(
    `failed to observe session "${sessionId}": ${errorMessage(error)}`,
    'SESSION_QUERY_PERSISTENCE_FAILED',
    { cause: error },
  )
}

function notFound(sessionId: SessionId, cause?: unknown): SessionQueryError {
  return new SessionQueryError(
    `session "${sessionId}" not found`,
    'SESSION_QUERY_SESSION_NOT_FOUND',
    cause === undefined ? undefined : { cause },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

function hasErrorName(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name
}

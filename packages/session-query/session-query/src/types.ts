// 中文：对优先存活的逻辑会话语料执行精确读取和关系追踪的公开记录类型。
/**
 * Public records for exact reads and relationship traces over the
 * live-preferred logical session corpus.
 *
 * @module @deepseek-ai/dsh-session-query/types
 */

import type {
  SessionEvent,
  SessionEventType,
  SessionHeader,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  OptionalSessionSeq,
  SurfaceEvent,
} from '@deepseek-ai/dsh-session'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import type { SessionSearchCursor } from './cursor.ts'

export type { SessionSearchCursor } from './cursor.ts'

// 中文：事件属于当前模型上下文、已替换上下文还是仅原始日志。
/** Whether an event is current model context, replaced context, or raw-log-only. */
export type SessionEventSurface = 'current' | 'shadowed' | 'log-only'

// 中文：逻辑会话的轻量身份与来源可用性。
/** Lightweight identity and source availability for one logical session. */
export interface SessionRecord {
  // 中文：从优先存活语料选取的克隆会话文件头。
  /** Cloned session header selected from the live-preferred corpus. */
  header: SessionHeader
  // 中文：该 ID 当前是否存在于 ctx.sessions。
  /** Whether the id currently exists in `ctx.sessions`. */
  live: boolean
  // 中文：当前持久化后端是否列出该 ID，包括已创建但尚未落地、后端已经观察到的会话。
  /** Whether the active persistence backend currently lists the id, including a created-but-unmaterialized session it already observes. */
  persisted: boolean
}

// 中文：对会话当前模型可见内容的一次原子、优先存活观察。
/** One atomic live-preferred observation of a session's current model surface. */
export interface SessionSurfaceSnapshot {
  // 中文：与 events 来自同一次语料观察的克隆文件头。
  /** Cloned session header selected from the same corpus observation as `events`. */
  session: SessionHeader
  // 中文：被观察日志中分叉继承事件的精确数量。
  /** Exact number of fork-inherited events in the observed log. */
  inheritedEventCount: SessionLogOffset
  // 中文：观察包含的最大原始日志 seq，空日志为 null。
  /** Highest raw-log seq included in the observation, or `null` for an empty log. */
  capturedThroughSeq: OptionalSessionSeq
  // 中文：按模型历史顺序排列的克隆当前可见事件。
  /** Cloned current surface events in model-history order. */
  events: SurfaceEvent[]
}

// 中文：对逻辑会话完整原始日志的一份已校验独立观察。
/** One validated detached observation of a logical session's complete raw log. */
export interface SessionLogSnapshot {
  // 中文：与 events 来自同一次观察的克隆文件头。
  /** Cloned session header selected from the same observation as `events`. */
  session: SessionHeader
  // 中文：被观察日志中分叉继承事件的精确数量。
  /** Exact number of fork-inherited events in the observed log. */
  inheritedEventCount: SessionLogOffset
  // 中文：经内存中断轮次补齐和重放校验后的克隆连续原始事件。
  /** Cloned contiguous raw events after in-memory interrupted-turn balancing and replay validation. */
  events: SessionEvent[]
}

// 中文：逻辑会话中单个事件的轻量元数据。
/** Lightweight metadata for one event within a logical session. */
export interface SessionEventRecord {
  // 中文：拥有事件的会话。
  /** Session that owns the event. */
  sessionId: SessionId
  // 中文：会话内单调事件序号。
  /** Monotonic event seq within the session. */
  seq: SessionSeq
  // 中文：会话事件的判别标签。
  /** Discriminant of the session event. */
  type: SessionEventType
  // 中文：Unix 纪元毫秒事件时间戳。
  /** Event timestamp in Unix epoch milliseconds. */
  time: number
  // 中文：事件在折叠后模型可见内容中的位置分类。
  /** Event placement in the folded session surface. */
  surface: SessionEventSurface
}

// 中文：会话血缘追踪中的递归后代节点。
/** Recursive descendant node in a session-lineage trace. */
export interface SessionLineageNode {
  // 中文：此后代的独立逻辑语料记录。
  /** Detached logical-corpus record for this descendant. */
  session: SessionRecord
  // 中文：直接子节点，各自递归携带后代。
  /** Direct children, each carrying its own recursive descendants. */
  descendants: SessionLineageNode[]
}

// 中文：逻辑会话的已知祖先及后代。
/** Known ancestry and descendants for one logical session. */
export type SessionLineageTrace = {
  // 中文：被追踪会话的独立记录。
  /** Detached record for the session that was traced. */
  target: SessionRecord
  // 中文：从直接父级向外排列的已知父链。
  /** Known parents from the immediate parent outward. */
  ancestors: SessionRecord[]
  // 中文：以目标直接子节点为根的完整已知后代树。
  /** Complete known descendant trees rooted at the target's direct children. */
  descendants: SessionLineageNode[]
} & (
  | {
    // 中文：逻辑语料包含完整父链。
    /** The complete parent chain is present in the logical corpus. */
    complete: true
    // 中文：完整血缘顶端的独立记录。
    /** Detached record at the top of the complete lineage. */
    root: SessionRecord
  }
  | {
    // 中文：父链超出可见逻辑语料。
    /** The parent chain leaves the visible logical corpus. */
    complete: false
    // 中文：逻辑语料中缺失的第一个父 ID。
    /** First parent id that is not present in the logical corpus. */
    unresolvedParentId: SessionId
  }
)

// 中文：查询某事件直接位置替换及引用来源关系的请求。
/** Request for direct surface replacements and relationships to cited source events around one event. */
export interface SessionEventTraceRequest {
  // 中文：拥有目标事件的会话。
  /** Session that owns the target event. */
  sessionId: SessionId
  // 中文：目标事件序号。
  /** Target event seq. */
  seq: SessionSeq
}

// 中文：某事件的直接位置替换及引用来源关系。
/** Direct surface replacements and relationships to cited source events for one event. */
export interface SessionEventTrace {
  // 中文：轻量目标记录。
  /** Lightweight target record. */
  target: SessionEventRecord
  // 中文：目标被遮蔽时的直接位置替换事件。
  /** Immediate positional replacement event, when the target was shadowed. */
  replacedBy?: SessionSeq
  // 中文：从直接替换到最终替换的位置替换链。
  /** Positional replacers from the immediate replacement to the final replacement. */
  replacementChain: SessionSeq[]
  // 中文：目标自身执行替换时直接移除的可见节点。
  /** Surface nodes directly removed when the target itself performed a replacement. */
  replacedEventSeqs: SessionSeq[]
  // 中文：直接引用为来源的先前事件，按记录顺序排列。
  /** Earlier events cited directly as sources, in their recorded order. */
  sourceEventSeqs: SessionSeq[]
  // 中文：直接引用目标为来源的后续事件，按日志顺序排列。
  /** Later events that directly cite the target as a source, in log order. */
  derivedEventSeqs: SessionSeq[]
}

// 中文：绑定同一次会话文件头观察的事件关系。
/** Event relationships bound to the same session-header observation. */
export interface SessionEventTraceObservation extends SessionEventTrace {
  // 中文：与追踪所用事件日志同时选取的克隆文件头。
  /** Cloned header selected with the event log used for the trace. */
  session: SessionHeader
}

// 中文：读取单个事件及其相邻原始日志上下文的请求。
/** Request for one event plus raw neighboring log context. */
export interface SessionEventReadRequest {
  // 中文：拥有目标事件的会话。
  /** Session that owns the target event. */
  sessionId: SessionId
  // 中文：目标事件序号。
  /** Target event seq. */
  seq: SessionSeq
  // 中文：需要包含的前置原始事件数。
  /** Number of preceding raw events to include. */
  before?: number
  // 中文：需要包含的后置原始事件数。
  /** Number of following raw events to include. */
  after?: number
}

// 中文：完整目标事件及有界原始日志窗口。
/** Full target event and a bounded raw-log window. */
export interface SessionEventWindow {
  // 中文：优先存活来源读取的克隆文件头。
  /** Cloned header for the live-preferred source read. */
  session: SessionHeader
  // 中文：观察日志中分叉继承事件的精确数量。
  /** Exact number of fork-inherited events in the observed log. */
  inheritedEventCount: SessionLogOffset
  // 中文：完整克隆目标事件。
  /** Full cloned target event. */
  target: SessionEvent
  // 中文：从 startSeq 到 endSeq 的完整克隆事件。
  /** Full cloned events from `startSeq` through `endSeq`. */
  events: SessionEvent[]
  // 中文：events 中包含的首个 seq。
  /** First seq included in `events`. */
  startSeq: SessionSeq
  // 中文：events 中包含的末个 seq。
  /** Last seq included in `events`. */
  endSeq: SessionSeq
}

// 中文：绑定同一次会话头观察的最新折叠标题。
/** Latest folded title bound to the same session-header observation. */
export interface SessionTitleObservation {
  // 中文：与标题折叠所用日志同时选取的克隆文件头。
  /** Cloned header selected with the event log used for the title fold. */
  session: SessionHeader
  // 中文：最新标题快照，观察日志无标题时缺失。
  /** Latest title snapshot, absent when the observed log has no title. */
  title?: SessionTitleSnapshot
}

// 中文：批量标题观察中的单个有序结果。
/** One ordered result from a batch title observation. */
export type SessionTitleObservationResult =
  | {
    // 中文：请求的会话 ID。
    /** Requested session id. */
    sessionId: SessionId
    // 中文：成功的原子文件头／标题观察。
    /** Successful atomic header/title observation. */
    status: 'fulfilled'
    // 中文：来自同一逻辑来源的文件头及可选最新标题。
    /** Header and optional latest title from one logical source. */
    value: SessionTitleObservation
  }
  | {
    // 中文：请求的会话 ID。
    /** Requested session id. */
    sessionId: SessionId
    // 中文：隔离在此会话内的操作失败。
    /** Operational failure isolated to this session. */
    status: 'rejected'
    // 中文：逻辑来源解析或标题折叠产生的原始失败。
    /** Original failure from logical-source resolution or title folding. */
    reason: unknown
  }

// 中文：时间及序号过滤使用的包含两端数值区间。
/** Inclusive numeric interval used by time and sequence filters. */
export interface SessionResultRange {
  // 中文：包含端点的下界。
  /** Inclusive lower bound. */
  from?: number
  // 中文：包含端点的上界。
  /** Inclusive upper bound. */
  to?: number
}

// 中文：逻辑会话过滤支持的来源可用性谓词。
/** Source availability predicates understood by logical-session filters. */
export type SessionAvailability = 'live' | 'persisted'

// 中文：单个逻辑会话谓词。过滤数组之间取 AND，同一条件内 values 取 OR。
/**
 * One logical-session predicate. A filter array is ANDed; `values` within a
 * clause are ORed.
 */
export type SessionResultFilter =
  | { kind: 'id'; values: readonly SessionId[] }
  | { kind: 'cwd'; values: readonly (string | null)[] }
  | ({ kind: 'created-at' } & SessionResultRange)
  | { kind: 'parent'; values: readonly (SessionId | null)[] }
  | { kind: 'availability'; values: readonly SessionAvailability[] }

// 中文：单个事件谓词。过滤数组取 AND，列表值条件内部取 OR；文本按字面、不区分大小写、灵活空白方式扫描语义文本。
/**
 * One event predicate. A filter array is ANDed; list-valued clauses are ORed.
 * Text is a literal, case-insensitive, whitespace-flexible semantic-text scan.
 */
export type SessionEventResultFilter =
  | ({ kind: 'seq' } & SessionResultRange)
  | ({ kind: 'time' } & SessionResultRange)
  | { kind: 'type'; values: readonly SessionEventType[] }
  | { kind: 'surface'; values: readonly SessionEventSurface[] }
  | { kind: 'text'; text: string }

// 中文：全文提供方在相关性排序前可应用的事件谓词。
/** Event predicates a full-text provider can apply before relevance ranking. */
export type SessionEventMetadataFilter = Exclude<SessionEventResultFilter, { kind: 'text' }>

// 中文：从单个会话事件派生的可搜索语义文档。
/** Searchable semantic document derived from one session event. */
export interface SessionEventSearchDocument extends SessionEventRecord {
  // 中文：扫描过滤和全文索引使用的第一方语义文本。
  /** First-party semantic text used by scan filters and full-text indexes. */
  text: string
}

// 中文：游标分页的一页结果。
/** One cursor-paginated result page. */
export interface SessionSearchPage<T> {
  // 中文：按契约顺序排列的本页结果。
  /** Results for this page in contract-defined order. */
  items: readonly T[]
  // 中文：不透明续页游标，最后一页缺失。
  /** Opaque continuation cursor, absent on the final page. */
  nextCursor?: SessionSearchCursor
}

// 中文：绑定索引目标会话观察的事件搜索结果。
/** Event-search results bound to the indexed target-session observation. */
export interface SessionEventSearchPage extends SessionSearchPage<SessionEventSearchHit> {
  // 中文：与 items 同一索引代次的克隆目标文件头。
  /** Cloned target header from the same indexed generation as `items`. */
  session: SessionHeader
}

// 中文：跨会话和会话内搜索共享的控制项。
/** Controls shared by cross-session and within-session search calls. */
export interface SessionSearchExecContext {
  // 中文：取消调用方等待，并在支持时中断提供方工作。
  /** Abort caller waiting and interrupt provider work where supported. */
  signal?: AbortSignal
}

// 中文：跨会话全文搜索请求。
/** Cross-session full-text search request. */
export interface SessionSearchRequest {
  // 中文：全文查询作为数据解释，绝不作为可执行 FTS 语法。
  /** Full-text query interpreted as data, never executable FTS syntax. */
  query: string
  // 中文：事件排序前应用的逻辑会话谓词。
  /** Logical-session predicates applied before event ranking. */
  sessionFilters?: readonly SessionResultFilter[]
  // 中文：事件排序前应用的事件谓词。
  /** Event predicates applied before event ranking. */
  eventFilters?: readonly SessionEventMetadataFilter[]
  // 中文：本页最大会话数。
  /** Maximum sessions in this page. */
  limit?: number
  // 中文：为相同规范化请求返回的不透明游标。
  /** Opaque cursor returned for the identical normalized request. */
  cursor?: SessionSearchCursor
}

// 中文：会话内全文搜索请求。
/** Within-session full-text search request. */
export interface SessionEventSearchRequest {
  // 中文：要搜索其优先存活逻辑日志的会话。
  /** Session whose live-preferred logical log is searched. */
  sessionId: SessionId
  // 中文：全文查询作为数据解释，绝不作为可执行 FTS 语法。
  /** Full-text query interpreted as data, never executable FTS syntax. */
  query: string
  // 中文：排序前应用的事件谓词。
  /** Event predicates applied before ranking. */
  filters?: readonly SessionEventMetadataFilter[]
  // 中文：本页最大事件数。
  /** Maximum events in this page. */
  limit?: number
  // 中文：为相同规范化请求返回的不透明游标。
  /** Opaque cursor returned for the identical normalized request. */
  cursor?: SessionSearchCursor
}

// 中文：带有界纯文本摘要的单个事件全文搜索命中。
/** One event full-text search hit with a bounded plain-text excerpt. */
export interface SessionEventSearchHit extends SessionEventRecord {
  // 中文：围绕匹配位置选择的纯文本片段。
  /** Plain text excerpt selected around the match. */
  snippet: string
}

// 中文：按最强匹配事件排名的跨会话分组命中。
/** One grouped cross-session hit, ranked by its strongest matching event. */
export interface SessionSearchHit extends SessionRecord {
  // 中文：此会话匹配最强的事件。
  /** Strongest matching event for this session. */
  bestMatch: SessionEventSearchHit
}

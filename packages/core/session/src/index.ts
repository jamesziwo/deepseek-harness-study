// 中文：事件溯源会话服务：只追加日志、内存存储及派生的模型消息历史。持久化由插件负责，订阅 session/event，在 session/flush 排空。
/**
 * Event-sourced session service: append-only session log, in-memory store, and
 * the derived LLM message history. Persistence is a plugin concern (subscribe
 * to `session/event`, drain on `session/flush`).
 *
 * @module @deepseek-ai/dsh-session
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever, deepFreeze, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Message } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionLogOffset, SessionSeq } from './types.ts'
import type { TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import type { CreateSessionOptions, EpochHeader, PrepareSessionOptions, RequestContext, SessionEvent, SessionEventMap, SessionEventType, SessionHeader, SessionId, SessionSeedEventState, SurfaceIntent, SurfaceEventType } from './types.ts'
import { deriveEventMessage, SurfaceManager, validateSessionEventData, validateSurfaceMetadata } from './surface.ts'
import type { SessionSurface } from './surface.ts'
import { foldRequestHeader } from './request-header.ts'

export * from './types.ts'
export { SessionPreparation } from './preparation.ts'
export type { SessionPreparationOptions } from './preparation.ts'
export type { AssistantMessage, SystemMessage, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm'
export { interruptedTurnClosers, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from './repair.ts'
export type { SessionSurface, SurfaceFoldReplacement, SurfaceFoldResult } from './surface.ts'
export { deriveEventMessage, foldSurface, isAppendSurfaceEvent, isReplacementSurfaceEvent, isSurfaceEvent, isSurfaceEligibleType } from './surface.ts'
export { canonicalHeader, foldRequestHeader, headerEquals } from './request-header.ts'
export { KNOWN_SESSION_EVENT_TYPES } from './known-event-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: SessionStore
  }

  interface Events {
    // 中文：发布会话时的创建宣告。同步抛错可否决并触发配对释放回滚；分发中请求 detach 会延迟执行。返回 Promise 的拒绝只记日志，不能追溯否决同步边界。按所有者智
    // 能体作用域过滤；session 为刚进入并宣告的会话；不支持作用域静态扫描，模式 emit。
    /**
     * Creation announcement during session publication. A synchronous throw vetoes and rolls
     * back with a paired disposal; detach requested during dispatch is deferred.
     * A returned-promise rejection is logged but cannot retroactively veto this
     * synchronous boundary.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only sessions entered through that agent's context.
     * @param session - the session just entered and announced.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'session/created'(this: Scoped<Session>, session: Session): void
    // 中文：已宣告会话离开存储时恰好发出一次，包括发布回滚；创建宣告从未开始的条目不发出。监听器失败记日志并隔离，复用所有者作用域过滤。session 为已不在存储中存活的会话
    // ；不支持作用域静态扫描，模式 emit。
    /**
     * Emitted once when an announced session leaves the store, including
     * publication rollback, but never for an entry whose creation announcement
     * did not begin. Listener failures are logged and contained.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
     * @param session - the session that is no longer live in the store.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'session/disposed'(this: Scoped<Session>, session: Session): void
    // 中文：提交后无需等待的追加事件流。监听器快照在日志 push 前解析，回调在之后运行；观察器失败记日志并隔离，不使已提交追加失败。按智能体所有者作用域过滤；session
    //  为日志增长的会话，event 与实际记录完全一致；不支持作用域静态扫描，模式 emit。
    /**
     * Post-commit, fire-and-forget append feed. The listener snapshot resolves
     * before the log push, but callbacks run after it; observer failures are
     * logged and contained without making the committed append fail.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only events from sessions entered through that agent's context.
     * @param session - the session whose log grew.
     * @param event - the appended event, exactly as recorded.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
    // 中文：需要等待的并行持久化检查点：所有监听器都运行，调用方等待全部结束，没有 waterfall 否决；复用会话所有者作用域。session 的缓冲事件必须写入持久存储；
    // 不支持作用域静态扫描，模式 parallel。
    /**
     * Awaited parallel durability checkpoint: every listener runs and the
     * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
     * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
     * @param session - the session whose buffered events must reach durable storage.
     * @dshScopeScan unsupported
     * @mode parallel
     */
    'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    session: TypertLookup<Session, SessionId>
  }
}

// 中文：原地校验并冻结已脱离原引用的创建文件头。
/** Validate and freeze one detached creation header in place. */
function validateSessionHeader(id: SessionId, input: unknown): SessionHeader {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('session header is not a plain JSON record')
  }
  const record = input as Record<string, unknown>
  if (Object.hasOwn(record, 'seedLength')) {
    throw new Error('session header has invalid field "seedLength"')
  }
  if (record.version !== SESSION_FORMAT_VERSION) {
    throw new Error(`session header version must be ${SESSION_FORMAT_VERSION}, got ${String(record.version)}`)
  }
  if (record.id !== id) {
    throw new Error(`session header id "${String(record.id)}" does not match session id "${id}"`)
  }
  if (typeof record.createdAt !== 'number'
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt < 0) {
    throw new Error('session header createdAt must be a non-negative safe integer')
  }
  if (record.cwd !== undefined) {
    if (typeof record.cwd !== 'string') throw new Error('session header cwd must be a string')
    if (!isAbsolute(record.cwd)) {
      throw new Error(`session header cwd must be an absolute path, got "${record.cwd}"`)
    }
  }
  if (record.parentSession !== undefined && typeof record.parentSession !== 'string') {
    throw new Error('session header parentSession must be a string')
  }
  if (typeof record.isSeeded !== 'boolean') {
    throw new Error('session header isSeeded must be a boolean')
  }
  if (record.origin !== undefined && record.origin !== 'subagent') {
    throw new Error('session header origin must be "subagent"')
  }
  if (record.delegationDepth !== undefined
    && (typeof record.delegationDepth !== 'number' || !Number.isSafeInteger(record.delegationDepth) || record.delegationDepth < 0)) {
    throw new Error('session header delegationDepth must be a non-negative safe integer')
  }
  if (record.agentPreset !== undefined && typeof record.agentPreset !== 'string') {
    throw new Error('session header agentPreset must be a string')
  }
  return deepFreeze(record as unknown as SessionHeader)
}

// 中文：原地校验并冻结独占的持久化文件头。
/** Validate and freeze one exclusively owned persistence header in place. */
function validateRestoredSessionHeader(id: SessionId, input: unknown): SessionHeader {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('session header is not a plain JSON record')
    }
  }
  return validateSessionHeader(id, input)
}

// 中文：对会话发布的创建元数据断开引用、校验并冻结。
/** Detach, validate, and freeze the creation metadata published by a session. */
function snapshotSessionHeader(id: SessionId, source?: SessionHeader): SessionHeader {
  const input: unknown = source === undefined
    ? { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: false }
    : source
  const snapshot = snapshotJsonValue(input)
  if (snapshot === undefined) throw new Error('session header is not losslessly JSON-serializable')
  return validateSessionHeader(id, snapshot)
}

// 中文：校验独占事件并深冻结其带身份消息，不复制事件。调用方转移的对象图不得被生产者保留，也不得与其他事件共享可变子对象；不能保证独占时用
// snapshotSessionEvent。event 来自可信边界并独占；返回同一事件及已校验冻结消息。事件局部接口元数据、请求头或消息不变量无效时抛错，不检查历史关系。
/**
 * Validate an exclusively owned event and deeply freeze its identified message
 * without copying the event. The caller transfers an object graph that no
 * producer retains and that shares no mutable children with another event.
 * Use {@link snapshotSessionEvent} when exclusive ownership is not guaranteed.
 * @param event - exclusively owned event imported across a trusted boundary.
 * @returns the same event object with a validated, deeply frozen message.
 * @throws when event-local surface metadata, request-header fields, or message invariants are invalid; history relations are not checked.
 */
export function adoptSessionEvent<T extends SessionEvent>(event: T): T {
  validateSessionEventData(event, `session event at seq ${event.seq}`)
  validateSurfaceMetadata(event)
  assertMessageEventShape(
    event,
    `session event at seq ${event.seq}`,
  )
  switch (event.type) {
    case 'user/message':
      deepFreeze(event.data)
      break
    case 'system/message':
    case 'assistant/message':
    case 'tool/result':
      deepFreeze(event.data.message)
      break
    default:
      // 中文：SessionEventMap 可声明合并扩展，插件自有事件不携带核心消息。
      // SessionEventMap is merge-extensible; plugin-owned events carry no core message.
      break
  }
  return event
}

// 中文：为单个事件断开引用，同时保持其带身份消息深不可变。event 从查询或持久化边界导入；返回独立事件快照及已校验深冻结消息。
/**
 * Detach one event while preserving deep immutability for its identified message.
 * @param event - event imported across a query or persistence boundary.
 * @returns a detached event snapshot with a validated, deeply frozen message.
 */
export function snapshotSessionEvent<T extends SessionEvent>(event: T): T {
  return adoptSessionEvent(structuredClone(event))
}

// 中文：单次 JSON 实体化后校验固定事件封装。
/** Validate the fixed event envelope after one-pass JSON materialization. */
function assertSessionEventEnvelope(value: unknown, index: number): asserts value is SessionEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`seed event at index ${index} has an invalid event envelope`)
  }
  const event = value as Record<string, unknown>
  for (const key in event) {
    switch (key) {
      case 'type':
      case 'seq':
      case 'time':
      case 'data':
      case 'surfaceOp':
      case 'sourceEventSeqs':
      case 'ignorable':
        break
      default:
        throw new Error(`seed event at index ${index} has an invalid event envelope`)
    }
  }
  const type = event['type']
  const seq = event['seq']
  const time = event['time']
  if (typeof type !== 'string'
    || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0 || Object.is(seq, -0)
    || typeof time !== 'number' || !Number.isSafeInteger(time)
    || event['data'] === undefined
    || (event['ignorable'] !== undefined && event['ignorable'] !== true)) {
    throw new Error(`seed event at index ${index} has an invalid event envelope`)
  }
  validateSessionEventData(event as SessionEvent, `seed ${type} at index ${index}`)
  switch (type) {
    case 'request/header':
    case 'system/message':
    case 'user/message':
    case 'assistant/attempt':
    case 'assistant/message':
    case 'tool/result':
      assertCurrentLlmShape(event, index)
      break
  }
}

// 中文：在种子／加载入口拒绝过时请求头和格式错误消息。
/** Reject obsolete request headers and malformed messages at the seed/load boundary. */
function assertCurrentLlmShape(event: Record<string, unknown>, index: number): void {
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  if (event['type'] === 'request/header') {
    const headerRecord = record?.['header'] as Record<string, unknown>
    const config = headerRecord['config']
    if (!hasProviderModel(config)) throw new Error(`seed request/header at index ${index} lacks provider/model`)
    const configRecord = config as Record<string, unknown>
    const reasoningEffort = configRecord['reasoningEffort']
    if (reasoningEffort !== undefined
      && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
      throw new Error(`seed request/header at index ${index} has an invalid reasoningEffort`)
    }
    assertAdapterDefaults(headerRecord['adapterDefaults'], configRecord, index)
    const reason = record?.['reason']
    if (reason !== 'initial' && reason !== 'resume' && reason !== 'change' && reason !== 'series') {
      throw new Error(`seed request/header at index ${index} has an invalid reason`)
    }
    if (record?.['startsSeries'] !== undefined && record['startsSeries'] !== true) {
      throw new Error(`seed request/header at index ${index} has an invalid startsSeries marker`)
    }
  }
  const type = event['type']
  if (type === 'assistant/attempt') {
    assertAssistantSettlementShape(record, type, index)
    return
  }
  if (!isMessageEventType(type)) return
  assertMessageEventShape(event, `seed ${type} at index ${index}`)
  if (type === 'assistant/message') {
    assertAssistantSettlementShape(record, type, index)
  }
}

// 中文：不重放内嵌流，只校验恢复的 Session 生命周期逻辑直接使用的字段。
/** Validate fields used directly by restored Session lifecycle logic without replaying the embedded stream. */
function assertAssistantSettlementShape(
  data: Record<string, unknown> | undefined,
  type: 'assistant/attempt' | 'assistant/message',
  index: number,
): void {
  const turn = data?.['turn']
  const step = data?.['step']
  if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0 || Object.is(turn, -0)
    || typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0 || Object.is(step, -0)
    || !Array.isArray(data?.['stream'])) {
    throw new Error(`seed ${type} at index ${index} has invalid settlement fields`)
  }
}

const allowedAdapterKeys = new Set(['reasoningEffort', 'maxTokens'])

// 中文：校验从持久请求头导入的适配器默认值标记。
/** Validate adapter-default markers imported from a durable request header. */
function assertAdapterDefaults(
  value: unknown,
  config: Record<string, unknown>,
  index: number,
): void {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
  const defaults = value as Record<string, unknown>
  if (Object.keys(defaults).some(key => !allowedAdapterKeys.has(key))
    || Object.values(defaults).some(marker => marker !== true)
    || defaults['reasoningEffort'] === true && config['reasoningEffort'] === undefined
    || defaults['maxTokens'] === true && config['maxTokens'] === undefined) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
}

// 中文：载荷中携带带身份消息的四种模型可见内容事件类型。
/** The four surface event types whose payload carries an identified message. */
function isMessageEventType(type: unknown): type is SurfaceEventType {
  return type === 'system/message' || type === 'user/message'
    || type === 'assistant/message' || type === 'tool/result'
}

const MESSAGE_ROLE_BY_TYPE: Record<SurfaceEventType, Message['role']> = {
  'system/message': 'system',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'user',
}

// 中文：仅校验安全重放消息所需的事件特定不变量。
/** Validate only the event-specific invariants needed to safely replay a message. */
function assertMessageEventShape(event: Record<string, unknown>, subject: string): void {
  const type = event['type']
  if (!isMessageEventType(type)) return
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  const message = type === 'user/message' ? record : record?.['message']
  if (typeof message !== 'object' || message === null
    || typeof (message as Record<string, unknown>)['id'] !== 'string'
    || (message as Record<string, unknown>)['id'] === '') {
    throw new Error(`${subject} lacks an identified message`)
  }
  const messageRecord = message as Record<string, unknown>
  const expectedRole = MESSAGE_ROLE_BY_TYPE[type]
  if (messageRecord['role'] !== expectedRole) {
    throw new Error(`${subject} message must have role "${expectedRole}"`)
  }
  const source = messageRecord['source']
  if (typeof source !== 'object' || source === null
    || typeof (source as Record<string, unknown>)['kind'] !== 'string'
    || (source as Record<string, unknown>)['kind'] === '') {
    throw new Error(`${subject} message has invalid source`)
  }
  if (!Array.isArray(messageRecord['content'])) {
    throw new Error(`${subject} message has invalid content`)
  }
  const sourceRecord = source as Record<string, unknown>
  if (type === 'system/message') {
    if (sourceRecord['kind'] !== 'plugin' || typeof sourceRecord['plugin'] !== 'string'
      || sourceRecord['plugin'] === '') {
      throw new Error(`${subject} message must have plugin source`)
    }
    return
  }
  if (type === 'assistant/message') {
    if (sourceRecord['kind'] !== 'model' || !hasProviderModel(sourceRecord)) {
      throw new Error(`${subject} message must have model source`)
    }
    return
  }
  if (type !== 'tool/result') return
  if (sourceRecord['kind'] !== 'tool'
    || typeof sourceRecord['callId'] !== 'string'
    || sourceRecord['callId'] === '') {
    throw new Error(`${subject} message must have tool source`)
  }
  const content = messageRecord['content'] as unknown[]
  const block = content[0]
  if (content.length !== 1 || typeof block !== 'object' || block === null
    || (block as Record<string, unknown>)['type'] !== 'tool-result'
    || !Array.isArray((block as Record<string, unknown>)['content'])) {
    throw new Error(`${subject} message must contain one tool-result block`)
  }
  if ((block as Record<string, unknown>)['toolCallId'] !== sourceRecord['callId']) {
    throw new Error(`${subject} message has mismatched tool call ids`)
  }
}

// 中文：未知值是否携带当前 provider/model 对。
/** Whether an unknown value carries the current provider/model pair. */
function hasProviderModel(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Record<string, unknown>
  return typeof pair['provider'] === 'string' && pair['provider'].length > 0
    && typeof pair['model'] === 'string' && pair['model'].length > 0
}

type SessionCallback = (...args: unknown[]) => unknown

// 中文：解析一份监听器快照，包括 Cordis 内部分发检查。
/** Resolve one listener snapshot, including Cordis's internal dispatch checks. */
function collectSessionCallbacks(ctx: Context, args: unknown[]): SessionCallback[] {
  return [...ctx.events.dispatch('emit', args)] as SessionCallback[]
}

// 中文：调用已解析的只观察监听器快照，逐监听器隔离失败。
/** Invoke one resolved observe-only listener snapshot with per-listener containment. */
function invokeContainedSessionObservers(
  ctx: Context,
  name: 'session/event' | 'session/disposed',
  id: SessionId,
  args: unknown[],
  callbacks: SessionCallback[],
): void {
  for (const callback of callbacks) {
    try {
      const returned: unknown = callback(...args)
      void Promise.resolve(returned).catch((error: unknown) => {
        ctx.logger.warn(`session "${id}": ${name} listener rejected: ${String(error)}`)
      })
    } catch (error: unknown) {
      ctx.logger.warn(`session "${id}": ${name} listener threw: ${String(error)}`)
    }
  }
}

// 中文：单个精确存储条目的全部可变生命周期状态。
/** All mutable lifecycle state for one exact store entry. */
interface SessionEntry {
  readonly id: SessionId
  readonly session: Session
  readonly carrier: Scoped<Session>
  readonly emitCtx: Context
  announced: boolean
  announcing: boolean
  appending: boolean
  detachRequested: boolean
  detach(): void
}

// 中文：追加路径使用的存储附接，模块私有，保持公开 Session 不依赖存储。
/** Store attachment for the append path; module-private to keep Session store-agnostic publicly. */
const attachments = new WeakMap<Session, SessionEntry>()

// 中文：事件溯源会话，即 SessionEvent 的只追加日志。它是普通类而非 Service，存活实例通过 ctx.sessions.create() 创建，脱离存储的
// 实例通过 create 创建；使用已有日志作为种子可重放或分叉会话。typert 对象类型。
/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
export class Session {
  private log: SessionEvent[] = []
  // 中文：模型可见内容接纳与投影状态的唯一增量维护者。
  /** Single incremental owner of surface acceptance and projection state. */
  private readonly surfaceManager = new SurfaceManager(this.log)

  // 中文：基于会话事件日志的有序模型可见内容。
  /** The ordered surface over this session's event log. */
  get surface(): SessionSurface {
    return this.surfaceManager
  }

  // 中文：脱离原引用且深冻结的创建元数据，包含格式版本、cwd、血缘及是否有分叉历史，由存储通过 ctx.sessions.create() 提供。没有存储文件头时生成带当前
  //  SESSION_FORMAT_VERSION 的最小文件头，确保 header 始终存在。它不进入事件日志，因为属于存储信息，不是可重放对话状态。
  /**
   * Detached, deep-frozen creation metadata (format version, cwd, lineage,
   * and whether fork history exists). Supplied by the store via `ctx.sessions.create()`. When a
   * `Session` is created without a store-owned header, a minimal header is
   * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
   * `session.header` is always present. Kept out of the event log — it is a
   * storage concern, not replayable conversation state.
   */
  readonly header: SessionHeader

  // 中文：从分叉父会话继承的前缀事件数量。
  /** Number of leading events inherited from this Session's fork parent. */
  readonly inheritedEventCount: SessionLogOffset

  // 中文：会话身份，从持久文件头中的唯一副本派生。
  /** The session identity, derived from its durable header's single copy. */
  get id(): SessionId {
    return this.header.id
  }

  // 中文：本进程首次追加的 seq，即构造器种子长度，无种子时为 0。更小 seq 来自重放、分叉或恢复的构造输入，从未经 session/event 发布。此值界定生命周期
  // 所有权及持久化接管；读取完整规范历史仍从 0 开始。它不同于持久分叉前缀 inheritedEventCount：恢复种子为完整已存日志，而继承数仍保持原分叉值。字段本身
  // 不持久化，种子会话以 session/end-seed 事件投影它；存储消费者找最后一个此类事件，不一定在当前 seq，因为已有末尾标记不重复添加。进程内优先读字段，标记
  // 落盘前也准确。若本生命周期追加标记，它占此 seq 且在存储附接前，不发布；否则此 seq 是普通发布写入。
  /**
   * The first seq appended IN THIS PROCESS: the length of the constructor
   * seed (0 without one). Events with smaller seq values entered through
   * construction — replay, fork, or resume — and were never published on the
   * `session/event` firehose (constructor seeds do not emit). This offset marks
   * the constructor-input boundary for lifecycle ownership and persistence
   * adoption; consumers that need complete canonical history still start at
   * seq 0. Distinct from {@link inheritedEventCount}, the DURABLE
   * fork-lineage cut: a resumed session's constructor seed is its full stored
   * log, while the inherited count keeps the original fork value — this field is the
   * in-process construction fact.
   *
   * Not persisted itself: a seeded session projects it into the log as the
   * `session/end-seed` event, which is what a consumer reading STORED history
   * reads. Locate the LAST such event, not necessarily one at this seq — a
   * seed already ending in one is not re-marked, so reopening an untouched
   * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
   * this field in-process: it is exact before the marker reaches storage.
   *
   * When this lifecycle appends the marker, it occupies this seq before the
   * store attaches and therefore does not publish either. Otherwise this seq
   * holds an ordinary published write.
   */
  readonly firstLiveSeq: SessionLogOffset

  // 中文：校验并快照化借用的种子事件与存储元数据，创建脱离存储的会话。id 为身份，seed 为可选重放／分叉事件，header 为可选元数据，
  // inheritedEventCount 为种子文件头的精确继承前缀长度；返回独立会话。
  /**
   * Create a detached session by validating and snapshotting borrowed seed
   * events and storage metadata.
   * @param id - session identity.
   * @param seed - optional borrowed replay or fork events.
   * @param header - optional borrowed storage metadata.
   * @param inheritedEventCount - exact fork-inherited prefix length for a seeded header.
   * @returns a detached session.
   */
  static create(
    id: SessionId,
    seed?: readonly SessionEvent[],
    header?: SessionHeader,
    inheritedEventCount?: SessionLogOffset,
  ): Session {
    return new Session(id, seed, header, 'snapshot', inheritedEventCount)
  }

  // 中文：接管独立拥有或深冻结的种子以恢复脱离存储的会话。不复制／冻结事件，而校验运行所需字段、封装、序号连续性、接口转换及文件头；内嵌助手流保持不透明，直到流消费者或存储校
  // 验器读取。id 为恢复身份，seed 为独占／冻结事件，header 为独占元数据，inheritedEventCount 来自存储，eventState 携带生成种子操
  // 作的引用共享状态；返回恢复会话。
  /**
   * Restore a detached session by adopting an independently owned or deeply frozen seed.
   * Runtime-required event fields, event envelopes, sequence continuity, surface
   * transitions, and header fields are validated without copying or freezing events.
   * Embedded Assistant streams remain opaque until a stream consumer or storage
   * verifier reads them.
   * @param id - restored session identity.
   * @param seed - independently owned or deeply frozen events.
   * @param header - independently owned storage metadata.
   * @param inheritedEventCount - exact fork-inherited prefix length decoded from storage.
   * @param eventState - aliasing state carried from the operation that produced the seed.
   * @returns a restored detached session.
   */
  static fromRestore(
    id: SessionId,
    seed: readonly SessionEvent[],
    header: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    eventState: SessionSeedEventState,
  ): Session {
    return new Session(
      id,
      seed,
      header,
      eventState,
      inheritedEventCount,
    )
  }

  private constructor(
    id: SessionId,
    seed?: readonly SessionEvent[],
    header?: SessionHeader,
    mode: 'snapshot' | SessionSeedEventState = 'snapshot',
    suppliedInheritedEventCount?: SessionLogOffset,
  ) {
    const restoredHeader = mode === 'snapshot' ? undefined : validateRestoredSessionHeader(id, header)
    if (seed !== undefined) {
      // 中文：按与 append 相同的不变量校验种子，避免重放／分叉创建任何后端都无法存储的日志。每个 data 必须可 JSON 序列化，seq 从 0 连续，符合
      // seq=log.length；否则错误会延迟为后端拒绝，或导致内存日志与磁盘悄然偏离。
      // Validate the seed to the SAME invariants `append` enforces, so a
      // replay/fork (`ctx.sessions.create(id, { seed })`) cannot construct a
      // live log that no persistence backend could store: each event's `data`
      // must be JSON-serializable, and `seq` must be contiguous from 0 (the
      // `seq = log.length` contract the whole system relies on). Without this,
      // a bad seed would surface only later as a backend rejection or a silent
      // divergence between the live log and disk.
      for (const [index, source] of seed.entries()) {
        // 中文：种子属于持久化／重放边界，通过一次无损 JSON 遍历校验并分离完整事件。
        // The seed is a persistence/replay boundary: validate and detach the
        // complete event in one lossless-JSON pass.
        const snapshot = mode === 'snapshot' ? snapshotJsonValue(source) : source
        if (snapshot === undefined) {
          throw new Error(`seed event at index ${index} is not losslessly JSON-serializable`)
        }
        assertSessionEventEnvelope(snapshot, index)
        if (snapshot.seq !== index) {
          throw new Error(`seed event at index ${index} has seq ${snapshot.seq} (expected ${index}); seed must be contiguous from 0`)
        }
        // 中文：种子与实时追加和全日志折叠使用同一转换逐步接纳；候选进入 log 前先规划，失败不能部分修改模型可见内容。
        // A seed is accepted incrementally through the same transition as a
        // live append and a full-log fold. The candidate is planned before it
        // enters `log`, so a failure cannot partially mutate the surface.
        try {
          this.surfaceManager.validateNext(snapshot)
        } catch (error: unknown) {
          throw new Error(`invalid seed event at index ${index}: ${error instanceof Error ? error.message : 'invalid surface metadata'}`)
        }
        this.log.push(mode === 'snapshot' ? deepFreeze(snapshot) : snapshot)
      }
    }
    this.firstLiveSeq = SessionLogOffset(this.log.length)
    this.header = restoredHeader ?? snapshotSessionHeader(id, header)
    if (this.header.isSeeded && seed === undefined) {
      throw new Error('seeded session requires an explicit constructor seed')
    }
    if (this.header.isSeeded && suppliedInheritedEventCount === undefined) {
      throw new Error('seeded session requires an inherited event count')
    }
    const inheritedEventCount = SessionLogOffset(suppliedInheritedEventCount ?? 0)
    if (!this.header.isSeeded && inheritedEventCount !== 0) {
      throw new Error('unseeded session inherited event count must be 0')
    }
    if (inheritedEventCount > this.log.length) {
      throw new Error('session inherited event count exceeds its event log')
    }
    if (mode === 'snapshot' && this.header.isSeeded && inheritedEventCount !== this.log.length) {
      throw new Error('seeded session constructor seed must equal its inherited prefix')
    }
    this.inheritedEventCount = inheritedEventCount
    // 中文：新的带种子子会话总在继承切点拥有一个带标签标记，即使复制前缀已以祖先标记结束。恢复保留该持久标记，只追加普通恢复标记。
    // A fresh seeded child always owns one tagged marker at its inherited cut,
    // even when the copied prefix already ends in an ancestor marker. Restore
    // retains that durable marker and appends only the ordinary resume marker.
    if (seed !== undefined && mode === 'snapshot' && this.header.isSeeded) {
      this.append('session/end-seed', { inherited: true })
    } else if (seed !== undefined && this.log.at(-1)?.type !== 'session/end-seed') {
      this.append('session/end-seed', {})
    }
  }

  // 中文：私有只追加日志的缓存不可变完整快照。
  /** Cached immutable full snapshot of the private append-only log. */
  private eventsSnapshot: readonly SessionEvent[] | undefined

  // 中文：返回精确序号处存储的不可变事件；已弃用，现有逻辑可暂缓迁移，但禁止新增调用。seq 为事件序号；不存在时返回 undefined，否则返回已接纳事件。原因见原文链接
  // 。
  /**
   * Return the immutable event stored at one exact sequence number.
   * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
   * See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
   * @param seq - event sequence number.
   * @returns the accepted event, or undefined when the log does not contain it.
   */
  eventAt(seq: SessionSeq): SessionEvent | undefined {
    return this.log[seq]
  }

  // 中文：实体化半开事件序号区间的不可变快照。完整当前快照复用至下次追加，以前返回的快照在后续追加后仍稳定。已弃用，禁止新增调用。fromSeq 为非负包含起点，默认日志开始
  // ；toSeqExclusive 为非负排除终点，默认当前末尾；返回所选深冻结事件的冻结数组。
  /**
   * Materialize an immutable snapshot of a half-open event sequence range.
   * A full current snapshot is reused until the next append; every previously
   * returned snapshot remains stable after later appends.
   * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
   * See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
   * @param fromSeq - non-negative inclusive sequence number; defaults to the log start.
   * @param toSeqExclusive - non-negative exclusive sequence number; defaults to the current end.
   * @returns a frozen array of the selected deeply frozen events.
   */
  snapshotEvents(
    fromSeq: SessionLogOffset = SessionLogOffset(0),
    toSeqExclusive: SessionLogOffset = this.seq,
  ): readonly SessionEvent[] {
    if (fromSeq === 0 && toSeqExclusive === this.log.length) {
      this.eventsSnapshot ??= Object.freeze([...this.log])
      return this.eventsSnapshot
    }
    return Object.freeze(this.log.slice(fromSeq, toSeqExclusive))
  }

  // 中文：返回分叉继承前缀之后本会话自己的事件，按日志顺序放入新数组。已弃用，现有调用可暂缓迁移，禁止新增调用，详见原文链接。
  /**
   * Return this Session's events after its fork-inherited prefix.
   * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
   * See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
   * @returns a fresh array containing child-owned events in log order.
   */
  ownEvents(): readonly SessionEvent[] {
    // 中文：静态检查例外：已弃用读取器委托给已弃用的区间读取。
    // oxlint-disable-next-line typescript/no-deprecated -- Deprecated reader delegates to the deprecated range read.
    return this.snapshotEvents(this.inheritedEventCount)
  }

  // 中文：判断既有事件位置是否在继承前缀之外。seq 为本会话事件位置；事件属于本会话而非父会话时返回 true。
  /**
   * Whether one existing event position is outside the fork-inherited prefix.
   * @param seq - event position in this Session.
   * @returns true when the event belongs to this Session rather than its parent.
   */
  isOwnSeq(seq: SessionSeq): boolean {
    return seq >= this.inheritedEventCount && seq < this.seq
  }

  // 中文：下一个事件序号始终等于日志长度，符合 seq=log.length 连续性契约。
  /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
  get seq(): SessionLogOffset {
    return SessionLogOffset(this.log.length)
  }

  // 中文：向日志追加类型化事件，并通过存储拥有的模块私有发布钩子同步通知观察器。热路径不等待 I/O，持久化插件异步缓冲。事件进入日志即提交，监听器失败逐个记日志并隔离，不改
  // 变返回值或阻止后续监听器。type 为 SessionEventMap 键，data 必须无损 JSON；opts 中 surfaceOp 决定进入有序模型可见内容的方式
  // ，sourceEventSeqs 引用先前来源事件。产出消息的 SurfaceEventType 必填此元数据，turn/start、assistant/attempt
  // 等非接口类型编译期禁止提供；助手消息内嵌原始提供方流，不能引用顶层来源事件。返回日志中的事件，含分配的 seq/time 及 data 快照，不是仍可变的调用方输入。
  // data 或元数据含 BigInt、函数、symbol、undefined、负零、非有限数、循环、稀疏数组或 Map/Set/Date/类实例等特殊对象时抛错；请求头空字
  // 段、工具错误一致性、标记格式和资格、唯一先前来源引用、位置替换及完整遮蔽覆盖规则违规也抛错。单次迭代读取、校验、复制嵌套值，避免有状态 getter 在校验和存储时给出不
  // 同值。错误在追加处暴露，不延迟到后端刷盘；同步内部分发校验失败或接纳／发布期间重入追加也在日志变化前拒绝。
  /**
   * Append one typed event to the log and synchronously notify observers via
   * the store-owned, module-private publication hooks. The hot path never blocks
   * on I/O — persistence plugins buffer asynchronously. Once the event enters
   * the log, the append is committed: observer failures are logged and
   * contained per listener, so they do not change the return value or prevent
   * later listeners from observing the same accepted event.
   *
   * @param type - The event type (key of {@link SessionEventMap}).
   * @param data - The event payload; must be JSON-serializable.
   * @param opts - Surface metadata: `surfaceOp` controls how the event enters
   *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
   *   events this one derives from. REQUIRED for
   *   {@link SurfaceEventType} events (every message-producing event must
   *   declare how it joins the surface, the sole source of derived model
   *   history) and
   *   rejected by the compiler for non-surface types like `turn/start` or
   *   `assistant/attempt`. Assistant messages embed their exact provider
   *   stream and cannot cite top-level source events.
   * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
   *   `data` that entered the log, so reading `event.data` back sees the logged
   *   value, never the caller's still-mutable input.
   * @throws if `data` or surface metadata is not losslessly JSON-serializable
   *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
   *   circular reference, sparse array, or an exotic object such as
   *   Map/Set/Date/class instance), or when the candidate violates the
   *   request-header empty-field or tool-error consistency rules, or the
   *   canonical surface contract (marker shape and eligibility, unique
   *   earlier source-event references, positional replacement validity, and complete
   *   shadowed-node coverage). One iterative pass reads, validates, and
   *   copies each nested value once, so a stateful getter cannot supply one value
   *   to validation and another to storage. The event log is the durable source
   *   of truth, so a bad event fails at the append site rather than later during
   *   a backend flush. A synchronous internal dispatch validation failure or an
   *   append reentered while this acceptance/publication boundary is open also
   *   rejects before the log changes.
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []
  ): SessionEvent<T> {
    const surfaceOpts: SurfaceIntent | undefined = opts[0]
    const surfaceMetadata = {
      ...surfaceOpts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
      ...surfaceOpts?.surfaceOp === undefined ? {} : { surfaceOp: surfaceOpts.surfaceOp },
    }
    const dataSnapshot = snapshotJsonValue(data)
    if (dataSnapshot === undefined) {
      throw new Error(`session event "${type}" carries non-JSON-serializable data`)
    }
    const surfaceMetadataSnapshot = snapshotJsonValue(surfaceMetadata)
    if (surfaceMetadataSnapshot === undefined) {
      throw new Error(`session event "${type}" carries non-JSON-serializable surface metadata`)
    }
    const entry = attachments.get(this)
    if (entry?.appending) {
      throw new Error('session append cannot reenter while another append is being published')
    }
    const event = deepFreeze({
      type,
      seq: SessionSeq(this.log.length),
      time: Date.now(),
      data: dataSnapshot,
      ...(surfaceMetadataSnapshot as { surfaceOp?: unknown; sourceEventSeqs?: unknown }),
    } as unknown as SessionEvent<T>)
    validateSessionEventData(event, `session event "${type}" at seq ${event.seq}`)
    this.surfaceManager.validateNext(event as SessionEvent)

    if (entry !== undefined) entry.appending = true
    try {
      let callbacks: SessionCallback[] | undefined
      const callbackArgs: unknown[] = [this, event]
      if (entry !== undefined) {
        callbacks = collectSessionCallbacks(entry.emitCtx, [entry.carrier, 'session/event', ...callbackArgs])
      }
      this.log.push(event as SessionEvent)
      this.eventsSnapshot = undefined
      if (callbacks !== undefined && entry !== undefined) {
        invokeContainedSessionObservers(entry.emitCtx, 'session/event', entry.id, callbackArgs, callbacks)
      }
      return event
    } finally {
      if (entry !== undefined) {
        entry.appending = false
        if (entry.detachRequested && !entry.announcing) entry.detach()
      }
    }
  }

  // 中文：请求头事件折叠结果的缓存，参见 requestHeader。
  /** Cached fold of the request-header events — see {@link requestHeader}. */
  private headerFold: EpochHeader | undefined
  // 中文：请求头折叠已消费到的日志位置。
  /** Log position (events consumed) the header fold has reached. */
  private headerFoldSeq = 0

  // 中文：日志最后一个请求头事件后生效的 EpochHeader，即下一请求用于比较的请求头；首个 request/header 前为 undefined。这是
  // foldRequestHeader(session.snapshotEvents()) 的实时增量形式，每个请求头事件首次遇到时只折叠一次，逐 step 读取成本为新增事
  // 件数。返回折叠头或 undefined。
  /**
   * The {@link EpochHeader} in force after the log's last header event — the
   * header the NEXT request will be compared against — or undefined before
   * the first `request/header` snapshot. The live, incrementally-maintained
   * form of `foldRequestHeader(session.snapshotEvents())`: each header event is folded
   * once, when first seen, so a per-step read costs O(new events).
   * @returns the folded header, or undefined when no header event exists yet.
   */
  requestHeader(): EpochHeader | undefined {
    if (this.headerFoldSeq < this.log.length) {
      // 中文：更新时冻结：折叠结果是按引用暴露的会话状态，若消费者原地改动而非构建替代值，会使后续比较偏离日志，因此修改会抛错。
      // Frozen on update: the fold is session state exposed by reference — a
      // consumer mutating it in place (instead of building a replacement)
      // would desync every later comparison against the log, so mutation
      // throws instead.
      this.headerFold = deepFreeze(foldRequestHeader(this.log.slice(this.headerFoldSeq), this.headerFold))
      this.headerFoldSeq = this.log.length
    }
    return this.headerFold
  }

  // 中文：request/context 事件的缓存折叠结果。
  /** Cached fold of `request/context` events. */
  private contextFold: RequestContext | undefined
  private contextFoldSeq = 0

  // 中文：返回最新已解析路由元数据；首个 request/context 之前为 undefined。每个事件只折叠一次，返回不可变路由元数据。
  /**
   * Return the latest resolved route metadata, or `undefined` before the first
   * `request/context` event. Each event is folded once.
   * @returns the latest immutable route metadata.
   */
  requestContext(): RequestContext | undefined {
    if (this.contextFoldSeq < this.log.length) {
      for (const event of this.log.slice(this.contextFoldSeq)) {
        if (event.type === 'request/context') this.contextFold = deepFreeze({ ...event.data })
      }
      this.contextFoldSeq = this.log.length
    }
    return this.contextFold
  }

  // 中文：派生消息缓存：冻结的投影，逐个补入尚未处理的节点。
  /** The derived-message cache: frozen projections, extended per unseen node. */
  private derived: Message[] = []
  // 中文：缓存已投影到的模型可见内容节点位置。
  /** Surface position (nodes projected) the cache has reached. */
  private derivedNodes = 0
  // 中文：构建缓存时的 SurfaceManager.replaceGeneration。
  /** {@link SurfaceManager.replaceGeneration} the cache was built under. */
  private derivedGeneration = 0

  // 中文：沿 surfaceOp 标记维护的产出消息事件有序序列派生模型历史。该序列是历史唯一来源：无标记的 chunk、轮次边界不进入历史，压缩 replace 从派生过程
  // 移除被遮蔽节点；逐节点按 deriveEventMessage 投影。每个节点首次遇到时只投影一次，读取成本为新增节点数；replace 改写时重建。每次返回新数组，后续
  // 追加不改变已持有数组；其中 Message 对象共享且深冻结，内容复用冻结事件数据，无需再次深克隆，也不能修改日志。
  /**
   * Derive the LLM message history by walking the ordered sequences of
   * message-producing events maintained by `surfaceOp` markers. The
   * surface is the single source of derived history: every message-producing
   * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
   * turn boundary) is correctly absent, and a compaction `replace` deletes the
   * shadowed nodes from the derivation. The projection rules are
   * {@link deriveEventMessage}, folded per node.
   *
   * CACHED: each surface node is projected exactly once, when first seen — a
   * call costs O(new nodes), and a surface rewrite (a `replace`;
   * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
   * a fresh snapshot per call (later appends never grow an array a caller
   * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
   * Their content reuses the already frozen durable event data, so the cache
   * needs no second deep clone and consumers still cannot mutate the log.
   * @returns a fresh array of the shared, frozen derived history.
   */
  deriveMessages(): Message[] {
    const surface = this.surface
    const nodes = surface.nodes
    const generation = surface.replaceGeneration
    if (generation !== this.derivedGeneration) {
      this.derived = []
      this.derivedNodes = 0
      this.derivedGeneration = generation
    }
    for (const seq of nodes.slice(this.derivedNodes)) {
      // 中文：可见序列由 this.log 构建，seq 按构造保证总是有效索引；非空断言表达此不变量。
      // Surface sequences are built from this.log — seq is always a valid
      // index by construction. The non-null assertion expresses that invariant.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const msg = this.deriveEventMessage(this.log[seq]!)
      // 中文：可见节点属于五种产出消息类型之一，但空内容 assistant/message（例如只有用量的 max-tokens step）派生为 null，不能进入对话记录。
      // A surface node is one of the five message-producing types, but an
      // empty-content assistant/message (a max-tokens step that hosts only
      // usage) derives to null and must not enter the transcript.
      if (msg) this.derived.push(msg)
    }
    this.derivedNodes = nodes.length
    return [...this.derived]
  }

  // 中文：surface.ts 中纯函数 deriveEventMessage 的实例入口。event 为待投影事件；返回派生消息，不产出消息时返回 null。
  /**
   * Instance face of the pure per-node `deriveEventMessage` export from
   * `surface.ts`.
   * @param event - the event to project.
   * @returns the derived message, or null when the event produces none.
   */
  deriveEventMessage(event: SessionEvent): Message | null {
    return deriveEventMessage(event)
  }
}

// 中文：分叉来源，可以是存活会话对象或其存储中的 ID。
/** A fork source: either the live session object or its live store id. */
export type SessionForkSource = Session | SessionId

// 中文：分叉拒绝码：SESSION_NOT_FOUND 表示源 ID 不在实时存储；SESSION_NOT_LIVE 表示对象不是存储中的存活实例；
// SESSION_ALREADY_EXISTS 表示子 ID 被占用；INVALID_BOUNDARY 表示边界不是现有连续 seq；OPEN_TURN 表示前缀结束于未闭
// 合轮次中。
/**
 * Rejection codes for session forking: the fork source id is unknown to the
 * live store (`SESSION_NOT_FOUND`) or names a session object that is not the
 * store's live instance (`SESSION_NOT_LIVE`); the requested child id is
 * already taken (`SESSION_ALREADY_EXISTS`); the boundary is not a contiguous
 * existing seq (`INVALID_BOUNDARY`); or the selected prefix ends inside an
 * open turn (`OPEN_TURN`).
 */
export type SessionForkErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_LIVE'
  | 'SESSION_ALREADY_EXISTS'
  | 'INVALID_BOUNDARY'
  | 'OPEN_TURN'

// 中文：会话分叉拒绝的类型化错误。
/** Typed error for session fork rejections. */
export class SessionForkError extends Error {
  constructor(message: string, public readonly code: SessionForkErrorCode) {
    super(message)
    this.name = 'SessionForkError'
  }
}

// 中文：内存会话存储 ctx.sessions，不在此实现持久化。智能体生命周期为每个已发布会话写句柄附接日志写入器；在该生命周期之外发布的会话不持久化任何内容。
/**
 * In-memory session store (`ctx.sessions`).
 *
 * Persistence is intentionally not implemented here — the agent lifecycle
 * attaches a session-log writer to each published session's write handle;
 * a session published outside that lifecycle persists nothing.
 */
export class SessionStore extends Service {
  private store = new Map<SessionId, SessionEntry>()
  private counter = 0

  constructor(ctx: Context) {
    super(ctx, 'sessions')
    ctx.inject(['typert'], (typeCtx) => {
      typeCtx.typert.lookups.register('session', {
        parameter: 'session',
        wire: 'sessionId',
        hostTypeSymbol: '@deepseek-ai/dsh-session#Session',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: sessionId => this.get(sessionId),
      })
    })
  }

  // 中文：创建由调用 fiber 持有的会话；fiber 释放时停止事件通知并从存储移除。seed 复制事件以重放／分叉；meta 将有效绝对 cwd、种子和父血缘、委托深度
  // 附为不可变 SessionHeader，存储补 version/id/createdAt。若会话须与循环有序释放、先发布循环结束事件，应使用
  // prepare+enter+announce 融入智能体自身 effect，而不用本便利方法。id 省略时生成 session-<n>；options 包含种子／头元数据
  // ；返回已进入并宣告的存活会话。重复 ID、非普通无损 JSON 元数据、无效标量或非绝对 cwd 均抛错。
  /**
   * Create a session owned by the calling fiber: disposing that fiber stops
   * event notification and removes the session from the store. `options.seed`
   * populates the session with a copy of those events (replay/fork);
   * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
   * and parent lineage, and delegation depth) as the immutable
   * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
   *
   * For an agent whose session must be torn down IN ORDER with its loop (so the
   * loop's final events are published before the store attachment ends), do NOT use this
   * — fold the session lifecycle into the agent's own effect via
   * {@link prepare} + {@link enter} + {@link announce} (see
   * `dsh-agent-loop`'s creation transaction).
   *
   * @param id - the session id; omitted, the store mints `session-<n>`.
   * @param options - seed events and/or creation metadata for the header.
   * @returns the live session, already entered and announced.
   * @throws if a session with `id` already exists, metadata is not a plain
   *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
   *   non-absolute path (storage backends key directories off it).
   */
  create(id?: SessionId, options?: CreateSessionOptions): Session {
    const session = this.prepare(id, options)
    // 中文：调用 fiber 拥有一个 effect；宣告前先 yield detach，使 session/created 同步抛错时生成器释放已 yield 的资源，回滚附
    // 接，避免泄漏条目及发布钩子。
    // Single effect owned by the calling fiber. Yield the detach BEFORE
    // announcing so a throwing `session/created` listener rolls the attach back
    // (the generator effect disposes already-yielded disposers on a throw)
    // instead of leaking the store entry and its publication hooks.
    this.ctx.effect(function* (this: SessionStore) {
      yield this.enter(session)
      this.announce(session)
    }.bind(this), 'sessions.create()')
    return session
  }

  // 中文：只构建会话，不加入存储：校验 id/cwd 并构造带不可变头的 Session。配合 enter+announce，将会话与智能体生命周期纳入同一个组合
  // effect，按有序链释放，避免兄弟 effect 竞态提前移除发布钩子、丢失结束事件。id 省略生成 session-<n>；options 含种子／头，带
  // eventState 时种子独占或共享值深冻结，fromRestore 校验后直接接管；返回未入存储的会话。重复 ID、无效普通无损 JSON 元数据、无效标量或非绝对
  // cwd 抛错。
  /**
   * Build a session WITHOUT entering it into the store — validate the id/cwd and
   * construct the {@link Session} (with its immutable {@link SessionHeader}).
   * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
   * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
   * effect so a fiber unload tears the session + agent down as a single ORDERED
   * chain rather than as racing sibling effects — which would remove the publication hooks
   * before the driver's closing events commit, dropping them.
   *
   * @param id - the session id; omitted, the store mints `session-<n>`.
   * @param options - seed events and/or creation metadata for the header. With
   *   `eventState`, every seed event is either independently owned or any
   *   shared value is deeply frozen; {@link Session.fromRestore} validates and
   *   adopts those values without copying or freezing them.
   * @returns the constructed session, NOT yet in the store.
   * @throws if a session with `id` already exists, metadata is not a plain
   *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
   *   non-absolute path.
   */
  prepare(id?: SessionId, options?: PrepareSessionOptions): Session {
    let sessionId: SessionId
    if (id === undefined) {
      do sessionId = brandString<SessionId>(`session-${++this.counter}`)
      while (this.store.has(sessionId))
    } else {
      sessionId = brandString<SessionId>(id)
    }
    if (this.store.has(sessionId)) throw new Error(`session "${sessionId}" already exists`)
    if (options !== undefined) {
      const { eventState } = options
      switch (eventState) {
        case 'detached':
        case 'shared-frozen':
          return Session.fromRestore(
            sessionId,
            options.seed,
            options.meta,
            options.inheritedEventCount,
            eventState,
          )
        case undefined:
          break
        // 中文：覆盖率例外：封闭联合类型的穷尽检查。
        /* v8 ignore next -- closed-union exhaustiveness guard */
        default:
          assertNever(eventState, 'SessionStore.prepare event state')
      }
    }
    const seed = options?.seed
    const meta = options?.meta
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: meta?.createdAt ?? Date.now(),
      ...meta?.cwd === undefined ? {} : { cwd: meta.cwd },
      ...meta?.parentSession === undefined ? {} : { parentSession: meta.parentSession },
      isSeeded: meta?.isSeeded ?? false,
      ...meta?.origin === undefined ? {} : { origin: meta.origin },
      ...meta?.delegationDepth === undefined ? {} : { delegationDepth: meta.delegationDepth },
      ...meta?.agentPreset === undefined ? {} : { agentPreset: meta.agentPreset },
    }
    return Session.create(sessionId, seed, header, options?.inheritedEventCount)
  }

  // 中文：将 prepare 后的会话加入存储，安装私有追加发布钩子并返回移除钩子及条目的 detach 释放器，不发 session/created。调用方先 yield
  // 释放器再 announce，以便创建监听器抛错可回滚。再次检查重复 ID，因为 prepare 与 enter 之间可穿插任意工作，过期准备对象不能覆盖同 ID 存活会话
  // ，否则旧释放器会删除真正会话。session 为尚未入存储的准备对象；同步创建监听器内调用 detach 时，移除和释放延迟到创建分发退出；重复 ID 抛错。
  /**
   * Enter a {@link prepare}d session into the store: install the module-private
   * append publication hooks and add it to the store. Returns the DETACH
   * disposer (hooks + store removal). Does NOT emit `session/created` —
   * the caller yields this disposer inside its effect and THEN calls
   * {@link announce}, so a throwing `session/created` listener rolls the attach
   * back instead of leaking it.
   *
   * Re-checks the id for a duplicate: `prepare` and `enter` are public
   * cross-package primitives and a caller may interleave arbitrary work (or
   * another create) between them, so a stale prepared session must NOT overwrite
   * a live store entry of the same id — its detach disposer would later delete
   * the REAL session. The {@link create} convenience and the agent factory call
   * the two back-to-back so they never trip this, but the public API cannot
   * assume that.
   *
   * @param session - a {@link prepare}d session not yet in the store.
   * @returns the detach disposer (publication hooks + store removal). When called from
   *   a synchronous `session/created` listener, removal and disposal wait until
   *   that creation dispatch unwinds.
   * @throws if a session with this id is already in the store.
   */
  enter(session: Session): () => void {
    const id = session.id
    const carrier = scopeTarget(session, scopeOf(this.ctx))
    // 中文：这是经过任意未发布准备后权威的冲突检查点，只有同 ID 的一个精确事务能发布。
    // This is the authoritative collision boundary after arbitrary unpublished
    // preparation. Only one exact same-id transaction can publish.
    if (this.store.has(id)) throw new Error(`session "${id}" already exists`)
    if (attachments.has(session)) throw new Error(`session "${id}" is already attached to a store`)
    const entry: SessionEntry = {
      id,
      session,
      carrier,
      emitCtx: this.ctx,
      announced: false,
      announcing: false,
      appending: false,
      detachRequested: false,
      detach: () => { this.detachEntered(entry) },
    }
    this.store.set(id, entry)
    attachments.set(session, entry)
    let entered = true
    const detach = (): void => {
      if (!entered) return
      entered = false
      // 中文：生命周期监听器可能持有高级 detach 能力。保持条目和发布钩子存活至同步创建或追加分发退出，再发布配对释放事件。
      // A lifecycle listener may own the advanced detach capability. Keep the
      // entry and its publication hooks live until synchronous creation or append
      // publication unwinds, then publish the paired disposal edge.
      if (entry.announcing || entry.appending) {
        entry.detachRequested = true
        return
      }
      entry.detach()
    }
    return detach
  }

  // 中文：移除精确的已进入会话，若已宣告则发出配对释放。
  /** Remove one exact entered session and emit its paired disposal when announced. */
  private detachEntered(entry: SessionEntry): void {
    entry.detachRequested = false
    // 中文：过期能力不能移除属于后续同 ID 生命周期的观察器或存储。
    // A stale capability cannot remove observers or storage belonging to a
    // later same-id lifecycle.
    // 中文：覆盖率例外：单次 detach 能力存活期间，enter() 拒绝替换。
    /* v8 ignore next -- enter() rejects replacement while this single-shot detach capability is live. */
    if (this.store.get(entry.id) !== entry) return
    this.store.delete(entry.id)
    attachments.delete(entry.session)
    if (entry.announced) this.emitDisposed(entry)
  }

  // 中文：为已 enter 的会话使用当时捕获的上下文载体恰好发出一次 session/created。与 enter 分离，让调用方先 yield detach 以保证回滚
  // 安全。session 为待宣告会话；非存活或已开始宣告时抛错，包括创建监听器重入调用。
  /** Emit `session/created` exactly once for an {@link enter}ed session (with
   * the carrier {@link enter} captured). Separate from {@link enter} so the
   * caller can yield the detach disposer first (rollback safety — see
   * {@link enter}).
   * @param session - the entered session to announce to listeners.
   * @throws if the session is not live or its announcement already began,
   *   including a reentrant call from a creation listener. */
  announce(session: Session): void {
    const entry = this.liveEntryFor(session)
    if (entry.announced || entry.announcing) {
      throw new Error(`session "${entry.id}" was already announced`)
    }
    // 中文：发出前先标记：Cordis 可能投递部分监听器后抛错，回滚仍须给这次部分创建配对释放，也防止监听器递归产生第二个生命周期事件。
    // Mark before emit: Cordis emit may deliver to earlier listeners and then
    // throw. Rollback must still pair that partial creation with disposal, and
    // a listener cannot recursively create a second lifecycle edge.
    entry.announced = true
    const callbackArgs: unknown[] = [session]
    entry.announcing = true
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/created', session])
      for (const callback of callbacks) {
        // 中文：同步异常有意传播并否决发布，已 yield 的 detach 随后发出配对释放。异步函数也可赋给 void 监听器，所以必须观察其返回 Promise；拒绝发生太晚
        // 无法回滚，应记录而非成为未处理拒绝。
        // Synchronous throws intentionally propagate and veto publication; the
        // yielded detach then emits the paired disposal edge. An async function
        // is nevertheless assignable to a void listener, so observe its returned
        // promise: rejection is too late to roll back and must be logged instead
        // of becoming unhandled.
        const returned: unknown = callback(...callbackArgs)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`session "${entry.id}": session/created listener rejected: ${String(error)}`)
        })
      }
    } finally {
      entry.announcing = false
      if (entry.detachRequested && !entry.appending) entry.detach()
    }
  }

  // 中文：发出配对释放通知，逐监听器隔离失败。
  /** Emit the paired teardown notification with per-listener containment. */
  private emitDisposed(entry: SessionEntry): void {
    const callbackArgs: unknown[] = [entry.session]
    try {
      const callbacks = collectSessionCallbacks(this.ctx, [entry.carrier, 'session/disposed', entry.session])
      invokeContainedSessionObservers(this.ctx, 'session/disposed', entry.id, callbackArgs, callbacks)
    } catch (error: unknown) {
      this.ctx.logger.warn(`session "${entry.id}": session/disposed dispatch threw: ${String(error)}`)
    }
  }

  // 中文：使用 enter 时捕获的上下文载体分发并等待 session/flush 持久化检查点。存储是载体所有者，所有调用方——逐请求屏障、目标轮次空闲检查点、释放排空及
  // 存储读取前刷入——都须走此唯一入口，而非直接 ctx.parallel。session 为待持久化缓冲事件的会话；全部监听器成功后返回是否至少有一个参与；全体结束后抛出按
  // 注册顺序首个失败。
  /**
   * Dispatch the awaited `session/flush` durability checkpoint for `session`,
   * with the carrier captured at {@link enter}. THE flush entry point: the
   * store owns the carrier, so callers (the checkpoint policy's per-request
   * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
   * that flush themselves before reading storage) must come through here
   * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
   * one spelling, and the scoped-dispatch invariant can pin it.
   * @param session - the session whose buffered events must reach durable storage.
   * @returns whether at least one durability listener participated, after every
   *   listener has settled successfully.
   * @throws the first registered listener failure after every listener settles.
   */
  async flush(session: Session): Promise<boolean> {
    const { carrier } = this.liveEntryFor(session)
    const callbackArgs: unknown[] = [session]
    const callbacks = collectSessionCallbacks(this.ctx, [carrier, 'session/flush', session])
    const results = await Promise.allSettled(callbacks.map((callback) => {
      try {
        return callback(...callbackArgs)
      } catch (error: unknown) {
        // 中文：保留监听器精确拒绝值；flush 是调用方负责的失败边界，Cordis 监听器可以抛任意值。
        // Preserve the listener's exact rejection value; flush is a caller-owned
        // failure boundary, and Cordis listeners may throw arbitrary values.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        return Promise.reject(error)
      }
    }))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure !== undefined) throw failure.reason
    return callbacks.length > 0
  }

  // 中文：返回精确存活条目，拒绝已脱离或仅准备的对象。
  /** Return the exact live entry; detached/prepared objects reject. */
  private liveEntryFor(session: Session): SessionEntry {
    const entry = attachments.get(session)
    if (entry === undefined || this.store.get(entry.id) !== entry) {
      throw new Error(`session "${session.id}" is not live in this store`)
    }
    return entry
  }

  // 中文：按 id 查找存活会话，找不到返回 undefined。
  /**
   * Look up a live session.
   * @param id - the session id to look up.
   * @returns the session, or undefined when no live session has that id.
   */
  get(id: SessionId): Session | undefined {
    return this.store.get(id)?.session
  }

  // 中文：按创建顺序返回所有存活会话的新数组，修改数组不影响存储。
  /**
   * All live sessions, in creation order.
   * @returns a fresh array; mutating it does not affect the store.
   */
  list(): Session[] {
    return [...this.store.values()].map(entry => entry.session)
  }

  // 中文：从存活源的稳定前缀创建存活子会话。boundary 是包含的源事件 seq，省略取当前末事件；前缀可结束于轮次间事件，但不能在未闭合轮次内结束。source 为存活
  // 对象或 ID；空源且省略 boundary 时创建空子会话；childSessionId 可选，省略遵循存储 ID 策略；返回新建存活子会话。
  /**
   * Create a live child session from a stable prefix of a live source.
   * `boundary` is an inclusive source event seq; omitted means the source's
   * current last event. The selected slice may end with a between-turn event
   * but must not end inside an open turn.
   *
   * @param source - Live source session object or id.
   * @param boundary - Inclusive source event seq to fork through; omitted means
   *   the source's current last event, and omitted on an empty source forks an
   *   empty child.
   * @param childSessionId - Optional child session id; omitted delegates to
   *   `SessionStore`'s id policy.
   * @returns The created live child session.
   */
  fork(source: SessionForkSource, boundary?: SessionSeq, childSessionId?: SessionId): Session {
    if (childSessionId !== undefined && this.get(childSessionId) !== undefined) {
      throw new SessionForkError(`session "${childSessionId}" already exists`, 'SESSION_ALREADY_EXISTS')
    }
    const liveSource = this._resolveForkSource(source)
    const seed = this._forkSeed(liveSource, boundary)
    return this.create(childSessionId, {
      seed,
      inheritedEventCount: SessionLogOffset(seed.length),
      meta: {
        ...liveSource.header.cwd !== undefined ? { cwd: liveSource.header.cwd } : {},
        parentSession: liveSource.id,
        isSeeded: true,
      },
    })
  }

  private _forkSeed(session: Session, requestedBoundary: SessionSeq | undefined): readonly SessionEvent[] {
    // 中文：静态检查例外：读取现有 Session 历史，迁移延后。
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const lastEvent = session.snapshotEvents().at(-1)
    let boundary: SessionSeq
    if (requestedBoundary !== undefined) {
      boundary = requestedBoundary
    } else {
      if (lastEvent === undefined) return []
      boundary = lastEvent.seq
    }
    if (!Number.isSafeInteger(boundary) || boundary < 0) {
      throw new SessionForkError(
        `fork boundary for session "${session.id}" must be a non-negative safe integer, got ${String(boundary)}`,
        'INVALID_BOUNDARY',
      )
    }
    if (boundary >= session.seq) {
      const lastSeq = lastEvent?.seq
      throw new SessionForkError(
        `fork boundary ${boundary} does not exist in session "${session.id}" (last seq: ${lastSeq ?? 'none'})`,
        'INVALID_BOUNDARY',
      )
    }

    // 中文：静态检查例外：读取现有 Session 历史，迁移延后。
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const boundaryEvent = session.eventAt(boundary)
    if (boundaryEvent === undefined || boundaryEvent.seq !== boundary) {
      throw new SessionForkError(
        `fork boundary ${boundary} does not match a contiguous event seq in session "${session.id}"`,
        'INVALID_BOUNDARY',
      )
    }
    // 中文：静态检查例外：读取现有 Session 历史，迁移延后。
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = session.snapshotEvents(SessionLogOffset(0), SessionLogOffset(boundary + 1))
    const lastTurnBoundary = events
      .findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
    if (lastTurnBoundary?.type === 'turn/start') {
      throw new SessionForkError(
        `fork boundary ${boundary} in session "${session.id}" ends inside open turn ${lastTurnBoundary.data.turn}`,
        'OPEN_TURN',
      )
    }

    return events
  }

  private _resolveForkSource(source: SessionForkSource): Session {
    if (typeof source === 'string') {
      const session = this.get(source)
      if (session === undefined) throw new SessionForkError(`session "${source}" not found`, 'SESSION_NOT_FOUND')
      return session
    }

    const live = this.get(source.id)
    if (live === undefined) {
      throw new SessionForkError(`session "${source.id}" not found`, 'SESSION_NOT_FOUND')
    }
    if (live !== source) throw new SessionForkError(`session "${source.id}" is not the live store instance`, 'SESSION_NOT_LIVE')
    return source
  }

}

export { decodeSeqRanges, encodeSeqRanges } from './seq-ranges.ts'
export default SessionStore

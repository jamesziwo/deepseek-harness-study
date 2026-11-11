// 中文：具体的 agent-loop 插件：创建作用域隔离的 ReactLoopAgent，经智能体／会话注册表发布，并负责按顺序释放。
/**
 * Concrete agent-loop plugin: creates scoped ReactLoopAgents, publishes them
 * through the agent/session registries, and owns their ordered teardown.
 *
 * @module @deepseek-ai/dsh-agent-loop
 */

import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentFactory,
  AgentHandle,
  AgentOptions,
  AgentSetup,
  CreateAgentOptions,
  ResumeAgentOptions,
  SessionStartSource,
  TurnBoundaryProjection,
} from '@deepseek-ai/dsh-agent'
import { errorChain, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { interruptedTurnClosers, SessionLogOffset, SessionPreparation, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { ReactLoopAgent } from './agent.ts'
import { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from './constants.ts'

// 中文：无法拥有或服务新生命周期的 fiber 状态。
/** Fiber states that cannot own or serve a new lifecycle. */
const INACTIVE_STATES: ReadonlySet<FiberState> = new Set([
  FiberState.UNLOADING,
  FiberState.DISPOSED,
  FiberState.FAILED,
])

const turnBoundaryProjectionSchema: zod.ZodType<TurnBoundaryProjection> = zod.object({
  openTurnStartSeq: zod.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepStartSeq: zod.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepBoundary: zod.object({
    kind: zod.union([zod.literal('start'), zod.literal('end')]),
    seq: zod.number().int().nonnegative().transform(SessionSeq),
  }).nullable(),
  lastTurn: zod.number().int().nonnegative(),
})

// 中文：智能体 turn 和 step 边界的宿主侧投影。
/** Host projection of agent turn and step boundaries. */
export const turnBoundaryProjectionDefinition = {
  key: 'turnBoundary',
  stateVersion: 2,
  stateSchema: turnBoundaryProjectionSchema,
  init: () => ({
    openTurnStartSeq: null,
    lastStepStartSeq: null,
    lastStepBoundary: null,
    lastTurn: 0,
  }),
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        return {
          ...state,
          openTurnStartSeq: event.seq,
          lastTurn: event.data.turn,
        }
      case 'turn/end':
        return {
          ...state,
          openTurnStartSeq: null,
        }
      case 'step/start':
        return {
          ...state,
          lastStepStartSeq: event.seq,
          lastStepBoundary: { kind: 'start', seq: event.seq },
        }
      case 'step/end':
        return {
          ...state,
          lastStepBoundary: { kind: 'end', seq: event.seq },
        }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'turnBoundary', TurnBoundaryProjection>

// 中文：工厂层负责的资源：存活智能体的释放操作及配置启动任务。
/** Factory-level ownership: live agent teardowns plus config startup work. */
class FactoryOwnership {
  private accepting = true
  private readonly teardown = new AbortController()
  private readonly inactive = Promise.withResolvers<void>()
  private readonly liveAgents = new Set<() => Promise<void>>()
  private startupTasks = new Set<Promise<void>>()

  constructor(private readonly fiber: Context['fiber']) {}

  // 中文：工厂开始释放时取消，原因是 agent loop is not active 错误。
  /** Aborts (reason: `agent loop is not active` error) when factory teardown begins. */
  get signal(): AbortSignal {
    return this.teardown.signal
  }

  isActive(): boolean {
    return this.accepting && !INACTIVE_STATES.has(this.fiber.state)
  }

  // 中文：跟踪单个存活智能体的共享释放操作，直到其执行完毕。
  /** Track one live agent's shared teardown until it has run. */
  track(dispose: () => Promise<void>): () => void {
    this.liveAgents.add(dispose)
    return () => { this.liveAgents.delete(dispose) }
  }

  // 中文：纳入智能体创建之前开始的配置启动工作。
  /** Join config startup work that begins before an agent exists. */
  trackStartup(job: Promise<void>): void {
    this.startupTasks.add(job)
    const forget = () => { this.startupTasks.delete(job) }
    void job.then(forget, forget)
  }

  // 中文：纳入一次公开 create/resume 续接操作，工厂 dispose 会等待其结束。
  /** Join one public create/resume continuation; factory dispose awaits its settlement. */
  trackWrapper(job: Promise<unknown>): void {
    this.trackStartup(job.then(() => undefined, () => undefined))
  }

  // 中文：等待 task 完成，或在工厂开始释放时停止等待。
  /** Resolve `task`, or stop waiting when factory teardown begins. */
  async waitWhileActive(job: Promise<void>): Promise<void> {
    await Promise.race([job, this.inactive.promise])
  }

  async dispose(): Promise<void> {
    this.accepting = false
    this.teardown.abort(new Error('agent loop is not active'))
    this.inactive.resolve()
    await Promise.all([
      ...[...this.liveAgents].map(dispose => dispose()),
      ...this.startupTasks,
    ])
  }
}

// 中文：等待 operation；信号取消时立即抛出其取消原因。
/** Await `operation`, or throw the signal's reason as soon as it aborts. */
async function raceAbort<T>(operation: PromiseLike<T> | T, signal: AbortSignal, id: SessionId): Promise<T> {
  const toAbortError = (): Error => signal.reason instanceof Error
    ? signal.reason
    : new Error(`agent "${id}" creation aborted`, { cause: signal.reason })
  if (signal.aborted) throw toAbortError()
  const aborted = Promise.withResolvers<never>()
  const listener = (): void => { aborted.reject(toAbortError()) }
  signal.addEventListener('abort', listener, { once: true })
  try {
    return await Promise.race([Promise.resolve(operation), aborted.promise])
  } finally {
    signal.removeEventListener('abort', listener)
  }
}

// 中文：启动可取消操作，并释放取消之后才到达的结果值。
/** Start an abortable operation and release a value that arrives after cancellation. */
async function raceAbortCall<T>(
  operation: () => PromiseLike<T> | T,
  signal: AbortSignal,
  id: SessionId,
  releaseAbandoned?: (value: T) => void,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error(`agent "${id}" creation aborted`, { cause: signal.reason })
  }
  const pending = Promise.resolve().then(operation)
  try {
    return await raceAbort(pending, signal, id)
  } catch (error: unknown) {
    // 中文：静态检查例外：等待操作期间，信号可能被取消。
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the operation is awaited.
    if (signal.aborted && releaseAbandoned !== undefined) {
      void pending.then(releaseAbandoned, () => undefined)
    }
    throw error
  }
}

// 中文：在负责配置的入口解析整个部署的调度并发上限。
/** Resolve the deployment-wide scheduler cap at the owning config boundary. */
function resolveMaxParallelToolCalls(value: number | undefined): number {
  const maxParallelToolCalls = value ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS
  if (!Number.isInteger(maxParallelToolCalls) || maxParallelToolCalls < 1) {
    throw new Error('maxParallelToolCalls must be a positive integer')
  }
  return maxParallelToolCalls
}

// 中文：拒绝无法在请求传输格式中精确表示的输出 token 上限。
/** Reject an output-token cap that cannot be represented exactly on the request wire. */
function assertAgentOptions(options: AgentOptions): void {
  if (options.maxTokens !== undefined
    && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) {
    throw new TypeError('agent maxTokens must be a positive safe integer')
  }
}

// 中文：单个会话持有的写入句柄，以及已通过该句柄存储的事件数量。
/** One session's owned write handle plus the count of events already stored through it. */
interface StoredSession {
  readonly handle: SessionHandle
  storedCount: number
}

// 中文：已经准备但尚未发布的智能体资源，共享一个缓存结果的释放操作。
/** Prepared-but-unpublished agent resources sharing one memoized teardown. */
interface PreparedAgent {
  agent: ReactLoopAgent
  // 中文：工厂卸载、调用方取消或开始释放时取消，终止准备阶段的等待。
  /** Aborts when the factory unloads, the caller cancels, or teardown begins — ends any setup await. */
  signal: AbortSignal
  // 中文：加入注册表、宣告发布、通知会话开始，然后启动状态机。
  /** Enter registries, announce, notify session-start, and start the machine. */
  publish(source: SessionStartSource): AgentHandle
  // 中文：反向释放：停止状态机、注销、撤销作用域；结果被缓存以共享同一次操作。
  /** Reverse teardown: stop the machine, unregister, unwind the scope. Memoized. */
  dispose(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentLoop: AgentLoop
    // 中文：启动器持有的已配置智能体精确会话身份，以配置 id 为键，在任何 Loader 条目挂载前通过 ctx.provide() 设置。只有启动器知道会话是否已存在，因此
    // 身份由它负责，而 cordis.yml 中的模型路由仍是可覆盖配置。没有匹配键的条目继续使用自身配置的身份。
    /**
     * Launcher-owned exact session identities for configured agents, keyed by
     * the agent's config `id` and set with `ctx.provide()` before any Loader
     * entry mounts (see {@link CONFIGURED_AGENT_IDENTITIES_KEY}). A launcher
     * owns identity because only it knows whether the session already exists,
     * while the `cordis.yml` row keeps the model route as ordinary patchable
     * config. An entry with no matching key keeps its configured identity.
     */
    configuredAgentIdentities?: ConfiguredAgentIdentities
  }
  interface Events {
    // 中文：声明式智能体条目在发布存活智能体之前失败。为该配置身份缓存工作的消费者使用此临时信号拒绝工作，避免无限等待；正常工厂释放会抑制已取消启动尝试的失败。
    // payload.sessionId 为启动失败的共享智能体／会话精确身份；payload.error 为持久化、准备或发布失败；事件模式为 emit。
    /**
     * A declarative agent entry failed before it could publish a live agent.
     * Consumers that buffer work for the configured identity use this
     * transient signal to reject that work instead of waiting forever. Normal
     * factory teardown suppresses failures from the cancelled startup attempt.
     * @param payload.sessionId - exact shared agent/session identity that failed startup.
     * @param payload.error - persistence, setup, or publication failure.
     * @mode emit
     */
    'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
  }
}

export { DEFAULT_MAX_PARALLEL_TOOL_CALLS }

// 中文：启动器为配置智能体选定的会话身份。resume 区分恢复已有持久化历史和以该 ID 创建新会话，分别对应配置键 resumeSessionId 和
// sessionId。
/**
 * One launcher-selected session identity for a configured agent. `resume`
 * distinguishes rehydrating existing persisted history from creating the
 * session fresh under that exact id, which the two config keys express as
 * `resumeSessionId` and `sessionId`.
 */
export interface LauncherAgentIdentity {
  // 中文：要新建或恢复的精确会话 ID。
  /** Exact session id to create fresh or resume. */
  id: SessionId
  // 中文：恢复已有持久化历史，而不是创建新会话。
  /** Resume existing persisted history instead of creating the session fresh. */
  resume: boolean
}

// 中文：以配置智能体 id 为键的启动器指定身份。
/** Launcher-selected identities keyed by the configured agent's `id`. */
export interface ConfiguredAgentIdentities extends Readonly<Record<string, LauncherAgentIdentity>> {}

// 中文：启动器在任何 Loader 条目挂载前设置的上下文键，通过 ctx.provide(CONFIGURED_AGENT_IDENTITIES_KEY,
// identities) 固定会话身份而不使用配置键，从而模型路由覆盖不会丢掉身份。
/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(CONFIGURED_AGENT_IDENTITIES_KEY, identities)`) to fix
 * configured agents' session identities without a config key, so an overlay
 * repointing the row's model route cannot drop them.
 */
export const CONFIGURED_AGENT_IDENTITIES_KEY = 'configuredAgentIdentities'

// 中文：将启动器持有的身份应用到配置智能体，为启动器指定的每个条目替换两个身份键，确保配置身份不会与启动器身份同时残留。agents 为配置条目；identities 为按
// 智能体 id 索引的身份或 undefined；返回应用后的条目。
/**
 * Apply launcher-owned identities over the configured agents, replacing both
 * identity keys for every entry the launcher named so a config-supplied
 * identity can never survive alongside a launcher-supplied one.
 * @param agents - the configured agent entries.
 * @param identities - launcher identities keyed by configured agent `id`, or `undefined`.
 * @returns the entries with launcher-owned identities applied.
 */
function applyLauncherIdentities(
  agents: Config['agents'],
  identities: ConfiguredAgentIdentities | undefined,
): Config['agents'] {
  if (identities === undefined) return agents
  return agents.map((agent) => {
    const identity = identities[agent.id]
    if (identity === undefined) return agent
    const { sessionId: _sessionId, resumeSessionId: _resumeSessionId, ...rest } = agent
    return identity.resume
      ? { ...rest, resumeSessionId: identity.id }
      : { ...rest, sessionId: identity.id }
  })
}

// 中文：承载用户可控制的工具调用并行度的设置命名空间。
/** Settings namespace carrying the tool-call parallelism a user owns. */
export const AGENT_LOOP_SETTINGS_NAMESPACE = 'agent-loop'

// 中文：用户可控制的 agent-loop 字段，刻意限制为 Config 的严格子集。agents 是服务启动时只消费一次的启动组合数组，持久化修改只会造成已生效的假象。
/**
 * The agent-loop fields a user owns. Deliberately a strict subset of
 * {@link Config}: `agents` is a boot-time composition array consumed once when
 * the service starts, so a stored change could only look like it had an effect.
 */
export interface AgentLoopSettings {
  // 中文：每个智能体 step 中可并行安全执行的最大在途调用数。
  /** Maximum parallel-safe calls in flight per agent step. */
  maxParallelToolCalls: number
}

// 中文：agent-loop 设置部分的 schema。
/** Schema of the agent-loop settings section. */
export const AGENT_LOOP_SETTINGS_SCHEMA: z<AgentLoopSettings> = z.object({
  maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS),
})

// 中文：agent-loop 插件配置。
/** Agent-loop plugin configuration. */
export interface Config {
  // 中文：每个智能体 step 中可并行安全执行的最大在途调用数；1 表示串行，省略时采用 DEFAULT_MAX_PARALLEL_TOOL_CALLS。
  /**
   * Maximum parallel-safe calls in flight per agent step. `1` is serial;
   * omission defaults to {@link DEFAULT_MAX_PARALLEL_TOOL_CALLS}.
   */
  maxParallelToolCalls?: number
  // 中文：插件启动时创建或恢复的智能体。
  /** Agents created or resumed at plugin startup. */
  agents: (AgentOptions & {
    // 中文：稳定的配置标签，用于日志及新组合 ID 的前缀。
    /** Stable config label used in logs and as the fresh combined-id prefix. */
    id: string
    // 中文：可选稳定身份；重新挂载时恢复已落地历史，首次使用时新建。
    /** Optional stable identity; remounts resume its materialized history, while first use creates it fresh. */
    sessionId?: SessionId
    // 中文：新会话的可选工作区。
    /** Optional workspace for a fresh session. */
    cwd?: string
    // 中文：需要恢复的持久化会话，用于替代新建会话。
    /** Persisted session to resume instead of creating a fresh session. */
    resumeSessionId?: SessionId
  })[]
}

// 中文：应用默认值并完成加载时校验后的 agent-loop 配置。
/** Agent-loop configuration after defaults and load-time validation. */
type ResolvedConfig = Config & { maxParallelToolCalls: number }

// 中文：在任何配置智能体启动前拒绝可独立判断的身份冲突。
/** Reject self-contained identity conflicts before any configured agent starts. */
function validateConfiguredAgents(agents: Config['agents']): void {
  const exactIdentities = new Map<SessionId, string>()
  for (const { id, sessionId, resumeSessionId } of agents) {
    const hasResumeId = resumeSessionId !== undefined && resumeSessionId !== ''
    if (sessionId !== undefined && hasResumeId) {
      throw new Error(`agent "${id}": sessionId and resumeSessionId are mutually exclusive`)
    }
    const exactIdentity = hasResumeId ? resumeSessionId : sessionId
    if (exactIdentity === undefined) continue
    const firstId = exactIdentities.get(exactIdentity)
    if (firstId !== undefined) {
      throw new Error(`agents "${firstId}" and "${id}" use duplicate exact session identity "${exactIdentity}"`)
    }
    exactIdentities.set(exactIdentity, id)
  }
}

// 中文：具体的智能体工厂与驱动服务。
/** Concrete agent factory and driver service. */
export class AgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections']

  // 中文：声明式智能体的运行时 schema。
  /** Runtime schema for declarative agents. */
  static Config = z.object({
    maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS),
    agents: z.array(z.object({
      id: z.string().required(),
      sessionId: z.string().min(1),
      provider: z.string(),
      model: z.string(),
      reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId>>,
      maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
      cwd: z.string(),
      resumeSessionId: z.string(),
    })).default([]),
  }) as z<Config>

  // 中文：agent-loop 服务持有的已校验配置。
  /** Validated configuration owned by the agent-loop service. */
  readonly config: ResolvedConfig
  private readonly ownership: FactoryOwnership
  // 中文：使用普通容器，防止 Cordis 通过调用方的上下文遮蔽重新追踪工厂依赖上下文。
  /** Plain holder prevents Cordis from re-tracing the factory's dependency context through a caller shadow. */
  private readonly runtime: { ctx: Context }

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentLoop')

    const entry: AgentLoopSettings = {
      maxParallelToolCalls: resolveMaxParallelToolCalls(config.maxParallelToolCalls),
    }
    let source: () => AgentLoopSettings = () => entry
    this.config = {
      ...config,
      agents: applyLauncherIdentities(config.agents, ctx.get(CONFIGURED_AGENT_IDENTITIES_KEY)),
      // 中文：每次调度决策都读取当前值：tool-calls.ts 在每组开始时解构此值，因此已提交修改限制下一组，不干扰正在执行的组。
      // Read through on every scheduler decision: `tool-calls.ts` destructures
      // this at the start of each group, so a committed change caps the next
      // group without disturbing the one in flight.
      get maxParallelToolCalls() {
        return source().maxParallelToolCalls
      },
    }
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_LOOP_SETTINGS_NAMESPACE, AGENT_LOOP_SETTINGS_SCHEMA, entry, {
        // 中文：schema 允许所有正整数，完整规则由 resolveMaxParallelToolCalls 负责；在此拒绝无效值，使运行中的调度器保留最近有效上限，而不在下一
        // 工具组才失败。
        // The schema admits any integer above zero; `resolveMaxParallelToolCalls`
        // owns the whole rule, so refusing here keeps the running scheduler on
        // its last good cap instead of failing at the next tool group.
        validate: value => void resolveMaxParallelToolCalls(value.maxParallelToolCalls),
        setSource: (current) => {
          source = current
        },
        // 中文：没有其他值由上限派生，上面的 getter 是唯一读取者。
        // Nothing is derived from the cap: the getter above is the only reader.
        onChange: () => {},
      })
    })
    validateConfiguredAgents(this.config.agents)
    // 中文：所有配置校验通过后才注册，确保构造失败不遗留投影单元。
    // Register only after every config validation above has passed, so a
    // rejected constructor leaves no projection unit behind.
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    this.ownership = new FactoryOwnership(ctx.fiber)
    this.runtime = { ctx }
    ctx.effect(() => () => this.ownership.dispose(), 'agentLoop.transactions()')
    ctx.effect(() => ctx.agents.setFactory(this), 'agentLoop.setFactory()')
    ctx.systemPrompt.variable('provider', context => context.agent?.options.provider)
    ctx.systemPrompt.variable('model', context => context.agent?.options.model)
    ctx.systemPrompt.variable('cwd', context => context.agent?.session.header.cwd)

    for (const { id, sessionId, cwd, resumeSessionId, ...options } of this.config.agents) {
      const meta = cwd === undefined ? {} : { cwd }
      if (resumeSessionId === undefined || resumeSessionId === '') {
        const configuredId = sessionId ?? brandString<SessionId>(`${id}-session-${randomUUID()}`)
        const persistence = sessionId === undefined ? undefined : ctx.get('sessionPersistence')
        if (persistence === undefined) {
          const startup = this.create(configuredId, options, meta).then(() => undefined, (error: unknown) => {
            this.reportConfiguredStartupFailure(id, 'restore', configuredId, error)
          })
          this.ownership.trackStartup(startup)
        } else {
          const startup = this.restoreOrCreateConfigured(ctx, persistence, configuredId, options, meta).catch((error: unknown) => {
            this.reportConfiguredStartupFailure(id, 'restore', configuredId, error)
          })
          this.ownership.trackStartup(startup)
        }
        continue
      }
      ctx.effect(() => {
        const fiber = ctx.inject(['sessionPersistence'], (childCtx: Context) => {
          void this.resumeWith(ctx, childCtx.sessionPersistence, {
            resumeSessionId,
            agentOptions: options,
          }).catch((error: unknown) => {
            this.reportConfiguredStartupFailure(id, 'resume', resumeSessionId, error)
          })
        })
        return fiber.dispose
      }, `agentLoop.resume(${id})`)
    }
  }

  // 中文：向绑定身份的消费者报告已被隔离处理的声明式启动失败。
  /** Report a contained declarative-start failure to identity-bound consumers. */
  private reportConfiguredStartupFailure(
    configId: string,
    action: 'restore' | 'resume',
    sessionId: SessionId,
    error: unknown,
  ): void {
    if (!this.ownership.isActive()) return
    this.ctx.logger.warn(`agent "${configId}": config-driven ${action} of "${sessionId}" failed: ${errorChain(error)}`)
    const args: unknown[] = ['agent-loop/config-start-failed', { sessionId, error }]
    for (const callback of this.ctx.events.dispatch('emit', args)) {
      try {
        const returned: unknown = callback(...args)
        void Promise.resolve(returned).catch((listenerError: unknown) => {
          this.ctx.logger.warn(`agent "${configId}": config-start-failed listener rejected: ${errorChain(listenerError)}`)
        })
      } catch (listenerError: unknown) {
        this.ctx.logger.warn(`agent "${configId}": config-start-failed listener threw: ${errorChain(listenerError)}`)
      }
    }
  }

  // 中文：重新挂载时恢复已落地的精确配置身份，首次使用时创建。
  /** Restore a materialized exact config identity on remount, or create it on first use. */
  private async restoreOrCreateConfigured(
    ownerCtx: Context,
    persistence: SessionPersistence,
    sessionId: SessionId,
    agentOptions: AgentOptions,
    meta: Pick<SessionHeader, 'cwd'>,
  ): Promise<void> {
    await this.waitForDrainingConfiguredIdentity(ownerCtx, sessionId)
    if (!this.ownership.isActive()) return
    try {
      await this.resumeWith(ownerCtx, persistence, { resumeSessionId: sessionId, agentOptions })
      return
    } catch (error: unknown) {
      if (!this.ownership.isActive()) return
      // 中文：只有存储会话确实不存在时才回退到首次创建；损坏、所有权冲突和后端失败仍明确报错。
      // Only a genuinely absent stored session falls back to first creation;
      // corruption, ownership conflicts, and backend failures stay loud.
      if (!(error instanceof SessionPersistenceNotFoundError)) throw error
    }
    await this.create(sessionId, agentOptions, meta)
  }

  // 中文：等待正在排空的同 ID 生命周期完成注册表清理。
  /** Wait for a draining same-id lifecycle to finish registry teardown. */
  private async waitForDrainingConfiguredIdentity(ownerCtx: Context, sessionId: SessionId): Promise<void> {
    // 中文：只有仍占用注册表的 ID 需要等待；健康存活的占用属于冲突，后续 create/resume 会自行报告。
    // Only an id still occupying a registry needs waiting for; a live healthy
    // occupant is a collision the create/resume below will surface itself.
    if (ownerCtx.agents.get(sessionId) === undefined && ownerCtx.sessions.get(sessionId) === undefined) return

    const released = Promise.withResolvers<void>()
    const checkReleased = (): void => {
      if (ownerCtx.agents.get(sessionId) === undefined && ownerCtx.sessions.get(sessionId) === undefined) {
        released.resolve()
      }
    }
    const disposeAgentListener = ownerCtx.on('agent/disposed', () => { checkReleased() })
    const disposeSessionListener = ownerCtx.on('session/disposed', checkReleased)
    try {
      checkReleased()
      await this.ownership.waitWhileActive(released.promise)
    } finally {
      disposeAgentListener()
      disposeSessionListener()
    }
  }

  // 中文：为新智能体创建驱动器、作用域和缓存结果的反向释放操作。发布前便将释放注册到工厂及所有者 fiber，确保准备中途卸载可回滚全部资源；signal 合并调用方取消与生
  // 命周期释放，供准备阶段等待使用。
  /**
   * Construct the driver, scope, and one memoized reverse teardown for a new
   * agent. The teardown is registered with the factory and the owner fiber
   * BEFORE publication, so a mid-setup unload rolls everything back; `signal`
   * fuses caller cancellation with lifecycle teardown for setup awaits.
   */
  private prepare(
    ownerCtx: Context,
    id: SessionId,
    options: AgentOptions,
    session: Session,
    callerSignal?: AbortSignal,
    handle?: SessionHandle,
    parentAgent?: Agent,
  ): PreparedAgent {
    assertAgentOptions(options)
    ownerCtx.fiber.assertActive()
    // 中文：所有调用方要么从 Cordis 分发已要求工厂 fiber 存活的服务方法同步进入 prepare()，要么在等待后自行重新检查所有权，例如 resume 的加载屏
    // 障。
    // Every caller reaches prepare() synchronously from a service method
    // whose Cordis dispatch already requires the live factory fiber, or
    // re-checks ownership itself after its awaits (resume's load barrier).
    // 中文：覆盖率例外：不可达的兜底分支，原因见上文。
    /* v8 ignore next -- unreachable backstop, see above */
    if (!this.ownership.isActive()) throw new Error('agent loop is not active')
    if (callerSignal?.aborted) {
      throw callerSignal.reason instanceof Error
        ? callerSignal.reason
        : new Error(`agent "${id}" creation aborted`, { cause: callerSignal.reason })
    }
    const loopCtx = this.runtime.ctx

    // 中文：停用合并三类所有者及各自原因：调用方取消信号、所有者 fiber 卸载、工厂释放。在任何资源存在之前就基于可变槽位注册，确保作用域创建中发生卸载时仍有可用释放器，避
    // 免泄漏。
    // Deactivation fuses three owners, each with its own reason: the caller's
    // cancellation signal, the owner fiber's unload, and factory teardown.
    // It is registered BEFORE any resource exists, over mutable slots, so an
    // unload arriving while the scope is still minting finds a working
    // disposer instead of a leak.
    const abort = new AbortController()
    const onCallerAbort = (): void => {
      abort.abort(callerSignal?.reason instanceof Error
        ? callerSignal.reason
        : new Error(`agent "${id}" creation aborted`, { cause: callerSignal?.reason }))
    }
    const onFactoryTeardown = (): void => { abort.abort(this.ownership.signal.reason) }
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    this.ownership.signal.addEventListener('abort', onFactoryTeardown, { once: true })

    let machine: ReactLoopAgent | undefined
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let disposing: Promise<void> | undefined
    const machineReady = Promise.withResolvers<void>()
    // 中文：缓存同一次反向释放，让并发释放方等待同一次静止状态：停止状态机，排空并关闭会话写路径，退出注册表，撤销作用域，清理管理记录。
    // Reverse teardown, memoized so every racing owner awaits one quiescence:
    // stop the machine, drain and close the session's write path, leave the
    // registries, unwind the scope, release bookkeeping.
    const dispose = (ownerTriggered = false): Promise<void> => (disposing ??= (async () => {
      abort.abort(new Error(`agent "${id}" lifecycle disposed`))
      callerSignal?.removeEventListener('abort', onCallerAbort)
      this.ownership.signal.removeEventListener('abort', onFactoryTeardown)
      // 中文：收集而不吞掉释放失败；注册表、作用域和所有权清理始终执行到静止，之后共享的释放 Promise 携失败原因拒绝，使每个并发释放方都能观察到。
      // Teardown failures are collected, never swallowed: registry, scope,
      // and ownership cleanup always run to quiescence, then the memoized
      // disposal rejects with what failed so every racing owner observes it.
      const failures: unknown[] = []
      try {
        // 中文：释放本身就是以 disposed 原因为取消并等待静止。从此刻起再发送工作是发送方错误，注册表即将移除智能体，不应还有使用者持有它。
        // Disposal IS a disposed-cause cancel followed by quiescence. New work
        // sent after this point is the sender's bug — the registries are about
        // to drop the agent, so nothing should still hold it.
        // 中文：覆盖率例外：Cordis effect 释放会等待同步准备结束，才观察状态机槽位。
        /* v8 ignore next -- Cordis effect teardown waits for synchronous setup before observing the machine slot. */
        if (machine === undefined) await machineReady.promise
        // 中文：覆盖率例外：准备失败时会先取消跟踪该释放器，再以没有状态机的结果结束。
        /* v8 ignore next -- setup failure untracks this disposer before resolving without a machine. */
        if (machine !== undefined) {
          machine.cancel({ kind: 'disposed' })
          await machine.whenIdle()
          await machine.scope.dispose()
        }
      } catch (error: unknown) {
        failures.push(error)
      }
      // 中文：上面的循环已同步把结束事件提交到会话；句柄关闭前会持久化排空这些事件，再释放写路径。关闭排空可能首次暴露持久化失败，因此保留该错误，不仅记日志后忽略。
      // The loop above committed its closing events synchronously into the
      // session; handle close drains them durably before releasing the write
      // path. The close drain can be the first operation that surfaces a
      // durability failure, so its error is retained, not logged away.
      try {
        await handle?.close()
      } catch (error: unknown) {
        failures.push(error)
      }
      try {
        detachAgent?.()
        detachSession?.()
      } finally {
        untrack()
        if (!ownerTriggered) await unfollowOwner()
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, `agent "${id}" disposal failed`)
      }
    })())
    const untrack = this.ownership.track(dispose)
    let unfollowOwner: () => Promise<void> | void
    try {
      unfollowOwner = ownerCtx.effect(function* () {
        machine = new ReactLoopAgent(loopCtx, id, options, session)
        machineReady.resolve()
        yield machine.scope.rawDispose
        yield () => {
          // 中文：所有者释放也等待同一个静止边界；此释放逻辑不会在自身内部注销正在运行的所有者 effect。
          // Owner disposal owns the same quiescence boundary. Its teardown skips
          // unregistering this already-running owner effect from inside itself.
          if (disposing !== undefined) return
          abort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`))
          return dispose(true)
        }
      }, `agentLoop.lifecycle(${id})`)
      // 中文：覆盖率例外开始：ctx.effect 仅在 fiber 不活动时抛错，上面的 assertActive() 已排除此情况。
      /* v8 ignore start -- ctx.effect throws only on an inactive fiber, which assertActive() above already rejected */
    } catch (error: unknown) {
      machineReady.resolve()
      untrack()
      callerSignal?.removeEventListener('abort', onCallerAbort)
      this.ownership.signal.removeEventListener('abort', onFactoryTeardown)
      throw error
    }
    // 中文：结束覆盖率忽略区间。
    /* v8 ignore stop */

    const assertLive = (): void => {
      if (!abort.signal.aborted) return
      // 中文：每个合并的取消来源都携带 Error：onCallerAbort 和 raceAbort 包装调用方的非 Error 原因，工厂／生命周期所有者使用构造的
      // Error 取消。
      // Every fused abort source carries an Error reason: onCallerAbort and
      // raceAbort wrap non-Error caller reasons, and the factory/lifecycle
      // owners abort with constructed Errors.
      // 中文：覆盖率例外：String() 分支不可达，原因见上文。
      /* v8 ignore next -- unreachable String() arm, see above */
      throw abort.signal.reason instanceof Error ? abort.signal.reason : new Error(String(abort.signal.reason))
    }
    try {
      // 中文：覆盖率例外：同步 effect 在返回前会耗尽生成器。
      /* v8 ignore next -- a synchronous effect exhausts the generator before returning */
      if (machine === undefined) throw new Error(`agent "${id}" lifecycle did not construct its driver`)
      const agent = machine
      assertLive()

      return {
        agent,
        signal: abort.signal,
        publish: (source) => {
          assertLive()
          detachSession = agent.ctx.sessions.enter(session)
          // 中文：已挂载后端按会话 ID 将已宣告的实时事件路由到活动写句柄；循环仅拥有句柄本身。
          // The mounted backend routes announced live events into the active
          // write handle by session id; the loop only owns the handle itself.
          detachAgent = loopCtx.agents.enter(agent, parentAgent)
          agent.ctx.sessions.announce(session)
          assertLive()
          loopCtx.agents.announce(agent)
          assertLive()
          // 中文：同步的 announce/session-start 监听器可能已触发释放。状态机已存活，session-start 扩展点可投递消息，因此这里只需重新检查存活状态
          // 。
          // A synchronous announce/session-start listener may have started
          // teardown; the machine is already live (delivery works from the
          // session-start extension point), so only the liveness recheck is owed.
          emitAgentEvent(loopCtx, agent, 'agent/session-start', { source })
          assertLive()
          return { agent, dispose }
        },
        dispose,
      }
    } catch (error: unknown) {
      machineReady.resolve()
      // 中文：回滚时忽略释放 Promise 的拒绝，因为准备失败才是主要错误。
      // Rollback swallows a disposal rejection: the setup failure is primary.
      void dispose().catch(() => {})
      throw error
    }
  }

  // 中文：使用调用方提供的同一个身份创建智能体和会话，由访问该服务的 fiber 持有。构造器驱动的配置调用在进入前生成新组合 ID。挂载持久化后端时，发布前存储持久身份与种
  // 子数据。id 为共享身份，options 为具体循环选项，meta 为可选新会话工作区元数据；返回已发布运行的智能体。
  /**
   * Create an agent and session under one caller-supplied identity, owned by
   * the accessing fiber. Constructor-driven config calls mint a fresh combined
   * id before entering this boundary. When a persistence backend is mounted,
   * the session's durable identity and any seed are stored before publication.
   * @param id - shared agent/session identity.
   * @param options - concrete loop options.
   * @param meta - optional fresh-session workspace metadata.
   * @returns the published running agent.
   */
  async create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Promise<Agent> {
    using preparation = SessionPreparation.create(this.runtime.ctx.sessions.prepare(id, { meta }))
    const stored = await this.createStoredSession(preparation.session)
    let prepared: PreparedAgent
    try {
      prepared = this.prepare(this.ctx, id, options, preparation.session, undefined, stored?.handle)
    } catch (error: unknown) {
      await stored?.handle.close().catch(() => {})
      throw error
    }
    try {
      await this.appendUnstoredSuffix(stored, preparation.session)
      return prepared.publish('startup').agent
    } catch (error: unknown) {
      // 中文：回滚时忽略释放 Promise 的拒绝，因为准备失败才是主要错误。
      // Rollback swallows a disposal rejection: the setup failure is primary.
      void prepared.dispose().catch(() => {})
      throw error
    }
  }

  // 中文：挂载持久化时取得新会话的写所有权。此处不追加内容；构造器种子不会再经 session/event 发出，而是在发布提交点由 appendUnstoredSuffix
  //  存储。因此校验或准备失败／取消只会关闭未落地句柄，不留存储残留，同一 ID 可再次创建。session 为尚未发布会话，signal 为传给后端创建的可选取消信号；返回
  // 句柄和已存游标，无后端则 undefined。
  /**
   * Take a fresh session's write ownership when persistence is mounted.
   * Nothing is appended here: the constructor seed (which never re-emits
   * through `session/event`) is stored by `appendUnstoredSuffix` at the
   * publication commit point, so a failed or cancelled validation or setup
   * closes an unmaterialized handle and leaves no stored residue — the same
   * id can be created again.
   * @param session - the unpublished session to store.
   * @param signal - optional cancellation forwarded to the backend create.
   * @returns the owned handle and stored cursor, or `undefined` without a backend.
   */
  private async createStoredSession(session: Session, signal?: AbortSignal): Promise<StoredSession | undefined> {
    const persistence = this.runtime.ctx.get('sessionPersistence')
    if (persistence === undefined) return undefined
    const handle = await persistence.create(session.header, {
      inheritedEventCount: session.inheritedEventCount,
      ...signal === undefined ? {} : { signal },
    })
    return { handle, storedCount: 0 }
  }

  // 中文：持久化自上次存储游标之后追加的会话事件。发布前追加的构造器种子标记、委托策略等准备窗口事件不会再经 session/event 发出，因此发布前必须经句柄刷入，之后
  // 才允许路由实时事件。stored 为可选句柄和存储游标，session 为待保存尾部的未发布会话。
  /**
   * Durably store the session events appended since the last stored cursor.
   * Pre-publication appends (constructor seed markers, setup-window events
   * such as delegation policy records) never re-emit through `session/event`,
   * so publication must flush them through the handle before live events
   * start routing into it.
   * @param stored - the session's owned handle and stored cursor, if any.
   * @param session - the unpublished session whose suffix is stored.
   */
  private async appendUnstoredSuffix(stored: StoredSession | undefined, session: Session): Promise<void> {
    if (stored === undefined) return
    // 中文：静态检查例外：读取现有 Session 历史，迁移延后。
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const suffix = session.snapshotEvents(SessionLogOffset(stored.storedCount))
    if (suffix.length > 0) await stored.handle.append(suffix)
    // 中文：按实际已存数量推进游标，而不是推进到 session.seq；等待期间追加的事件必须留待下次刷入。
    // Advance by what was stored, not to `session.seq`: an event appended
    // during the await must stay unstored for the next flush.
    stored.storedCount += suffix.length
  }

  // 中文：在调用方指定会话 ID 上创建有明确所有者的智能体。ownerCtx 在结构上持有生命周期；options 包含身份、可选存活父对象、会话种子／元数据、循环选项、准
  // 备及取消；返回已发布句柄。
  /**
   * Create an owned agent on a caller-supplied session id.
   * @param ownerCtx - caller context that structurally owns the lifecycle.
   * @param options - identities, optional live parent, session seed/metadata, loop options, setup, and cancellation.
   * @returns the published handle.
   */
  async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const preparation = SessionPreparation.create(this.runtime.ctx.sessions.prepare(options.sessionId, {
      ...options.seed === undefined ? {} : { seed: options.seed },
      ...options.meta === undefined ? {} : { meta: options.meta },
      ...options.inheritedEventCount === undefined ? {} : { inheritedEventCount: options.inheritedEventCount },
    }))
    const published = (async () => {
      let stored: StoredSession | undefined
      try {
        // 中文：raceAbortCall 统一处理预先取消和创建中取消，并关闭在操作已被放弃后才创建完成的句柄。
        // raceAbortCall normalizes a pre-aborted or mid-create abort and
        // closes a handle that finishes creating after abandonment.
        stored = options.signal === undefined
          ? await this.createStoredSession(preparation.session)
          : await raceAbortCall(
            () => this.createStoredSession(preparation.session, options.signal),
            options.signal,
            options.sessionId,
            (abandoned) => { void abandoned?.handle.close().catch(() => {}) },
          )
      } catch (error: unknown) {
        preparation[Symbol.dispose]()
        throw error
      }
      return this.setupAndPublish(
        ownerCtx,
        options.sessionId,
        preparation,
        options.agentOptions ?? {},
        options.setup,
        options.signal,
        'startup',
        stored,
        options.parentAgent,
      )
    })()
    this.ownership.trackWrapper(published)
    return published
  }

  // 中文：围绕已取得的 Session 准备 Agent，执行设置后发布。
  /** Prepare one Agent around an acquired Session, run setup, and publish it. */
  private async setupAndPublish(
    ownerCtx: Context,
    id: SessionId,
    preparation: SessionPreparation,
    agentOptions: AgentOptions,
    setup: AgentSetup | undefined,
    signal: AbortSignal | undefined,
    source: SessionStartSource,
    stored?: StoredSession,
    parentAgent?: Agent,
  ): Promise<AgentHandle> {
    using ownedPreparation = preparation
    const session = ownedPreparation.session
    let prepared: PreparedAgent
    try {
      prepared = this.prepare(ownerCtx, id, agentOptions, session, signal, stored?.handle, parentAgent)
    } catch (error: unknown) {
      await stored?.handle.close().catch(() => {})
      throw error
    }
    try {
      const setupCommit = await raceAbort(setup?.(prepared.agent.ctx, prepared.agent), prepared.signal, id)
      setupCommit?.commit()
      await this.appendUnstoredSuffix(stored, session)
      return prepared.publish(source)
    } catch (error: unknown) {
      // 中文：回滚忽略释放拒绝（例如最终句柄关闭失败），调用方应看到的主错误是准备失败。
      // Rollback swallows a disposal rejection (a failing final handle close):
      // the setup failure is the primary error the caller must see.
      await prepared.dispose().catch(() => {})
      throw error
    }
  }

  // 中文：从已配置持久化服务恢复有明确所有者的智能体。ownerCtx 持有加载、准备和存活生命周期；options 包含持久身份、可选存活父对象、循环选项、准备及取消；返回
  // 已发布句柄。
  /**
   * Resume an owned agent from the configured persistence service.
   * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
   * @param options - persisted identity, optional live parent, loop options, setup, and cancellation.
   * @returns the published handle.
   */
  async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
    const persistence = this.runtime.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new Error('cannot resume: session persistence is not configured (load a dsh-session-persistence backend)')
    }
    return this.resumeWith(ownerCtx, persistence, options)
  }

  // 中文：通过延迟配置路径使用的显式持久化句柄恢复。
  /** Resume through an explicit persistence handle used by the deferred config path. */
  private resumeWith(
    ownerCtx: Context,
    persistence: SessionPersistence,
    options: ResumeAgentOptions,
  ): Promise<AgentHandle> {
    const id = options.resumeSessionId
    const published = (async () => {
      // 中文：打开和读取可能比所有者活得更久，因此与调用方取消、所有者 fiber 卸载及工厂释放竞速，避免永不结束的后端一直占用身份。
      // The open and read may outlive their owner: race them against caller
      // cancellation, owner-fiber unload, and factory teardown so a
      // never-settling backend cannot pin the identity.
      const ownerAbort = new AbortController()
      const unfollowOwner = ownerCtx.effect(() => () => {
        ownerAbort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`))
      }, `agentLoop.resume-load(${id})`)
      const fused = AbortSignal.any([
        ...options.signal === undefined ? [] : [options.signal],
        ownerAbort.signal,
        this.ownership.signal,
      ])
      let handle: SessionHandle | undefined
      let stored: StoredSession | undefined
      let preparation: SessionPreparation | undefined
      try {
        try {
          // 中文：先取得写所有权，以排除同一 ID 的并发恢复；本进程中存活智能体的句柄持有该占用权。
          // Taking write ownership FIRST excludes a concurrent resume of the
          // same id (in this process, a live agent's handle holds the claim).
          handle = await raceAbortCall(
            () => persistence.open(id, 'write', { signal: fused }),
            fused,
            id,
            (abandoned) => { void abandoned.close() },
          )
          // 中文：语义层崩溃修复由智能体层负责。持久化返回物理有效日志；被中断的末轮会补合成结束记录（缺失工具错误、step/end、turn/end），经同一句柄按普通批次追加。
          // Semantic crash repair is the agent layer's job: persistence hands
          // back the physically valid log; an interrupted final turn receives
          // synthetic closers (missing tool errors, step/end, turn/end) that
          // are appended through the same handle as an ordinary batch.
          const coldRead = await handle.read(0, undefined, { signal: fused })
          fused.throwIfAborted()
          const persisted = coldRead.events
          const closers = interruptedTurnClosers(persisted)
          if (closers.length > 0) await handle.append(closers)
          preparation = SessionPreparation.create(this.runtime.ctx.sessions.prepare(id, {
            seed: [...persisted, ...closers],
            meta: structuredClone(handle.header),
            inheritedEventCount: handle.inheritedEventCount,
            eventState: coldRead.eventState,
          }))
          stored = { handle, storedCount: persisted.length + closers.length }
          await this.appendUnstoredSuffix(stored, preparation.session)
        } finally {
          await unfollowOwner()
        }
        ownerCtx.fiber.assertActive()
        if (!this.ownership.isActive()) throw new Error('agent loop is not active')
        const owned = stored
        // 中文：所有权转移给 setupAndPublish/prepare。
        handle = undefined // ownership passes to setupAndPublish/prepare
        return await this.setupAndPublish(
          ownerCtx,
          id,
          preparation,
          options.agentOptions ?? {},
          options.setup,
          options.signal,
          'resume',
          owned,
          options.parentAgent,
        )
      } finally {
        preparation?.[Symbol.dispose]()
        await handle?.close().catch(() => {})
      }
    })()
    this.ownership.trackWrapper(published)
    return published
  }
}

export default AgentLoop

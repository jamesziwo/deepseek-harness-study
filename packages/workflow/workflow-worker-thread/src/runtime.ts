// 中文：每轮 worker 侧 vm 钩子、子级 RPC、并发与资源上限、取消和结果序列化，不接触 Cordis。离开 realm 的脚本值先实体化为普通 JSON；进入可
// 信模型脚本 realm 的值直接传入，只有 args 克隆以防脚本修改初始化数据，信任模型见 realm.ts。错误钩子参数、非法 schema／选项、上限、启动失败及取
// 消等致命错误穿过组合器传播；只有子级失败和普通阶段错误映射为逐项 null。每个返回 Promise 都安装拒绝消费者，避免脚本丢弃 Promise 导致 worker
// 退出。取消后始终不结束的脚本不发结果，由宿主在宽限内强制结算并终止线程。
/**
 * Per-run worker-side vm hooks, child RPC, concurrency/caps, cancellation, and result serialization; it
 * never touches Cordis. Script values leaving the realm are materialized as plain JSON before
 * messaging. Values entering the trusted model-written realm are passed directly; `args` alone is
 * cloned so script mutation cannot alter initialization data. See `./realm.ts` for the trust model.
 *
 * Fatal workflow errors—bad hook arguments, unsupported schemas/options, caps, start failures, and
 * cancellation—propagate through combinators. Only child failures and ordinary stage errors become
 * per-item nulls. Every returned promise has a rejection consumer so dropped script promises cannot
 * kill the worker. A cancelled script that never settles emits nothing; the host force-settles the
 * run within grace and terminates the thread.
 * @module @deepseek-ai/dsh-workflow-worker-thread/runtime
 */

import * as vm from 'node:vm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { assertObjectJsonSchema, JsonSchemaError } from '@deepseek-ai/dsh-tools'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { isFatalWorkflowError, WorkflowError } from '@deepseek-ai/dsh-workflow'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowMeta,
  WorkflowResult,
} from '@deepseek-ai/dsh-workflow'
import { materializeFromRealm, MaterializeError, renderThrown } from './realm.ts'
import type { ChildHandle, ChildPort, WorkerLimits } from './types.ts'

// 中文：执行过程通过这些观察器报告进度，会话将其发送给宿主。
/** The observers the execution reports progress through (the session posts them to the host). */
export interface ExecutionObserver {
  phase(title: string): void
  log(message: string): void
  agentStart(info: WorkflowAgentInfo): void
  agentEnd(info: WorkflowAgentEndInfo): void
}

// 中文：脚本可传给 agent() 的选项，其他选项明确拒绝。
/** The `agent()` options the script may pass; everything else rejects loud. */
const SUPPORTED_AGENT_OPTIONS = new Set(['label', 'phase', 'schema', 'provider', 'model'])
// 中文：尚未支持的 Claude Code 选项，在拒绝消息中明确点名。
/** Deferred Claude Code options we name explicitly in the rejection message. */
const DEFERRED_AGENT_OPTIONS = new Set(['effort', 'isolation', 'agentType'])

// 中文：将子级最终输出块展开为文本，作为无 schema 时的 agent() 结果。
/** Flatten a child's final output blocks to text (the non-schema `agent()` result). */
function outputText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

// 中文：脚本未提供标签时，从提示生成简短显示标签。
/** A short display label derived from the prompt when the script passes none. */
function defaultLabel(prompt: string): string {
  const newline = prompt.indexOf('\n')
  const line = newline === -1 ? prompt : prompt.slice(0, newline)
  return line.length <= 48 ? line : `${line.slice(0, 47)}…`
}

// 中文：worker 中单次存活脚本执行，由会话按运行创建。drive() 恰好调用一次且绝不拒绝，所有失败变为非 completed 的 WorkflowResult。宿
// 主负责取消和清理被脚本丢弃的子级工作。
/**
 * One live script execution inside the worker. Constructed per run by the
 * session; `drive()` is called exactly once and NEVER rejects — every failure
 * becomes a {@link WorkflowResult} with a non-`completed` stop reason. The
 * host owns cancellation and cleanup of any dropped child work.
 */
export class WorkflowExecution {
  // 中文：从 1 开始计数的已启动 agent() 调用数，即 agentsStarted。
  /** 1-based count of `agent()` calls started (the `agentsStarted` result field). */
  private started = 0
  private activeSlots = 0
  private readonly slotWaiters: { resolve(): void; reject(error: unknown): void }[] = []
  private cancelReason: string | undefined
  private cancelError: WorkflowError | undefined
  private currentPhase: string | undefined
  private readonly context: vm.Context
  private readonly compiled: vm.Script

  constructor(
    meta: WorkflowMeta,
    body: string,
    args: unknown,
    private readonly limits: WorkerLimits,
    private readonly observer: ExecutionObserver,
    private readonly children: ChildPort,
  ) {
    // 中文：先编译：任何 realm 状态存在前，脚本语法错误必须从构造器抛出。宿主已用相同包装器预解析，同一 Node 版本生产中不可达，但会话仍防御性映射为错误结果。
    // lineOffset 补偿包装器行，使堆栈使用脚本原始行号。
    // Compile FIRST: a body syntax error must throw out of the constructor
    // before any realm state exists. The host pre-parses the identical
    // wrapper, so under one Node version this throw is unreachable in
    // production — the session still maps it to an error result defensively.
    // lineOffset compensates for the wrapper line, so stack traces carry the
    // script's own line numbers.
    try {
      this.compiled = new vm.Script(`(async () => {\n${body}\n})()`, {
        filename: `workflow:${meta.name}`,
        lineOffset: -1,
      })
    } catch (error: unknown) {
      throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error })
    }

    this.context = vm.createContext({}, { name: `workflow:${meta.name}` })

    const globals: Record<string, unknown> = {
      agent: (prompt: unknown, opts?: unknown) => this.contain(this.agent(prompt, opts)),
      parallel: (thunks: unknown) => this.contain(this.parallel(thunks)),
      pipeline: (items: unknown, ...stages: unknown[]) => this.contain(this.pipeline(items, stages)),
      phase: (title: unknown) => { this.phase(title) },
      log: (message: unknown) => { this.log(message) },
      // 中文：workerData 已完成真实的跨线程结构化克隆。
      // workerData already performed the real cross-thread structured clone.
      args,
    }
    for (const [key, value] of Object.entries(globals)) {
      // 中文：上下文化全局上的数据属性无需冻结结构；脚本覆盖自身钩子只会破坏自己。
      // Data properties on the contextified global; frozen shape not required —
      // a script overwriting its own hooks only sabotages itself.
      ;(this.context as Record<string, unknown>)[key] = typeof value === 'function' ? Object.freeze(value) : value
    }
  }

  // 中文：判断运行是否取消，使用方法而非内联属性读取。cancel() 会在会话消息处理器中并发改变 cancelReason，await 后内联读取可能被控制流缩窄为恒
  // false 比较。
  /**
   * Whether the run has been cancelled. A METHOD, not an inline property
   * read: `cancel()` mutates `cancelReason` concurrently (the session's
   * message handler), and an inline read after an `await` gets narrowed by
   * control flow into an always-false comparison.
   */
  private isCancelled(): boolean {
    return this.cancelReason !== undefined
  }

  // 中文：所有钩子共用入口守卫。cancel 后每个钩子下次调用都抛 CANCELLED，取消边界是下一次钩子调用而不仅 agent()；即使脚本捕获取消拒绝，也不能继续
  // phase/log 进度或进入组合器。
  /**
   * Shared hook entry guard: after {@link cancel}, EVERY hook throws
   * `CANCELLED` at its next call — cancellation is the next HOOK boundary,
   * not just the next `agent()`, so a script that caught one cancelled
   * rejection cannot keep emitting progress through `phase`/`log` or enter a
   * combinator.
   */
  private throwIfCancelled(): void {
    if (this.isCancelled()) throw this.cancelledError()
  }

  // 中文：取消运行：等待 agent() 并发槽的调用被拒绝，未来所有钩子抛 CANCELLED，脚本在下一 await 结束。若脚本停在与钩子无关的 Promise 上永不
  // 结束，由宿主宽限定时器强制结算并终止 worker。幂等且首个原因优先；reason 进入 CANCELLED 错误，宿主独立取消所有子级共享信号。
  /**
   * Cancel the run: waiting `agent()` slots reject and every future hook call
   * throws `CANCELLED` — the script dies at its next await. A script that
   * never settles anyway (parked on a promise no hook owns) is the HOST's
   * problem: its grace timer force-settles the run and terminates the
   * worker. Idempotent; the first reason wins.
   * @param reason - human-readable cause carried on the CANCELLED error. The
   * host independently aborts the required signal shared by every child.
   */
  cancel(reason: string): void {
    if (this.cancelReason !== undefined) return
    this.cancelReason = reason
    this.cancelError = new WorkflowError(`workflow run cancelled: ${this.cancelReason}`, 'CANCELLED')
    for (const waiter of this.slotWaiters.splice(0)) waiter.reject(this.cancelledError())
  }

  // 中文：驱动脚本至结束，Promise 只完成不拒绝。completed 包含实体化返回值，error 包含失败消息，取消导致结束则 cancelled。此方法仅选择结果，
  // 由会话发布、宿主负责终止子级取消；所有失败都映射到结果变体。
  /**
   * Run the script to settlement. Resolves — never rejects — with the run's
   * {@link WorkflowResult}: the materialized return value on `completed`, the
   * failure message on `error`, and `cancelled` when the script died of
   * cancellation. This method only chooses the result; the session publishes
   * it and the host owns terminal child cancellation.
   * @returns the settled outcome — this promise NEVER rejects (the seam's
   * `result`-never-rejects contract); every failure maps to a variant.
   */
  async drive(): Promise<WorkflowResult> {
    try {
      // 中文：脚本体运行前已取消，例如启动信号预先取消且在 go 前由宿主转发，此时根本不应执行脚本，更不能报告 completed。
      // Cancelled before the body ever ran (an already-aborted start signal,
      // relayed by the host before its `go`): the script must not execute at
      // all, let alone report `completed`.
      if (this.isCancelled()) throw this.cancelledError()
      const scriptPromise = this.compiled.runInContext(this.context, { timeout: this.limits.syncTimeoutMs }) as Promise<unknown>
      const raw: unknown = await this.contain(Promise.resolve(scriptPromise))
      // 中文：脚本运行中取消，即使随后没再调用钩子就结束，仍须报告 cancelled，不能违背持有者取消请求而称 completed。
      // Cancelled while the body ran: a script that settled without touching
      // another hook (or without any) must still report `cancelled` — the
      // holder asked for cancellation and `completed` would be a lie.
      if (this.isCancelled()) throw this.cancelledError()
      const value = raw === undefined ? null : this.materializeResult(raw)
      return { value, stopReason: 'completed', agentsStarted: this.started }
    } catch (error: unknown) {
      // 中文：cancel() 后任何失败均以规范原因报告 cancelled，与成功路径的结束后检查对称。
      // Any failure after cancel() reports `cancelled` with the canonical
      // reason — the reject path mirrors the resolve path's post-settle check.
      if (this.isCancelled()) {
        return { value: null, stopReason: 'cancelled', error: this.cancelledError().message, agentsStarted: this.started }
      }
      // 中文：renderThrown 对任何 realm 的抛出值都有定义，因此此分支不再抛错；drive() 完成体现 result 永不拒绝契约。
      // renderThrown is total (thrown values of any realm), so this arm
      // cannot throw — drive() resolving is the `result` never-rejects contract
      // contract.
      return { value: null, stopReason: 'error', error: renderThrown(error), agentsStarted: this.started }
    }
  }

  // 中文：附接空操作拒绝消费者，但不改变调用方收到的 Promise。脚本不 await 时，取消不会成为导致 worker 退出的未处理拒绝；脚本 await 时仍观察到拒
  // 绝。
  /**
   * Attach a no-op rejection consumer WITHOUT changing what the caller
   * receives: if the script drops the promise (no await), cancellation cannot
   * become an unhandled rejection (which would kill the worker thread); if
   * the script does await it, it still observes the rejection.
   */
  private contain<T>(promise: Promise<T>): Promise<T> {
    // 中文：拒绝已被消费：被丢弃的钩子 Promise 不得产生未处理拒绝，参见方法契约。
    promise.catch(() => { /* consumed: see method contract — a dropped hook promise must not surface an unhandled rejection */ })
    return promise
  }

  private cancelledError(): WorkflowError {
    // 中文：任何调用方观察到 isCancelled() 为 true 之前，cancel() 已设置 cancelError；回退仅保护类型，不是可达路径。
    // cancel() arms cancelError before any caller can observe isCancelled()
    // === true; the fallback guards the type, not a reachable path.
    // 中文：覆盖率忽略下一项。
    /* v8 ignore next */
    return this.cancelError ?? new WorkflowError('workflow run cancelled', 'CANCELLED')
  }

  // 中文：实体化脚本返回值，违规转换为 RESULT_UNSERIALIZABLE。
  /** Materialize the script's return value; violations become RESULT_UNSERIALIZABLE. */
  private materializeResult(raw: unknown): unknown {
    try {
      return materializeFromRealm(raw, 'workflow result')
    } catch (error: unknown) {
      // 中文：覆盖率例外：防御性重抛分支，materializeFromRealm 只抛 MaterializeError。
      /* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */
      if (!(error instanceof MaterializeError)) throw error
      throw new WorkflowError(
        `the workflow's return value is not plain JSON data — ${error.message}. Return only JSON-serializable objects/arrays/scalars.`,
        'RESULT_UNSERIALIZABLE',
        { cause: error },
      )
    }
  }

  // 中文：按 FIFO 获取一个并发槽。取消拒绝排队等待者，调用方自行保护进入前和取得槽之后的窗口，所以此处不重复取消预检。
  /**
   * Acquire one concurrency slot (FIFO). Cancellation rejects QUEUED waiters
   * (see {@link cancel}); the callers guard their own entry and post-acquire
   * windows, so no cancelled-precheck is duplicated here.
   */
  private acquireSlot(): Promise<void> {
    if (this.activeSlots < this.limits.maxConcurrentAgents) {
      this.activeSlots += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      this.slotWaiters.push({
        resolve: () => {
          this.activeSlots += 1
          resolve()
        },
        reject,
      })
    })
  }

  private releaseSlot(): void {
    this.activeSlots -= 1
    const next = this.slotWaiters.shift()
    if (next) next.resolve()
  }

  // 中文：agent(prompt, opts) 钩子。
  /** The `agent(prompt, opts)` hook. */
  private async agent(rawPrompt: unknown, rawOpts: unknown): Promise<unknown> {
    this.throwIfCancelled()
    if (typeof rawPrompt !== 'string' || rawPrompt.length === 0) {
      throw new WorkflowError('agent() requires a non-empty prompt string', 'INVALID_ARGUMENT')
    }
    const opts = this.readAgentOptions(rawOpts)
    if (this.started >= this.limits.maxTotalAgents) {
      throw new WorkflowError(
        `this run reached its total agent cap (${this.limits.maxTotalAgents}) — a runaway-loop backstop; raise the applicable maxTotalAgents limit if the scale is intentional`,
        'AGENT_CAP',
      )
    }
    this.started += 1
    const seq = this.started
    const label = opts.label ?? defaultLabel(rawPrompt)
    const phase = opts.phase ?? this.currentPhase

    await this.acquireSlot()
    try {
      // 中文：取得槽后重新检查：即使槽空闲，await 至少让出一个微任务；排队等待者也在释放后的微任务恢复。任一窗口取消都不得再到宿主，否则虽然宿主会拒绝，却表现为启动失败而非
      // 取消。
      // Re-check after the acquire: the await yields at least one microtask
      // tick even when a slot is free, and a queued waiter resumes a tick
      // after its release — a cancel() landing in either window must not
      // reach the host (which would refuse anyway, but the refusal reads as
      // a start failure rather than the cancellation it is).
      this.throwIfCancelled()
      let run: ChildHandle
      try {
        run = await this.children.startAgent({
          prompt: rawPrompt,
          ...opts.schema !== undefined ? { schema: opts.schema } : {},
          ...opts.provider !== undefined ? { provider: opts.provider } : {},
          ...opts.model !== undefined ? { model: opts.model } : {},
        })
      } catch (error: unknown) {
        // 中文：宿主在取消后拒绝新启动；若拒绝与本地取消状态竞速，应体现为取消，而不是契约损坏。
        // The host refuses starts once the run is cancelled — a refusal that
        // races our own cancel state must read as the cancellation it is,
        // not as a broken contract.
        if (this.isCancelled()) throw this.cancelledError()
        throw new WorkflowError(`agent() could not start a child: ${renderThrown(error)}`, 'AGENT_START', { cause: error })
      }
      // 中文：启动往返会让出事件循环，宿主启动子级到此续接之间可能取消；应清理新子级，不能让它留在已死脚本之后继续存活。
      // The start round-trip yields to the event loop, so a cancel CAN land
      // between the host starting the child and this continuation running —
      // wind the fresh child down instead of leaving it live behind a dead
      // script.
      if (this.isCancelled()) {
        await run.dispose()
        throw this.cancelledError()
      }
      const info: WorkflowAgentInfo = { seq, label, ...phase !== undefined ? { phase } : {}, childId: brandString<SessionId>(run.id) }
      this.observer.agentStart(info)
      try {
        let result
        try {
          result = await run.result
        } catch (error: unknown) {
          // 中文：子级结果 Promise 拒绝是宿主转发的基础设施故障，不同于子级失败但正常完成结果。先配对生命周期再传播致命错误；普通异常会被组合器吞为逐项 null，而损坏提供
          // 方不能伪装成子级失败。
          // A rejected child result is an INFRASTRUCTURE fault relayed by the
          // host — distinct from a child that failed and resolved. Pair the
          // lifecycle before propagating, and propagate FATAL: an ordinary
          // throw would dissolve to a per-item null inside the combinators,
          // and a broken provider must not read as a failed child.
          if (this.isCancelled()) {
            this.observer.agentEnd({ ...info, outcome: 'cancelled' })
            throw this.cancelledError()
          }
          this.observer.agentEnd({ ...info, outcome: 'failed' })
          throw new WorkflowError(`child agent run failed: ${renderThrown(error)}`, 'AGENT_RESULT', { cause: error })
        }
        if (result.stopReason === 'completed') {
          if (opts.schema !== undefined) {
            // 中文：提供方在启动时已通过能力检查承诺 outputSchema，所以 completed 却没有结构化值属于子级失败。
            // The provider honored outputSchema (capability-gated at start), so
            // a completed run without a structured value is a child failure.
            if (result.structured === undefined) {
              this.observer.agentEnd({ ...info, outcome: 'failed' })
              return null
            }
            this.observer.agentEnd({ ...info, outcome: 'completed' })
            return result.structured
          }
          this.observer.agentEnd({ ...info, outcome: 'completed' })
          return outputText(result.output)
        }
        // 中文：整个运行取消会终止脚本；子级因自身原因失败则返回 null，脚本可按 CC 契约 .filter(Boolean)。
        // A cancelled RUN kills the script; a child that failed for its own
        // reasons resolves null (scripts .filter(Boolean) per the CC contract).
        if (this.isCancelled()) {
          this.observer.agentEnd({ ...info, outcome: 'cancelled' })
          throw this.cancelledError()
        }
        this.observer.agentEnd({ ...info, outcome: 'failed' })
        return null
      } finally {
        await run.dispose()
      }
    } finally {
      this.releaseSlot()
    }
  }

  // 中文：实体化并校验来自 realm 的 agent() 选项对象。
  /** Materialize + validate the `agent()` options bag from the realm. */
  private readAgentOptions(rawOpts: unknown): {
    label?: string
    phase?: string
    provider?: string
    model?: string
    schema?: ObjectJsonSchema
  } {
    if (rawOpts === undefined) return {}
    let opts: unknown
    try {
      opts = materializeFromRealm(rawOpts, 'agent() options')
    } catch (error: unknown) {
      // 中文：覆盖率例外：防御性重抛分支，materializeFromRealm 只抛 MaterializeError。
      /* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */
      if (!(error instanceof MaterializeError)) throw error
      throw new WorkflowError(`agent() options must be plain JSON data — ${error.message}`, 'INVALID_ARGUMENT', { cause: error })
    }
    if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
      throw new WorkflowError('agent() options must be an object', 'INVALID_ARGUMENT')
    }
    const record = opts as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (SUPPORTED_AGENT_OPTIONS.has(key)) continue
      if (DEFERRED_AGENT_OPTIONS.has(key)) {
        throw new WorkflowError(`agent() option "${key}" is deferred and not supported by this engine (supported: label, phase, schema, provider, model)`, 'UNSUPPORTED_OPTION')
      }
      throw new WorkflowError(`agent() option "${key}" is not recognized (supported: label, phase, schema, provider, model)`, 'UNSUPPORTED_OPTION')
    }
    for (const key of ['label', 'phase', 'provider', 'model'] as const) {
      if (record[key] !== undefined && typeof record[key] !== 'string') {
        throw new WorkflowError(`agent() option "${key}" must be a string`, 'INVALID_ARGUMENT')
      }
    }
    let schema: ObjectJsonSchema | undefined
    if (record.schema !== undefined) {
      try {
        assertObjectJsonSchema(record.schema)
        schema = record.schema
      } catch (error: unknown) {
        // 中文：覆盖率例外：防御性重抛分支，assertObjectJsonSchema 只抛 JsonSchemaError。
        /* v8 ignore next -- defensive rethrow arm: assertObjectJsonSchema only throws JsonSchemaError */
        if (!(error instanceof JsonSchemaError)) throw error
        throw new WorkflowError(`agent() schema is outside the supported subset — ${error.message}`, 'UNSUPPORTED_SCHEMA', { cause: error })
      }
    }
    return {
      ...record.label !== undefined ? { label: record.label as string } : {},
      ...record.phase !== undefined ? { phase: record.phase as string } : {},
      ...record.provider !== undefined ? { provider: record.provider as string } : {},
      ...record.model !== undefined ? { model: record.model as string } : {},
      ...schema !== undefined ? { schema } : {},
    }
  }

  // 中文：parallel(thunks) 钩子：各 thunk 普通失败转为 null，致命错误传播。
  /** The `parallel(thunks)` hook: each thunk caught → `null`; fatal errors propagate. */
  private async parallel(rawThunks: unknown): Promise<unknown[]> {
    this.throwIfCancelled()
    if (!Array.isArray(rawThunks)) {
      throw new WorkflowError('parallel() requires an array of zero-argument functions', 'INVALID_ARGUMENT')
    }
    this.assertItemCap(rawThunks.length, 'parallel()')
    const thunks = rawThunks.map((thunk, index) => {
      if (typeof thunk !== 'function') {
        throw new WorkflowError(`parallel() item ${index} is not a function`, 'INVALID_ARGUMENT')
      }
      return thunk as () => unknown
    })
    return Promise.all(thunks.map(async (thunk) => {
      try {
        return await thunk()
      } catch (error: unknown) {
        // 中文：钩子错误是在脚本 realm 外构造的 WorkflowError，通过宿主类 instanceof 判定致命性；脚本构造对象无法通过，既不能伪造致命性，也不会意外
        // 将真正致命错误化为 null。
        // Hook failures are WorkflowErrors built OUTSIDE the script's realm;
        // fatality is recognized by `instanceof` against this realm's class —
        // a script-built object can never pass it, so fatality cannot be
        // forged (nor accidentally dissolved).
        if (isFatalWorkflowError(error)) throw error
        return null
      }
    }))
  }

  // 中文：pipeline(items, ...stages) 钩子：每项独立串联阶段，没有跨阶段全局屏障。
  /** The `pipeline(items, ...stages)` hook: per-item stage chains, NO cross-stage barrier. */
  private async pipeline(rawItems: unknown, rawStages: unknown[]): Promise<unknown[]> {
    this.throwIfCancelled()
    if (!Array.isArray(rawItems)) {
      throw new WorkflowError('pipeline() requires an items array', 'INVALID_ARGUMENT')
    }
    this.assertItemCap(rawItems.length, 'pipeline()')
    if (rawStages.length === 0) {
      throw new WorkflowError('pipeline() requires at least one stage function', 'INVALID_ARGUMENT')
    }
    const stages = rawStages.map((stage, index) => {
      if (typeof stage !== 'function') {
        throw new WorkflowError(`pipeline() stage ${index} is not a function`, 'INVALID_ARGUMENT')
      }
      return stage as (previous: unknown, item: unknown, index: number) => unknown
    })
    return Promise.all(rawItems.map(async (item: unknown, index) => {
      let value: unknown = item
      try {
        for (const stage of stages) {
          value = await stage(value, item, index)
        }
        return value
      } catch (error: unknown) {
        // 中文：普通阶段抛错将该项设为 null 并跳过剩余阶段；致命 WorkflowError 终止整个脚本，参见 parallel()。
        // An ordinary stage throw drops the ITEM to null and skips its
        // remaining stages; a fatal WorkflowError (see parallel()) kills the
        // whole script.
        if (isFatalWorkflowError(error)) throw error
        return null
      }
    }))
  }

  private assertItemCap(length: number, hook: string): void {
    if (length > this.limits.maxItemsPerCall) {
      throw new WorkflowError(
        `${hook} received ${length} items — over the per-call cap (${this.limits.maxItemsPerCall}); split the work or raise maxItemsPerCall in the engine config`,
        'ITEM_CAP',
      )
    }
  }

  // 中文：phase(title) 设置后续 agent() 调用的当前标签，并通知观察器。
  /** The `phase(title)` hook: sets the current label for subsequent `agent()` calls and notifies observers. */
  private phase(title: unknown): void {
    this.throwIfCancelled()
    if (typeof title !== 'string' || title.length === 0) {
      throw new WorkflowError('phase() requires a non-empty title string', 'INVALID_ARGUMENT')
    }
    this.currentPhase = title
    this.observer.phase(title)
  }

  // 中文：log(message) 向观察器发送叙述消息。
  /** The `log(message)` hook: narration to observers. */
  private log(message: unknown): void {
    this.throwIfCancelled()
    if (typeof message !== 'string') {
      throw new WorkflowError('log() requires a message string', 'INVALID_ARGUMENT')
    }
    this.observer.log(message)
  }
}

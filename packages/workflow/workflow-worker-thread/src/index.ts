// 中文：Worker 线程工作流引擎：每次运行在新 worker 的可逃逸 vm 上下文执行模型编写脚本，并桥接 agent() 到宿主子代理。线程避免同步脚本阻塞宿主，允
// 许强制终止，但只是运行隔离，不是安全边界。
/**
 * Worker-thread workflow engine. Each run executes its model-written script in
 * an escapable vm context on a fresh worker and bridges `agent()` calls to host
 * subagents. The thread prevents synchronous script work from blocking the host
 * and permits forced termination, but it is containment rather than a security boundary.
 * @module @deepseek-ai/dsh-workflow-worker-thread
 */

import { randomUUID } from 'node:crypto'
import { availableParallelism } from 'node:os'
import * as vm from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import WorkflowEngine, { WorkflowError, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun, WorkflowRunInfo, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { WorkerRun } from './host.ts'
import { validateMeta } from './meta.ts'
import type { WorkerInit, WorkerLimits } from './types.ts'

export { validateMeta } from './meta.ts'
export { materializeFromRealm, MaterializeError } from './realm.ts'
export type {
  ChildHandle,
  ChildPort,
  ChildResult,
  ChildStartRequest,
  WorkerInit,
  WorkerLimits,
} from './types.ts'

// 中文：插件配置全部可选，static Config 提供默认值。
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  // 中文：子级运行所用 ctx.subagents 提供方，默认 spawn。
  /** The `ctx.subagents` provider children run on (default `spawn`). */
  provider?: string
  // 中文：并发 agent() 上限；默认 0 自动解析为 min(16, max(1, cores - 2))。
  /** Concurrent `agent()` ceiling; `0` (the default) auto-resolves to `min(16, max(1, cores - 2))`. */
  maxConcurrentAgents?: number
  // 中文：单次运行可启动的 agent() 总数，防失控循环的兜底上限，默认 1000。
  /** Total `agent()` calls one run may start — the runaway-loop backstop (default 1000). */
  maxTotalAgents?: number
  // 中文：一次 parallel()/pipeline() 接受的条目数，默认 4096。
  /** Items accepted by a single `parallel()`/`pipeline()` call (default 4096). */
  maxItemsPerCall?: number
  // 中文：worker 内脚本初始同步片段的 vm 超时，默认 5000 毫秒。
  /** vm timeout for the script's initial synchronous slice, inside the worker (default 5000 ms). */
  syncTimeoutMs?: number
  // 中文：取消后脚本可继续未结束运行的宽限时间，默认 5000 毫秒；超时强制结算为 cancelled 并终止 worker，同时也限制 dispose()。
  /**
   * How long after a cancellation an unsettled script may keep running before
   * the run force-settles `cancelled` and its worker is TERMINATED (default
   * 5000 ms); also bounds `dispose()`.
   */
  disposeGraceMs?: number
}

type ResolvedConfig = Required<Config>

// 中文：仍包含 Claude Code 风格 meta 头的脚本体；这里 meta 应作为数据跨能力接口传递。
/** A body that still carries the Claude Code-style meta header (meta rides the seam as data here). */
const META_STATEMENT = /^\s*export\s+const\s+meta\b/

// 中文：用与 worker 运行时完全相同的包装器预解析脚本，使 start() 保持同步抛 SCRIPT_PARSE 的契约，而非等返回后的线程编译才失败。刻意每轮多解析
// 一次换取该保证。若以 export const meta 开头，返回明确提示而非普通 SyntaxError，这是模型常见编写错误。
/**
 * Parse-check the body with the SAME wrapper the worker-side runtime
 * compiles, so `start()` keeps the seam's synchronous `SCRIPT_PARSE` throw
 * (the worker's own compile happens a thread away, after `start()` returned).
 * One redundant parse per run, bought deliberately for the contract. A body
 * opening with `export const meta` gets a pointed message instead of the
 * wrapper's bare SyntaxError — the model's likeliest authoring slip.
 */
function assertBodyParses(body: string, name: string): void {
  if (META_STATEMENT.test(body)) {
    throw new WorkflowError('workflow meta rides the `meta` request field, not the script: remove the `export const meta = {...}` statement from the body', 'SCRIPT_PARSE')
  }
  try {
    // 中文：只解析，丢弃脚本对象，不执行内容。
    // Parse only — the script object is discarded, nothing executes.
    void new vm.Script(`(async () => {\n${body}\n})()`, { filename: `workflow:${name}`, lineOffset: -1 })
  } catch (error: unknown) {
    throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error })
  }
}

// 中文：发布工作之前解析本次运行的提供方路由。
/** Resolve one run's provider route before publishing work. */
function resolveSubagentProvider(ctx: Context, configured: string, override: string | undefined): string {
  const provider = override ?? configured
  if (provider.length === 0 || provider !== provider.trim()) {
    throw new WorkflowError(
      'workflow subagentProvider must be a non-empty normalized string',
      'INVALID_ARGUMENT',
    )
  }
  if (ctx.subagents.getProvider(provider) === undefined) {
    throw new WorkflowError(`no subagent provider registered for "${provider}"`, 'AGENT_START')
  }
  return provider
}

// 中文：对照部署上限解析单次运行的子调用总数上限。
/** Resolve one run's total-child cap against the engine deployment ceiling. */
function resolveMaxTotalAgents(requested: number | undefined, ceiling: number): number {
  if (requested === undefined) return ceiling
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new WorkflowError('workflow maxTotalAgents must be a positive safe integer', 'INVALID_ARGUMENT')
  }
  if (requested > ceiling) {
    throw new WorkflowError(
      `workflow maxTotalAgents ${requested} exceeds the engine ceiling ${ceiling}`,
      'INVALID_ARGUMENT',
    )
  }
  return requested
}

// 中文：Worker 线程引擎服务。start() 预先校验 meta 并在宿主解析脚本体，返回 result 从不拒绝的 WorkflowRun；workflow/* 事
// 件按能力契约围绕运行发出。
/**
 * The worker-thread engine service. `start()` validates the script up front
 * (meta + a host-side body parse) and returns a {@link WorkflowRun} whose
 * `result` never rejects; the `workflow/*` events fire around the run per
 * the seam contract.
 */
class WorkerThreadWorkflowEngine extends WorkflowEngine {
  static inject = ['subagents']

  static Config: z<Config> = z.object({
    provider: z.string().default('spawn'),
    maxConcurrentAgents: z.natural().default(0),
    maxTotalAgents: z.natural().min(1).default(1000),
    maxItemsPerCall: z.natural().min(1).default(4096),
    syncTimeoutMs: z.natural().min(1).default(5000),
    disposeGraceMs: z.natural().default(5000),
  })

  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // 中文：schemastery 的 static Config 已填充默认字段；断言记录该解析结果，不是隐藏回退。
    // schemastery (static Config) has already filled the defaulted fields;
    // the assertion records that resolution, not a hidden fallback.
    this.config = config as ResolvedConfig
  }

  // 中文：在新 worker 线程校验并执行脚本。无法开始的请求同步抛 WorkflowError：meta 格式问题为 META_INVALID，脚本不可编译为
  // SCRIPT_PARSE；一旦返回运行，所有失败通过 result.stopReason 表达。request 包含脚本体、meta、args、父智能体及可选取消；返回存
  // 活运行，result 在脚本结束时完成。
  /**
   * Validate and execute a workflow script in a fresh worker thread. Throws
   * {@link WorkflowError} synchronously (`META_INVALID` for a malformed meta
   * block, `SCRIPT_PARSE` for a body that does not compile) for a request
   * that cannot begin; once a run is returned, every failure resolves through
   * `result.stopReason` instead.
   * @param request - the script body, its meta data and `args`, the parent
   *   agent, and an optional cancel signal.
   * @returns the live run (its `result` resolves when the script settles).
   */
  start(request: WorkflowStartRequest): WorkflowRun {
    const meta = validateMeta(request.meta)
    assertBodyParses(request.script, meta.name)
    const subagentProvider = resolveSubagentProvider(this.ctx, this.config.provider, request.subagentProvider)
    const maxTotalAgents = resolveMaxTotalAgents(request.maxTotalAgents, this.config.maxTotalAgents)
    const id = WorkflowRunId(randomUUID())
    const info: WorkflowRunInfo = { id, meta }
    const limits: WorkerLimits = {
      maxConcurrentAgents: this.config.maxConcurrentAgents === 0
        ? Math.min(16, Math.max(1, availableParallelism() - 2))
        : this.config.maxConcurrentAgents,
      maxTotalAgents,
      maxItemsPerCall: this.config.maxItemsPerCall,
      syncTimeoutMs: this.config.syncTimeoutMs,
    }
    const init: WorkerInit = {
      meta,
      body: request.script,
      ...request.args !== undefined ? { args: request.args } : {},
      limits,
    }
    // 中文：服务调用仍经 start() 持有者追踪时捕获依赖。Cordis 返回 SubagentRuntime 句柄时去除引擎提供方遮蔽，所以热卸载移除
    // ctx.workflowEngine 后，已返回运行仍可启动子级。稍后从 WorkerRun 重新解析 this.ctx.subagents 会经过已失活引擎 fiber
    // ，破坏句柄持有者负责生命周期的契约。
    // Capture the dependency while this service call is still traced through
    // the start() holder. Cordis strips the engine-provider shadow when it
    // returns the SubagentRuntime handle, so an already-returned run can keep
    // starting children after an engine HMR unload removes ctx.workflowEngine.
    // Re-resolving `this.ctx.subagents` later from WorkerRun would instead walk
    // the now-inactive engine fiber and break the seam's holder-owned lifetime.
    const runCtx = this.ctx
    const subagents = runCtx.subagents
    const workerRun = new WorkerRun(
      runCtx,
      subagents,
      id,
      meta,
      request.parent,
      init,
      subagentProvider,
      this.config.disposeGraceMs,
      {
        phase: (title) => { this.emitWorkflowEvent('workflow/phase', info, title) },
        log: (message) => { this.emitWorkflowEvent('workflow/log', info, message) },
        agentStart: (agent) => { this.emitWorkflowEvent('workflow/agent-start', info, agent) },
        agentEnd: (agent) => { this.emitWorkflowEvent('workflow/agent-end', info, agent) },
      },
      request.signal,
    )

    this.emitWorkflowEvent('workflow/start', info)
    // 中文：从不拒绝的 result 结束时发出 workflow/end，只含结果数据，结果值仍归运行持有者。
    // `workflow/end` fires as the (never-rejecting) result settles, with the
    // outcome DATA only — the value stays with the run's holder.
    void workerRun.result.then((settled) => {
      this.emitWorkflowEvent('workflow/end', info, {
        stopReason: settled.stopReason,
        ...settled.error !== undefined ? { error: settled.error } : {},
        agentsStarted: settled.agentsStarted,
      })
    })

    return workerRun
  }
}

export default WorkerThreadWorkflowEngine

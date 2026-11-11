// 中文：Workflow 能力的服务定义。提供方执行编排脚本，只供观察的生命周期事件不暴露运行控制权。
/**
 * Service Definition for the workflow capability seam. Service Providers execute orchestration scripts;
 * observe-only lifecycle events never expose run control.
 * @module @deepseek-ai/dsh-workflow
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from './types.ts'
import type { WorkflowRun, WorkflowStartRequest } from './runtime-types.ts'

export { WorkflowRunId } from './types.ts'
export type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowAgentOutcome,
  WorkflowMeta,
  WorkflowPhase,
  WorkflowResult,
  WorkflowResultInfo,
  WorkflowRunInfo,
  WorkflowStopReason,
} from './types.ts'
export type { WorkflowRun, WorkflowStartRequest } from './runtime-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workflowEngine: WorkflowEngine
  }

  interface Events {
    // 中文：工作流开始：meta 已校验，脚本体即将执行。与 workflow/end 配对。info 为 id+meta 身份快照，模式 emit。
    /**
     * A workflow run started — the script's meta block validated, the body
     * about to execute. Paired with {@link Events['workflow/end']}.
     * @param info - the run's identity snapshot (id + meta).
     * @mode emit
     */
    'workflow/start'(info: WorkflowRunInfo): void
    // 中文：脚本调用 phase(title) 进入阶段，只供观察器分组进度，没有执行语义。info 为身份快照，title 原样传递；模式 emit。
    /**
     * The script entered a phase (a `phase(title)` call) — progress grouping
     * for observers; no execution semantics.
     * @param info - the run's identity snapshot.
     * @param title - the phase title, verbatim.
     * @mode emit
     */
    'workflow/phase'(info: WorkflowRunInfo, title: string): void
    // 中文：脚本通过 log(message) 发出叙述文本。info 为身份快照，message 原样传递；模式 emit。
    /**
     * The script emitted a narration line (a `log(message)` call).
     * @param info - the run's identity snapshot.
     * @param message - the logged message, verbatim.
     * @mode emit
     */
    'workflow/log'(info: WorkflowRunInfo, message: string): void
    // 中文：agent() 调用建立已发布的子运行，按 agent.seq 与 workflow/agent-end 配对。未从提供方取得已发布运行时，这对事件均不发出。
    // info 为运行快照，agent 含序号、标签、阶段、子 ID；模式 emit。
    /**
     * One `agent()` call established a published child run. Paired with
     * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
     * receives a published run from the provider emits neither
     * event in this pair.
     * @param info - the run's identity snapshot.
     * @param agent - the call's sequence number, label, phase, and child id.
     * @mode emit
     */
    'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
    // 中文：agent() 调用结束，可能成功、子级失败或取消。每条停止路径上对已开始调用按 agent.seq 恰好配对一次结束；worker 超过宽限被杀时，由引擎合成
    // cancelled 结果。info 为快照，agent 含身份及结果；模式 emit。
    /**
     * One `agent()` call settled (clean result, child failure, or run
     * cancellation). Paired with {@link Events['workflow/agent-start']} by
     * `agent.seq`, exactly once per started call on every stop path — on an
     * engine termination path (a worker killed past its grace) the end is
     * engine-synthesized with outcome `'cancelled'`.
     * @param info - the run's identity snapshot.
     * @param agent - the call identity plus its outcome.
     * @mode emit
     */
    'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
    // 中文：工作流以任意原因结束，在 WorkflowRun.result 完成时发出，与 workflow/start 配对。info 为身份快照，result 仅含停止原因
    // 、错误、智能体数量等数据，刻意不含结果值；模式 emit。
    /**
     * A workflow run settled (any stop reason). Fired when
     * {@link WorkflowRun.result} resolves. Paired with
     * {@link Events['workflow/start']}.
     * @param info - the run's identity snapshot.
     * @param result - the outcome data (stop reason, error, agent count) —
     *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
     * @mode emit
     */
    'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
  }
}

// 中文：WorkflowEngine.emitWorkflowEvent 分发的完整 workflow/* 事件名集合。
/** The full set of `workflow/*` event names {@link WorkflowEngine.emitWorkflowEvent} dispatches. */
export type WorkflowEventName =
  | 'workflow/start'
  | 'workflow/phase'
  | 'workflow/log'
  | 'workflow/agent-start'
  | 'workflow/agent-end'
  | 'workflow/end'

// 中文：机器可路由的工作流致命失败：解析、meta、参数或 schema 错误、资源上限、子代理基础设施失败、跨边界值不可序列化及取消。普通子级失败只将对应项设为 null
// ，不属于这些致命码。
/**
 * Machine-routable fatal workflow failures: parse/meta/argument/schema errors,
 * resource caps, subagent infrastructure failures, unserializable boundary
 * values, and cancellation. An ordinary child failure resolves its item to
 * `null` and is not one of these fatal codes.
 */
export type WorkflowErrorCode =
  | 'SCRIPT_PARSE'
  | 'META_INVALID'
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_OPTION'
  | 'UNSUPPORTED_SCHEMA'
  | 'AGENT_CAP'
  | 'ITEM_CAP'
  | 'AGENT_START'
  | 'AGENT_RESULT'
  | 'RESULT_UNSERIALIZABLE'
  | 'CANCELLED'

// 中文：工作流能力的类型化错误，继承 HarnessError，以 code 提供可路由分类。fatal 决定组合器行为：parallel/pipeline 必须重抛致命错
// 误，选项拼错或触及上限应明确终止脚本；每项 null 只留给子运行失败及普通阶段脚本错误。所有 WorkflowErrorCode 都致命，保留标志是为了每个 catch
//  明确区分。
/**
 * Typed error for workflow-seam failures. Extends {@link HarnessError}, so the
 * `code` is machine-routable taxonomy. `fatal` drives the combinator
 * discipline: `parallel()`/`pipeline()` re-throw a fatal error (a typo'd
 * option or a tripped cap must kill the script loudly), and reserve the
 * per-item `null` for child-run failures and ordinary in-stage script errors.
 * Every {@link WorkflowErrorCode} is fatal; the flag exists so the
 * distinction is explicit at every catch site rather than implied.
 */
export class WorkflowError extends HarnessError {
  // 中文：组合器是否必须传播此错误，而非把当前项设为 null。
  /** Whether combinators must propagate this error instead of nulling the item. */
  readonly fatal: boolean

  constructor(message: string, code: WorkflowErrorCode, options?: ErrorOptions & { fatal?: boolean }) {
    super(message, code, options)
    this.name = 'WorkflowError'
    this.fatal = options?.fatal ?? true
  }
}

// 中文：判断是否必须重抛 error 而非映射为 null；致命性通过宿主 instanceof 判定，脚本 realm 无法伪造。仅 WorkflowError 且
// fatal 已设置时返回 true。
/**
 * Whether combinators must re-throw `error` instead of mapping the item to `null`.
 * @param error - any thrown value; fatality is host `instanceof` (unforgeable from a script realm).
 * @returns true iff `error` is a {@link WorkflowError} whose `fatal` flag is set.
 */
export function isFatalWorkflowError(error: unknown): boolean {
  return error instanceof WorkflowError && error.fatal
}

// 中文：Workflow 服务定义契约：无效请求在发布前抛错；存活运行由句柄持有者负责，result 从不拒绝；取消和释放有时间上限，释放在限内等待子级清理。监听器失败被隔
// 离，结果结束时 workflow/end 恰好发出一次。
/**
 * Workflow Service Definition contract. Invalid requests throw before publication; a live
 * run is holder-owned, its result never rejects, cancellation and disposal are
 * bounded, and disposal waits for child cleanup within that bound. Lifecycle
 * listener failures are contained, and `workflow/end` fires exactly once as the
 * result settles.
 */
export abstract class WorkflowEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workflowEngine')
  }

  // 中文：解析并执行工作流脚本。request 含脚本、args、父智能体及可选取消信号；返回存活运行，其 result 在脚本结束时完成。
  /**
   * Parse and execute a workflow script.
   * @param request - the script, its `args`, the parent agent, and an
   *   optional cancel signal.
   * @returns the live run; its `result` resolves when the script settles.
   */
  abstract start(request: WorkflowStartRequest): WorkflowRun

  // 中文：发出生命周期事件，隔离并记录每个监听器失败。name 为 workflow/* 名称，args 与事件声明的载荷签名匹配。
  /**
   * Emit a lifecycle event while containing and logging each listener failure.
   * @param name - the `workflow/*` event to dispatch.
   * @param args - the event's payload, matching its declared signature.
   */
  protected emitWorkflowEvent(name: WorkflowEventName, ...args: unknown[]): void {
    for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
      try {
        const returned: unknown = (callback as (...payload: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`workflow: ${name} listener rejected: ${renderListenerError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`workflow: ${name} listener threw: ${renderListenerError(error)}`)
      }
    }
  }
}

// 中文：渲染任意抛出值而不破坏监听器错误隔离。error 为任意值；返回 String(error)，转换本身抛错时返回固定标签。
/**
 * Render any thrown value without violating listener containment.
 * @param error - any thrown value.
 * @returns `String(error)`, or a fixed label when even coercion throws.
 */
function renderListenerError(error: unknown): string {
  try {
    return String(error)
  } catch {
    // 中文：字符串强制转换本身也可能抛错。
    // String coercion itself may throw.
    return '[unrenderable thrown value]'
  }
}

export default WorkflowEngine

// 中文：工具注册表、模型呈现模式，以及 pre/guard/around/post/result 执行管线。
/**
 * Tool registry, model presentation modes, and pre/guard/around/post/result
 * execution pipeline.
 * @module @deepseek-ai/dsh-tools
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AnonymousEntries, NamedEntries, ScopedLayers, scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer, Scoped } from '@deepseek-ai/dsh-scope'
import type { ToolCallId, ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { assertNever, deepFreeze, snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolProviderResult } from '@deepseek-ai/dsh-system-prompt'
import type { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
// 中文：仅用于类型：让 ctx.get('approval') 解析为 ApprovalService 的声明扩展。运行时此能力仍可选，参见 serviceAsk。
// Type-only: makes `ctx.get('approval')` resolve to the ApprovalService
// augmentation. The seam stays optional at runtime — see `serviceAsk`.
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ToolCallView, ToolResultView } from './presentation.ts'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from './json-schema.ts'
import type { JsonSchemaNode } from './json-schema.ts'
import { createRunCodeTool, RUN_CODE_NAME } from './ptc.ts'
import type { CodeSdkLanguage } from './ptc.ts'
import { renderToolsSdk } from './ts-types.ts'
import type { ToolSdkSchema } from './ts-types.ts'
import { renderToolsSdkPy } from './py-types.ts'

// 中文：语言到 SDK 段落渲染器的映射。非 native 模式组装 tools:sdk 时按 ctx.codeRuntime.language 查表，语言无对应项则明确失
// 败，与 toolOrder 违规一致。新增后端语言须同时修改 CodeSdkLanguage 成员、本表、ptc.ts 的 RUN_CODE_FLAVORS 中
// run_code schema 字符串，并实现渲染函数；satisfies 与类型检查约束各表键一致。自动检查不覆盖仅在文字中列举这些值的文档：
// dsh-code-runtime 双语 README、CodeRuntime.language JSDoc、code-runtime 子系统双语文档、本包双语
// README 和 Config.mode JSDoc 也需同步。
/**
 * Language → SDK-section renderer. The registry looks up the loaded
 * `ctx.codeRuntime.language` in this table when assembling the `tools:sdk`
 * section under a non-native mode; a runtime whose language is not a key
 * fails the assembly loudly (same idiom as `toolOrder` violations). Adding a
 * new backend language is three parallel edits — a {@link CodeSdkLanguage}
 * member, an entry here, and a `RUN_CODE_FLAVORS` entry in `ptc.ts` for
 * its `run_code` schema strings — plus the renderer function this table points
 * at. The `satisfies` clause pins this table's key set to that union, which
 * the flavor table is checked against too, so any of the three left out is a
 * typecheck failure. What no check reaches is the prose that names the values
 * instead of deriving them: the seam's `dsh-code-runtime` README pair, its
 * `CodeRuntime.language` JSDoc, and `docs/subsystems/code-runtime.md`
 * with its zh pair, plus this package's own README pair and the
 * {@link Config.mode} JSDoc.
 */
// 中文：向模型说明 ptc 接口收敛的语句，同时说明后果（调用失败）和正确路径（在程序内部调用），避免模型直到被拒绝才发现规则、纠正过晚。
/**
 * The model-facing statement of the `ptc` collapse. Names the consequence
 * (the call fails) and the route (inside the program), because a rule the
 * model can only discover by being denied is one it corrects too late.
 */
const PTC_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`

const SDK_RENDERERS: Record<string, (schemas: ToolSdkSchema[]) => string> = {
  typescript: renderToolsSdk,
  python: renderToolsSdkPy,
} satisfies Record<CodeSdkLanguage, (schemas: ToolSdkSchema[]) => string>

export {
  defineTool,
  valueSchemaSpecToJsonSchema,
  parameterSchemaSpecToJsonSchema,
  validateArgs,
  ToolArgsError,
  type ValueSchemaAnnotations,
  type StringValueSchemaSpec,
  type NumberValueSchemaSpec,
  type IntegerValueSchemaSpec,
  type BooleanValueSchemaSpec,
  type NullValueSchemaSpec,
  type ArrayValueSchemaSpec,
  type ObjectValueSchemaSpec,
  type JsonValueSchemaSpec,
  type OneOfValueSchemaSpec,
  type ValueSchemaSpec,
  type ParameterPropertySpec,
  type ParameterSchemaSpec,
  type ParameterJsonSchema,
  type InferValue,
  type InferArgs,
  type DefineToolOptions,
} from './schema.ts'

export {
  assertSupportedJsonSchema,
  assertObjectJsonSchema,
  validateJsonSchemaValue,
  JsonSchemaError,
  type JsonSchemaNode,
  type ObjectJsonSchema,
  type JsonSchemaType,
  type JsonSchemaScalar,
} from './json-schema.ts'

export type { PtcDispatchEventData, PtcDispatchStartEventData } from './types.ts'

export { CodeRunFailedError, RUN_CODE_NAME } from './ptc.ts'
export { jsonSchemaToTs, renderToolsSdk } from './ts-types.ts'
export { jsonSchemaToPy, renderToolsSdkPy } from './py-types.ts'
export { defineContentToolFixture, type ContentToolFixtureOptions } from './testing.ts'

// 中文：工具通过 presentCall/presentResult 声明的渲染意图类型放在独立界面模块；此处重导出，使 @deepseek-ai/dsh-tools 仍是
// 工具提供方和界面适配器的统一公开 API。
// The render-intent vocabulary a tool declares via `presentCall`/`presentResult`
// lives in its own UI-facing module; re-export it so `@deepseek-ai/dsh-tools`
// stays the single public API for tool producers and UI adapters.
export type {
  ToolCallKind,
  FileLocation,
  FileDiff,
  ReadFileLine,
  ToolCallView,
  GenericCallView,
  TerminalCallView,
  DiffCallView,
  ToolResultView,
  GenericResultView,
  TerminalResultView,
  DiffResultView,
  SearchResultView,
  SearchMatchesResultView,
  SearchPathsResultView,
  SearchFileMatches,
  SearchLineMatch,
  ReadResultView,
  WebResultView,
  WebSearchResultView,
  WebFetchResultView,
  WebSource,
} from './presentation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: ToolRuntime
  }

  interface Events {
    // 中文：分发前允许、拒绝或询问。next() 委托为允许；没有审批支持时 ask 转为拒绝。异步门禁必须响应 exec.signal；注册表在其结束后复查取消，但不会丢弃其
    //  Promise。按作用域过滤，智能体监听器只接收该智能体调用。exec 包含待执行名称、已解析参数及调用方智能体；模式为 waterfall。
    /**
     * Allow, deny, or ask before dispatch. `next()` delegates to allow; missing
     * approval support turns `ask` into denial. Async gates must observe
     * `exec.signal`; the registry rechecks cancellation after they settle but
     * never abandons their promise.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
     * @param exec - the pending call (name, parsed arguments, caller agent).
     * @mode waterfall
     */
    'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
    // 中文：包围分发的 waterfall，用于超时、重试或指标。next() 返回规范化结果，包装器只能改 exec.signal，调用身份不可变。工具体前注册表重新合并原调
    // 用方信号，替换信号不能脱离调用方取消；包装器仍须恢复信号并等待自身工作静止。按智能体作用域过滤；exec 为获准且即将分发的调用，含名称、参数、智能体和信号；模式为
    // waterfall。
    /**
     * Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns
     * a normalized result; wrappers may change only `exec.signal`, while call
     * identity remains immutable. The registry re-fuses the original caller
     * signal before the body, so replacement cannot detach caller cancellation;
     * wrappers must still restore their signal and reach quiescence.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
     * @param exec - the allowed call about to dispatch (name, parsed arguments, caller agent, signal).
     * @mode waterfall
     */
    'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
    // 中文：接受、替换、补充或阻止规范化分发结果。next() 原样接受；工具抛错也以错误结果进入此 waterfall。异步监听器须响应 exec.signal；结束后，调用
    // 方取消只替换已接受的成功结果，错误码取决于工具体是否已调用。按智能体作用域过滤；exec 为刚运行的调用，result 为可接受、替换或阻止的结果；模式为
    // waterfall。
    /**
     * Accept, replace, enrich, or block a normalized dispatch result. `next()`
     * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
     * listeners must observe `exec.signal`; after they settle, caller
     * cancellation replaces only a successful accepted outcome with the code
     * selected by whether the tool body was invoked.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
     * @param exec - the call that just ran (name, parsed arguments, caller agent).
     * @param result - the dispatch outcome a listener may accept, replace, or block.
     * @mode waterfall
     */
    'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>
    // 中文：在桥接层追加 tool/ptc-dispatch 前，允许替换某次 run_code 子分发结果的持久日志副本内容。next() 保持原内容，也可返回替代块，如超大
    // 文本的预览加定位信息。仅影响日志副本：程序已收到完整值，模型两者都看不到。监听器抛错会被隔离，回退为记录原始已结束内容。按智能体作用域过滤；dispatch 包含父执行、
    // 子调用身份及待记录内容；模式为 waterfall。
    /**
     * Allow a listener to replace content in the DURABLE LOG COPY of one
     * `run_code` sub-dispatch outcome before the bridge appends its
     * `tool/ptc-dispatch` event. `next()` keeps the
     * content unchanged; a listener may return replacement blocks (e.g. the
     * spill policy's preview + locator for an oversized text result). Only the
     * logged copy is affected — the program already received the complete
     * value, and the model sees neither. A throwing listener is contained:
     * the bridge falls back to logging the original settled content.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.
     * @param dispatch - the parent execution, sub-call identity, and the settled content to log.
     * @mode waterfall
     */
    'tools/ptc-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: PtcDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>
    // 中文：观察冻结且可无损 JSON 表示的最终结果，监听器失败被隔离。按 exec.agent 过滤作用域。exec 为经过管线的执行对象，result 为最终返回结果的深
    // 冻结快照；模式为 emit。
    /**
     * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.
     * @param exec - the execution object that traversed the pipeline.
     * @param result - a deep-frozen snapshot of the final returned result.
     * @mode emit
     */
    'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
    // 中文：工具注册、注销或作用域限制变化，即可用工具集变化，可能只影响单个作用域。这是未按作用域过滤的注册表通知：全局变更关系到每个智能体的下次组装，所以作用域监听器也接收所
    // 有变化，而非仅自身作用域；模式为 emit。
    /**
     * A tool was registered or unregistered, or a scoped restriction changed
     * (the available tool set changed — possibly for one scope only). An
     * UNFILTERED registry-subject notification, deliberately not scope-filtered
     * dispatch: a global change concerns every agent's next assembly, so a
     * scoped listener subscribing here sees every change, not just its own
     * scope's.
     * @mode emit
     */
    'tools/change'(): void
  }
}

// 中文：工具体返回 JSON 值后使用的工具自有规范输出契约。
/** Tool-owned canonical output contract used after the body returns a JSON value. */
export interface ToolOutputDefinition {
  // 中文：对每个成功的规范值强制执行的受支持原始 JSON Schema。
  /** Raw supported JSON Schema enforced against every successful canonical value. */
  readonly schema: JsonSchemaNode
  // 中文：将已校验参数和值投影为 Native／模型内容的纯函数。
  /** Pure projection from validated arguments and value to Native/model content. */
  render(args: unknown, value: JsonValue): ContentBlock[]
  // 中文：可重放的纯呈现投影，仅对顶层调用计算。
  /** Pure replayable presentation projection, computed only for top-level calls. */
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}

// 中文：已注册工具：schema 加执行函数。
/** A registered tool: its schema plus the execution function. */
export interface ToolDefinition extends ToolSchema {
  // 中文：必填的规范输出声明。
  /** Mandatory canonical output declaration. */
  readonly output: ToolOutputDefinition
  // 中文：运行获准调用，仅返回其规范的无损 JSON 值。异步工作须响应或转发 exec.signal，并等自身工作静止后才结束。注册表在 around-dispatch 替
  // 换信号时保留调用方取消，且不放弃此 Promise，但不能强制杀死同进程代码。args 为无损快照且冻结的模型参数；exec 含执行身份、取消信号及上下文延迟；返回
  // output.schema 声明的规范值。
  /**
   * Run one accepted call and return only its canonical lossless-JSON value.
   * Async work must observe or forward `exec.signal` and settle only after its
   * owned work reaches quiescence. The registry preserves caller cancellation
   * through around-dispatch signal replacement and does not abandon this
   * promise, but it cannot hard-kill same-process code.
   * @param args - losslessly snapshotted, frozen model arguments.
   * @param exec - execution identity, cancellation signal, and context deferral.
   * @returns the canonical value declared by `output.schema`.
   */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  // 中文：面向模型内容的最终同步变换。注册表在执行开始时保存回调，并在每个规范化结果无损实体化前恰好调用一次，包括绕过 tools/post-execute 的管线失败。返回
  //  undefined 保留内容；其他结果字段仍由注册表负责。回调必须对所有输入有定义且不得抛错。exec 为不可变身份与参数，result 为实体化前完整结果；返回替代内
  // 容或 undefined。
  /**
   * Synchronous last-mile transform for model-facing content. The registry
   * snapshots this callback when execution starts and invokes it exactly once
   * for every normalized outcome, including pipeline failures that bypass
   * `tools/post-execute`, immediately before lossless materialization.
   * Returning `undefined` preserves the content; every other result field
   * remains registry-owned. The callback must be total and must not throw.
   * @param exec - immutable execution identity and arguments.
   * @param result - complete normalized outcome before materialization.
   * @returns replacement content, or `undefined` to preserve it.
   */
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  // 中文：协作式工具调用超时预算，单位毫秒，省略表示无截止时间。由 dsh-tool-call-timeout-policy 的 tools/execute 包装器执行；不发
  // 送给模型，schemas() 只允许名称、描述和参数。声明此值意味着工具会将 exec.signal 转发到可在取消后静止的协作实现。
  /**
   * Cooperative tool-call timeout budget in milliseconds. Omit for no deadline.
   * Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper); it
   * is NEVER sent to the model — `schemas()` whitelists only name/description/
   * parameters. Declaring it asserts this tool forwards `exec.signal` to a
   * cooperative implementation that can reach quiescence when the signal aborts.
   */
  timeoutMs?: number
  // 中文：判断是否允许与同组工具调用重叠执行的纯同步分类器。只有 true 才允许；省略、抛错、非 true 返回或无效 defineTool 参数都视为独占。此元数据不对模
  // 型可见。允许并行的执行不得修改父级状态，共享状态须支持并发；记录器竞态只有可交换或默认拒绝时才允许。完整契约见链接的并行工具调用说明。args 为已解析且由
  // defineTool 预先校验的参数；返回是否可加入并行组。
  /**
   * Pure synchronous classifier for overlap with sibling tool calls. Only
   * `true` opts in; omission, exceptions, non-`true` returns, and invalid
   * `defineTool` arguments are exclusive. This metadata is never model-visible.
   *
   * Opted-in executions must not mutate parent-owned state. Shared state must
   * tolerate concurrent dispatch; recorder races are permitted only when they
   * commute or fail closed. See the
   * [parallel-tool-call Agent Note](../../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)
   * for the full contract.
   * @param args - parsed arguments; `defineTool` validates before calling.
   * @returns Whether this call may join a parallel group.
   */
  isConcurrencySafe?(args: unknown): boolean
  // 中文：可选的调用待处理状态界面投影，仅依赖 args。参数为 unknown，由工具自行校验和缩窄；返回带 card 标签的 ToolCallView，省略或返回
  // undefined 则使用工具名标题及原始参数的通用展示。必须纯粹无副作用，因为实时流和日志重放都可能调用。
  /**
   * Optional: how to present the PENDING state of one call in a UI, derived from
   * the call's `args` (parsed arguments, `unknown` — the tool validates/narrows
   * its own input). Returns a {@link ToolCallView} (a `card`-tagged render intent),
   * or `undefined` (or omit the method) to fall back to a generic presentation
   * (title = tool name, raw args as input). Pure and side-effect-free: a UI may
   * call it during live streaming AND a session-log replay, so it must depend
   * only on `args`.
   */
  presentCall?(args: unknown): ToolCallView | undefined
  // 中文：可选的已完成状态投影，输入相同 args 和持久结果投影（content、失败状态及可选 meta）。返回 ToolResultView；省略或返回
  // undefined 则保留待处理标题并展示原始结果。为支持重放，必须纯粹无副作用。
  /**
   * Optional: how to present the COMPLETED state, given the same `args` and the
   * durable result projection (`content`, failure state, and optional `meta`). Returns a
   * {@link ToolResultView}, or `undefined` (or omit the method) to keep the
   * pending title and render the raw result content. Pure and side-effect-free
   * for the same replay reason.
   */
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}

// 中文：传给 ToolDefinition.presentResult 的已完成结果。
/** The completed outcome handed to {@link ToolDefinition.presentResult}. */
export interface ToolResult {
  // 中文：最终面向模型的内容，失败时为渲染后的错误文本。
  /** The final model-facing content (or the rendered error text on failure). */
  content: ContentBlock[]
  // 中文：调用是否失败。
  /** Whether the call failed. */
  isError: boolean
  // 中文：由工具输出声明投影的私有呈现数据，原样持久化在 tool/result，供宿主呈现器和客户端渲染器独立缩窄类型。未声明投影器或调用嵌套于组合传输时缺失。
  /**
   * The tool-private presentation payload projected by its output declaration.
   * It is persisted verbatim on `tool/result` for Host presenters and Client
   * renderers to narrow independently. Absent when the tool declared no
   * projector or the call was nested under a composite transport.
   */
  meta?: JsonValue
}

declare const toolExecutionTokenBrand: unique symbol

// 中文：不透明调用身份，用于关联而不暴露可变执行状态。
/** Opaque call identity that permits correlation without exposing mutable execution state. */
export type ToolExecutionToken = symbol & { readonly [toolExecutionTokenBrand]: true }

// 中文：调用方提供的工具调用描述；ToolRuntime.execute 添加注册表持有的 token，形成管线 ToolExecution；token 不由调用方选择。
/**
 * Caller-supplied description of one tool call. {@link ToolRuntime.execute}
 * adds the registry-owned token to form a pipeline {@link ToolExecution};
 * callers do not choose that token.
 */
export interface ToolExecutionInput {
  readonly callId: ToolCallId
  // 中文：拥有此执行树的模型请求根调用。根执行省略，嵌套分发器传播外层值。
  /**
   * Root model-requested call owning this execution tree. Callers omit it for
   * a root execution; nested dispatchers propagate the enclosing value.
   */
  readonly rootCallId?: ToolCallId
  readonly name: string
  // 中文：可无损 JSON 序列化的已解析参数，工具自行校验 schema。
  /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
  readonly arguments: unknown
  // 中文：调用所代表的智能体，由智能体循环设置。
  /** The agent on whose behalf the call runs (set by the agent loop). */
  readonly agent?: Agent
  // 中文：外层传输执行的不透明 token（如果存在）。PTC 为 SDK 子分发设置此值，让提交型观察器等待外层 run_code 结果而不接收可变执行对象。它也标识调用是
  // 传输子分发而非模型直调；ptc 模式仅带 parent 的调用可执行原生工具名，无 parent 的模型直调在策略管线前被拒绝为 UNKNOWN_TOOL。
  /**
   * Opaque token of the enclosing transport execution, when one exists. PTC
   * mode sets this on SDK sub-dispatches so commit-style observers can wait for
   * the outer `run_code` outcome without receiving its live mutable execution.
   * The token also marks the call as a transport sub-dispatch rather than a
   * model-direct call: under `mode: 'ptc'`, only calls WITH a parent may
   * execute a native tool name — a model-direct call (no parent) is denied as
   * `UNKNOWN_TOOL` before the policy pipeline. See {@link ToolRuntime.execute}.
   */
  readonly parent?: ToolExecutionToken
  // 中文：本次调用必需的调用方自有取消信号。
  /** Required caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
}

// 中文：待处理调用的调度模式：parallel 可与同组调用重叠，exclusive 独占并形成顺序屏障。
/**
 * Scheduling mode for one pending call. `parallel` may overlap with siblings;
 * `exclusive` runs alone and forms an ordering barrier.
 */
export type ToolExecutionMode =
  | { kind: 'parallel' }
  | { kind: 'exclusive' }

// 中文：tools/ptc-dispatch-log waterfall 看到的即将记录的已结束 run_code 子分发，包括父执行（会话所有者及外层身份）、子调用身份及
// 可重塑日志副本的结果。content 是已渲染结果投影，相当于原生 tool/result 内容；程序收到的是结构化 value，失败时只收到错误消息。仅
// tool/ptc-dispatch 事件副本会变化。
/**
 * One settled `run_code` sub-dispatch about to be logged, as seen by the
 * `tools/ptc-dispatch-log` waterfall: the parent execution (session owner,
 * outer call identity), the sub-call identity, and the outcome whose durable
 * copy a listener may reshape. `content` is the RENDERED result projection
 * (what a native `tool/result` would carry) — the program itself received
 * the structured `value` (or just the error message on failure); only the
 * `tool/ptc-dispatch` event's copy changes.
 */
export interface PtcDispatchLog {
  // 中文：外层 run_code 执行。
  /** The outer `run_code` execution. */
  readonly exec: ToolExecution
  // 中文：外层调用的智能体（如果有），用于作用域路由及溢出内容所有权。
  /** The calling agent (the scope routing key and the spill owner), when the outer call has one. */
  readonly agent?: Agent
  // 中文：不透明子调用 ID，新调用使用 <parent>:ptc:<n>。
  /** Opaque sub-call id; new calls use `<parent>:ptc:<n>`. */
  readonly subCallId: ToolCallId
  // 中文：已分发的子工具名称。
  /** The dispatched sub-tool name. */
  readonly name: string
  // 中文：子调用是否以错误结束。
  /** Whether the sub-call settled as an error. */
  readonly isError: boolean
  // 中文：子调用完整的模型可见内容，作为结束事件的默认载荷。
  /** The sub-call's complete model-facing content (the settle event's default payload). */
  readonly content: ContentBlock[]
}

// 中文：注册表管线中的待处理工具调用。参数在策略前经过一次无损 JSON 实体化并深冻结；调用身份、调用方信号和注册表分配的 token 只读。tools/result 观
// 察器运行前注册表冻结完整对象。
/**
 * One pending tool call inside the registry pipeline. Parsed arguments cross
 * one lossless-JSON materialization boundary before policy and are deep-frozen;
 * call identity, the caller signal, and the registry-assigned {@link token} are
 * readonly. The registry freezes the complete object before `tools/result`
 * observers run.
 */
export interface ToolExecution extends ToolExecutionInput {
  // 中文：为所有根执行和嵌套执行解析出的模型请求根调用。
  /** Root model-requested call, resolved for every root and nested execution. */
  readonly rootCallId: ToolCallId
  // 中文：注册表分配的身份，仅以不透明 parent token 形式与嵌套调用共享。
  /** Registry-assigned identity shared with nested calls only as their opaque `parent` token. */
  readonly token: ToolExecutionToken
}

// 中文：ToolExecution 的 around-dispatch 视图。tools/execute 包装器可在其委托生命周期中替换信号，但不能移除；注册表将每个替代信
// 号与已捕获的调用方信号合并。
/**
 * Around-dispatch view of a {@link ToolExecution}. A `tools/execute` wrapper
 * may replace the signal for its delegated lifetime, but it cannot remove it.
 * The registry fuses every replacement with the captured caller signal.
 */
export interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> {
  // 中文：下一层包装器或工具体可见的取消信号。
  /** Cancellation signal visible to the next wrapper or tool body. */
  signal: AbortSignal
}

// 中文：注册表接受 ToolExecution 后交给工具实现的运行时上下文。deferContext 将上下文附到本次执行结果；组合工具把嵌套分发上下文带回外层，叶工具可
// 生成新的插件来源指令；循环仅在 tool/result 后追加。
/**
 * Runtime context handed to a tool implementation after the registry has
 * accepted a {@link ToolExecution}. {@link deferContext} attaches context to
 * this execution's own result — a composite tool ferries nested-dispatch
 * context back to the outer result, and a leaf tool may mint a fresh
 * plugin-sourced instruction; the loop appends it only after the
 * `tool/result`.
 */
export interface ToolRunContext extends ToolExecution {
  // 中文：延迟一个上下文，通常为组合工具转送的嵌套上下文或新插件指令，直到本工具最终结果到达循环。各上下文保留独立来源和元数据，按调用顺序发出。
  /**
   * Defer one context — typically a nested-dispatch context ferried by a
   * composite tool, or a fresh plugin-sourced instruction — until this tool's
   * final result reaches the agent loop. Contexts retain their individual
   * source and metadata and are emitted in call order.
   */
  deferContext(context: UserMessage): void
  // 中文：将成功的最终结果标记为当前轮次终点。标记附于本次执行结果，concludesTurn 仅存在于 ToolExecutionSuccess；组合工具像转发
  // additionalContexts 一样从嵌套结果转发标记，因此只有权威嵌套成功能结束外层运行。
  /**
   * Mark a successful final result as terminal for the current agent turn.
   * The marker rides this execution's own result (`concludesTurn` exists only
   * on {@link ToolExecutionSuccess}); a composite that dispatches nested
   * calls forwards it from the nested result, exactly like
   * `additionalContexts`, so only an authoritative nested success can
   * conclude the enclosing run.
   */
  concludeTurn(): void
}

// 中文：注册表持有的实时执行对象，对外管线视图保持只读。
/** Registry-owned live execution object; public pipeline views stay readonly. */
type MutableToolRunContext = Omit<ToolRunContext, 'signal'> & { signal: AbortSignal }

// 中文：仅供调度器使用、经过有序 pre-execute 和 guard 后的结果。post-result 仍执行 post-execute；final-result 绕过
// 它。内部接口。
/**
 * Scheduler-only result after ordered pre-execute and guards. A `post-result`
 * still receives post-execute; a `final-result` bypasses it.
 * @internal
 */
export type ScheduledToolPreparation =
  | { kind: 'dispatch'; exec: ToolRunContext }
  | { kind: 'post-result'; exec: ToolRunContext; result: ToolExecutionResult }
  | { kind: 'final-result'; exec: ToolRunContext; result: ToolExecutionResult }

// 中文：仅供调度器使用的分发结果。post-result 仍执行 post-execute；final-result 已符合 ToolRuntime.execute 的失败
// 语义。内部接口。
/**
 * Scheduler-only dispatch result. A `post-result` still receives post-execute;
 * a `final-result` already matches {@link ToolRuntime.execute} failure semantics.
 * @internal
 */
export type ScheduledToolDispatch =
  | { kind: 'post-result'; result: ToolExecutionResult }
  | { kind: 'final-result'; result: ToolExecutionResult }

// 中文：以 Symbol 为键的调度视图，在分发重叠时保持前后策略有序。普通调用方使用 ToolRuntime.execute；这不是插件扩展点。
/**
 * Symbol-keyed scheduler view that keeps pre/post policy ordered while
 * overlapping dispatch. Ordinary callers use {@link ToolRuntime.execute};
 * this is not a plugin extension point.
 * @internal
 */
export interface ToolRuntimeScheduler {
  // 中文：实体化输入，运行有序的 pre-execute／guard 门禁，并决定后续阶段。
  /** Materialize input, run the ordered pre-execute/guard gate, and decide what stage follows. */
  prepare(exec: ToolExecutionInput): Promise<ScheduledToolPreparation>
  // 中文：只执行 around-dispatch／工具体阶段。
  /** Run only the around-dispatch/body stage. */
  dispatch(exec: ToolRunContext): Promise<ScheduledToolDispatch>
  // 中文：执行 post-execute 和工具定义拥有的最终内容处理，再实体化并通知。
  /** Run post-execute and definition-owned content finalization, then materialize and notify. */
  finalize(exec: ToolRunContext, result: ToolExecutionResult): Promise<ToolExecutionResult>
  // 中文：不执行 post-execute，直接完成定义自有的内容处理，再实体化并通知。
  /** Run definition-owned content finalization, then materialize and notify without post-execute. */
  finish(exec: ToolRunContext, result: ToolExecutionResult): ToolExecutionResult
}

// 中文：不包含在生成的具名服务 API 中的调度器入口，内部使用。
/**
 * Scheduler entry point omitted from the generated named service API.
 * @internal
 */
export const TOOL_RUNTIME_SCHEDULER: unique symbol = Symbol('@deepseek-ai/dsh-tools.scheduler')

// 中文：工具体已调用后的取消所用规范错误码。
/** Canonical error code for cancellation after a tool body was invoked. */
export const TOOL_ABORTED = 'ABORTED'

// 中文：工具体尚未调用时取消所用规范错误码。
/** Canonical error code for cancellation before a tool body was invoked. */
export const TOOL_ABORTED_BEFORE_DISPATCH = 'ABORTED_BEFORE_DISPATCH'

// 中文：失败工具调用的结构化错误元数据，与面向模型的文本并列。
/** Structured error metadata for a failed tool call (alongside the model-facing text). */
export interface ToolErrorInfo {
  name: string
  code: string
}

// 中文：规范失败详情，内部路由信息保持可选。
/** Canonical failure detail; internal routing information remains optional. */
export interface ToolFailure {
  // 中文：不含 Native 的 Error: 包装前缀的人类可读失败消息。
  /** Human-readable failure message without the Native `Error: ` envelope. */
  message: string
  // 中文：供策略和持久诊断使用的内部错误类／错误码。
  /** Internal error class/code used by policy and durable diagnostics. */
  info?: ToolErrorInfo
}

// 中文：模型请求未注册工具时内部抛出。继承 HarnessError，代码 UNKNOWN_TOOL，使未知工具失败与工具自身抛错同样可路由；重试、沙箱、重放逻辑可区分两者
// 。
/**
 * Thrown (internally) when the model requests a tool that isn't registered.
 * Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
 * failure is as routable as a tool-thrown one — retry/sandbox/replay code can
 * distinguish it from a tool body's own error.
 */
export class ToolNotFoundError extends HarnessError {
  // 中文：toolName 为调用方请求的名称；reachableFrom 在名称可见、仅呈现方式禁止直调时说明替代调用路径；任何地方都未注册的名称省略此字段。
  /**
   * @param toolName - the name the caller asked for.
   * @param reachableFrom - how the model reaches this tool instead, when the
   *   name IS visible and only the presentation denies calling it directly.
   *   Omitted for a name that is registered nowhere.
   */
  constructor(toolName: string, reachableFrom?: string) {
    super(
      reachableFrom === undefined
        ? `unknown tool "${toolName}"`
        : `unknown tool "${toolName}": ${reachableFrom}`,
      'UNKNOWN_TOOL',
    )
    this.name = 'ToolNotFoundError'
  }
}

// 中文：工具体或后置策略结果违反声明输出时抛出。
/** Thrown when a tool body or post-policy value violates its declared output. */
export class ToolOutputError extends HarnessError {
  // 中文：按校验顺序列出的 schema／值违规。
  /** Schema/value violations in validation order. */
  readonly violations: string[]

  constructor(toolName: string, violations: string[]) {
    super(`tool "${toolName}" returned invalid output: ${violations.join('; ')}`, 'INVALID_TOOL_OUTPUT')
    this.name = 'ToolOutputError'
    this.violations = violations
  }
}

// 中文：将投影器异常转换为规范的无效输出失败。
/** Convert one projector exception into the canonical invalid-output failure. */
function projectionError(toolName: string, projector: 'render' | 'presentationMeta', error: unknown): ToolOutputError {
  return new ToolOutputError(toolName, [`output.${projector} failed: ${errorMessage(error)}`])
}

// 中文：在后续持久结果实体化之前，为投影器结果生成快照。
/** Snapshot one projector result before later durable-result materialization. */
function snapshotProjection<T>(toolName: string, projector: 'render' | 'presentationMeta', candidate: T): T {
  try {
    const detached = snapshotJsonValue(candidate)
    if (detached === undefined) {
      throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`])
    }
    return detached
  } catch (error: unknown) {
    if (error instanceof ToolOutputError) throw error
    throw projectionError(toolName, projector, error)
  }
}

// 中文：为工具体或策略返回值生成快照，并把无效情况归为规范无效输出失败类。
/** Snapshot one body or policy value into the canonical invalid-output failure class. */
function snapshotToolValue(toolName: string, candidate: unknown): JsonValue {
  try {
    const detached = snapshotJsonValue(candidate)
    if (detached === undefined) throw new ToolOutputError(toolName, ['value is not lossless JSON'])
    return detached as JsonValue
  } catch (error: unknown) {
    if (error instanceof ToolOutputError) throw error
    throw new ToolOutputError(toolName, [`value snapshot failed: ${errorMessage(error)}`])
  }
}

// 中文：成功的规范工具执行，包含 Native／模型投影。
/** Successful canonical tool execution, including its Native/model projection. */
export interface ToolExecutionSuccess {
  readonly isError: false
  // 中文：执行局部的规范值，刻意不写入持久事件。
  /** Execution-local canonical value; deliberately omitted from durable events. */
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly error?: never
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  // 中文：智能体循环在提交此成功结果批次后停止。
  /** The agent loop stops after committing this successful result batch. */
  readonly concludesTurn?: true
}

// 中文：失败的规范工具执行，失败结果不携带成功值。
/** Failed canonical tool execution; failures never carry a successful value. */
export interface ToolExecutionFailure {
  readonly isError: true
  readonly error: ToolFailure
  readonly value?: never
  readonly content: ContentBlock[]
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  readonly concludesTurn?: never
}

// 中文：单次工具调用在执行局部的带判别标签结果。
/** The discriminated, execution-local outcome of one tool call. */
export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure

// 中文：分发前决策：allow 执行，deny 生成错误，ask 仅在审批服务返回 allowed-once 时执行，否则拒绝。参数已记录并展示，因此不允许改写输入。
/**
 * Pre-dispatch decision. `allow` runs the call; `deny` materializes an error;
 * `ask` runs only after an approval service returns `allowed-once` and otherwise
 * denies. Input rewriting is excluded because arguments are already logged and
 * presented.
 */
export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

// 中文：分发后决策：接受、替换某个投影、为下一请求附加上下文，或把纠正反馈变为错误结果来阻止。
/**
 * Post-dispatch decision: accept, replace one projection, attach context for the
 * next request, or block by turning corrective feedback into an error result.
 */
export type PostToolDecision =
  | { kind: 'accept'; content?: ContentBlock[]; value?: never; additionalContexts?: UserMessage[] }
  | { kind: 'accept'; value: JsonValue; content?: never; additionalContexts?: UserMessage[] }
  | { kind: 'block'; feedback: ContentBlock[]; additionalContexts?: UserMessage[] }

// 中文：尽力从任意抛出值取得可读消息：Error 使用 .message，带字符串 message 属性的非 Error 对象也使用该属性，其余转字符串。
/**
 * Best-effort human-readable message from an arbitrary thrown value: Error
 * instances use `.message`; non-Error objects with a string `message`
 * property (e.g. `throw { message: 'denied' }`) use it too; everything else
 * is stringified.
 */
function errorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null
      && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
    return String(error)
  } catch {
    // 中文：恶意抛出值可能在 instanceof、属性访问或字符串转换时触发异常。错误规范化是最外层安全边界，其回退自身也必须对所有输入有定义。
    // A hostile thrown value can trap `instanceof`, property access, or string
    // coercion. Error normalization is the outermost safety boundary, so its
    // fallback must itself be total.
    return '<unprintable thrown value>'
  }
}

// 中文：从策略反馈派生失败消息，不改变其渲染块。
/** Derive one failure message from policy feedback without changing its rendered blocks. */
function failureMessageFromContent(content: ContentBlock[]): string {
  const text = content
    .map(block => block.type === 'text' ? block.text : `[${block.type} content]`)
    .join('\n')
  return text.length > 0 ? text : 'tool result blocked by post-execute policy'
}

// 中文：对持久工具结果投影生成快照并冻结，拒绝有损数据。
/** Snapshot and freeze one durable tool-result projection or reject lossy data. */
function materializePresentation<T>(candidate: T): T {
  const detached = snapshotJsonValue(candidate)
  if (detached === undefined) {
    throw new TypeError('tool result must be losslessly JSON-serializable')
  }
  return deepFreeze(detached)
}

// 中文：抛出值为 HarnessError 时返回结构化 { name, code }，否则 undefined。
/** Structured `{ name, code }` for a thrown HarnessError, else undefined. */
function errorInfo(error: unknown): ToolErrorInfo | undefined {
  try {
    return error instanceof HarnessError ? { name: error.name, code: error.code } : undefined
  } catch {
    return undefined
  }
}

// 中文：注册表向模型呈现工具的方式，参见 Config.mode。
/** How the registry presents its tools to the model (see {@link Config.mode}). */
export type ToolPresentationMode = 'native' | 'ptc' | 'both'

// 中文：插件配置：如何向模型呈现已注册工具。
/** Plugin config: how the registered tools are presented to the model. */
export interface Config {
  // 中文：模型呈现模式：native 默认发送每个可见 schema；ptc 只发送 run_code 和生成的 SDK 提示，执行器也收敛到相同接口，模型仅能直调
  // run_code，而 SDK 子分发仍能访问所有可见工具；both 同时提供两种形式。PTC 要求 ctx.codeRuntime 的语言有已注册 SDK 渲染器（
  // TypeScript 或 Python），缺失时提示组装失败。ptc 下 toolOrder 中原生名称无效。
  /**
   * Model presentation. `native` (default) sends every visible schema; `ptc`
   * sends only `run_code` plus a generated SDK prompt and collapses the
   * executor to the same surface (a model-direct call may only name
   * `run_code`; `run_code` SDK sub-dispatches keep every visible tool); `both`
   * sends both forms. PTC mode requires a `ctx.codeRuntime` whose `language`
   * has a registered SDK renderer (TypeScript or Python) and fail prompt
   * assembly when it is absent or has no renderer. Under `ptc`, native names
   * in `toolOrder` are invalid.
   */
  mode?: ToolPresentationMode
  // 中文：run_code 程序重叠子调用的并发上限，默认 10，与循环调度器相同。子调用遵循原生调度契约：仅被工具判为并发安全的调用可重叠，独占调用形成屏障；1 恢复严格串
  // 行。必须为正整数。
  /**
   * Concurrency cap for a `run_code` program's overlapping sub-calls
   * (default 10, the loop scheduler's own default). Sub-calls follow the
   * native scheduling contract — only calls whose tools classify
   * concurrency-safe overlap; exclusive calls form barriers — so `1`
   * restores strictly serial dispatch. Must be a positive integer.
   */
  maxParallelSubCalls?: number
}

// 中文：作用域级全局工具过滤器。限制取交集，不影响作用域注册工具和保留的 PTC 模式传输。
/**
 * Per-scope filter over global tools. Restrictions intersect and do not affect
 * scoped registrations or the reserved PTC mode transport.
 */
export interface ToolRestriction {
  // 中文：保留可见的全局工具名，其余移除。
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  // 中文：从可见集合移除的全局工具名。
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}

// 中文：注册时编译的限制，供反复查询当前全局工具使用。
/** One restriction compiled at registration for repeated live-global lookup. */
interface CompiledToolRestriction {
  readonly allow?: ReadonlySet<string>
  readonly deny?: ReadonlySet<string>
}

// 中文：单次遍历层级得到的某作用域完整注册表视图。
/** One scope's complete registry view, derived in a single layer traversal. */
interface ToolView {
  // 中文：应用限制、作用域遮蔽及传输插入后可见的定义。
  /** Visible definitions after restrictions, scoped shadowing, and transport insertion. */
  readonly visible: ReadonlyMap<string, ToolDefinition>
  // 中文：应用限制前的能力名称，用于校验提示顺序。
  /** Pre-restriction capability names used by prompt-order validation. */
  readonly knownNames: ReadonlySet<string>
  // 中文：作用域限制当前可以引用的全局工具名。
  /** Current global names that a scoped restriction may name. */
  readonly restrictableNames: ReadonlySet<string>
}

// 中文：在每个 tools/pre-execute 监听器之后、工具体之前评估的单调执行守卫。返回原因即拒绝，undefined 保持不变；守卫没有允许结果，所以监听器顺序
// 无法把拒绝变成允许。execution 为完成可扩展前置策略且身份受保护的调用；返回最终拒绝原因或 undefined。
/**
 * A monotonic execution guard evaluated after every `tools/pre-execute`
 * listener and before the tool body. Returning a reason denies the call;
 * returning `undefined` leaves it unchanged. Because guards have no allow
 * result, listener ordering cannot turn a denial back into permission.
 * @param execution - the identity-protected call after extensible pre-execute policy completed.
 * @returns a final denial reason, or `undefined` to leave the call allowed.
 */
export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined

// 中文：一个作用域贡献的完整工具注册内容。
/** One scope's complete tool-registry contribution. */
class ToolLayer implements ScopeLayer {
  readonly tools: NamedEntries<ToolDefinition>
  readonly restrictions = new AnonymousEntries<CompiledToolRestriction>()
  readonly guards = new AnonymousEntries<ToolGuard>()
  // 中文：该作用域智能体为自身声明的呈现模式，覆盖部署默认。用单值而非条目表，因为对“模型看到哪种形式”存在两个答案是矛盾，不能合并。
  /**
   * Presentation this scope's agent declared for itself, shadowing the
   * deployment default. One cell rather than an entry table: two answers to
   * "which form does the model see" is a contradiction, not a merge.
   */
  mode: ToolPresentationMode | undefined

  constructor(scope: ScopeKey | undefined) {
    this.tools = new NamedEntries(name => new Error(scope === undefined
      ? `tool "${name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)`
      : `tool "${name}" is already registered in this scope`))
  }

  // 中文：此聚合层的所有贡献表是否都为空。
  /** Whether every contribution table in this aggregate layer is empty. */
  isEmpty(): boolean {
    return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty()
      && this.mode === undefined
  }

  // 中文：此层每个已编译限制是否都允许某全局工具名。
  /** Whether every compiled restriction in this layer admits a global tool name. */
  admits(name: string): boolean {
    for (const filter of this.restrictions.values()) {
      if ((filter.allow !== undefined && !filter.allow.has(name))
        || (filter.deny !== undefined && filter.deny.has(name))) return false
    }
    return true
  }

  // 中文：此层当前注册守卫给出的首个单调拒绝。
  /** First monotonic denial from this layer's live guard registrations. */
  guardReason(exec: ToolExecution): string | undefined {
    for (const guard of this.guards.values()) {
      const reason = guard(exec)
      if (reason !== undefined) return reason
    }
    return undefined
  }
}

// 中文：审批决策及审批通道是否报告取消。
/** Approval decision plus whether the approval channel reported cancellation. */
interface ToolAskResolution {
  readonly decision: Extract<PreToolDecision, { kind: 'allow' | 'deny' }>
  readonly approvalCancelled: boolean
}

// 中文：保存在 around 包装器视图之外的调用方取消和分发状态。
/** Caller cancellation and dispatch state kept outside the around-wrapper view. */
interface ToolCancellationState {
  readonly callerSignal: AbortSignal
  bodyInvoked: boolean
}

// 中文：单次分发作用域的合并信号，以及工具体结束后的监听器清理。
/** One dispatch-scoped fused signal plus listener cleanup after the body settles. */
interface FusedToolSignal {
  readonly signal: AbortSignal
  dispose(): void
}

// 中文：在配置归属处解析 run_code 重叠上限；直接构造会绕过 Loader schema。
/** Resolve the run_code overlap cap at the owning config boundary (direct construction bypasses the Loader schema). */
function resolveMaxParallelSubCalls(value: number | undefined): number {
  const maxParallelSubCalls = value ?? 10
  if (!Number.isInteger(maxParallelSubCalls) || maxParallelSubCalls < 1) {
    throw new Error('maxParallelSubCalls must be a positive integer')
  }
  return maxParallelSubCalls
}

// 中文：工具注册表与执行管线。作用域注册覆盖全局注册；同一个可见性解析器服务于呈现、查找和分发。
/**
 * Tool registry and execution pipeline. Scoped registrations shadow globals;
 * one visibility resolver feeds presentation, lookup, and dispatch.
 */
export class ToolRuntime extends Service {
  static inject = ['systemPrompt']

  static Config: z<Config> = z.object({
    mode: z.union(['native', 'ptc', 'both'] as const).default('native'),
    maxParallelSubCalls: z.natural().min(1).default(10),
  })

  // 中文：供 dsh-agent-loop 并行调度器消费的内部分阶段视图。
  /** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
  readonly [TOOL_RUNTIME_SCHEDULER]: ToolRuntimeScheduler = {
    prepare: exec => this.prepareScheduledExecution(exec),
    dispatch: exec => this.dispatchScheduledExecution(exec),
    finalize: (exec, result) => this.finalizeScheduledExecution(exec, result),
    finish: (exec, result) => this.finishScheduledExecution(exec, result),
  }

  // 中文：运行中工具体延迟的上下文，以调度器拥有的执行对象为键。
  /** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
  private deferredContexts = new WeakMap<ToolRunContext, UserMessage[]>()
  // 中文：工具体已声明当前轮次完成的执行集合。
  /** Executions whose tool body declared the current turn complete. */
  private concludingExecutions = new WeakSet<ToolExecution>()
  // 中文：原始调用方取消状态，保存在包装器可变执行对象之外。
  /** Original caller cancellation, kept outside the wrapper-mutable execution object. */
  private cancellationStates = new WeakMap<ToolRunContext, ToolCancellationState>()
  // 中文：策略开始之前保存的定义自有最终内容变换。
  /** Definition-owned final content transform snapshotted before policy begins. */
  private contentFinalizers = new WeakMap<ToolRunContext, ToolDefinition['finalizeContent']>()
  private readonly layers = new ScopedLayers(
    scope => new ToolLayer(scope),
    () => { this.ctx.emit('tools/change') },
  )
  // 中文：未自行声明模式的作用域使用的呈现方式；presentAs 可逐作用域覆盖。
  /** Presentation for scopes that declare none; {@link presentAs} shadows it per scope. */
  private readonly defaultMode: ToolPresentationMode
  private readonly maxParallelSubCalls: number
  // 中文：保留的呈现传输，置于可过滤注册层之外。首次需要时才构建，而非构造时，因为服务构造时尚不知道哪些智能体会用 PTC；除闭包引用 this 外，传输本身无状态。
  /**
   * Reserved presentation transport, kept outside the filterable registration
   * layers. Built on first need rather than at construction: which agents run
   * a PTC mode is no longer known when the service is constructed, and the
   * transport is stateless beyond its closures over `this`.
   */
  private ptcTransport: ToolDefinition | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'tools')
    // 中文：schema 已为省略的 mode 设置默认值；此处 ?? 用于测试中直接非 Loader 构造时缩窄可选输入类型。
    // The schema already defaulted an omitted mode; the ?? narrows the
    // optional-input type for direct (non-Loader) construction in tests.
    this.defaultMode = config.mode ?? 'native'
    this.maxParallelSubCalls = resolveMaxParallelSubCalls(config.maxParallelSubCalls)
    ctx.systemPrompt.tools(context => this.wireSchemas(context.scope))
    if (this.defaultMode !== 'native') {
      ctx.systemPrompt.section(this.collapseSection())
      ctx.systemPrompt.section(this.sdkSection())
    }
  }

  // 中文：说明 ptc 执行器接口收敛的提示段落，与 sdkSection 同处注册，非有效 ptc 模式时为空。各工具指导只说明工具名、不说明调用路径，且在 SDK 前渲染
  // ；缺少此规则会让模型直调工具、收到 UNKNOWN_TOOL 后误判部署不一致。因此规则排在工具指导之前。both 模式原生调用可执行，规则不成立，故输出为空。返回段落注
  // 册项。
  /**
   * The prompt statement of the `ptc` executor collapse, registered wherever
   * {@link sdkSection} is and rendering empty outside an effective `ptc`.
   *
   * Every tool contributes its own guidance section naming its tool, none of
   * them qualify how that tool is reached, and they all render before the SDK.
   * Without this the model reads a catalog of tools it is told to use and no
   * statement that only `run_code` may be called, so it emits a native call,
   * receives `UNKNOWN_TOOL` for a tool the prompt just declared, and concludes
   * the deployment is inconsistent. Its order places the rule before that
   * guidance rather than after it.
   *
   * `both` renders empty: native calls do execute there, so the rule is false.
   * @returns the section registration.
   */
  private collapseSection(): { name: string; order: number; text: (context: { scope?: ScopeKey }) => string } {
    return {
      name: 'tools:ptc-only',
      order: this.ctx.systemPrompt.getSectionOrder('PTC_ONLY'),
      // 中文：与执行器拒绝时使用完全相同的判断条件，保证提示不会宣称注册表未执行的规则，参见 collapses。
      // The SAME predicate the executor denies by, so the prompt cannot state
      // a rule the registry does not enforce (see `collapses`).
      text: context => this.modeFor(context.scope) === 'ptc' ? PTC_ONLY_INSTRUCTION : '',
    }
  }

  // 中文：生成 SDK 的提示段落：PTC 部署全局注册，presentAs 按作用域注册。内容从调用作用域重新生成；原生模式智能体输出为空，即使它仍看到全局注册，空段落也会
  // 从最终提示中移除。返回段落注册项。
  /**
   * The generated-SDK prompt section, registered globally by a PTC mode
   * deployment and per scope by {@link presentAs}.
   *
   * The body regenerates from the CALLING scope, and renders empty for an
   * agent presenting natively — an agent that opted out under a PTC mode
   * deployment still sees the global registration, and an empty section is
   * dropped from the rendered prompt.
   * @returns the section registration.
   */
  private sdkSection(): { name: string; order: number; text: (context: { scope?: ScopeKey }) => string } {
    return {
      name: 'tools:sdk',
      order: this.ctx.systemPrompt.getSectionOrder('TOOLS_SDK'),
      // 中文：按稳定顺序，从调用作用域可见工具重新生成。
      // Regenerate from the calling scope's visible tools in stable order.
      text: (context) => {
        const mode = this.modeFor(context.scope)
        if (mode === 'native') return ''
        const runtime = this.requireCodeRuntime(mode)
        // 中文：只读自有属性，否则 toString、constructor 等语言名可能被错误解析成 Object.prototype 继承成员的渲染器。
        // Own-property read: a language like `toString`/`constructor` would
        // otherwise resolve an inherited Object.prototype member as a renderer.
        const render = SDK_RENDERERS[runtime.language]
        // 中文：覆盖率例外：requireCodeRuntime 在运行至此之前已拒绝未知语言。
        /* v8 ignore next -- requireCodeRuntime rejects an unknown language before this runs. */
        if (render === undefined) throw new Error(`dsh-tools: no SDK renderer for ${runtime.language}`)
        return render(this.sdkSchemas(context.scope))
      },
    }
  }

  // 中文：解析作用域智能体看到的呈现方式：优先自身声明，否则部署默认。scope 为调用智能体，undefined 表示全局视图；返回解析后的模式。
  /**
   * The presentation one scope's agent sees: its own declaration, else the
   * deployment default.
   * @param scope - the calling agent, or undefined for the global view.
   * @returns the resolved presentation mode.
   */
  private modeFor(scope?: ScopeKey): ToolPresentationMode {
    // 中文：沿作用域链最近者优先：预设的常设声明覆盖其下所有智能体，智能体自身声明又可覆盖预设。模式决定模型看到什么，属于沿链继承的事实。
    // Nearest scope wins along the chain: a preset's standing declaration
    // covers every agent parented under it, and an agent's own (were one ever
    // declared) would override its preset's. The mode decides what the model
    // SEES, which is exactly the class of fact the chain inherits.
    const layers = this.layers.chainLayers(scope)
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const mode = layers[index]?.mode
      if (mode !== undefined) return mode
    }
    return this.defaultMode
  }

  // 中文：首次需要时构建的保留 run_code 传输。它从不进入全局层，避免被智能体限制移除或作用域注册遮蔽；解析可过滤能力层后才追加，仅对实际呈现它的作用域追加。返回共享
  // 传输定义。
  /**
   * The reserved `run_code` transport, built on first need.
   *
   * It never enters the global layer: per-agent restrictions must not remove
   * it, and a scoped registration must not shadow it. The visibility resolver
   * appends it after resolving the filterable global/scoped capability layers,
   * and only for scopes whose mode actually presents it.
   * @returns the shared transport definition.
   */
  private requireCodeTransport(): ToolDefinition {
    this.ptcTransport ??= createRunCodeTool(this, {
      requireRuntime: () => this.requireCodeRuntime(this.defaultMode),
      // 中文：感知语言的 description/parameters getter 读取运行时但不强制要求其存在，使默认原生模式的进程仍可为选择代码模式的智能体投影传输。
      // The language-aware description/parameters getters read the runtime
      // without demanding one, so a native-default process can still project
      // the transport for an agent that chose code.
      peekRuntime: () => this.ctx.get('codeRuntime'),
      maxParallel: this.maxParallelSubCalls,
      shapeDispatchLog: dispatch => this.shapeDispatchLog(dispatch),
    })
    return this.ptcTransport
  }

  // 中文：用指定 mode 替代部署默认来呈现调用作用域工具。链上最近作用域优先，预设声明覆盖其下智能体。仅允许作用域使用且每作用域一次声明，以在同进程组合 PTC 和原生智
  // 能体；全进程覆盖应使用 mode 配置。mode 为所覆盖模型看到的方式；返回用于撤销声明、恢复默认的精确释放器。
  /**
   * Present the calling scope's tools in `mode` instead of the deployment
   * default. Nearest scope on the chain wins, so a preset's standing
   * declaration covers every agent joined under it.
   *
   * Scoped only, and one declaration per scope: this is how an agent preset
   * composes PTC mode agents beside native ones in the same process, and a
   * process-global override would be the `mode` config field instead.
   * @param mode - the presentation the covered agents' models see.
   * @returns the exact disposer that restores the deployment default.
   */
  presentAs(mode: ToolPresentationMode): () => void {
    const ctx = this.ctx
    if (scopeOf(ctx) === undefined) {
      throw new Error('tools.presentAs() requires a scoped context (agent.ctx): a context-global presentation is the `mode` config field on the tools row')
    }
    const dispose = ctx.effect(function* (this: ToolRuntime) {
      yield this.layers.effect(
        ctx,
        (layer) => {
          if (layer.mode !== undefined) {
            throw new Error(`tools.presentAs("${mode}") conflicts with "${layer.mode}" already declared for this scope; one composition selects one presentation`)
          }
          layer.mode = mode
          return () => { layer.mode = undefined }
        },
        { label: 'tools.presentAs()' },
      )
      // 中文：SDK 和收敛规则段落与模式一样按作用域注册。部署已默认 PTC 时，以相同内容覆盖全局注册，无额外成本，也避免分情况维护多套规则。
      // The SDK and collapse sections are per scope for the same reason the
      // mode is. Under a deployment that already defaults to PTC mode this
      // shadows the global registration with an identical body, which costs
      // nothing and keeps one rule instead of a case analysis.
      if (mode !== 'native') {
        yield ctx.systemPrompt.section(this.collapseSection())
        yield ctx.systemPrompt.section(this.sdkSection())
      }
    }.bind(this), 'tools.presentAs()')
    // 中文：静态检查例外：同步组合释放。
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous composite teardown
    return dispose
  }

  // 中文：构建作用域的传输 schema 及提示顺序校验所需名称。限制不会让已知工具变成无效名称，但模式收敛会。
  /**
   * Build one scope's wire schemas and names for prompt-order validation.
   * Restrictions do not make known tools invalid, but a mode collapse does.
   */
  private wireSchemas(scope?: ScopeKey): ToolProviderResult {
    const view = this.view(scope)
    const mode = this.modeFor(scope)
    if (mode === 'native') {
      const schemas = [...view.visible.values()].map(definition => this.schemaOf(definition, false))
      return { schemas, knownNames: [...view.knownNames] }
    }
    // 中文：投影 schema 前先校验运行时语言，因为 schemaOf 会读取 run_code 的语言相关 getter，其 flavor 表检查否则会先报错。这样无
    // SDK 渲染器的语言统一报渲染器表的组装错误。
    // Validate the runtime language BEFORE projecting schemas: schemaOf reads
    // run_code's language-aware description/parameters getters, whose own
    // flavor-table guard would otherwise surface first. This keeps the
    // renderer-table rejection the canonical assembly-time error for a
    // language with no SDK renderer.
    this.requireCodeRuntime(mode)
    const schemas = [...view.visible.values()].map(definition => this.schemaOf(definition, false))
    if (mode === 'ptc') {
      return {
        schemas: schemas.filter(schema => schema.name === RUN_CODE_NAME),
        knownNames: [RUN_CODE_NAME],
      }
    }
    return { schemas, knownNames: [...view.knownNames, RUN_CODE_NAME] }
  }

  // 中文：解析代码运行时，否则抛出可操作的配置错误。应在组装／run_code 执行时读取，而非静态 inject，避免 native 模式也把 ctx.tools 及所有工
  // 具插件绑定于代码运行时存在。组装与执行分别读取，语言尚未绑定请求；单后端时两次一致，但若期间重载成另一语言，就可能将按某 SDK 写的程序交给另一后端。绑定延后到第二后端
  // 发布、可验证时实现。
  /**
   * Resolve the code runtime or throw the actionable misconfiguration error.
   * Read at use time (assembly / run_code execution), NOT via static
   * `inject`: an inject entry would hold `ctx.tools` — and every tool plugin
   * behind it — hostage to a code runtime existing even under `mode:
   * 'native'`.
   *
   * Assembly and `run_code` execution read separately, so the language is not
   * bound to a request. Harmless while one published backend exists — both
   * reads return the same flavor — but a reload that swapped in a second
   * language between them would hand a program written against one SDK to the
   * other. Binding it is deferred until a second backend ships (the first
   * point it is testable).
   */
  private requireCodeRuntime(mode: ToolPresentationMode): CodeRuntime {
    const runtime = this.ctx.get('codeRuntime')
    if (!runtime) {
      throw new Error(`dsh-tools: mode "${mode}" requires a code runtime — load a ctx.codeRuntime implementation (e.g. @deepseek-ai/dsh-code-runtime-worker-thread) or set tools mode to "native"`)
    }
    if (!Object.hasOwn(SDK_RENDERERS, runtime.language)) {
      const known = Object.keys(SDK_RENDERERS).map(name => JSON.stringify(name)).join(', ')
      throw new Error(`dsh-tools: no SDK renderer registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`)
    }
    return runtime
  }

  // 中文：全局或调用智能体作用域内注册工具。作用域工具覆盖全局；同层重复及保留名 run_code 报错。definition 包含 schema、执行及可选最终处理／呈现回
  // 调；返回精确注销释放器。
  /**
   * Register globally or in the calling agent scope. Scoped tools shadow
   * globals; duplicates within one layer and the reserved `run_code` name fail.
   * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
   * @returns the exact disposer that unregisters the tool.
   */
  register(definition: ToolDefinition): () => void {
    const name = definition.name
    const output = (definition as Partial<ToolDefinition>).output
    if (output === undefined || typeof output !== 'object'
      || typeof output.render !== 'function'
      || (output.presentationMeta !== undefined && typeof output.presentationMeta !== 'function')) {
      throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`)
    }
    assertSupportedJsonSchema(output.schema)
    const timeoutMs = definition.timeoutMs
    if (timeoutMs !== undefined
      && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`)
    }
    // 中文：无条件保留该名称：任一智能体都可自行选择代码模式，如果默认部署下允许占用，预设一挂载就会产生冲突。
    // Reserved unconditionally: any agent may select a code mode for itself,
    // so a name free to take under the deployment default would become a
    // collision the moment a preset mounted.
    if (name === RUN_CODE_NAME) {
      throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.tools.insert(name, definition),
      { label: 'tools.register()' },
    )
  }

  // 中文：限制调用智能体作用域继承的全局工具。空过滤器、未知名、作用域本地名及保留传输名均报错；限制取交集，作用域注册仍可见。filter 为 allow 保留／deny 移
  // 除掩码；返回解除此限制的精确释放器。
  /**
   * Restrict global tools for the calling agent scope. Empty filters, unknown
   * names, scope-local names, and reserved transport names fail. Restrictions
   * intersect; scoped registrations remain visible.
   * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
   * @returns the exact disposer that lifts this restriction.
   */
  restrict(filter: ToolRestriction): () => void {
    const scope = scopeOf(this.ctx)
    if (scope === undefined) {
      throw new Error('tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead')
    }
    const allow = filter.allow
    const deny = filter.deny
    if (allow === undefined && deny === undefined) {
      throw new Error('tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)')
    }
    const compiled: CompiledToolRestriction = {
      ...allow !== undefined ? { allow: new Set(allow) } : {},
      ...deny !== undefined ? { deny: new Set(deny) } : {},
    }
    if ([...allow ?? [], ...deny ?? []].includes(RUN_CODE_NAME)) {
      throw new Error(`tools.restrict() cannot name reserved PTC mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`)
    }
    const known = this.view(scope).restrictableNames
    const unknown = [...allow ?? [], ...deny ?? []].filter(name => !known.has(name))
    if (unknown.length > 0) {
      throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? 's' : ''} ${unknown.map(n => `"${n}"`).join(', ')}; known global tools: ${[...known].sort().join(', ') || '(none)'}`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.restrictions.append(compiled),
      { label: 'tools.restrict()' },
    )
  }

  // 中文：在可扩展 tools/pre-execute waterfall 后注册单调守卫。普通上下文全局生效，agent.ctx 仅作用于该智能体；任何匹配守卫可返回原因拒
  // 绝，但不能强制允许其他守卫拒绝的调用。返回精确 effect 释放器，以维护顺序所有权和热重载清理。guard 为同步检查，返回字符串则拒绝；返回注销释放器。
  /**
   * Register a monotonic guard after the extensible `tools/pre-execute`
   * waterfall. A plain-context guard applies globally; one registered through
   * `agent.ctx` applies only to that agent. Any matching guard may deny by
   * returning a reason, while no guard can force-allow a call another guard
   * denied. The exact effect disposer is returned for ordered ownership and
   * HMR cleanup.
   * @param guard - synchronous check; a returned string denies the execution.
   * @returns the exact disposer that unregisters the guard.
   */
  guard(guard: ToolGuard): () => void {
    return this.layers.effect(
      this.ctx,
      layer => layer.guards.append(guard),
      { label: 'tools.guard()', notify: false },
    )
  }

  // 中文：从全局到作用域链、由远及近查找第一个单调拒绝。
  /** First monotonic denial from the global then the scope chain's guard layers, farthest first. */
  private guardReason(exec: ToolExecution): string | undefined {
    const globalReason = this.layers.global.guardReason(exec)
    if (globalReason !== undefined) return globalReason
    if (exec.agent === undefined) return undefined
    for (const layer of this.layers.chainLayers(exec.agent)) {
      const reason = layer.guardReason(exec)
      if (reason !== undefined) return reason
    }
    return undefined
  }

  // 中文：单次层级遍历解析作用域所需全部注册事实。先限制继承的能力，再加入自身注册和保留呈现传输；其他集合保留限制前事实供限制及提示顺序校验。限制过滤全局及所有祖先层，但不影
  // 响自身层：例如委托运行时把结构化输出工具注册在子级自身层，能力过滤不能移除其回答机制。若只过滤全局，工具移到预设祖先层后子级限制就会失效。scope 为观察智能体或全局
  // undefined；返回完整派生视图。
  /**
   * Resolve every registry fact one scope needs in one layer traversal. The
   * visible map applies restrictions to the INHERITED surface, then the
   * scope's own registrations and the reserved presentation transport; the
   * other sets retain the pre-restriction facts needed by restriction and
   * prompt-order validation.
   *
   * A restriction filters what a scope inherits — the global layer and every
   * ancestor layer on its chain — and never what its OWN layer registers.
   * That exemption is what a per-child capability filter has to keep intact:
   * the delegation runtime registers a child's structured-output tool into the
   * child's own layer, and a filter naming the capabilities the child may use
   * must not strip the machinery it answers through.
   *
   * Reading the exempt set as "the global layer" instead of "not mine" held
   * only while every model-facing tool sat in the host composition. Once
   * presets moved them onto the agent plane they became an ANCESTOR
   * contribution, so a child's filter silently stopped constraining anything
   * it was given.
   * @param scope - the viewing scope (the agent), or undefined for the global view.
   * @returns the complete derived view for that scope.
   */
  private view(scope?: ScopeKey): ToolView {
    // 中文：作用域链按最远祖先在前、当前作用域最后排列。
    // Scope-chain layers, farthest ancestor first, the exact scope last.
    const layers = this.layers.chainLayers(scope)
    // 中文：刻意不沿链读取：这是作用域自己拥有而非继承注册的唯一层，作用域尚未贡献内容时不存在。
    // Chain-blind on purpose: this is the ONE layer whose registrations the
    // scope owns rather than inherits, and it is absent until the scope
    // contributes something.
    const own = this.layers.peek(scope)
    // 中文：继承能力按最近祖先最后排列；近作用域同名项覆盖远处，全局层最远。
    // Inherited surface, nearest ancestor last: a nearer scope's same-name
    // entry shadows a farther one, and the global layer is the farthest.
    const inherited = new Map<string, ToolDefinition>(this.layers.global.tools.entries())
    for (const layer of layers) {
      if (layer === own) continue
      for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition)
    }
    const visible = new Map<string, ToolDefinition>()
    const knownNames = new Set<string>()
    const restrictableNames = new Set<string>()
    for (const [name, definition] of inherited) {
      knownNames.add(name)
      restrictableNames.add(name)
      // 中文：整条链限制取交集，任一作用域都可对其下嵌套作用域屏蔽继承名称。
      // Restrictions intersect across the whole chain: any scope on it may
      // mask an inherited name for everything nested inside it.
      if (layers.every(layer => layer.admits(name))) visible.set(name, definition)
    }
    // 中文：最后加入作用域自身注册，覆盖继承名称，且不受前面过滤影响。
    // The scope's own registrations last, shadowing an inherited name and
    // outside the filter above.
    if (own !== undefined) {
      for (const [name, definition] of own.tools.entries()) {
        knownNames.add(name)
        visible.set(name, definition)
      }
    }
    // 中文：呈现基础设施最后解析，不受能力过滤。注册逻辑拒绝保留名，因此此插入既断言不变量，也防未来层级变化。按作用域处理，不能因为同进程其他智能体呈现 run_code，就让
    // 原生智能体的分发表也出现它。
    // Presentation infrastructure is resolved last and outside capability
    // filtering. Registration rejects this reserved name, so the insertion is
    // an invariant assertion as well as protection against future layer
    // changes. Per scope: a native agent must not find `run_code` in its
    // dispatch table because some other agent in the process presents it.
    if (this.modeFor(scope) !== 'native') {
      visible.set(RUN_CODE_NAME, this.requireCodeTransport())
    }
    return { visible, knownNames, restrictableNames }
  }

  // 中文：按作用域可见性查找工具：作用域覆盖全局，被限制移除的全局项视为不存在。呈现器传入调用智能体，使卡片与实际执行定义一致。name 为注册名，scope 省略表示全局；
  // 返回可见定义，无则 undefined。
  /**
   * Look up a tool as one scope sees it (scoped
   * shadows global; a restricted-away global reads as absent). Presenters pass
   * the calling agent so the rendered card matches the definition that
   * actually executed.
   * @param name - the tool name as registered.
   * @param scope - the viewing scope (the agent); omitted = the global view.
   * @returns the definition the scope resolves, or undefined when none is visible.
   */
  get(name: string, scope?: ScopeKey): ToolDefinition | undefined {
    return this.view(scope).visible.get(name)
  }

  // 中文：解析本次调用允许执行的定义，在实际执行归属处应用模式收敛。get 视图不依赖呈现；这里 ptc 下模型直调只能指定 run_code，带 parent 的嵌套子分发
  // 可调用任意可见工具。拒绝通过执行器表现为 UNKNOWN_TOOL，与缺失定义一致。name 为工具名，scope 为智能体或全局，nested 区分子分发与直调；返回可
  // 运行定义或 undefined。
  /**
   * Resolve the definition that MAY EXECUTE for a call, applying the mode
   * collapse at the operation boundary that owns it. The registry view
   * (`get`) is presentation-agnostic; here a MODEL-DIRECT call under `ptc`
   * may only name the reserved `run_code` transport, while a nested
   * sub-dispatch (a `parent` token set — the `run_code` SDK calling a tool
   * it bound) may call any visible tool. Denial surfaces as `UNKNOWN_TOOL`
   * through the executor, matching an absent definition.
   * @param name - the tool name as registered.
   * @param scope - the viewing scope (the agent); omitted = the global view.
   * @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
   * @returns the definition that may run, or undefined when the call must be rejected.
   */
  private resolveExecution(name: string, scope: ScopeKey | undefined, nested: boolean): ToolDefinition | undefined {
    const tool = this.get(name, scope)
    if (tool === undefined) return undefined
    if (this.collapses(name, scope, nested)) return undefined
    return tool
  }

  // 中文：将可见定义投影到允许的模型 schema 字段，不包含执行和呈现回调。scope 省略表示全局；每个可见工具返回一份深克隆 schema。
  /**
   * Project visible definitions onto the allowlisted model-facing schema fields,
   * excluding execution and presentation callbacks.
   * @param scope - the viewing scope (the agent); omitted = the global view.
   * @returns one deep-cloned schema per visible tool.
   */
  schemas(scope?: ScopeKey): ToolSchema[] {
    return [...this.view(scope).visible.values()].map(definition => this.schemaOf(definition, true))
  }

  // 中文：将可见且可调用工具投影到生成的 PTC SDK 契约。
  /** Project visible callable tools onto the generated PTC mode SDK contract. */
  private sdkSchemas(scope?: ScopeKey): ToolSdkSchema[] {
    return [...this.view(scope).visible.values()]
      .filter(definition => definition.name !== RUN_CODE_NAME)
      .map((definition): ToolSdkSchema => {
        const output = snapshotJsonValue(definition.output.schema)
        // 中文：覆盖率例外：注册时已校验并以无损 JSON 保留此 schema。
        /* v8 ignore next -- registration already validated and retained this schema as lossless JSON. */
        if (output === undefined) {
          throw new Error(`tool "${definition.name}" output schema must be lossless JSON before SDK projection`)
        }
        return {
          ...this.schemaOf(definition, true),
          output,
        }
      })
  }

  // 中文：将单个工具定义投影到面向模型的 schema 字段。
  /** Project one definition onto the model-facing schema fields. */
  private schemaOf(definition: ToolDefinition, detachParameters: boolean): ToolSchema {
    const { name, description, parameters } = definition
    const detached = detachParameters ? snapshotJsonValue(parameters) : parameters
    if (detached === undefined) {
      throw new Error(`tool "${name}" parameters must be lossless JSON before schema projection`)
    }
    return {
      name,
      description,
      parameters: detached,
    }
  }

  // 中文：通过调用方可见工具定义分类待调用任务；只有精确 true 才允许并行，未知、隐藏、未声明、无效或抛错的分类器均独占。exec 包含名称、已解析参数及可选智能体作用域
  // ；返回默认拒绝并行的调度模式。
  /**
   * Classify a pending call through the caller's visible tool definition. Only
   * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
   * throwing classifiers are exclusive.
   * @param exec - call name, parsed arguments, and optional agent scope.
   * @returns the fail-closed scheduling mode.
   */
  executionMode(exec: ToolExecutionInput): ToolExecutionMode {
    const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined)
    if (!tool?.isConcurrencySafe) return { kind: 'exclusive' }
    try {
      const concurrencySafe: unknown = tool.isConcurrencySafe(exec.arguments)
      return concurrencySafe === true ? { kind: 'parallel' } : { kind: 'exclusive' }
    } catch {
      return { kind: 'exclusive' }
    }
  }

  // 中文：对已结束子分发运行 tools/ptc-dispatch-log waterfall，返回桥接层应记录的内容。监听器抛错时记录原内容，不得使分发失败或遗漏结束事件。
  // 此方法私有，唯一消费者是注册表构建的 run_code 桥，作为能力参数传入；公开扩展点是 waterfall，而非此调用器。
  /**
   * Run the `tools/ptc-dispatch-log` waterfall over one settled sub-dispatch
   * and return the content the bridge should log on `tool/ptc-dispatch`.
   * Contained: when a listener throws, the method logs the original settled
   * content; that failure must not fail the dispatch or omit the settle event. Private:
   * the ONE consumer is the `run_code` bridge this registry constructs, which
   * receives it as a capability parameter (the `requireRuntime` idiom) — the
   * waterfall, not this invoker, is the public extension point.
   */
  private async shapeDispatchLog(dispatch: PtcDispatchLog): Promise<ContentBlock[]> {
    try {
      return await this.ctx.waterfall(
        scopeTarget(this, dispatch.agent), 'tools/ptc-dispatch-log', dispatch,
        () => Promise.resolve(dispatch.content),
      )
    } catch (error: unknown) {
      this.ctx.logger.warn(`tools: ptc-dispatch-log listener failed for ${dispatch.name}: ${errorMessage(error)}; logging the original settled content`)
      return dispatch.content
    }
  }

  // 中文：判断 ptc 收敛是否拒绝模型直调：仅可指定保留的 run_code；带 parent 的子分发绕过此收敛。安全相关条件统一供 resolveExecution 和
  //  createExecution 使用，避免漂移。按 modeFor 而非 defaultMode 解析，使原生部署中通过预设选择 ptc 的智能体也受约束，不出现提示接
  // 口与执行接口不一致。name 为工具名，scope 为有效模式作用域，nested 标识传输子分发。
  /**
   * Whether the `ptc` mode collapse denies a model-direct call: only the
   * reserved `run_code` transport may be named. Nested sub-dispatches (a
   * `parent` token set) bypass the collapse. One home for the
   * security-relevant predicate, shared by {@link resolveExecution} and
   * {@link createExecution} so the two can never drift apart.
   *
   * Resolved through {@link modeFor}, NOT `defaultMode`: an agent given `ptc`
   * by an agent preset under a native deployment is the composition
   * `dsh-agent-tool-presentation` exists for, and reading the deployment default would
   * leave exactly that agent uncollapsed — announcing one surface while
   * executing another, which is the bypass this collapse closes.
   * @param name - the tool name as registered.
   * @param scope - the viewing scope whose effective presentation mode applies.
   * @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
   */
  private collapses(name: string, scope: ScopeKey | undefined, nested: boolean): boolean {
    return !nested && this.modeFor(scope) === 'ptc' && name !== RUN_CODE_NAME
  }

  // 中文：依次执行前置策略、守卫、around 分发、后置策略、定义自有最终内容处理和最终通知。工具及监听器失败转为实体化错误结果，不可见工具报 UNKNOWN_TOOL；返
  // 回与最终观察器相同的无损冻结快照。进入后、最终实体化前取消：未启动工具体跳过并报 ABORTED_BEFORE_DISPATCH，已启动成功结果替换为 ABORTED；已
  // 启动工作仍等待排空，可保留工具自身结构化错误。exec 是同进程类型化输入，策略前注册表分配关联 token；返回最终结果。
  /**
   * Execute through pre-policy, guards, around-dispatch, post-policy,
   * definition-owned content finalization, and final notification. Tool and
   * listener failures resolve as materialized error results; an invisible tool
   * reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
   * snapshot final observers receive. Cancellation
   * arriving after entry and before final result materialization skips a
   * not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
   * successful started outcome with `ABORTED`; already-started work is still
   * drained and may retain a tool-owned structured error.
   * @param exec - the typed same-process call input. The registry assigns its
   *   correlation token before policy begins.
   * @returns the materialized final result.
   */
  async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult> {
    return this.prepareExecution(exec, prepared => this.completeScheduledExecution(prepared))
  }

  private async completeScheduledExecution(prepared: ScheduledToolPreparation): Promise<ToolExecutionResult> {
    switch (prepared.kind) {
      case 'dispatch': {
        const dispatched = await this.dispatchScheduledExecution(prepared.exec)
        return dispatched.kind === 'post-result'
          ? await this.finalizeScheduledExecution(prepared.exec, dispatched.result)
          : this.finishScheduledExecution(prepared.exec, dispatched.result)
      }
      case 'post-result':
        return await this.finalizeScheduledExecution(prepared.exec, prepared.result)
      case 'final-result':
        return this.finishScheduledExecution(prepared.exec, prepared.result)
      // 中文：覆盖率例外：封闭联合类型的穷尽检查。
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(prepared, 'scheduled tool preparation')
    }
  }

  private createExecution(exec: ToolExecutionInput): ScheduledToolPreparation | { kind: 'ready'; exec: MutableToolRunContext } {
    const deferredContexts: UserMessage[] = []
    const token = createExecutionToken()
    const callId = exec.callId
    const rootCallId = exec.rootCallId ?? callId
    const name = exec.name
    const agent = exec.agent
    const parent = exec.parent
    const signal = exec.signal
    // 中文：区分仅被 ptc 模式收敛拒绝的可见调用与真正未知工具。前者必然失败，在可扩展策略管线之前终止，前置监听器、审批 ask 和守卫不得观察或批准它。未知工具仍沿原来的
    // 分发阶段 UNKNOWN_TOOL 路径，让策略监听器看到到达注册表的名称。
    // Distinguish a mode-collapsed call (visible in the scope, denied only by
    // the `ptc` collapse) from a genuinely unknown tool. A collapsed call is
    // deterministically denied, so it terminates BEFORE the extensible policy
    // pipeline: pre-execute listeners, approval `ask`, and guards must never
    // observe — or worse, approve — a call that can only fail. An unknown tool
    // keeps the historical dispatch-stage `UNKNOWN_TOOL` path so policy
    // listeners still see every name that reaches the registry.
    const visible = this.get(name, agent)
    const collapsed = visible !== undefined && this.collapses(name, agent, parent !== undefined)
    const concludingExecutions = this.concludingExecutions
    const base = {
      token,
      callId,
      rootCallId,
      name,
      signal,
      ...agent !== undefined ? { agent } : {},
      ...parent !== undefined ? { parent } : {},
      deferContext(context: UserMessage): void {
        deferredContexts.push(context)
      },
      concludeTurn(): void {
        concludingExecutions.add(this as unknown as ToolExecution)
      },
    }
    // 中文：参数实体化之前捕获最终处理回调，因为参数 getter 可能在 snapshotJsonValue 中替换或清空已注册回调。收敛只决定是否保留已捕获回调：分发前取消
    // 路径保留，包括 getter 在实体化中取消且先于无效参数失败的情况；UNKNOWN_TOOL 拒绝及未取消收敛调用的无效参数失败则丢弃，因为该调用原本就不能执行。
    // Capture the finalizer BEFORE argument materialization: the
    // `finalizeContent` contract snapshots the callback when the call starts,
    // and an arguments getter can replace or clear the registered callback
    // during `snapshotJsonValue`. The collapse only decides whether the
    // CAPTURED callback is retained: the pre-dispatch abort path keeps it
    // (the cancellation contract routes aborted results through it — a getter
    // that aborts mid-materialization before an invalid-args failure lands in
    // the same retained path), while the `UNKNOWN_TOOL` denial and the
    // invalid-args failure of a NON-ABORTED collapsed call drop it (the call
    // could never execute).
    const capturedFinalizer = visible?.finalizeContent?.bind(visible)
    const finalizerFor = (): ToolDefinition['finalizeContent'] | undefined =>
      collapsed && !signal.aborted ? undefined : capturedFinalizer
    try {
      const detached = snapshotJsonValue(exec.arguments)
      if (detached === undefined) {
        throw new TypeError('tool execution arguments must be losslessly JSON-serializable')
      }
      const execution: MutableToolRunContext = { ...base, arguments: deepFreeze(detached) }
      this.deferredContexts.set(execution, deferredContexts)
      this.contentFinalizers.set(execution, finalizerFor())
      this.cancellationStates.set(execution, {
        callerSignal: signal,
        bodyInvoked: false,
      })
      if (collapsed) {
        // 中文：模式收敛在策略前拒绝，但分发前取消仍遵循既定取消契约；final-result 跳过 prepare 的调用方取消检查，所以此处处理取消，避免已取消调用错误地报告
        // UNKNOWN_TOOL。
        // The collapse denies the call before the policy pipeline, but a
        // pre-dispatch abort still keeps the established cancellation
        // contract: `prepare`'s caller-cancellation check is skipped for
        // final-results, so honor the abort here instead of surfacing
        // `UNKNOWN_TOOL` on an already-cancelled call.
        if (signal.aborted) {
          return { kind: 'final-result', exec: execution, result: toolAbortedBeforeDispatchResult() }
        }
        // 中文：名称在作用域内确实可见，因此拒绝消息附带模型应使用的替代路径；否则模型会对提示已声明的工具收到裸 unknown tool，并误判部署损坏。
        // The name IS visible here, so the denial carries the route the model
        // must take instead. Without it the model reads a bare `unknown tool`
        // for a tool the prompt just declared and concludes the deployment is
        // broken rather than correcting itself.
        return {
          kind: 'final-result',
          exec: execution,
          result: toolErrorResult(new ToolNotFoundError(
            name,
            `only \`${RUN_CODE_NAME}\` is callable directly — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`,
          )),
        }
      }
      return { kind: 'ready', exec: execution }
    } catch (error: unknown) {
      const execution: MutableToolRunContext = { ...base, arguments: undefined }
      this.contentFinalizers.set(execution, finalizerFor())
      return { kind: 'final-result', exec: execution, result: toolErrorResult(error) }
    }
  }

  // 中文：为调度器执行有序前置策略和单调守卫。input 为调用方输入；返回准备好的执行对象和下一调度阶段。内部接口。
  /**
   * Run the ordered pre-execute and monotonic guard stages for the scheduler.
   * @param input - the caller-supplied execution input.
   * @returns the prepared execution plus the next scheduler stage.
   * @internal
   */
  private async prepareScheduledExecution(input: ToolExecutionInput): Promise<ScheduledToolPreparation> {
    return this.prepareExecution(input, prepared => prepared)
  }

  private async prepareExecution<T>(
    input: ToolExecutionInput,
    next: (prepared: ScheduledToolPreparation) => T | PromiseLike<T>,
  ): Promise<T> {
    const created = this.createExecution(input)
    if (created.kind !== 'ready') return next(created)
    const exec = created.exec
    if (this.callerCancelled(exec)) {
      return next({ kind: 'final-result', exec, result: toolAbortedBeforeDispatchResult() })
    }
    try {
      const carrier = scopeTarget(this, exec.agent)
      const gate = await this.ctx.waterfall(
        carrier, 'tools/pre-execute', exec,
        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
      )
      const askResolution: ToolAskResolution = gate.kind === 'ask'
        ? await this.serviceAsk(exec, gate)
        : { decision: gate, approvalCancelled: false }
      const { decision } = askResolution
      if (this.callerCancelled(exec) && askResolution.approvalCancelled) {
        return await next({ kind: 'post-result', exec, result: toolAbortedBeforeDispatchResult() })
      }
      const denialReason = decision.kind === 'allow'
        ? this.guardReason(exec)
        : decision.reason
      if (denialReason !== undefined) {
        return await next({
          kind: 'post-result',
          exec,
          result: this.materializeFinalResult({
            content: [{ type: 'text', text: `Error: ${denialReason}` }],
            isError: true,
            error: { message: denialReason },
          }),
        })
      }
      if (this.callerCancelled(exec)) {
        return await next({ kind: 'post-result', exec, result: toolAbortedBeforeDispatchResult() })
      }
      return await next({ kind: 'dispatch', exec })
    } catch (error: unknown) {
      return next({ kind: 'final-result', exec, result: toolErrorResult(error) })
    }
  }

  // 中文：原始调用方信号当前是否已取消。
  /** Whether the original caller signal is currently aborted. */
  private callerCancelled(exec: ToolRunContext): boolean {
    const state = this.cancellationStates.get(exec)
    // 中文：覆盖率例外：分阶段调度器方法只会收到注册表生成的执行对象。
    /* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
    if (state === undefined) throw new Error('tool registry scheduler invariant violated: missing cancellation state')
    return state.callerSignal.aborted
  }

  // 中文：根据工具体是否已开始来选择规范取消结果。
  /** Canonical cancellation outcome selected by whether the tool body started. */
  private cancellationResult(exec: ToolRunContext, prior?: ToolExecutionResult): ToolExecutionResult {
    const state = this.cancellationStates.get(exec)
    // 中文：覆盖率例外：分阶段调度器方法只会收到注册表生成的执行对象。
    /* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
    if (state === undefined) throw new Error('tool registry scheduler invariant violated: missing cancellation state')
    return state.bodyInvoked
      ? toolAbortedResult(prior)
      : toolAbortedBeforeDispatchResult(prior)
  }

  // 中文：分发已注册工具体，把原始调用方信号重新合并到 around 包装器的替代信号。取消不会放弃工具体；已启动 Promise 必须等工作静止后，结果才变为
  // ABORTED。
  /**
   * Dispatch the registered body with the original caller signal fused back
   * into any around-wrapper replacement. Cancellation never abandons the body:
   * a started promise reaches quiescence before its outcome becomes `ABORTED`.
   */
  private async dispatchToolBody(exec: MutableToolRunContext): Promise<ToolExecutionResult> {
    const state = this.cancellationStates.get(exec)
    // 中文：覆盖率例外：分阶段调度器方法只会收到注册表生成的执行对象。
    /* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
    if (state === undefined) throw new Error('tool registry scheduler invariant violated: missing cancellation state')
    const wrapperSignal = exec.signal
    const fused = fuseToolSignals(state.callerSignal, wrapperSignal)
    const signal = fused.signal

    if (isAborted(signal)) {
      fused.dispose()
      return toolAbortedBeforeDispatchResult()
    }
    exec.signal = signal
    try {
      const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined)
      if (!tool) throw new ToolNotFoundError(exec.name)
      state.bodyInvoked = true
      const returned = await tool.execute(exec.arguments, exec)
      const result = this.createSuccessResult(exec, tool, returned)
      return isAborted(signal)
        ? toolAbortedResult(result)
        : result
    } catch (error: unknown) {
      return toolErrorResult(error)
    } finally {
      fused.dispose()
      exec.signal = wrapperSignal
    }
  }

  // 中文：只执行分发阶段；工具体错误仍进入 post-execute，管线失败已是最终结果。exec 为已准备执行；返回结果是否仍需后置处理。内部接口。
  /**
   * Run around-dispatch and the tool body. Tool and unknown-tool failures still
   * receive post-execute; pipeline failures are already final.
   * @param exec - the prepared execution.
   * @returns whether the result still needs post-execute.
   * @internal
   */
  private async dispatchScheduledExecution(exec: ToolRunContext): Promise<ScheduledToolDispatch> {
    try {
      const mutableExec = exec as MutableToolRunContext
      const carrier = scopeTarget(this, exec.agent)
      const result = await this.ctx.waterfall(
        carrier, 'tools/execute', mutableExec,
        () => this.dispatchToolBody(mutableExec),
      )
      const normalized = this.normalizeDispatchResult(exec, result)
      const deferredContexts = this.deferredContexts.get(exec)
      // 中文：覆盖率例外：dispatch 仅接收此注册表 prepare 阶段生成的执行对象。
      /* v8 ignore next -- dispatch only receives executions minted by this registry's prepare stage */
      if (deferredContexts === undefined) throw new Error('tool registry scheduler invariant violated: unprepared execution')
      const resultWithDeferredContexts: ToolExecutionResult = deferredContexts.length === 0
        ? normalized
        : this.markCanonical(exec, {
          ...normalized,
          additionalContexts: [
            ...deferredContexts,
            ...normalized.additionalContexts ?? [],
          ],
        })
      return {
        kind: 'post-result',
        result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError
          ? this.cancellationResult(exec, resultWithDeferredContexts)
          : resultWithDeferredContexts,
      }
    } catch (error: unknown) {
      return { kind: 'final-result', result: toolErrorResult(error) }
    }
  }

  // 中文：执行有序 post-execute，应用定义自有内容最终处理，再实体化并通知。exec 为已准备执行，result 为仍需后置处理的分发／前置结果；返回最终实体化结
  // 果。内部接口。
  /**
   * Run ordered post-execute, then apply definition-owned content finalization,
   * materialize, and notify the final outcome.
   * @param exec - the prepared execution.
   * @param result - dispatch/pre result that still needs post-execute.
   * @returns the materialized final result.
   * @internal
   */
  private async finalizeScheduledExecution(exec: ToolRunContext, result: ToolExecutionResult): Promise<ToolExecutionResult> {
    try {
      const postResult = await this.postExecute(exec, result)
      return this.finishScheduledExecution(
        exec,
        this.callerCancelled(exec) && !postResult.isError
          ? this.cancellationResult(exec, postResult)
          : postResult,
      )
    } catch (error: unknown) {
      return this.finishScheduledExecution(exec, toolErrorResult(error))
    }
  }

  // 中文：实体化候选结果，应用定义自有最终内容处理，再实体化并通知权威结果。exec 为已准备执行，result 为最终结果；返回实体化结果。内部接口。
  /**
   * Materialize the candidate, apply definition-owned content finalization,
   * then materialize and notify the authoritative result.
   * @param exec - the prepared execution.
   * @param result - final result.
   * @returns the materialized final result.
   * @internal
   */
  private finishScheduledExecution(exec: ToolRunContext, result: ToolExecutionResult): ToolExecutionResult {
    let materializedResult: ToolExecutionResult
    try {
      materializedResult = this.materializeFinalResult(result)
    } catch (error: unknown) {
      materializedResult = this.materializeFinalResult(toolErrorResult(error))
    }
    let finalResult: ToolExecutionResult
    try {
      finalResult = this.materializeFinalResult(this.applyFinalContent(exec, materializedResult))
    } catch (error: unknown) {
      finalResult = this.materializeFinalResult(toolErrorResult(error))
    }
    this.notifyResult(exec, finalResult)
    return finalResult
  }

  // 中文：应用已保存的工具自有内容变换，不暴露其他结果字段。
  /** Apply the snapshotted tool-owned content transform without exposing other result fields. */
  private applyFinalContent(exec: ToolRunContext, result: ToolExecutionResult): ToolExecutionResult {
    const finalizeContent = this.contentFinalizers.get(exec)
    if (finalizeContent === undefined) return result
    const content = finalizeContent(exec, result)
    return content === undefined ? result : { ...result, content }
  }

  // 中文：通知观察器，但不提供可修改结果或将错误传回结果的通道。
  /** Notify observers without exposing a mutation or error channel into the outcome. */
  private notifyResult(exec: ToolExecution, result: ToolExecutionResult): void {
    // 中文：观察器收到可作为 WeakMap 键的只读视图之前，先冻结注册表实时对象。
    // Freeze the registry's live object before observers receive its readonly
    // WeakMap-keyable view.
    Object.freeze(exec)
    const { name: toolName, callId } = exec
    const reportFailure = (error: unknown): void => {
      this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${errorMessage(error)}`)
    }
    const callbacks = this.ctx.events.dispatch('emit', [
      scopeTarget(this, exec.agent), 'tools/result', exec, result,
    ])
    for (const callback of callbacks) {
      try {
        const returned: unknown = callback(exec, result)
        void Promise.resolve(returned).catch(reportFailure)
      } catch (error: unknown) {
        reportFailure(error)
      }
    }
  }

  // 中文：通过审批能力将 ask 解析为允许／拒绝。按需使用 ctx.get('approval')；未组合 ApprovalService 或中途卸载时，下次询问降级为拒绝
  // 。无智能体执行也拒绝，因为无会话可审计、无界面可路由。其他情况一一映射：allowed-once 继续，三种未授权结果以不同原因拒绝，使模型区分人的拒绝与通道缺失。
  /**
   * Resolve an `ask` decision to allow/deny through the approval seam. The
   * seam is consumed opportunistically with `ctx.get('approval')` — a
   * deployment that composes no ApprovalService keeps the historical degrade
   * to deny, and an unmount mid-session degrades the same way on the next ask.
   * An agent-less execution also degrades: without an agent there is no
   * session to audit to and no UI to route to. Otherwise the outcome maps
   * one-to-one — `allowed-once` proceeds; the three non-grants deny with
   * distinct reasons so the model can tell a human "no" from an absent
   * approval channel.
   */
  private async serviceAsk(
    exec: ToolExecution,
    ask: Extract<PreToolDecision, { kind: 'ask' }>,
  ): Promise<ToolAskResolution> {
    const approval = this.ctx.get('approval')
    if (approval === undefined) {
      return {
        decision: { kind: 'deny', reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)` },
        approvalCancelled: false,
      }
    }
    if (exec.agent === undefined) {
      return {
        decision: { kind: 'deny', reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through` },
        approvalCancelled: false,
      }
    }
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      ...ask.reason !== undefined ? { reason: ask.reason } : {},
      signal: exec.signal,
    })
    switch (outcome) {
      case 'allowed-once': return { decision: { kind: 'allow' }, approvalCancelled: false }
      case 'rejected': return {
        decision: { kind: 'deny', reason: `the user rejected tool "${exec.name}"` },
        approvalCancelled: false,
      }
      case 'cancelled': return {
        decision: { kind: 'deny', reason: `approval for tool "${exec.name}" was cancelled` },
        approvalCancelled: true,
      }
      case 'unavailable': return {
        decision: { kind: 'deny', reason: `tool "${exec.name}" requires approval, but no approval channel is available` },
        approvalCancelled: false,
      }
      default: return assertNever(outcome, 'ApprovalOutcome')
    }
  }

  // 中文：对分发结果运行 tools/post-execute waterfall 并应用 PostToolDecision：accept 保持成功，可替换 content；
  // block 将纠正反馈变为 isError。两者都可附 additionalContexts，通过结果送往循环活动批次 FIFO。工具体延迟的上下文在接受时保留，外层被阻
  // 止时丢弃，仅暴露阻止决策显式提供的上下文。运行于 execute 外层 try/catch，监听器抛错转为 isError。
  /**
   * Run the `tools/post-execute` waterfall over a dispatched `result` and apply
   * its {@link PostToolDecision}: `accept` keeps the call successful (replacing
   * `content` when given), `block` turns it into an `isError` whose content is
   * the corrective `feedback`. Either decision may attach `additionalContexts`,
   * which are ferried on the returned result for the loop's active-batch FIFO.
   * Context deferred by the tool body survives an accepted result but is
   * discarded when the outer call is blocked; a block exposes only context the
   * blocking decision explicitly supplied.
   * Runs inside `execute`'s outer try/catch (a throwing listener → isError).
   */
  private async postExecute(exec: ToolExecution, result: ToolExecutionResult): Promise<ToolExecutionResult> {
    const decision = await this.ctx.waterfall(
      scopeTarget(this, exec.agent), 'tools/post-execute', exec, result,
      () => Promise.resolve<PostToolDecision>({ kind: 'accept' }),
    )
    const decisionContexts = decision.additionalContexts ?? []
    if (decision.kind === 'block') {
      const message = failureMessageFromContent(decision.feedback)
      return this.markCanonical(exec, {
        content: decision.feedback,
        isError: true,
        error: { message },
        ...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {},
      })
    }
    if (Object.hasOwn(decision, 'content') && Object.hasOwn(decision, 'value')) {
      throw new TypeError('tools/post-execute accept decision cannot replace both value and content')
    }
    const additionalContexts = [
      ...result.additionalContexts ?? [],
      ...decisionContexts,
    ]
    if (Object.hasOwn(decision, 'value')) {
      if (result.isError) {
        throw new TypeError('tools/post-execute cannot replace the value of a failed result')
      }
      const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined)
      if (tool === undefined) throw new ToolNotFoundError(exec.name)
      const replaced = this.createSuccessResult(exec, tool, decision.value)
      return this.markCanonical(exec, {
        ...replaced,
        ...additionalContexts.length > 0 ? { additionalContexts } : {},
      })
    }
    return this.markCanonical(exec, {
      ...result,
      ...decision.content !== undefined ? { content: decision.content } : {},
      ...additionalContexts.length > 0 ? { additionalContexts } : {},
    })
  }

  // 中文：注册表规范化结果，以及校验各值的精确分发身份。
  /** Registry-normalized results and the exact dispatch that validated each value. */
  private readonly canonicalResults = new WeakMap<object, ToolExecutionToken>()

  // 中文：仅对结果所属分发标记注册表规范化结果为规范结果。
  /** Mark one registry-normalized result as canonical only for its owning dispatch. */
  private markCanonical<T extends ToolExecutionResult>(exec: ToolExecution, result: T): T {
    this.canonicalResults.set(result, exec.token)
    return result
  }

  // 中文：对成功工具体值进行快照、校验、渲染和可选呈现投影。
  /** Snapshot, validate, render, and optionally project one successful body value. */
  private createSuccessResult(exec: ToolExecution, tool: ToolDefinition, candidate: unknown): ToolExecutionSuccess {
    const detached = snapshotToolValue(tool.name, candidate)
    const violations = validateJsonSchemaValue(tool.output.schema, detached, 'value')
    if (violations.length > 0) throw new ToolOutputError(tool.name, violations)
    const value = deepFreeze(detached)
    let rendered: ContentBlock[]
    try {
      rendered = tool.output.render(exec.arguments, value)
    } catch (error: unknown) {
      throw projectionError(tool.name, 'render', error)
    }
    const content = snapshotProjection(tool.name, 'render', rendered)
    let meta: JsonValue | undefined
    if (exec.parent === undefined && tool.output.presentationMeta !== undefined) {
      let projected: JsonValue
      try {
        projected = tool.output.presentationMeta(exec.arguments, value)
      } catch (error: unknown) {
        throw projectionError(tool.name, 'presentationMeta', error)
      }
      meta = snapshotProjection(tool.name, 'presentationMeta', projected)
    }
    const concludesTurn = this.concludingExecutions.has(exec)
    return this.markCanonical(exec, this.materializeFinalResult({
      isError: false,
      value,
      content,
      ...meta !== undefined ? { meta } : {},
      ...concludesTurn ? { concludesTurn: true as const } : {},
    }) as ToolExecutionSuccess)
  }

  // 中文：按所属输出契约规范化 around-dispatch 包装器自行构造的结果。
  /** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
  private normalizeDispatchResult(exec: ToolExecution, result: ToolExecutionResult): ToolExecutionResult {
    if (this.canonicalResults.get(result) === exec.token) return result
    if (result.isError) {
      return this.markCanonical(exec, {
        isError: true,
        error: result.error,
        content: result.content,
        ...result.meta !== undefined ? { meta: result.meta } : {},
        ...result.additionalContexts !== undefined ? { additionalContexts: result.additionalContexts } : {},
      })
    }
    const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined)
    if (tool === undefined) throw new ToolNotFoundError(exec.name)
    const normalized = this.createSuccessResult(exec, tool, result.value)
    return this.markCanonical(exec, {
      ...normalized,
      ...result.additionalContexts !== undefined ? { additionalContexts: result.additionalContexts } : {},
    })
  }

  // 中文：在 tools/result 之前仅一次实体化权威提交结果。
  /** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
  private materializeFinalResult(result: ToolExecutionResult): ToolExecutionResult {
    const presentation = {
      content: result.content,
      ...result.meta !== undefined ? { meta: result.meta } : {},
      ...result.additionalContexts !== undefined ? { additionalContexts: result.additionalContexts } : {},
    }
    if (result.isError) {
      return materializePresentation({ isError: true as const, error: result.error, ...presentation })
    }
    const detached = materializePresentation({
      isError: false as const,
      ...presentation,
      ...result.concludesTurn === true ? { concludesTurn: true as const } : {},
    })
    return deepFreeze({ ...detached, value: result.value })
  }
}

// 中文：生成同进程关联 token，其对象身份即其值。
/** Mint a same-process correlation token whose identity is its value. */
function createExecutionToken(): ToolExecutionToken {
  return Symbol('dsh.tool.execution') as ToolExecutionToken
}

function toolErrorResult(error: unknown): ToolExecutionResult {
  const info = errorInfo(error)
  const message = errorMessage(error)
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, ...info ? { info } : {} },
  }
}

// 中文：跨越 await 读取实时取消状态，不把它当作同步不可变值。
/** Read live abort state across an await without treating it as synchronously immutable. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

// 中文：合并调用方和包装器取消，不嵌套 AbortSignal.any；中继限定于分发作用域，可在工作结束时移除监听器。
/**
 * Fuse caller and wrapper cancellation without nesting `AbortSignal.any`.
 * Keeping the relay dispatch-scoped also removes listeners when work settles.
 */
function fuseToolSignals(caller: AbortSignal, wrapper: AbortSignal): FusedToolSignal {
  if (caller === wrapper) return { signal: caller, dispose() {} }

  const controller = new AbortController()
  let listening = false
  const dispose = (): void => {
    if (!listening) return
    listening = false
    caller.removeEventListener('abort', abortFromCaller)
    wrapper.removeEventListener('abort', abortFromWrapper)
  }
  const abortFrom = (source: AbortSignal): void => {
    const reason: unknown = source.reason
    controller.abort(reason)
    dispose()
  }
  const abortFromCaller = (): void => { abortFrom(caller) }
  const abortFromWrapper = (): void => { abortFrom(wrapper) }

  if (wrapper.aborted) abortFromWrapper()
  else if (caller.aborted) abortFromCaller()
  else {
    listening = true
    caller.addEventListener('abort', abortFromCaller, { once: true })
    wrapper.addEventListener('abort', abortFromWrapper, { once: true })
  }
  return { signal: controller.signal, dispose }
}

// 中文：工具体调用后，取消覆盖成功时的规范结果。
/** Canonical result when cancellation supersedes success after body invocation. */
function toolAbortedResult(prior?: ToolExecutionResult): ToolExecutionResult {
  const additionalContexts = prior?.additionalContexts ?? []
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted' }],
    isError: true,
    error: {
      message: 'tool call aborted',
      info: { name: 'AbortError', code: TOOL_ABORTED },
    },
    ...additionalContexts.length > 0 ? { additionalContexts } : {},
  }
}

// 中文：取消阻止工具体调用时的规范结果。
/** Canonical result when cancellation prevents tool body invocation. */
function toolAbortedBeforeDispatchResult(prior?: ToolExecutionResult): ToolExecutionResult {
  const additionalContexts = prior?.additionalContexts ?? []
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
    ...additionalContexts.length > 0 ? { additionalContexts } : {},
  }
}

export default ToolRuntime

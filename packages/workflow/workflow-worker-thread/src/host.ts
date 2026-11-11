// 中文：单次工作流运行的宿主侧。首个 worker 结果、意外死亡或取消宽限到期决定结算并关闭消息接纳。待启动项共享取消信号；已发布子级共享幂等清理；等待两类工作静止并补齐
// 缺失结束事件。
/**
 * Host side of one workflow run. The first worker result, unexpected death, or
 * cancellation-grace expiry owns settlement and closes message admission.
 * Pending starts share one abort signal; published children share idempotent
 * cleanup, and quiescence waits for both while synthesizing any missing end events.
 * @module @deepseek-ai/dsh-workflow-worker-thread/host
 */

import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assertNever, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowMeta, WorkflowResult, WorkflowRun, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { renderThrown } from './realm.ts'
import type { ExecutionObserver } from './runtime.ts'
import { HostToWorkerType, WorkerToHostType } from './protocol.ts'
import type { HostToWorkerPayloads, WorkerToHostMessage } from './protocol.ts'
import type { ChildResult, ChildStartRequest, WorkerInit } from './types.ts'

// 中文：一个已发布子级及其共享的静止后释放事务。
/** One published child and its shared quiescent-disposal transaction. */
interface ChildRecord {
  readonly run: SubagentRun
  disposal?: Promise<void>
}

// 中文：清理后的 worker 环境不含环境凭据、加载器参数，也刻意不带代理策略。线程不继承宿主全局 dispatcher，自行请求直连，避免把可能含
// user:password 的代理 URL 交给执行模型脚本的 worker；与代码运行时及防御模式要求一致。Windows 空环境会使 os.tmpdir() 退化为相
// 对 undefined\\temp，导致 tsx 缓存写入 cwd，因此传入宿主真实临时目录（不是凭据）；源码模式额外传 TSX_TSCONFIG_PATH 解析路径。
// platform 可在测试覆盖，tsconfigPath 仅源码调用传入；返回清理后的环境。
/**
 * The scrubbed worker environment: no ambient credentials, no loader flags, and deliberately no
 * proxy policy. A worker thread does not inherit the host's global dispatcher, so a workflow's own
 * requests go direct — the alternative is handing the worker a proxy URL that may carry
 * `user:password`, and this worker executes the model-authored script body. That is the same
 * containment the code runtime keeps, and `docs/defensive-patterns.md` requires it.
 * Windows derives `os.tmpdir()` from `TMP`/`TEMP` and falls back to the
 * literal relative path `undefined\temp` when the environment is empty, so
 * tsx's transform cache would land in a cwd-relative `undefined/temp`
 * directory; the host's real temp path (not a credential) is injected there.
 * The unbuilt shape additionally forwards `TSX_TSCONFIG_PATH` for path
 * resolution.
 * @param platform - host platform; overridable so tests exercise both peer arms.
 * @param tsconfigPath - the tsconfig pin to forward; only the unbuilt caller
 *   passes one, so the built worker never observes the host's pin.
 * @returns the scrubbed worker environment object.
 */
export function workerSpawnEnv(
  platform: NodeJS.Platform = process.platform,
  tsconfigPath?: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  if (platform === 'win32') {
    const tmp = tmpdir()
    env.TMP = tmp
    env.TEMP = tmp
  }
  if (tsconfigPath !== undefined) env.TSX_TSCONFIG_PATH = tsconfigPath
  return env
}

// 中文：解析已构建 worker 包或在 worker 内安装两种 tsx 变换的源码启动器。两者均清空 execArgv 和环境，只保留平台临时路径，源码模式再加
// TSX_TSCONFIG_PATH。init 作为 workerData；返回入口路径或 URL 及 Worker 选项。
/**
 * Resolve a built worker bundle or an unbuilt bootstrap that installs both tsx
 * transforms inside the worker. Both shapes clear `execArgv` and the ambient
 * environment (the worker only sees the platform temp path and, unbuilt,
 * `TSX_TSCONFIG_PATH`).
 * @param init - the run payload, passed as `workerData`.
 * @returns the entry path or URL and the Worker options to spawn it with.
 */
function resolveWorkerSpawn(init: WorkerInit): { entry: string | URL; options: WorkerOptions } {
  // 中文：覆盖率例外：下面三行是构建产物分支；单测运行 src 源码，实际构建 worker 由端到端测试覆盖。
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/); the built-worker e2e exercises this shape for real */
  if (!import.meta.url.endsWith('.ts')) {
    return { entry: fileURLToPath(new URL('./worker.cjs', import.meta.url)), options: { workerData: init, env: workerSpawnEnv(), execArgv: [] } }
  }
  // 中文：仅对源码消费者解析 tsx，并在导入 TS 前安装。
  // Resolve tsx only for unbuilt consumers and install it before importing TS.
  const workerEntry = new URL('./worker.ts', import.meta.url)
  const tsxEsmApiEntry = import.meta.resolve('tsx/esm/api')
  const tsxCjsApiEntry = import.meta.resolve('tsx/cjs/api')
  const bootstrap = [
    `import { register as registerEsm } from ${JSON.stringify(tsxEsmApiEntry)}`,
    `import { register as registerCjs } from ${JSON.stringify(tsxCjsApiEntry)}`,
    'registerCjs()',
    'registerEsm()',
    `await import(${JSON.stringify(workerEntry.href)})`,
  ].join('\n')
  return {
    entry: new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`),
    options: {
      workerData: init,
      env: workerSpawnEnv(undefined, process.env.TSX_TSCONFIG_PATH),
      execArgv: [],
    },
  }
}

// 中文：start() 直接返回的存活 WorkflowRun，拥有 Worker、子级注册表和结果结算，result 从不拒绝。meta 为同进程可信数据，句柄及事件按不
// 可变借用。返回前已捕获绑定持有者的 SubagentRuntime，因此卸载引擎只阻止新工作流，当前运行仍可启动和清理子级。
/**
 * One live worker-engine run — the seam's {@link WorkflowRun}, returned by
 * `start()` directly. Owns the Worker, the child registry, and the result
 * settlement; `result` never rejects. `meta` is trusted same-process data
 * borrowed as immutable by the handle and lifecycle events. The holder-bound
 * SubagentRuntime handle is captured before the
 * engine returns this run, so unloading the engine removes only the ability to
 * start another workflow; this run can still start and clean up its children.
 */
export class WorkerRun implements WorkflowRun {
  // 中文：恰好一次以运行结果完成，从不拒绝。
  /** Settles exactly once with the run's outcome; never rejects. */
  readonly result: Promise<WorkflowResult>
  private settleResolve!: (result: WorkflowResult) => void
  private settled = false
  // 中文：在释放回调之前原子地取得结算权的结果／死亡／宽限到期结果。
  /** A Result/death/grace outcome atomically won before teardown callbacks. */
  private terminalClaimed = false
  // 中文：首个死亡信号关闭 worker 消息接纳，并拥有失败清理。
  /** The first death signal closes worker-message admission and owns failure-time cleanup. */
  private workerDeathObserved = false
  private cancelReason: string | undefined
  private graceTimer: NodeJS.Timeout | undefined
  private readonly worker: Worker
  // 中文：exit 时设置；线程已不存在，不能再投递消息。
  /** Set on `exit`: the thread is gone, so posting has nowhere to go. */
  private workerGone = false
  // 中文：已接受的 child-start 消息，用于终止路径的 agentsStarted 计数，参见模块说明。
  /** Accepted `child-start` messages — the terminate-path `agentsStarted` (see module doc). */
  private hostStarted = 0
  // 中文：按 callId 索引已发布子级，条目仅在释放结束后移除。
  /** Published children by callId; an entry leaves only after disposal settles. */
  private readonly children = new Map<number, ChildRecord>()
  // 中文：尚未完成或拒绝的提供方启动操作。
  /** Provider starts that have not yet fulfilled or rejected. */
  private readonly pendingStarts = new Set<Promise<void>>()
  // 中文：按 seq 记录已开始但未结束的智能体，是宿主保证配对的台账，参见 endAgent。
  /** Started-but-not-ended agents by seq — the pairing ledger the HOST guarantees (see {@link endAgent}). */
  private readonly liveAgents = new Map<number, WorkflowAgentInfo>()
  private readonly quiescenceWaiters: (() => void)[] = []
  // 中文：每个子级启动请求携带的本轮共享取消信号。
  /** The per-run abort fanout every child start request carries. */
  private readonly controller = new AbortController()
  // 中文：外部启动信号及安装其上的精确回调，仅保留到首次结算／释放。
  /** External start signal and the exact callback installed on it, retained only until first settle/teardown. */
  private inputSignal: AbortSignal | undefined
  private inputSignalAbort: (() => void) | undefined
  private disposed: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly subagents: SubagentRuntime,
    readonly id: WorkflowRunId,
    readonly meta: WorkflowMeta,
    private readonly parent: Agent,
    init: WorkerInit,
    private readonly provider: string,
    private readonly disposeGraceMs: number,
    private readonly observer: ExecutionObserver,
    signal: AbortSignal | undefined,
  ) {
    this.result = new Promise<WorkflowResult>((resolve) => { this.settleResolve = resolve })
    // 中文：workerData 通过结构化克隆传递；按契约 args 是普通 JSON，因此克隆对所有合法输入有定义，同时隔离调用方。克隆失败会从 start() 明确抛出。
    // workerData rides the structured clone: args are plain JSON by the seam
    // contract, so the clone is total and doubles as the caller-isolation
    // copy (a clone failure throws loud out of start()).
    const { entry, options } = resolveWorkerSpawn(init)
    this.worker = new Worker(entry, options)
    this.worker.on('message', (message: WorkerToHostMessage) => { this.onMessage(message) })
    this.worker.on('error', (error) => { this.onWorkerDeath(`workflow worker failed: ${renderThrown(error)}`, false) })
    // 中文：覆盖率例外：自身协议的载荷全是 JSON 数据，无法构造 messageerror。
    /* v8 ignore next -- messageerror: not constructible from the engine's own protocol (every payload is JSON data) */
    this.worker.on('messageerror', (error) => { this.onWorkerDeath(`workflow worker message failed to deserialize: ${renderThrown(error)}`, false) })
    this.worker.on('exit', (code) => {
      this.workerGone = true
      this.onWorkerDeath(`workflow worker exited before the run settled (exit code ${code})`, true)
    })
    if (signal?.aborted) {
      this.cancel('workflow start signal already aborted')
    } else if (signal !== undefined) {
      const onAbort = (): void => {
        this.detachInputSignal()
        this.cancel('workflow signal aborted')
      }
      this.inputSignal = signal
      this.inputSignalAbort = onAbort
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  // 中文：取消运行：通知 worker，使钩子开始抛错、脚本在下一 await 结束；取消所有子启动共享信号并启动宽限定时器。disposeGraceMs 后仍未结束则强制结
  // 算 cancelled 并终止 worker。幂等，首个原因优先；reason 默认 workflow cancelled。
  /**
   * Cancel the run: the worker is told (its hooks start throwing and the
   * script dies at its next await), the required signal shared by every child
   * start is aborted, and the grace timer
   * arms: a run still unsettled `disposeGraceMs` later force-settles
   * `cancelled` and its worker is TERMINATED. Idempotent; the first reason
   * wins.
   * @param reason - human-readable cause (default `'workflow cancelled'`).
   */
  cancel(reason?: string): void {
    // 中文：已结束运行无需取消；清理回调前已取得终止权也须排除回调重入取消。否则正常 await result 后 dispose→cancel 会启动无人清理的宽限定时器，保
    // 留运行和 Worker 闭包直到过期，形成每次运行的有界泄漏。
    // A settled run has nothing left to cancel, and a terminal source claimed
    // before its cleanup callbacks must exclude cancellation reentered by one
    // of those callbacks. Without the settled guard the
    // ordinary consumer path (await result, then dispose -> cancel) would arm
    // a grace timer nothing ever clears, pinning the run and its Worker
    // closure until the grace expires - a bounded leak per completed run.
    if (this.settled || this.terminalClaimed || this.cancelReason !== undefined) return
    this.cancelReason = reason ?? 'workflow cancelled'
    this.post(HostToWorkerType.Cancel, { reason: this.cancelReason })
    this.abortChildren(this.cancelReason)
    this.graceTimer = setTimeout(() => {
      // 中文：cancelReason 已让取消取得竞态所有权，在观察器清理回调前显式关闭终止边界。
      // Cancellation already owns the race through cancelReason; close the
      // terminal boundary explicitly before observer teardown callbacks.
      this.terminalClaimed = true
      // 中文：worker 即将终止，可能不再响应；运行结算前给所有悬空开始事件补齐结束，确保它们先于 workflow/end。
      // The worker may no longer speak (it is about to be terminated): pair
      // every stranded start before the run settles, so ends precede
      // workflow/end.
      this.endStrandedAgents()
      this.settleResult(this.cancelledResult(this.hostStarted))
      void this.worker.terminate()
    }, this.disposeGraceMs)
    // 中文：定时器使用 unref，不能阻止进程退出。
    // unref'd: an armed grace timer must never hold the process open.
    this.graceTimer.unref()
  }

  // 中文：取消、限时结算并终止。宿主立即释放所有已注册子级：卡住的 worker 无法转发 dispose RPC，若等终止后才清理，会耗尽宽限却根本没开始静止。子级释放与
  // worker 结束共享宽限，worker 自身的释放 RPC 加入同一子级事务。最多等待宽限内结果及子级静止，随后无条件终止 worker，再清理残留子级；其释放错误被隔
  // 离，不在宽限外继续等待。幂等且适用于所有路径，返回在资源释放或被放弃时完成的 Promise。
  /**
   * Cancel + bounded settle + termination. Host-drives every registered
   * child's disposal IMMEDIATELY — a wedged worker can relay no dispose RPC,
   * and deferring child teardown to the post-terminate reap would spend the
   * whole grace waiting for a quiescence that cannot start, then return with
   * the disposals still in flight — so child disposal overlaps the same
   * grace the worker gets to settle (the worker's own dispose RPCs join the
   * shared per-child disposal). Waits (at most the grace) for the result and
   * child quiescence, then terminates the worker unconditionally — the
   * thread never outlives its run — and reaps whatever children remain
   * (their disposal is contained, not awaited past the grace, the same
   * abandonment the seam documents for a slow-disposing child). Idempotent;
   * safe on every path.
   * @returns resolves when the run's resources are released or abandoned.
   */
  dispose(): Promise<void> {
    if (this.disposed !== undefined) return this.disposed
    // 中文：执行子级／提供方释放之前先确立公开事务。原始提供方回调可重入 handle.dispose()，必须加入同一 Promise，而非启动第二次遍历。
    // Claim the public transaction BEFORE its body invokes child/provider
    // disposal. A raw provider callback can reenter handle.dispose(); it must
    // join this promise rather than start a second traversal.
    const claimed = Promise.withResolvers<undefined>()
    this.disposed = claimed.promise
    void (async () => {
      this.detachInputSignal()
      this.cancel('workflow disposed')
      // 中文：终止结算后 cancel() 刻意不再操作，但 dispose 仍拥有所有已注册子级，须独立清理，不能尚未启动存活子级释放就等待其静止。未结算运行中，此路径通过每调
      // 用的取消／释放门禁与取消路径汇合。
      // cancel() deliberately becomes a no-op after terminal settlement, but
      // disposal still owns every registered child. Reap independently so an
      // already-settled workflow cannot wait on child quiescence before it has
      // started the surviving children's disposals. On an unsettled run this
      // joins the cancel path through the per-call cancellation/disposal gates.
      this.reapChildren('workflow disposed')
      await Promise.race([
        (async () => {
          await this.result
          await this.childQuiescence()
        })(),
        sleep(this.disposeGraceMs),
      ])
      await this.worker.terminate()
      this.reapChildren('workflow disposed')
    })().then(
      () => { claimed.resolve(undefined) },
      // 中文：覆盖率例外：result 和 quiescence 从不拒绝，Worker.terminate 是唯一外部 Promise。
      /* v8 ignore next -- result/quiescence never reject and Worker.terminate is the only external promise */
      (error: unknown) => { claimed.reject(error) },
    )
    return this.disposed
  }

  // 中文：按消息标签映射查找载荷并向 worker 投递一条消息，允许线程已消失的情况。
  /** Post one message to the worker (payload looked up from the tag's map entry), tolerating a thread that is already gone. */
  private post<T extends HostToWorkerType>(type: T, payload: HostToWorkerPayloads[T]): void {
    if (this.workerGone || this.workerDeathObserved) return
    try {
      this.worker.postMessage({ type, ...payload })
    } catch (error: unknown) {
      // 中文：引擎消息均为 JSON，序列化不会失败，因此只有释放竞态会到达这里；已无接收者，记日志后继续。
      // Only a teardown race can land here (every engine message is JSON
      // data, so serialization cannot fail); there is nothing left to
      // deliver to — log and move on.
      // 中文：覆盖率例外：postMessage 在退出与 exit 事件之间抛错的释放竞态，无法在进程内构造。
      /* v8 ignore next -- postMessage teardown race (a throw between exit and its event): not constructible in-process */
      this.ctx.logger.warn(`workflow-worker-thread: postMessage failed: ${renderThrown(error)}`)
    }
  }

  private onMessage(message: WorkerToHostMessage): void {
    // 中文：Node 可能先发 error，再投递排队 message，最后 exit。首个死亡信号是宿主逻辑投递屏障，之后到达的消息不得创建子级、在 workflow/end
    //  后叙述或竞争既定结果。
    // Node may emit `error`, then deliver an already-queued `message`, then
    // emit `exit`. The first death signal is the host's logical delivery
    // barrier: nothing arriving afterward may create a child, narrate after
    // workflow/end, or compete with the chosen outcome.
    if (this.workerDeathObserved) return
    switch (message.type) {
      case WorkerToHostType.Ready:
        this.post(HostToWorkerType.Go, {})
        break
      case WorkerToHostType.Phase:
        // 中文：宿主抑制取消后的叙述；worker 只有处理取消消息后钩子才抛错，但在途或取消跨边界期间发出的叙述也不得送达观察器，cancel() 返回后不再发出此类事件。
        // Post-cancel narration is suppressed host-side: worker-side the
        // hooks throw once the cancel message is PROCESSED, but narration
        // already in flight (or emitted while the cancel crossed the
        // boundary) must not reach observers — nothing is emitted after
        // cancel() returns.
        if (this.cancelReason === undefined) this.observer.phase(message.title)
        break
      case WorkerToHostType.Log:
        if (this.cancelReason === undefined) this.observer.log(message.message)
        break
      case WorkerToHostType.AgentStart:
        this.liveAgents.set(message.info.seq, message.info)
        this.observer.agentStart(message.info)
        break
      case WorkerToHostType.AgentEnd:
        // 中文：取消时不抑制 agent-end；被取消子级以 cancelled 结果配对结束。该门禁配合终止路径的补齐，保证每个已开始子级在所有停止路径上恰好一对事件。
        // NOT suppressed on cancel: cancelled children report their paired
        // agent-end with outcome 'cancelled'. The gate (with the termination
        // paths' synthesis) is what makes the one-pair-per-started-child
        // contract hold on every stop path.
        this.endAgent(message.info)
        break
      case WorkerToHostType.ChildStart:
        this.onChildStart(message.callId, message.request)
        break
      case WorkerToHostType.ChildDispose:
        this.onChildDispose(message.callId)
        break
      case WorkerToHostType.Result:
        this.onResult(message.result)
        break
      // 中文：覆盖率例外：下面两行穷尽引擎拥有的封闭联合类型，仅用于新增消息类型时触发编译错误。
      /* v8 ignore next 2 -- closed engine-owned union; the arm only makes adding a message type a compile error */
      default:
        assertNever(message, 'worker-to-host message')
    }
  }

  // 中文：已就绪的提供方结果不再能被 worker 接纳的原因。
  /** Why a ready provider result may no longer be admitted to the worker. */
  private childAdmissionFailure(): { reason: string; rendered: string } | undefined {
    if (this.cancelReason !== undefined) {
      return { reason: this.cancelReason, rendered: `workflow run cancelled: ${this.cancelReason}` }
    }
    if (this.workerDeathObserved) {
      return { reason: 'workflow worker gone', rendered: 'workflow worker is no longer available' }
    }
    if (this.terminalClaimed) {
      return { reason: 'workflow settled', rendered: 'workflow run already settled' }
    }
    return undefined
  }

  private onChildStart(callId: number, request: ChildStartRequest): void {
    const initialFailure = this.childAdmissionFailure()
    if (initialFailure !== undefined) {
      // 中文：终止边界后拒绝启动。子级不得在已取消信号上开始，否则只订阅未来取消事件的提供方永远观察不到取消。
      // Refuse after a terminal boundary: a child must never start on an
      // already-aborted signal (a provider subscribing only to future abort
      // events would never observe it).
      this.post(HostToWorkerType.ChildStartError, { callId, rendered: initialFailure.rendered })
      return
    }
    this.hostStarted += 1
    const task = this.startChild(callId, request)
    this.pendingStarts.add(task)
    void task.then(
      () => { this.finishPendingStart(task) },
      // 中文：覆盖率例外：startChild 已隔离提供方及清理失败。
      /* v8 ignore next -- startChild contains provider and cleanup failures */
      () => { this.finishPendingStart(task) },
    )
  }

  // 中文：等待提供方拥有的启动事务，仅在仍允许接纳时发布。
  /** Await one provider-owned startup transaction and publish only while admitted. */
  private async startChild(callId: number, request: ChildStartRequest): Promise<void> {
    let run: SubagentRun
    try {
      run = await this.subagents.start(this.provider, {
        prompt: [{ type: 'text', text: request.prompt }],
        parent: this.parent,
        signal: this.controller.signal,
        ...request.schema !== undefined ? { outputSchema: request.schema } : {},
        ...request.provider !== undefined || request.model !== undefined
          ? {
            agentOptions: {
              ...request.provider !== undefined ? { provider: request.provider } : {},
              ...request.model !== undefined ? { model: request.model } : {},
            },
          }
          : {},
      })
    } catch (error: unknown) {
      const failure = this.childAdmissionFailure()
      this.post(HostToWorkerType.ChildStartError, {
        callId,
        rendered: failure?.rendered ?? renderThrown(error),
      })
      return
    }
    const failure = this.childAdmissionFailure()
    if (failure !== undefined) {
      this.post(HostToWorkerType.ChildStartError, { callId, rendered: failure.rendered })
      try {
        await run.dispose()
      } catch (error: unknown) {
        this.ctx.logger.warn(`workflow-worker-thread: refused child dispose failed: ${renderThrown(error)}`)
      }
      return
    }

    const record: ChildRecord = { run }
    this.children.set(callId, record)
    // 中文：发布子句柄前先附接结果转发；回调在后续微任务执行，因此即使提供方已结算，也先发送 ChildStarted。
    // Attach result forwarding before publishing the child handle. Because the
    // callback itself runs in a later microtask, ChildStarted is still posted
    // first even for an already-settled scripted provider.
    const forwardResult = run.result.then<() => void, () => void>(
      (result) => {
        try {
          const snapshot = snapshotJsonValue<ChildResult>({
            output: result.output,
            ...result.structured !== undefined ? { structured: result.structured } : {},
            stopReason: result.stopReason,
          })
          if (snapshot === undefined) throw new TypeError('child result is not losslessly JSON-serializable')
          return () => { this.post(HostToWorkerType.ChildSettled, { callId, result: snapshot }) }
        } catch (error: unknown) {
          const rendered = `workflow child result could not cross the worker boundary: ${renderThrown(error)}`
          return () => { this.post(HostToWorkerType.ChildFailed, { callId, rendered }) }
        }
      },
      (error: unknown) => {
        const rendered = renderThrown(error)
        return () => { this.post(HostToWorkerType.ChildFailed, { callId, rendered }) }
      },
    )
    this.post(HostToWorkerType.ChildStarted, { callId, childId: run.id })
    void forwardResult.then((forward) => { forward() })
  }

  private onChildDispose(callId: number): void {
    const record = this.children.get(callId)
    if (record === undefined) {
      // 中文：宿主已先完成释放（dispose 或死亡清理早于 RPC），仍须回复确认，因为 worker 包装器正在等待。
      // Already disposed host-side (a dispose() drive or a death reap beat
      // the RPC) — the ack is still owed (the worker-side wrapper awaits it).
      this.post(HostToWorkerType.ChildDisposed, { callId })
      return
    }
    // 中文：disposeChild 内部隔离错误，永不拒绝，所以之后总会回复确认。
    // disposeChild never rejects (containment is inside), so the ack always follows.
    void this.disposeChild(callId, record).then(() => { this.post(HostToWorkerType.ChildDisposed, { callId }) })
  }

  // 中文：启动或加入已注册子级释放，完成后移除条目。按 callId 缓存：worker RPC、宿主 dispose、清理都可能命中同一子级，但只执行一次 dispose，
  // 所有调用方等待同一结束。提供方违反契约发生拒绝时，记日志并隔离，仍移除条目，避免破坏静止。callId 为键，record 为查到的子记录；返回无论成功失败都完成、绝不拒
  // 绝的 Promise。
  /**
   * Start (or join) one registered child's disposal; the registry entry
   * leaves when it settles. Memoized per callId: the worker's dispose RPC,
   * the dispose() host drive, and the reap can all land on the same child —
   * the child's `dispose()` runs once and every caller awaits that one
   * settlement. A rejection is contained (the subagent seam's dispose() is
   * not supposed to reject, but a backend that does anyway must not break
   * quiescence): logged, and the child still leaves the registry.
   * @param callId - the child's registry key.
   * @param record - the registered child (the caller looked it up).
   * @returns resolves when the disposal settled either way; never rejects.
   */
  private disposeChild(callId: number, record: ChildRecord): Promise<void> {
    if (record.disposal !== undefined) return record.disposal
    record.disposal = Promise.resolve()
      .then(() => record.run.dispose())
      .catch((error: unknown) => {
        this.ctx.logger.warn(`workflow-worker-thread: child dispose failed: ${renderThrown(error)}`)
      })
      .then(() => { this.finishChild(callId) })
    return record.disposal
  }

  // 中文：移除子记录，全部工作结束时释放等待静止的调用方。
  /** Drop a child record and release quiescence waiters when all work ends. */
  private finishChild(callId: number): void {
    this.children.delete(callId)
    this.notifyChildQuiescence()
  }

  // 中文：结束一个提供方启动事务的跟踪。
  /** Retire one provider startup transaction. */
  private finishPendingStart(task: Promise<void>): void {
    this.pendingStarts.delete(task)
    this.notifyChildQuiescence()
  }

  // 中文：仅在待启动事务和已发布子级都结束后释放等待者。
  /** Release waiters only after both pending starts and published children end. */
  private notifyChildQuiescence(): void {
    if (this.children.size !== 0 || this.pendingStarts.size !== 0) return
    for (const waiter of this.quiescenceWaiters.splice(0)) waiter()
  }

  // 中文：所有待启动事务及已发布子级均静止后完成。
  /** Resolves once every pending start and published child has reached quiescence. */
  private childQuiescence(): Promise<void> {
    if (this.children.size === 0 && this.pendingStarts.size === 0) return Promise.resolve()
    return new Promise((resolve) => { this.quiescenceWaiters.push(resolve) })
  }

  // 中文：worker 死亡或最终释放时取消并释放所有注册子级；隔离释放失败，不等待。
  /** Abort + dispose every registered child (worker death / final teardown); disposal is contained, not awaited. */
  private reapChildren(reason: string): void {
    this.abortChildren(this.cancelReason ?? reason)
    for (const [callId, record] of [...this.children]) {
      void this.disposeChild(callId, record)
    }
  }

  // 中文：取消待启动及已发布子级共享的唯一规范信号。
  /** Abort the one canonical signal shared by pending and published children. */
  private abortChildren(reason: string): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason)
  }

  private onResult(result: WorkflowResult): void {
    // 中文：拥有的 worker 会话只发一个 Result；迟到重复结果或排在其他终止来源后的 Result 必须完全无副作用。
    // The owned worker session sends one Result. Keep a late duplicate or a
    // Result queued behind another terminal source completely side-effect-free.
    if (this.terminalClaimed) return
    // 中文：Result 到达宿主时决定先到者胜。若没有外部取消已在途，此结果获胜。随后清理残留子级可能经提供方同步重入 cancel，但结果之后的内部清理不得追溯改写先到的结
    // 果。
    // First-wins is decided when the Result message reaches the host. If no
    // external cancellation was already in flight, this result won. Reaping a
    // stray child below may synchronously reenter cancel() through provider
    // callbacks, but that internal post-result cleanup must not retroactively
    // rewrite the worker result that arrived first.
    const cancellationWasRequested = this.cancelReason !== undefined
    // 中文：结算清理调用提供方释放前先取得所有权。Result 获胜后，迟到取消不能改写。
    // Claim before settlement cleanup invokes provider disposal. Once Result
    // won, a later cancellation cannot rewrite it.
    this.terminalClaimed = true
    // 中文：工作流对外结算前取消待启动项，并开始释放已发布子级。清理仍由 childQuiescence 和持有者 dispose 独立跟踪。
    // Abort pending starts and begin disposing published children before the
    // workflow becomes externally settled. Cleanup remains independently
    // tracked by childQuiescence and the holder's dispose().
    this.reapChildren('workflow settled')
    if (!cancellationWasRequested) {
      this.settleResult(result)
      return
    }
    if (result.stopReason !== 'cancelled') {
      // 中文：取消跨线程传递期间脚本已结束，但请求取消时对外结果尚未结算，所以仍报告 cancelled；这是将 vm drive() 的结束后检查移到竞态接收端。
      // The script settled while our cancel was crossing the thread boundary
      // — the seam-visible result had NOT settled when cancellation was
      // requested, so report cancelled (the vm drive()'s post-settle check,
      // relocated to the receiving side of the race).
      this.settleResult(this.cancelledResult(result.agentsStarted))
      return
    }
    this.settleResult(result)
  }

  // 中文：处理 error/messageerror/exit 信号；exit 还执行最终释放扫描。
  /** Process an error/messageerror/exit signal; `exit` also performs the final disposal sweep. */
  private onWorkerDeath(message: string, isExit: boolean): void {
    if (!this.workerDeathObserved) {
      // 中文：清理回调之前关闭消息接纳。Node 可在 error 后投递崩溃前排队消息；把首个死亡信号当逻辑屏障，防止迟到消息创建工作或在 workflow/end 后叙述。
      // Close message admission BEFORE cleanup callbacks: Node can deliver a
      // message queued before the crash after its `error` event. Treating the
      // first death signal as a logical barrier prevents that late message
      // from creating work or narrating after workflow/end.
      this.workerDeathObserved = true
      const outcomeWasClaimed = this.terminalClaimed
      const cancellationWasRequested = this.cancelReason !== undefined
      // 中文：死亡是终止来源时，先取得所有权再清理子级或调用合成事件观察器，避免重入 cancel 改写。死亡先到仍为错误，死亡前已接受取消则为 cancelled；Result
      // ／宽限已获胜时保留其结果，但仍及时清理失败资源。
      // When death is itself the terminal source, claim BEFORE child reap or
      // synthesized observer callbacks. Either can reenter cancel(); a death
      // that arrived first remains an error, while a cancellation already
      // accepted before death remains cancelled. If Result/grace already won,
      // preserve it while still performing prompt failure-time cleanup.
      if (!outcomeWasClaimed) this.terminalClaimed = true
      if (this.children.size > 0 || this.pendingStarts.size > 0) this.reapChildren('workflow worker gone')
      this.endStrandedAgents()
      if (!outcomeWasClaimed) {
        if (cancellationWasRequested) {
          this.settleResult(this.cancelledResult(this.hostStarted))
        } else {
          this.settleResult({ value: null, stopReason: 'error', error: message, agentsStarted: this.hostStarted })
        }
      }
    }
    if (!isExit) return
    // 中文：error 不是 Node 物理投递屏障，排队消息可先于 exit。接纳已关闭，最终扫描只加入／启动残留记录释放，刻意不重复显式提供方取消。
    // `error` is not Node's physical delivery barrier: a queued message may
    // precede `exit`. Admission is already closed, so this final sweep only
    // joins/starts disposal for registry survivors; it deliberately does not
    // repeat explicit provider cancellation.
    for (const [callId, record] of [...this.children]) void this.disposeChild(callId, record)
    this.endStrandedAgents()
  }

  // 中文：唯一 agent-end 发出门禁：仅当台账中的 start 仍未配对才转发，保证每个 workflow/agent-start 恰好一个 end；worker 能
  // 响应时用其报告，否则由宿主 endStrandedAgents 合成。end 为待发出的结束结果。
  /**
   * The single agent-end emission gate: forwards `end` iff its start is still
   * unpaired in the ledger, so every forwarded `workflow/agent-start` gets
   * EXACTLY one `workflow/agent-end` — the worker's own report where it can
   * speak, a host-synthesized one where it cannot ({@link endStrandedAgents}).
   * @param end - the settlement to emit (worker-reported or synthesized).
   */
  private endAgent(end: WorkflowAgentEndInfo): void {
    // 中文：覆盖率例外：真实结束在宽限强制结算时仍跨线程在途，进程内无法控制排序。
    /* v8 ignore next -- a real end still in flight across the grace force-settle: not orderable in-process */
    if (!this.liveAgents.delete(end.seq)) return
    this.observer.agentEnd(end)
  }

  // 中文：为已开始但未配对的智能体合成 cancelled 的 agent-end。清理会取消所有子级，真实结果若与强制结算竞速则输给已开始的外部取消。
  // onResult/onWorkerDeath 的原子终止边界排除释放回调竞争。worker 不能响应时调用，包括宽限到期、死亡和物理退出。宽限／死亡决定结果时在
  // settleResult 前补齐，已知配对早于 workflow/end；若 Result 更早，退出清理可在其后关闭残留，台账在两种顺序下均保证恰好一次。
  /**
   * Synthesize the missing `agent-end` for every started-but-unpaired agent,
   * outcome `'cancelled'`: the reap cancels every child, and a real
   * settlement racing the force-settle loses to that already-started external
   * cancellation. The atomic terminal boundaries in {@link onResult} and
   * {@link onWorkerDeath} deliberately exclude teardown callbacks as contenders.
   * Called where the worker can no longer speak (the grace force-settle,
   * worker death, physical exit). When grace/death is the terminal source it
   * runs before settleResult, so already-known pairs precede `workflow/end`;
   * after an earlier Result, exit cleanup may close a survivor afterward.
   * The ledger preserves exactly-once pairing in both orders.
   */
  private endStrandedAgents(): void {
    for (const info of [...this.liveAgents.values()]) {
      this.endAgent({ ...info, outcome: 'cancelled' })
    }
  }

  private cancelledResult(agentsStarted: number): WorkflowResult {
    // 中文：cancelReason 只有 cancel() 写入，且调用方都先检查；回退仅用于类型保护，不是可达路径。
    // cancel() is the only writer of cancelReason and every caller checks it
    // first; the fallback guards the type, not a reachable path.
    // 中文：覆盖率忽略下一项。
    /* v8 ignore next */
    const reason = this.cancelReason ?? 'workflow cancelled'
    return { value: null, stopReason: 'cancelled', error: `workflow run cancelled: ${reason}`, agentsStarted }
  }

  // 中文：移除安装在调用方启动信号上的精确取消回调。
  /** Remove the exact abort callback installed on the caller's start signal. */
  private detachInputSignal(): void {
    const signal = this.inputSignal
    const onAbort = this.inputSignalAbort
    if (signal === undefined || onAbort === undefined) return
    this.inputSignal = undefined
    this.inputSignalAbort = undefined
    signal.removeEventListener('abort', onAbort)
  }

  // 中文：首次结算获胜，清除宽限定时器并释放调用方信号引用。
  /** First settle wins; disarms the grace timer and releases the caller signal. */
  private settleResult(result: WorkflowResult): void {
    // 中文：当前所有终止来源调用此处前都已取得所有权；保留局部兜底，防未来调用方重复完成。
    // Every current terminal source claims ownership before calling here; keep
    // the fallback local so a future caller cannot resolve twice.
    // 中文：覆盖率例外：已确立状态机之外的防御性兜底。
    /* v8 ignore next -- defensive fallback outside the claimed state machine */
    if (this.settled) return
    this.terminalClaimed = true
    this.settled = true
    this.detachInputSignal()
    clearTimeout(this.graceTimer)
    this.settleResolve(result)
  }
}

// 中文：普通定时等待，用于释放宽限；使用 unref，不阻止进程退出。
/** A plain timer sleep (the dispose grace); unref'd so it never holds the process open. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

// 中文：单语句 worker 入口，在真实 parentPort 上启动 runWorkerSession。逻辑留在 session 模块以便进程内
// MessageChannel 覆盖；主线程导入此入口会触发 requireParentPort 失败路径。
/**
 * Single-statement worker entry that boots `runWorkerSession` on real `parentPort`. Logic remains in
 * the session module for in-process MessageChannel coverage; importing this entry on the main thread
 * exercises `requireParentPort`'s failure path.
 * @module @deepseek-ai/dsh-workflow-worker-thread/worker
 */

import { parentPort, workerData } from 'node:worker_threads'
import { requireParentPort, runWorkerSession } from './session.ts'
import type { WorkerInit } from './types.ts'

// 中文：node:worker_threads 边界的 workerData 是 any；引擎是唯一启动方，始终提供 WorkerInit。
// workerData is `any` at the node:worker_threads boundary; the engine is the
// only spawner and always provides a WorkerInit.
void runWorkerSession(requireParentPort(parentPort), workerData as WorkerInit)

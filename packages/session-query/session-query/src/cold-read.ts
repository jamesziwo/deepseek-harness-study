// 中文：通过基于句柄的持久化能力进行一次性冷会话读取。
/** One-shot cold session read through the handle-based persistence seam. */

import { interruptedTurnClosers } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset, SessionSeedEventState } from '@deepseek-ai/dsh-session'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandleReadResult } from '@deepseek-ai/dsh-session-persistence'

// 中文：为只读查看补齐结构平衡的已存会话日志。
/** A stored session log balanced for read-only viewing. */
export interface ColdSessionLog {
  // 中文：持久事件的引用共享状态；合成结束事件由本地拥有。
  /** Aliasing state of the persisted events; synthetic closers are locally owned. */
  readonly eventState: SessionSeedEventState
  // 中文：读取句柄打开时固定的存储文件头。
  /** The stored header, fixed when the read handle opened. */
  readonly header: SessionHeader
  // 中文：与 header 配对的精确分叉继承事件数量。
  /** Exact fork-inherited event count paired with {@link header}. */
  readonly inheritedEventCount: SessionLogOffset
  // 中文：存储事件加上为中断末轮确定性生成的内存结束记录，不写回存储。
  /** Stored events plus deterministic in-memory closers for an interrupted final turn; nothing is written back. */
  readonly events: SessionEvent[]
}

// 中文：不取得所有权、不修改存储地读取完整已存日志：打开只读句柄，读取已校验连续日志，关闭句柄，再追加 interruptedTurnClosers，使写入方中途崩溃的日志
// 也可折叠为平衡对话。后端失败原样传播，由调用方定义错误分类。persistence 为已挂载服务，sessionId 为目标，signal 可取消打开和读取；返回外层数组
// 归调用方拥有、可直接接管恢复 Session 的种子。
/**
 * Read one complete stored session log without taking ownership or mutating
 * storage: open a read handle, read the validated contiguous log, close the
 * handle, and append `interruptedTurnClosers` so a log whose writer crashed
 * mid-turn folds as a balanced transcript. Backend failures propagate
 * unmapped — each caller owns its error taxonomy.
 * @param persistence - the mounted persistence service.
 * @param sessionId - the stored session to read.
 * @param signal - optional cancellation for the open and read work.
 * @returns an adoptable seed in a caller-owned outer array, ready for in-place Session restoration.
 */
export async function readColdSessionLog(
  persistence: SessionPersistence,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<ColdSessionLog> {
  const options = signal === undefined ? undefined : { signal }
  const handle = await persistence.open(sessionId, 'read', options)
  let read: SessionHandleReadResult
  try {
    read = await handle.read(0, undefined, options)
  } catch (error: unknown) {
    try {
      await handle.close()
    } catch {
      // 中文：读取失败才是可操作原因，同一损坏句柄的关闭失败没有额外价值。
      // The read failure is the actionable cause; a close failure on the same broken handle adds nothing.
    }
    throw error
  }
  await handle.close()
  const { events } = read
  return {
    eventState: read.eventState,
    header: handle.header,
    inheritedEventCount: handle.inheritedEventCount,
    events: [...events, ...interruptedTurnClosers(events)],
  }
}

// 中文：供 session-query 消费者使用的第一方语义文本提取。
/** First-party semantic text extraction for session-query consumers. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
// 中文：仅类型导入，包含后文消费的第一方 todo 事件。
// Type-only: includes the first-party todo event consumed below.
import type {} from '@deepseek-ai/dsh-tool-todo'

// 中文：从单个第一方会话事件提取可搜索语义文本。结构边界、内嵌原始流、请求封装及未知声明合并事件不贡献文本。event 为待检查事件；返回换行连接文本，不可搜索时为空字符串
// 。
/**
 * Extract searchable semantic text from one first-party session event.
 *
 * Structural boundaries, embedded raw streams, request envelopes, and unknown
 * declaration-merged events contribute no text.
 * @param event - event to inspect.
 * @returns newline-joined semantic text, or an empty string when non-searchable.
 */
export function extractSessionEventText(event: SessionEvent): string {
  switch (event.type) {
    case 'user/message':
      return contentText(event.data.content)
    case 'assistant/message':
      return contentText(event.data.message.content)
    case 'tool/call':
      return joinText([event.data.name, event.data.arguments])
    case 'tool/result':
      return joinText([
        contentText(event.data.message.content),
        event.data.error?.name ?? '',
        event.data.error?.code ?? '',
      ])
    case 'todo/write':
      return joinText(event.data.todos.flatMap(todo => [todo.status, todo.content]))
    case 'turn/end':
      return turnEndText(event.data.reason)
    case 'turn/start':
    case 'step/start':
    case 'step/end':
    case 'assistant/attempt':
    case 'request/header':
      return ''
    // 中文：SessionEventMap 可合并扩展；未知事件在具体第一方消费者定义语义之前保持不可搜索。
    // SessionEventMap is merge-extensible. Unknown events remain
    // non-searchable until a concrete first-party consumer defines semantics.
    default:
      return ''
  }
}

function turnEndText(reason: SessionEvent<'turn/end'>['data']['reason']): string {
  switch (reason.kind) {
    case 'error':
      return joinText(['error', reason.error.message])
    case 'aborted':
      return 'aborted'
    case 'max-tokens':
    case 'interrupted':
      return reason.kind
    case 'completed':
      return ''
    // 中文：TurnEndReasonMap 可合并扩展；未知结果暂不纳入，直到其所有者定义哪些详情是语义而非结构数据。
    // TurnEndReasonMap is merge-extensible. Unknown outcomes stay out until
    // their owner defines which detail is semantic rather than structural.
    default:
      return ''
  }
}

type SessionContentBlock = SessionEvent<'user/message'>['data']['content'][number]

function contentText(content: readonly SessionContentBlock[]): string {
  return joinText(content.flatMap(blockText))
}

function blockText(block: SessionContentBlock): string[] {
  switch (block.type) {
    case 'text':
      return [block.text]
    case 'reasoning':
      return []
    case 'tool-call':
      return [block.name, block.arguments]
    case 'tool-result':
      return block.content.flatMap(blockText)
    // 中文：ContentBlockMap 可合并扩展；未知块不会仅因载荷含字符串就变为可搜索。
    // ContentBlockMap is merge-extensible. Unknown blocks do not become
    // searchable merely because their payload happens to contain strings.
    default:
      return []
  }
}

function joinText(parts: readonly string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join('\n')
}

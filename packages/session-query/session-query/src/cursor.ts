// 中文：会话搜索分页的不透明游标身份。
/** Opaque cursor identity for session-search pagination. */

import type { Branded } from '@deepseek-ai/dsh-brand'

// 中文：会话搜索返回的、由提供方拥有的不透明续页 token。
/** Provider-owned opaque continuation token returned by session search. */
export type SessionSearchCursor = Branded<'SessionSearchCursor'>

// 中文：为编码后的提供方游标加上公开搜索契约的类型标记。value 为不透明编码值；运行时仍是同一字符串，类型上具备会话搜索游标身份。
/**
 * Brand an encoded provider cursor for the public search contract.
 * @param value - opaque encoded cursor value.
 * @returns the same runtime string with session-search cursor identity.
 */
export function SessionSearchCursor(value: string): SessionSearchCursor {
  return value as SessionSearchCursor
}

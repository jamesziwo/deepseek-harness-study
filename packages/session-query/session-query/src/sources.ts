// 中文：逻辑会话来源观察器共享的不可变文件头检查。
/** Shared immutable-header checks for logical session source observers. */

import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from './config.ts'

// 中文：拒绝同一逻辑会话来源的不兼容观察。a 为首次存活、枚举或加载头，b 为预期指向同一来源的第二份头。
/**
 * Reject incompatible observations of one logical session source.
 * @param a - first live, listed, or loaded header observation.
 * @param b - second header observation expected to identify the same source.
 */
export function assertSessionHeadersCompatible(a: SessionHeader, b: SessionHeader): void {
  if (
    a.id !== b.id
    || a.createdAt !== b.createdAt
    || a.cwd !== b.cwd
    || a.parentSession !== b.parentSession
    || a.isSeeded !== b.isSeeded
    || (a.delegationDepth ?? 0) !== (b.delegationDepth ?? 0)
  ) {
    throw new SessionQueryError(
      `session source headers conflict for session "${a.id}"`,
      'SESSION_QUERY_SOURCE_CONFLICT',
    )
  }
}

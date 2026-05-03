import type { ToolApprovalMatch } from '@renderer/pages/home/Messages/Tools/toolResponse'
import type { PermissionRule } from '@shared/data/preference/preferenceTypes'
import { createContext, use } from 'react'

/**
 * Provided by `useChatWithHistory`, consumed by approval cards. `null`
 * outside a V2 chat subtree (legacy path is gone — cards then no-op).
 */
export type ToolApprovalRespondFn = (args: {
  match: ToolApprovalMatch
  approved: boolean
  reason?: string
  /** Claude-Agent only; replaces the tool-call input before `execute()`. */
  updatedInput?: Record<string, unknown>
  /**
   * If set, main writes this rule to `tools.permission_rules` before
   * dispatching the response — next matching invocation skips the prompt.
   * Used by the approval card's "Allow always: <pattern>" affordance.
   */
  persistRule?: PermissionRule
}) => Promise<void> | void

const ToolApprovalContext = createContext<ToolApprovalRespondFn | null>(null)
export const ToolApprovalProvider = ToolApprovalContext.Provider

export function useToolApprovalRespond(): ToolApprovalRespondFn | null {
  return use(ToolApprovalContext)
}

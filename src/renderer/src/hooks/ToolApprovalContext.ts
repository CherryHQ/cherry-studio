import type { ToolApprovalMatch } from '@renderer/components/chat/messages/Tools/toolResponse'
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
}) => Promise<void> | void

const ToolApprovalContext = createContext<ToolApprovalRespondFn | null>(null)
export const ToolApprovalProvider = ToolApprovalContext.Provider

export function useToolApprovalRespond(): ToolApprovalRespondFn | null {
  return use(ToolApprovalContext)
}

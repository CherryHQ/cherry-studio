import { loggerService } from '@logger'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { useCallback } from 'react'

const logger = loggerService.withContext('useToolApprovalBridge')

type ToolApprovalRespondFn = (args: MessageToolApprovalInput) => Promise<void> | void

/**
 * Tool-approval flow.
 *
 * The renderer is NOT a writer of approval state. It only delivers the
 * user's decision to Main via `Ai_ToolApproval_Respond`. Main is the single
 * authority: it applies the decision to the DB-authoritative anchor parts and
 * persists, then (Claude-Agent) resolves the live `canUseTool` or (MCP)
 * dispatches `continue-conversation` once every approval on the turn is
 * decided.
 */
export function useToolApprovalBridge(topicId: string): ToolApprovalRespondFn {
  return useCallback(
    async ({ match, approved, reason, updatedInput }) => {
      const approvalId = match.approvalId

      try {
        const result = await window.api.ai.toolApproval.respond({
          approvalId,
          approved,
          reason,
          updatedInput,
          topicId,
          anchorId: match.messageId
        })
        // Main signals failure via a resolved `{ ok: false }` (e.g. anchor deleted). Surface it as
        // a rejection so the caller resets the card instead of leaving it stuck "submitting".
        if (!result?.ok) {
          throw new Error('Main rejected the tool-approval decision')
        }
      } catch (error) {
        logger.error('Failed to deliver tool-approval decision to main', {
          approvalId,
          approved,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error instanceof Error ? error : new Error(String(error))
      }
    },
    [topicId]
  )
}

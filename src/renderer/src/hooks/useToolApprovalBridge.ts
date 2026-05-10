import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { applyApprovalDecisions } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useCallback } from 'react'

import type { ToolApprovalRespondFn } from './ToolApprovalContext'

const logger = loggerService.withContext('useToolApprovalBridge')

/**
 * Tool-approval flow:
 *
 *  1. PATCH /messages/:id with `applyApprovalDecisions(beforeParts, [decision])`
 *     — DataApi `useMutation`'s `refresh` invalidates the topic's messages
 *     query so SWR refetches and `uiMessages` flips to `approval-responded`
 *     immediately, before the dispatched stream produces any chunk.
 *
 *  2. IPC `Ai_ToolApproval_Respond` only triggers the transport-specific
 *     dispatch (Claude-Agent registry resolve, or MCP continue-conversation
 *     when all approvals are decided). Main no longer writes parts —
 *     renderer is the canonical writer for this user-driven mutation.
 */
export function useToolApprovalBridge(topicId: string, uiMessages: CherryUIMessage[]): ToolApprovalRespondFn {
  const { trigger: patchMessage } = useMutation('PATCH', '/messages/:id', {
    // SWR cache keys for `/topics/:topicId/messages` use the **resolved** path
    // (e.g. `/topics/abc/messages`), not the template — `createMultiKeyMatcher`
    // does exact-string match. Resolve `:topicId` ourselves before handing the
    // pattern to `refresh`, otherwise no key matches and SWR never refetches.
    refresh: () => [`/topics/${topicId}/messages`]
  })

  return useCallback(
    async ({ match, approved, reason, updatedInput }) => {
      const approvalId = match.approvalId
      if (!approvalId) return

      const owner = uiMessages.find((m) => m.id === match.messageId)
      if (owner) {
        const before = (owner.parts ?? []) as CherryMessagePart[]
        const after = applyApprovalDecisions(before, [
          { approvalId, approved, ...(reason !== undefined && { reason }) }
        ])
        try {
          await patchMessage({
            params: { id: match.messageId },
            body: { data: { parts: after }, status: 'pending' }
          })
        } catch (err) {
          logger.error('Failed to PATCH approval state into DB', {
            approvalId,
            err: err instanceof Error ? err.message : String(err)
          })
          return
        }
      } else {
        logger.warn('Approval click had no matching message in uiMessages — falling back to main DB write', {
          approvalId,
          messageId: match.messageId
        })
      }

      try {
        await window.api.ai.toolApproval.respond({
          approvalId,
          approved,
          reason,
          updatedInput,
          topicId,
          anchorId: match.messageId
        })
      } catch (error) {
        logger.error('Failed to deliver tool-approval decision to main', {
          approvalId,
          approved,
          transport: match.transport,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [topicId, uiMessages, patchMessage]
  )
}

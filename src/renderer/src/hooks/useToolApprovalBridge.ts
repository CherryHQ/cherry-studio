import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { applyApprovalDecisions } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback } from 'react'

const logger = loggerService.withContext('useToolApprovalBridge')

type ToolApprovalRespondFn = (args: MessageToolApprovalInput) => Promise<void> | void
type PartsByMessageId = Record<string, CherryMessagePart[]>

/**
 * Tool-approval flow:
 *
 *  1. PATCH /messages/:id with `applyApprovalDecisions(beforeParts, [decision])`
 *     — DataApi `useMutation`'s `refresh` invalidates the topic's messages
 *     query so SWR refetches and `uiMessages` flips to `approval-responded`
 *     immediately, before the dispatched stream produces any chunk.
 *
 *  2. IPC `Ai_ToolApproval_Respond` only resumes the pending registry entry
 *     or dispatches the continue-conversation stream once every approval is
 *     decided. Main no longer writes parts —
 *     renderer is the canonical writer for this user-driven mutation.
 */
export function useToolApprovalBridge(topicId: string, partsByMessageId: PartsByMessageId): ToolApprovalRespondFn {
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

      const before = partsByMessageId[match.messageId]
      const after = applyApprovalDecisions(before, [{ approvalId, approved, ...(reason !== undefined && { reason }) }])

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
          error: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [topicId, partsByMessageId, patchMessage]
  )
}

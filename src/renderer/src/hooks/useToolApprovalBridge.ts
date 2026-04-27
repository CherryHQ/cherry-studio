import type { Chat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'
import { useCallback } from 'react'

import type { ToolApprovalRespondFn } from './ToolApprovalContext'

const logger = loggerService.withContext('useToolApprovalBridge')

/**
 * Tool approval responses for both transports route through the single
 * `Ai_ToolApproval_Respond` IPC. Main picks the right downstream:
 *
 *  - **Claude-Agent** — `ToolApprovalRegistry` still has a pending entry,
 *    dispatch unblocks the in-flight `canUseTool`, the SAME stream resumes.
 *  - **MCP** — no registry entry; Main applies the decision to the DB
 *    anchor (`topicId` + `anchorId`) and dispatches a fresh
 *    `continue-conversation` turn.
 *
 * Critically, **this never goes through `useChat`'s `addToolApprovalResponse`
 * + `sendAutomaticallyWhen` flow**. That flow extracts approvalIds out of
 * `chat.state.messages` to build the next request, but that state can drift
 * from Main's DB-truth (chunk loss, refresh races, etc.) and produces stale
 * decisions or phantom continues. By calling Main directly with ids pulled
 * from `mergedPartsMap` (which IS the DB-truth view), we keep the "Main is
 * the single writer of approval state" invariant intact.
 *
 * Main writes the DB anchor synchronously inside the IPC handler before
 * dispatching the stream, so the approval card naturally transitions to
 * `approval-responded` via the next DataApi reactive refresh — no separate
 * optimistic UI overlay is needed.
 */
export function useToolApprovalBridge(chat: Chat<CherryUIMessage>): ToolApprovalRespondFn {
  return useCallback(
    async ({ match, approved, reason, updatedInput }) => {
      const approvalId = match.approvalId
      if (!approvalId) return

      try {
        await window.api.ai.toolApproval.respond({
          approvalId,
          approved,
          reason,
          updatedInput,
          topicId: chat.id,
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
    [chat]
  )
}

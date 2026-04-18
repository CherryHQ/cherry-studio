import { loggerService } from '@logger'
import { CLAUDE_AGENT_TRANSPORT } from '@renderer/pages/home/Messages/Tools/toolResponse'
import { useCallback } from 'react'

import type { ToolApprovalRespondFn } from './ToolApprovalContext'

const logger = loggerService.withContext('useToolApprovalBridge')

type ChatLike = {
  addToolApprovalResponse: (args: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>
}

/**
 * MCP flows rely on `addToolApprovalResponse` + `sendAutomaticallyWhen`
 * for resend. Claude-Agent flows additionally push the decision (and any
 * `updatedInput`) via IPC to resolve the blocking `canUseTool` promise on
 * the same stream — see `ToolApprovalRegistry`.
 */
export function useToolApprovalBridge(chat: ChatLike): ToolApprovalRespondFn {
  return useCallback(
    async ({ match, approved, reason, updatedInput }) => {
      const approvalId = match.approvalId
      if (!approvalId) return

      await chat.addToolApprovalResponse({ id: approvalId, approved, reason })

      if (match.transport === CLAUDE_AGENT_TRANSPORT) {
        try {
          await window.api.ai.toolApproval.respond({ approvalId, approved, reason, updatedInput })
        } catch (error) {
          logger.error('Failed to deliver Claude Agent approval to main', {
            approvalId,
            approved,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    },
    [chat]
  )
}

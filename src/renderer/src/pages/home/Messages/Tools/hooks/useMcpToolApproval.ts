import { loggerService } from '@logger'
import { useToolApprovalRespond } from '@renderer/hooks/ToolApprovalContext'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks'
import type { MCPToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { APPROVAL_REQUESTED, APPROVAL_RESPONDED, findToolPartByCallId, getToolResponseFromBlock } from '../toolResponse'
import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

const logger = loggerService.withContext('useMcpToolApproval')

function isToolMessageBlock(target: MCPToolResponse | ToolMessageBlock): target is ToolMessageBlock {
  return 'messageId' in target && 'toolId' in target
}

/**
 * MCP tool approval — `needsApproval` on the tool definition causes AI
 * SDK v6 to emit a `ToolUIPart { state: 'approval-requested' }`. This
 * hook reads that state and routes confirm/deny through the bridge
 * (`chat.addToolApprovalResponse` → `sendAutomaticallyWhen` → resend).
 */
export function useMcpToolApproval(
  target?: MCPToolResponse | ToolMessageBlock
): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const respondToolApproval = useToolApprovalRespond()

  const toolResponse: MCPToolResponse | undefined =
    target == null
      ? undefined
      : isToolMessageBlock(target)
        ? ((getToolResponseFromBlock(target) as MCPToolResponse | null) ?? undefined)
        : target

  const toolCallId = toolResponse?.toolCallId ?? toolResponse?.id ?? ''
  const match = useMemo(() => findToolPartByCallId(partsMap, toolCallId), [partsMap, toolCallId])

  const respond = useCallback(
    async (approved: boolean) => {
      if (!match?.approvalId || !respondToolApproval) return
      try {
        await respondToolApproval({
          match,
          approved,
          reason: approved ? undefined : t('message.tools.denied', 'User denied tool execution')
        })
      } catch (error) {
        logger.error('MCP tool approval response failed', error as Error)
        window.toast?.error?.(t('message.tools.approvalError', 'Failed to send approval'))
      }
    },
    [match, respondToolApproval, t]
  )

  if (!match?.approvalId) {
    return { isWaiting: false, isExecuting: false, isSubmitting: false, confirm: () => {}, cancel: () => {} }
  }

  return {
    isWaiting: match.state === APPROVAL_REQUESTED,
    // `input-available` = SDK has inputs, tool's about to run (post-approval).
    isExecuting: match.state === APPROVAL_RESPONDED || match.state === 'input-available',
    isSubmitting: false,
    input: match.input as Record<string, unknown> | undefined,
    confirm: () => void respond(true),
    cancel: () => void respond(false)
  }
}

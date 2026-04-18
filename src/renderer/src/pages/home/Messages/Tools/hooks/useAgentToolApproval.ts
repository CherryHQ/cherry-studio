import { loggerService } from '@logger'
import { useToolApprovalRespond } from '@renderer/hooks/ToolApprovalContext'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks'
import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { APPROVAL_REQUESTED, APPROVAL_RESPONDED, findToolPartByCallId } from '../toolResponse'
import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

const logger = loggerService.withContext('useAgentToolApproval')

export interface UseAgentToolApprovalOptions {
  /** Direct toolCallId (alternative to extracting from block) */
  toolCallId?: string
}

/**
 * Claude-Agent-SDK tool approval — driven by the `ToolUIPart.approval`
 * state embedded in the current chat's messages, with decisions routed
 * through the shared bridge (`Ai_ToolApproval_Respond` IPC).
 */
export function useAgentToolApproval(
  block?: ToolMessageBlock | null,
  options: UseAgentToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const respondToolApproval = useToolApprovalRespond()

  const toolResponse = block?.metadata?.rawMcpToolResponse as NormalToolResponse | undefined
  const toolCallId = options.toolCallId ?? toolResponse?.toolCallId ?? ''
  const match = useMemo(() => findToolPartByCallId(partsMap, toolCallId), [partsMap, toolCallId])

  const respond = useCallback(
    async (approved: boolean) => {
      if (!match?.approvalId || !respondToolApproval) return
      try {
        await respondToolApproval({
          match,
          approved,
          reason: approved ? undefined : t('agent.toolPermission.defaultDenyMessage')
        })
      } catch (error) {
        logger.error('Tool approval response failed', error as Error)
        window.toast?.error?.(t('agent.toolPermission.error.sendFailed'))
      }
    },
    [match, respondToolApproval, t]
  )

  if (!match?.approvalId) {
    return { isWaiting: false, isExecuting: false, isSubmitting: false, confirm: () => {}, cancel: () => {} }
  }

  return {
    isWaiting: match.state === APPROVAL_REQUESTED,
    isExecuting: match.state === APPROVAL_RESPONDED,
    isSubmitting: false,
    input: match.input as Record<string, unknown> | undefined,
    confirm: () => void respond(true),
    cancel: () => void respond(false)
  }
}

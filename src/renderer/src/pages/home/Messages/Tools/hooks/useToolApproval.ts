import { loggerService } from '@logger'
import { useToolApprovalRespond } from '@renderer/hooks/ToolApprovalContext'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks'
import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { APPROVAL_REQUESTED, APPROVAL_RESPONDED, findToolPartByCallId, getToolResponseFromBlock } from '../toolResponse'

const logger = loggerService.withContext('useToolApproval')

/**
 * Unified tool approval state. AI-SDK-v6 `ToolUIPart.state` drives every
 * field — MCP and Claude-Agent tools no longer diverge at the hook layer;
 * the bridge decides transport-specific dispatch internally.
 */
export interface ToolApprovalState {
  isWaiting: boolean
  isExecuting: boolean
  isSubmitting: boolean
  input?: Record<string, unknown>
}

export interface ToolApprovalActions {
  confirm: () => void | Promise<void>
  cancel: () => void | Promise<void>
  autoApprove?: () => void | Promise<void>
}

type ToolApprovalTarget = ToolMessageBlock | MCPToolResponse | NormalToolResponse

function isToolMessageBlock(target: ToolApprovalTarget): target is ToolMessageBlock {
  return 'messageId' in target && 'toolId' in target
}

function resolveToolResponse(target: ToolApprovalTarget): MCPToolResponse | NormalToolResponse | undefined {
  if (isToolMessageBlock(target)) {
    return getToolResponseFromBlock(target) ?? undefined
  }
  return target
}

const IDLE: ToolApprovalState & ToolApprovalActions = {
  isWaiting: false,
  isExecuting: false,
  isSubmitting: false,
  confirm: () => {},
  cancel: () => {}
}

/**
 * Read approval state off the active `ToolUIPart` for a given tool call
 * and expose confirm/cancel that route through the shared bridge.
 *
 * The bridge internally branches on `providerMetadata.cherry.transport`:
 * Claude-Agent approvals also fire `Ai_ToolApproval_Respond` IPC to
 * unblock the blocking server-side `canUseTool` on the same stream.
 */
export function useToolApproval(target: ToolApprovalTarget): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const respondToolApproval = useToolApprovalRespond()

  const toolResponse = resolveToolResponse(target)
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
        logger.error('Tool approval response failed', error as Error)
        window.toast?.error?.(t('message.tools.approvalError', 'Failed to send approval'))
      }
    },
    [match, respondToolApproval, t]
  )

  if (!match?.approvalId) return IDLE

  return {
    isWaiting: match.state === APPROVAL_REQUESTED,
    // `input-available` = SDK has inputs, tool about to run (post-approval).
    isExecuting: match.state === APPROVAL_RESPONDED || match.state === 'input-available',
    isSubmitting: false,
    input: match.input as Record<string, unknown> | undefined,
    confirm: () => void respond(true),
    cancel: () => void respond(false)
  }
}

/** Whether a tool block is awaiting user approval (for grouped-header display). */
export function isBlockWaitingApproval(block: ToolMessageBlock): boolean {
  return getToolResponseFromBlock(block)?.status === 'pending'
}

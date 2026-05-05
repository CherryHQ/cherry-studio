import { loggerService } from '@logger'
import { useToolApprovalRespond } from '@renderer/hooks/ToolApprovalContext'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks'
import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { APPROVAL_REQUESTED, APPROVAL_RESPONDED, findToolPartByCallId } from '../toolResponse'

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

type ToolApprovalTarget = MCPToolResponse | NormalToolResponse

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

  const toolCallId = target.toolCallId ?? target.id ?? ''
  const match = useMemo(() => findToolPartByCallId(partsMap, toolCallId), [partsMap, toolCallId])

  // Optimistic submit flag — bridges the visible gap between click and the
  // arrival of the `approval-responded` / `input-available` chunk from main
  // (~15-30 ms IPC + state-transition round-trip). Without it the buttons
  // appear "frozen" right after click. Reset whenever the underlying call
  // identity changes so a new approval card starts in the pending state.
  const [optimisticSubmitted, setOptimisticSubmitted] = useState(false)
  const lastApprovalIdRef = useRef<string | undefined>(undefined)
  if (lastApprovalIdRef.current !== match?.approvalId) {
    lastApprovalIdRef.current = match?.approvalId
    if (optimisticSubmitted) setOptimisticSubmitted(false)
  }

  const respond = useCallback(
    async (approved: boolean) => {
      if (!match?.approvalId || !respondToolApproval) return
      setOptimisticSubmitted(true)
      try {
        await respondToolApproval({
          match,
          approved,
          reason: approved ? undefined : t('message.tools.denied', 'User denied tool execution')
        })
      } catch (error) {
        setOptimisticSubmitted(false)
        logger.error('Tool approval response failed', error as Error)
        window.toast?.error?.(t('message.tools.approvalError', 'Failed to send approval'))
      }
    },
    [match, respondToolApproval, t]
  )

  if (!match?.approvalId) return IDLE

  const remoteExecuting = match.state === APPROVAL_RESPONDED || match.state === 'input-available'
  return {
    // Hide the pending bar the instant the user submits — the real state
    // transition is on its way, but buttons should not look interactable.
    isWaiting: !optimisticSubmitted && match.state === APPROVAL_REQUESTED,
    // `input-available` = SDK has inputs, tool about to run (post-approval).
    isExecuting: optimisticSubmitted || remoteExecuting,
    isSubmitting: optimisticSubmitted && !remoteExecuting,
    input: match.input as Record<string, unknown> | undefined,
    confirm: () => void respond(true),
    cancel: () => void respond(false),
    // Auto-approve: same dispatch as `confirm` for now — the dropdown UX
    // is restored while persistence (per-tool / per-rule auto-approve)
    // is handled through the existing McpSettings page. When the unified
    // rule system lands on this branch, swap in the rule-saving path.
    autoApprove: () => void respond(true)
  }
}

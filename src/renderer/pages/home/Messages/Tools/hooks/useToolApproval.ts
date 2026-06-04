import { loggerService } from '@logger'
import { useToolApprovalRespond } from '@renderer/hooks/ToolApprovalContext'
import { useMcpServerMutations, useMcpServers } from '@renderer/hooks/useMcpServer'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks'
import type { McpTool, McpToolResponse, NormalToolResponse } from '@renderer/types'
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

type ToolApprovalTarget = McpToolResponse | NormalToolResponse

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
export function useToolApproval(
  target: ToolApprovalTarget,
  /**
   * Optional MCP tool descriptor. When provided, the dropdown's
   * `autoApprove` action also persists the per-tool opt-out by PATCHing
   * the server's `disabledAutoApproveTools` — so the MCP settings page
   * reflects it and subsequent calls of this tool skip the approval card
   * (the mirror operation of `McpSettings.handleToggleAutoApprove`).
   */
  mcpTool?: McpTool
): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const respondToolApproval = useToolApprovalRespond()
  const { mcpServers } = useMcpServers()
  // `useMcpServerMutations` must be called unconditionally per rules-of-hooks.
  // Pass the resolved serverId (or empty string sentinel) — the trigger is
  // only invoked when `mcpTool` is present and not the `hub` synthetic server.
  const { updateMcpServer } = useMcpServerMutations(mcpTool?.serverId ?? '')

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

  const persistAutoApprove = useCallback(() => {
    if (!mcpTool) return
    const server = mcpServers.find((s) => s.id === mcpTool.serverId)
    if (!server) return
    const current = server.disabledAutoApproveTools ?? []
    if (!current.includes(mcpTool.name)) return // already auto-approved server-side
    const next = current.filter((name) => name !== mcpTool.name)
    void updateMcpServer({ body: { disabledAutoApproveTools: next } }).catch((err) => {
      logger.warn('Failed to persist auto-approve for MCP tool', {
        serverId: mcpTool.serverId,
        toolName: mcpTool.name,
        err
      })
    })
  }, [mcpTool, mcpServers, updateMcpServer])

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
    // `autoApprove` ("always allow") only persists for MCP tools (per-server
    // `disabledAutoApproveTools`). Non-MCP (Claude-Agent) tools have no such store, so
    // expose the action only when there's an `mcpTool` — otherwise the card renders a
    // dead affordance that approves once and persists nothing.
    ...(mcpTool && {
      autoApprove: () => {
        void respond(true)
        persistAutoApprove()
      }
    })
  }
}

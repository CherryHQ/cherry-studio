import { loggerService } from '@logger'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { useTimer } from '@renderer/hooks/useTimer'
import type { MCPToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { cancelToolAction, confirmToolAction } from '@renderer/utils/userConfirmation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

const logger = loggerService.withContext('useMcpToolApproval')

const COUNTDOWN_TIME = 30

export interface UseMcpToolApprovalOptions {
  /** Disable countdown auto-approve */
  disableCountdown?: boolean
}

/**
 * Hook for MCP tool approval logic
 * Extracts approval state management from MessageMcpTool
 */
export function useMcpToolApproval(
  block: ToolMessageBlock,
  options: UseMcpToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  const { disableCountdown = false } = options
  const { t } = useTranslation()
  const { mcpServers, updateMCPServer } = useMCPServers()
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()

  const toolResponse = block.metadata?.rawMcpToolResponse as MCPToolResponse | undefined
  const tool = toolResponse?.tool
  const id = toolResponse?.id ?? ''
  const status = toolResponse?.status

  const isPending = status === 'pending'

  const isAutoApproved = useMemo(() => {
    if (!tool) return false
    return isToolAutoApproved(
      tool,
      mcpServers.find((s) => s.id === tool.serverId)
    )
  }, [tool, mcpServers])

  const [countdown, setCountdown] = useState<number>(COUNTDOWN_TIME)
  const [isConfirmed, setIsConfirmed] = useState(isAutoApproved)

  // Compute approval states
  const isWaiting = isPending && !isAutoApproved && !isConfirmed
  const isExecuting = isPending && (isAutoApproved || isConfirmed)

  // Countdown timer effect
  useEffect(() => {
    if (!isWaiting || disableCountdown) return

    if (countdown > 0) {
      setTimeoutTimer(
        `countdown-${id}`,
        () => {
          logger.debug(`countdown: ${countdown}`)
          setCountdown((prev) => prev - 1)
        },
        1000
      )
    } else if (countdown === 0) {
      setIsConfirmed(true)
      confirmToolAction(id)
    }

    return () => clearTimeoutTimer(`countdown-${id}`)
  }, [countdown, id, isWaiting, disableCountdown, setTimeoutTimer, clearTimeoutTimer])

  const cancelCountdown = useCallback(() => {
    clearTimeoutTimer(`countdown-${id}`)
  }, [clearTimeoutTimer, id])

  const confirm = useCallback(() => {
    cancelCountdown()
    setIsConfirmed(true)
    confirmToolAction(id)
  }, [cancelCountdown, id])

  const cancel = useCallback(() => {
    cancelCountdown()
    cancelToolAction(id)
  }, [cancelCountdown, id])

  const autoApprove = useCallback(async () => {
    cancelCountdown()

    if (!tool || !tool.name) {
      return
    }

    const server = mcpServers.find((s) => s.id === tool.serverId)
    if (!server) {
      return
    }

    let disabledAutoApproveTools = [...(server.disabledAutoApproveTools || [])]

    // Remove tool from disabledAutoApproveTools to enable auto-approve
    disabledAutoApproveTools = disabledAutoApproveTools.filter((name) => name !== tool.name)

    const updatedServer = {
      ...server,
      disabledAutoApproveTools
    }

    updateMCPServer(updatedServer)

    // Also confirm the current tool
    setIsConfirmed(true)
    confirmToolAction(id)

    window.toast.success(t('message.tools.autoApproveEnabled', 'Auto-approve enabled for this tool'))
  }, [cancelCountdown, tool, mcpServers, updateMCPServer, id, t])

  return {
    // State
    isWaiting,
    isExecuting,
    countdown,
    remainingSeconds: countdown,
    isExpired: false, // MCP tools don't expire, they auto-confirm
    isSubmitting: false,
    input: undefined, // MCP tools get input from toolResponse.arguments

    // Actions
    confirm,
    cancel,
    autoApprove: isWaiting ? autoApprove : undefined
  }
}

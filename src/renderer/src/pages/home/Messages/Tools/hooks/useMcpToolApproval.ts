import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import {
  cancelToolAction,
  confirmToolAction,
  isToolPending,
  onToolPendingChange
} from '@renderer/utils/userConfirmation'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

/**
 * Hook for MCP tool approval logic
 * Extracts approval state management from MessageMcpTool
 */
export function useMcpToolApproval(block: ToolMessageBlock): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const { mcpServers, updateMCPServer } = useMCPServers()
  const { agent } = useActiveAgent()

  const toolResponse = block.metadata?.rawMcpToolResponse as MCPToolResponse | undefined
  const tool = toolResponse?.tool
  const id = toolResponse?.id ?? ''
  const status = toolResponse?.status

  // Force re-render when requestToolConfirmation() is called for this tool.
  // The resolver Map is not React state, so we need this subscription
  // to detect when the execution layer has registered a pending approval.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!id) return
    return onToolPendingChange((toolId) => {
      if (toolId === id) forceUpdate()
    })
  }, [id])

  // Treat both 'pending' and 'streaming' as pending states.
  // During streaming, the tool execution layer may have already called
  // requestToolConfirmation() before tool-input-end fires, so we check
  // isToolPending() to detect this race condition.
  const isPending = status === 'pending' || (status === 'streaming' && !!id && isToolPending(id))

  const isAutoApproved = useMemo(() => {
    if (!tool) return false
    return isToolAutoApproved(
      tool,
      mcpServers.find((s) => s.id === tool.serverId),
      agent?.allowed_tools
    )
  }, [tool, mcpServers, agent?.allowed_tools])

  const [isConfirmed, setIsConfirmed] = useState(isAutoApproved)

  // Compute approval states
  const isWaiting = isPending && !isAutoApproved && !isConfirmed
  const isExecuting = isPending && (isAutoApproved || isConfirmed)

  const confirm = useCallback(() => {
    setIsConfirmed(true)
    confirmToolAction(id)
  }, [id])

  const cancel = useCallback(() => {
    cancelToolAction(id)
  }, [id])

  const autoApprove = useCallback(async () => {
    if (!tool || !tool.name) {
      return
    }

    let server = mcpServers.find((s) => s.id === tool.serverId)

    // For hub tools (invoke/exec), resolve to the underlying server
    if (!server && tool.serverId === 'hub' && (tool.name === 'invoke' || tool.name === 'exec')) {
      const toolArgs = toolResponse?.arguments as Record<string, unknown> | undefined
      const underlyingToolName = toolArgs?.name as string | undefined
      if (underlyingToolName) {
        try {
          const resolved = await window.api.mcp.resolveHubTool(underlyingToolName)
          if (resolved) {
            server = mcpServers.find((s) => s.id === resolved.serverId)
            // Use the resolved tool name for the disabledAutoApproveTools update
            if (server) {
              let disabledAutoApproveTools = [...(server.disabledAutoApproveTools || [])]
              disabledAutoApproveTools = disabledAutoApproveTools.filter((name) => name !== resolved.toolName)
              updateMCPServer({ ...server, disabledAutoApproveTools })
              setIsConfirmed(true)
              confirmToolAction(id)
              window.toast.success(t('message.tools.autoApproveEnabled', 'Auto-approve enabled for this tool'))
              return
            }
          }
        } catch {
          // Fall through to confirm the current tool at least
        }
      }
    }

    if (!server) {
      // Even if we can't persist auto-approve, confirm the current tool
      setIsConfirmed(true)
      confirmToolAction(id)
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
  }, [tool, toolResponse, mcpServers, updateMCPServer, id, t])

  return {
    // State
    isWaiting,
    isExecuting,
    isSubmitting: false,
    input: undefined,

    // Actions
    confirm,
    cancel,
    autoApprove: isWaiting ? autoApprove : undefined
  }
}

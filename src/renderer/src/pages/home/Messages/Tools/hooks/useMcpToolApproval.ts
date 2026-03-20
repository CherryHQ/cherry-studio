import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer, MCPToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import {
  cancelToolAction,
  confirmToolAction,
  isToolPending,
  onToolPendingChange
} from '@renderer/utils/userConfirmation'
import { useCallback, useEffect, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

/**
 * Resolve a hub tool (invoke/exec) to the underlying server and tool name.
 * Returns null if the tool is not a hub tool or resolution fails.
 */
async function resolveHubToolServer(
  tool: { serverId: string; name: string },
  toolResponse: MCPToolResponse | undefined,
  mcpServers: MCPServer[]
): Promise<{ server: MCPServer; toolName: string } | null> {
  if (tool.serverId !== 'hub' || (tool.name !== 'invoke' && tool.name !== 'exec')) {
    return null
  }
  const toolArgs = toolResponse?.arguments as Record<string, unknown> | undefined
  const underlyingToolName = toolArgs?.name as string | undefined
  if (!underlyingToolName) return null

  try {
    const resolved = await window.api.mcp.resolveHubTool(underlyingToolName)
    if (!resolved) return null
    const server = mcpServers.find((s) => s.id === resolved.serverId)
    if (!server) return null
    return { server, toolName: resolved.toolName }
  } catch {
    return null
  }
}

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

  // For hub invoke/exec tools, resolve the underlying server asynchronously
  // so the UI auto-approve state matches the execution layer's decision.
  const [hubResolvedAutoApproved, setHubResolvedAutoApproved] = useState(false)
  useEffect(() => {
    if (!tool || tool.serverId !== 'hub' || (tool.name !== 'invoke' && tool.name !== 'exec')) {
      setHubResolvedAutoApproved(false)
      return
    }
    let cancelled = false
    resolveHubToolServer(tool, toolResponse, mcpServers).then((result) => {
      if (cancelled) return
      if (result) {
        setHubResolvedAutoApproved(!result.server.disabledAutoApproveTools?.includes(result.toolName))
      } else {
        setHubResolvedAutoApproved(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [tool, toolResponse, mcpServers])

  const isAutoApproved = (() => {
    if (!tool) return false
    // Check basic auto-approve (built-in, agent allowed_tools, server-level)
    const basicApproved = isToolAutoApproved(
      tool,
      mcpServers.find((s) => s.id === tool.serverId),
      agent?.allowed_tools
    )
    if (basicApproved) return true
    // For hub invoke/exec, use the async-resolved underlying server result
    return hubResolvedAutoApproved
  })()

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

    // Try to resolve hub tools to the underlying server
    const hubResult = await resolveHubToolServer(tool, toolResponse, mcpServers)

    // Determine which server and tool name to update
    const server = hubResult?.server ?? mcpServers.find((s) => s.id === tool.serverId)
    const toolNameToApprove = hubResult?.toolName ?? tool.name

    if (!server) {
      // Even if we can't persist auto-approve, confirm the current tool
      setIsConfirmed(true)
      confirmToolAction(id)
      return
    }

    let disabledAutoApproveTools = [...(server.disabledAutoApproveTools || [])]

    // Remove tool from disabledAutoApproveTools to enable auto-approve
    disabledAutoApproveTools = disabledAutoApproveTools.filter((name) => name !== toolNameToApprove)

    updateMCPServer({ ...server, disabledAutoApproveTools })

    // Confirm the current tool. The execution layer will auto-confirm other
    // pending tools with the same name via confirmSameNameTools.
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

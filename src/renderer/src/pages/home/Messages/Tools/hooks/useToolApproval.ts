import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'

import { getToolResponseFromBlock } from '../toolResponse'
import { useAgentToolApproval } from './useAgentToolApproval'
import { useMcpToolApproval } from './useMcpToolApproval'

/**
 * Unified tool approval state
 */
export interface ToolApprovalState {
  /** Whether the tool is waiting for user confirmation */
  isWaiting: boolean
  /** Whether the tool is currently executing after approval */
  isExecuting: boolean
  /** Whether a submission is in progress (Agent only) */
  isSubmitting: boolean
  /** Tool input from permission request (Agent only) */
  input?: Record<string, unknown>
}

/**
 * Unified tool approval actions
 */
export interface ToolApprovalActions {
  /** Confirm/approve the tool execution */
  confirm: () => void | Promise<void>
  /** Cancel/deny the tool execution */
  cancel: () => void | Promise<void>
  /** Auto-approve this tool for future calls (if available) */
  autoApprove?: () => void | Promise<void>
}

export interface UseToolApprovalOptions {
  /** Force a specific approval type */
  forceType?: 'mcp' | 'agent'
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

/**
 * Unified hook for tool approval - automatically selects between MCP and Agent approval
 * based on the tool type in the block metadata.
 *
 * @param block - The tool message block
 * @param options - Optional configuration
 * @returns Unified approval state and actions
 */
export function useToolApproval(
  target: ToolApprovalTarget,
  options: UseToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  const { forceType } = options

  const toolResponse = resolveToolResponse(target)
  const tool = toolResponse?.tool

  const isMcpTool =
    forceType === 'mcp' ||
    (forceType !== 'agent' && (tool?.type === 'mcp' || tool?.type === 'builtin' || tool?.type === 'provider'))
  const mcpApproval = useMcpToolApproval(isMcpTool ? (toolResponse as MCPToolResponse | undefined) : undefined)
  const agentApproval = useAgentToolApproval(undefined, {
    toolCallId: (toolResponse as NormalToolResponse)?.toolCallId
  })

  return isMcpTool ? mcpApproval : agentApproval
}

/**
 * Determine if a block needs approval (either MCP or Agent)
 */
export function isBlockWaitingApproval(block: ToolMessageBlock): boolean {
  return getToolResponseFromBlock(block)?.status === 'pending'
}

export { useAgentToolApproval, type UseAgentToolApprovalOptions } from './useAgentToolApproval'
export { useMcpToolApproval } from './useMcpToolApproval'

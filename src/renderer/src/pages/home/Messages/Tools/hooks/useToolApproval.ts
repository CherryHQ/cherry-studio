import type { ToolMessageBlock } from '@renderer/types/newMessage'

import { useAgentToolApproval } from './useAgentToolApproval'
import { useMcpToolApproval, type UseMcpToolApprovalOptions } from './useMcpToolApproval'

/**
 * Unified tool approval state
 */
export interface ToolApprovalState {
  /** Whether the tool is waiting for user confirmation */
  isWaiting: boolean
  /** Whether the tool is currently executing after approval */
  isExecuting: boolean
  /** Countdown seconds (MCP only) */
  countdown?: number
  /** Expiration timestamp (Agent only) */
  expiresAt?: number
  /** Remaining seconds until auto-confirm (MCP) or expiration (Agent) */
  remainingSeconds: number
  /** Whether the request has expired (Agent only) */
  isExpired: boolean
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

export interface UseToolApprovalOptions extends UseMcpToolApprovalOptions {
  /** Force a specific approval type */
  forceType?: 'mcp' | 'agent'
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
  block: ToolMessageBlock,
  options: UseToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  const { forceType, ...mcpOptions } = options

  const toolResponse = block.metadata?.rawMcpToolResponse
  const tool = toolResponse?.tool

  const isMcpTool = forceType === 'mcp' || (forceType !== 'agent' && tool?.type === 'mcp')
  const mcpApproval = useMcpToolApproval(block, mcpOptions)
  const agentApproval = useAgentToolApproval(block)

  return isMcpTool ? mcpApproval : agentApproval
}

/**
 * Determine if a block needs approval (either MCP or Agent)
 */
export function isBlockWaitingApproval(block: ToolMessageBlock): boolean {
  return block.metadata?.rawMcpToolResponse?.status === 'pending'
}

export { useAgentToolApproval, type UseAgentToolApprovalOptions } from './useAgentToolApproval'
export { useMcpToolApproval, type UseMcpToolApprovalOptions } from './useMcpToolApproval'

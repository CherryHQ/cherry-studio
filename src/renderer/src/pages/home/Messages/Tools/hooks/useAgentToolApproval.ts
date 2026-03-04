import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { useCallback } from 'react'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

const logger = loggerService.withContext('useAgentToolApproval')

export interface UseAgentToolApprovalOptions {
  /** Direct toolCallId (alternative to extracting from block) */
  toolCallId?: string
}

/**
 * Hook for Agent tool approval logic.
 * toolPermissions store and window.api.agentTools have been removed.
 * This hook now returns a stub that always reports no pending permission.
 */
export function useAgentToolApproval(
  block?: ToolMessageBlock | null,
  _options: UseAgentToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  const toolResponse = block?.metadata?.rawMcpToolResponse as NormalToolResponse | undefined
  void toolResponse

  logger.debug('useAgentToolApproval: toolPermissions store removed, returning stub state')

  const confirm = useCallback(() => {
    logger.warn('useAgentToolApproval.confirm: agentTools API removed, no-op')
  }, [])

  const cancel = useCallback(() => {
    logger.warn('useAgentToolApproval.cancel: agentTools API removed, no-op')
  }, [])

  return {
    // State — always non-waiting since there is no permission store
    isWaiting: false,
    isExecuting: false,
    countdown: undefined,
    expiresAt: undefined,
    remainingSeconds: 0,
    isExpired: false,
    isSubmitting: false,
    input: undefined,

    // Actions
    confirm,
    cancel,
    autoApprove: undefined
  }
}

// Re-export PermissionUpdate so callers that import it from here still compile
export type { PermissionUpdate }

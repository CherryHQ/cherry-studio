import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectPendingPermission, toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

const logger = loggerService.withContext('useAgentToolApproval')

export interface UseAgentToolApprovalOptions {
  /** Direct toolCallId (alternative to extracting from block) */
  toolCallId?: string
}

/**
 * Hook for Agent tool approval logic
 * Can be used with:
 * - A ToolMessageBlock (extracts toolCallId from metadata)
 * - A direct toolCallId via options
 */
export function useAgentToolApproval(
  block?: ToolMessageBlock | null,
  options: UseAgentToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const toolResponse = block?.metadata?.rawMcpToolResponse as NormalToolResponse | undefined
  const toolCallId = options.toolCallId ?? toolResponse?.toolCallId ?? ''

  const request = useAppSelector((state) => selectPendingPermission(state.toolPermissions, toolCallId))

  const [now, setNow] = useState(() => Date.now())

  // Update time every 500ms to track expiration
  useEffect(() => {
    if (!request) return

    logger.debug('Tracking agent tool permission', {
      requestId: request.requestId,
      toolName: request.toolName,
      expiresAt: request.expiresAt
    })

    setNow(Date.now())

    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 500)

    return () => {
      window.clearInterval(interval)
    }
  }, [request])

  const remainingMs = useMemo(() => {
    if (!request) return 0
    return Math.max(0, request.expiresAt - now)
  }, [request, now])

  const remainingSeconds = useMemo(() => Math.ceil(remainingMs / 1000), [remainingMs])
  const isExpired = remainingMs <= 0

  const isSubmittingAllow = request?.status === 'submitting-allow'
  const isSubmittingDeny = request?.status === 'submitting-deny'
  const isSubmitting = isSubmittingAllow || isSubmittingDeny
  const isInvoking = request?.status === 'invoking'
  const isPending = request?.status === 'pending'

  const handleDecision = useCallback(
    async (
      behavior: 'allow' | 'deny',
      extra?: {
        updatedInput?: Record<string, unknown>
        updatedPermissions?: PermissionUpdate[]
        message?: string
      }
    ) => {
      if (!request) return

      logger.debug('Submitting agent tool permission decision', {
        requestId: request.requestId,
        toolName: request.toolName,
        behavior
      })

      dispatch(toolPermissionsActions.submissionSent({ requestId: request.requestId, behavior }))

      try {
        const payload = {
          requestId: request.requestId,
          behavior,
          ...(behavior === 'allow'
            ? {
                updatedInput: extra?.updatedInput ?? request.input,
                updatedPermissions: extra?.updatedPermissions
              }
            : {
                message: extra?.message ?? t('agent.toolPermission.defaultDenyMessage')
              })
        }

        const response = await window.api.agentTools.respondToPermission(payload)

        if (!response?.success) {
          throw new Error('Renderer response rejected by main process')
        }

        logger.debug('Tool permission decision acknowledged by main process', {
          requestId: request.requestId,
          behavior
        })
      } catch (error) {
        logger.error('Failed to send tool permission response', error as Error)
        window.toast?.error?.(t('agent.toolPermission.error.sendFailed'))
        dispatch(toolPermissionsActions.submissionFailed({ requestId: request.requestId }))
      }
    },
    [dispatch, request, t]
  )

  const confirm = useCallback(() => {
    handleDecision('allow')
  }, [handleDecision])

  const cancel = useCallback(() => {
    handleDecision('deny')
  }, [handleDecision])

  // Auto-approve with suggestions if available
  const autoApprove = useCallback(() => {
    if (request?.suggestions?.length) {
      handleDecision('allow', { updatedPermissions: request.suggestions })
    }
  }, [handleDecision, request?.suggestions])

  // Determine isWaiting - only when pending and not expired
  const isWaiting = !!request && isPending && !isExpired
  // isExecuting - when invoking or submitting allow
  const isExecuting = isInvoking || isSubmittingAllow

  return {
    // State
    isWaiting,
    isExecuting,
    countdown: undefined,
    expiresAt: request?.expiresAt,
    remainingSeconds,
    isExpired: !!request && isExpired,
    isSubmitting,
    // Agent-specific: input from permission request
    input: request?.input,

    // Actions
    confirm,
    cancel,
    autoApprove: request?.suggestions?.length ? autoApprove : undefined
  }
}

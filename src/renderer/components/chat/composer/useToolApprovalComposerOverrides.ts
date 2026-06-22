import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useMemo, useState } from 'react'

import type { MessageToolApprovalInput } from '../messages/types'
import type { ComposerOverride } from './ComposerContext'
import { createAskUserQuestionComposerOverride } from './variants/AskUserQuestionComposer'
import { findLatestPendingAskUserQuestionRequest } from './variants/askUserQuestionComposerRequest'
import { createPermissionRequestComposerOverride } from './variants/PermissionRequestComposer'
import { findLatestPendingPermissionRequest } from './variants/permissionRequestComposerRequest'

type ToolApprovalComposerOverridesOptions = {
  partsByMessageId: Record<string, CherryMessagePart[]>
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
}

export function useToolApprovalComposerOverrides({
  partsByMessageId,
  onRespond
}: ToolApprovalComposerOverridesOptions): readonly ComposerOverride[] {
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState<ReadonlySet<string>>(() => new Set())
  const askUserQuestionRequest = useMemo(
    () => findLatestPendingAskUserQuestionRequest(partsByMessageId),
    [partsByMessageId]
  )
  const permissionRequest = useMemo(() => findLatestPendingPermissionRequest(partsByMessageId), [partsByMessageId])
  const visiblePermissionRequest =
    permissionRequest && !dismissedApprovalIds.has(permissionRequest.approvalId) ? permissionRequest : null

  const optimisticallyRespond = useCallback(
    async (input: MessageToolApprovalInput) => {
      const approvalId = input.match.approvalId
      setDismissedApprovalIds((current) => new Set(current).add(approvalId))

      try {
        await onRespond(input)
      } catch (error) {
        setDismissedApprovalIds((current) => {
          const next = new Set(current)
          next.delete(approvalId)
          return next
        })
        throw error
      }
    },
    [onRespond]
  )

  return useMemo(() => {
    const overrides: ComposerOverride[] = []

    if (askUserQuestionRequest) {
      overrides.push(
        createAskUserQuestionComposerOverride({
          request: askUserQuestionRequest,
          onRespond
        })
      )
    }

    if (visiblePermissionRequest) {
      overrides.push(
        createPermissionRequestComposerOverride({
          request: visiblePermissionRequest,
          onRespond: optimisticallyRespond
        })
      )
    }

    return overrides
  }, [askUserQuestionRequest, onRespond, optimisticallyRespond, visiblePermissionRequest])
}

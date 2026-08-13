import type { MessageStreamingLayers, MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useMemo, useState } from 'react'

import type { ComposerOverride } from './ComposerContext'
import { createAskUserQuestionComposerOverride } from './variants/AskUserQuestionComposer'
import { findLatestPendingAskUserQuestionRequest } from './variants/askUserQuestionComposerRequest'
import { createPermissionRequestComposerOverride } from './variants/PermissionRequestComposer'
import { findLatestPendingPermissionRequest } from './variants/permissionRequestComposerRequest'

type ToolApprovalComposerOverridesOptions = {
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
}

export function useToolApprovalComposerOverrides({
  partsByMessageId,
  streamingLayers,
  onRespond
}: ToolApprovalComposerOverridesOptions): readonly ComposerOverride[] {
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState<ReadonlySet<string>>(() => new Set())
  const settledHistoryParts = useMemo<Record<string, CherryMessagePart[]> | null>(() => {
    if (!streamingLayers) return null

    const liveMessageIdSet = new Set(streamingLayers.liveMessageIds)
    const historyParts: Record<string, CherryMessagePart[]> = {}
    for (const [messageId, parts] of Object.entries(streamingLayers.historyPartsByMessageId)) {
      if (!liveMessageIdSet.has(messageId)) historyParts[messageId] = parts
    }
    return historyParts
  }, [streamingLayers])
  const currentParts = useMemo<Record<string, CherryMessagePart[]>>(() => {
    if (!streamingLayers) return partsByMessageId

    const liveParts: Record<string, CherryMessagePart[]> = {}
    for (const messageId of streamingLayers.liveMessageIds) {
      const parts = partsByMessageId[messageId]
      if (parts) liveParts[messageId] = parts
    }
    return liveParts
  }, [streamingLayers, partsByMessageId])
  const historyAskUserQuestionRequest = useMemo(
    () => (settledHistoryParts ? findLatestPendingAskUserQuestionRequest(settledHistoryParts) : null),
    [settledHistoryParts]
  )
  const currentAskUserQuestionRequest = useMemo(
    () => findLatestPendingAskUserQuestionRequest(currentParts),
    [currentParts]
  )
  const askUserQuestionRequest = currentAskUserQuestionRequest ?? historyAskUserQuestionRequest
  const historyPermissionRequest = useMemo(
    () => (settledHistoryParts ? findLatestPendingPermissionRequest(settledHistoryParts) : null),
    [settledHistoryParts]
  )
  const currentPermissionRequest = useMemo(() => findLatestPendingPermissionRequest(currentParts), [currentParts])
  const permissionRequest = currentPermissionRequest ?? historyPermissionRequest
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

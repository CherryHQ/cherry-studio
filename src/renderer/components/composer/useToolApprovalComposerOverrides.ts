import { getToolName, isToolUIPart } from 'ai'
import { useEffect, useMemo } from 'react'

import { isAskUserQuestionToolName } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import type { MessageStreamingLayers, MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { ComposerOverride } from './ComposerContext'
import { createAskUserQuestionComposerOverride } from './variants/AskUserQuestionComposer'
import { findLatestPendingAskUserQuestionRequest } from './variants/askUserQuestionComposerRequest'
import { clearAskUserQuestionDraftCache } from './variants/askUserQuestionDraftCache'
import { createPermissionRequestComposerOverride } from './variants/PermissionRequestComposer'
import { findNextPendingPermissionRequest } from './variants/permissionRequestComposerRequest'

type ToolApprovalComposerOverridesOptions = {
  partsByMessageId: Record<string, CherryMessagePart[]>
  /** Database message parts, before live overlays or optimistic projections. */
  persistedPartsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
}

export function useToolApprovalComposerOverrides({
  partsByMessageId,
  persistedPartsByMessageId,
  streamingLayers,
  onRespond
}: ToolApprovalComposerOverridesOptions): readonly ComposerOverride[] {
  useEffect(() => {
    for (const parts of Object.values(persistedPartsByMessageId)) {
      for (const part of parts) {
        if (!isToolUIPart(part) || !isAskUserQuestionToolName(getToolName(part))) continue
        if (
          part.state !== 'approval-responded' &&
          part.state !== 'output-available' &&
          part.state !== 'output-denied'
        ) {
          continue
        }
        if (part.approval?.id) clearAskUserQuestionDraftCache(part.approval.id)
      }
    }
  }, [persistedPartsByMessageId])

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
    () => (settledHistoryParts ? findNextPendingPermissionRequest(settledHistoryParts) : null),
    [settledHistoryParts]
  )
  const currentPermissionRequest = useMemo(() => findNextPendingPermissionRequest(currentParts), [currentParts])
  const permissionRequest = currentPermissionRequest ?? historyPermissionRequest

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

    if (permissionRequest) {
      overrides.push(
        createPermissionRequestComposerOverride({
          request: permissionRequest,
          onRespond
        })
      )
    }

    return overrides
  }, [askUserQuestionRequest, onRespond, permissionRequest])
}

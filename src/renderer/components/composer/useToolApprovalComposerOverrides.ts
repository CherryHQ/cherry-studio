import { getToolName, isToolUIPart } from 'ai'
import { type ComponentType, useEffect, useMemo } from 'react'

import { isAskUserQuestionToolName } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import type { MessageStreamingLayers, MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { type MessagePartRows, messagePartEntries, messagePartsAt } from '@renderer/utils/message/messagePartRows'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { ComposerOverride } from './ComposerContext'
import { createAskUserQuestionComposerOverride } from './variants/AskUserQuestionComposer'
import { findLatestPendingAskUserQuestionRequest } from './variants/askUserQuestionComposerRequest'
import { clearAskUserQuestionDraftCache } from './variants/askUserQuestionDraftCache'
import { useComputerUseApproval } from './variants/ComputerUseApprovalComposer'
import {
  createPermissionRequestComposerOverride,
  type PermissionRequestComposerProps
} from './variants/PermissionRequestComposer'
import { findNextPendingPermissionRequest, isPendingApprovalPart } from './variants/permissionRequestComposerRequest'

type ToolApprovalComposerOverridesOptions = {
  topicId?: string
  partsByMessageId: MessagePartRows
  /** Database message parts, before live overlays or optimistic projections. */
  persistedPartsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  permissionRequestComponent?: ComponentType<PermissionRequestComposerProps>
  agentName?: string
}

export function useToolApprovalComposerOverrides({
  topicId,
  partsByMessageId,
  persistedPartsByMessageId,
  streamingLayers,
  onRespond,
  permissionRequestComponent,
  agentName
}: ToolApprovalComposerOverridesOptions): readonly ComposerOverride[] {
  const computerUseApproval = useComputerUseApproval(topicId)
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

  const history = streamingLayers?.historyPartsByMessageId
  const historyWithApprovals = useMemo(() => {
    const candidates: [string, CherryMessagePart[]][] = []
    if (history) {
      for (const [id, parts] of messagePartEntries(history)) {
        if (parts.some(isPendingApprovalPart)) {
          candidates.push([id, parts])
        }
      }
    }
    return candidates
  }, [history])
  const liveIds = streamingLayers?.liveMessageIds
  const settledHistoryParts = useMemo(() => {
    if (!liveIds) return null
    const live = new Set(liveIds)
    return Object.fromEntries(historyWithApprovals.filter(([id]) => !live.has(id)))
  }, [historyWithApprovals, liveIds])
  const currentParts = useMemo<MessagePartRows>(() => {
    if (!streamingLayers) return partsByMessageId

    const liveParts: Record<string, CherryMessagePart[]> = {}
    for (const messageId of streamingLayers.liveMessageIds) {
      const parts = messagePartsAt(partsByMessageId, messageId)
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
    () => (settledHistoryParts ? findNextPendingPermissionRequest(settledHistoryParts, partsByMessageId) : null),
    [settledHistoryParts, partsByMessageId]
  )
  const currentPermissionRequest = useMemo(
    () => findNextPendingPermissionRequest(currentParts, partsByMessageId),
    [currentParts, partsByMessageId]
  )
  const permissionRequest = currentPermissionRequest ?? historyPermissionRequest

  return useMemo(() => {
    const overrides: ComposerOverride[] = computerUseApproval ? [computerUseApproval] : []

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
          onRespond,
          component: permissionRequestComponent,
          agentName
        })
      )
    }

    return overrides
  }, [askUserQuestionRequest, onRespond, permissionRequest, permissionRequestComponent, agentName, computerUseApproval])
}

import type { MessageActivityState, MessageListItem } from '@renderer/components/chat/messages/types'
import { isMessageListItemProcessing } from '@renderer/components/chat/messages/utils/messageListItem'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback } from 'react'

export function useMessageActivityState(
  topicId: string,
  partsMap?: Record<string, CherryMessagePart[]> | null
): (message: MessageListItem) => MessageActivityState {
  void partsMap
  const { activeExecutions, awaitingApprovalAnchors } = useTopicStreamStatus(topicId)

  return useCallback(
    (message: MessageListItem) => {
      const isActiveExecutionTarget = activeExecutions.some((execution) => execution.anchorMessageId === message.id)
      const isApprovalAnchor = awaitingApprovalAnchors.some((execution) => execution.anchorMessageId === message.id)
      const isProcessing = isMessageListItemProcessing(message) || isActiveExecutionTarget || isApprovalAnchor

      return {
        isProcessing,
        isStreamTarget: isProcessing,
        isApprovalAnchor
      }
    },
    [activeExecutions, awaitingApprovalAnchors]
  )
}

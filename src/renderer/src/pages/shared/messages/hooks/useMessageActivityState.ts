import type { MessageActivityState, MessageListItem } from '@renderer/components/chat/messages/types'
import { isMessageListItemAwaitingApproval } from '@renderer/components/chat/messages/utils/messageListItem'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { CherryMessagePart } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'
import { useCallback, useMemo } from 'react'

export function useMessageActivityState(
  topicId: string,
  partsMap?: Record<string, CherryMessagePart[]> | null
): (message: MessageListItem) => MessageActivityState {
  const { status: topicStreamStatus, activeExecutions } = useTopicStreamStatus(topicId)
  const isTopicStreaming = topicStreamStatus === 'pending' || topicStreamStatus === 'streaming'

  const isAwaitingApproval = useMemo(() => {
    if (isTopicStreaming || !partsMap) return false

    for (const parts of Object.values(partsMap)) {
      for (const part of parts) {
        if (isToolUIPart(part) && part.state === 'approval-requested') return true
      }
    }

    return false
  }, [isTopicStreaming, partsMap])

  return useCallback(
    (message: MessageListItem) => ({
      isProcessing: isTopicStreaming || isAwaitingApproval,
      isStreamTarget: activeExecutions.some((execution) => execution.anchorMessageId === message.id),
      isApprovalAnchor: isMessageListItemAwaitingApproval(message, partsMap?.[message.id] ?? [])
    }),
    [activeExecutions, isAwaitingApproval, isTopicStreaming, partsMap]
  )
}

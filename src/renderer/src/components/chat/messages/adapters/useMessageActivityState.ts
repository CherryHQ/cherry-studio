import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { Message } from '@renderer/types/newMessage'
import { isMessageAwaitingApproval } from '@renderer/utils/messageUtils/is'
import type { CherryMessagePart } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'
import { useCallback, useMemo } from 'react'

import type { MessageActivityState } from '../types'

export function useMessageActivityState(
  topicId: string,
  partsMap?: Record<string, CherryMessagePart[]> | null
): (message: Message) => MessageActivityState {
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
    (message: Message) => ({
      isProcessing: isTopicStreaming || isAwaitingApproval,
      isStreamTarget: activeExecutions.some((execution) => execution.anchorMessageId === message.id),
      isApprovalAnchor: isMessageAwaitingApproval(message)
    }),
    [activeExecutions, isAwaitingApproval, isTopicStreaming]
  )
}

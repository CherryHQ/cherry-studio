import type { MessageActivityState, MessageListItem } from '@renderer/components/chat/messages/types'
import { isMessageListItemProcessing } from '@renderer/components/chat/messages/utils/messageListItem'
import { useConversationStreamStatus } from '@renderer/hooks/useConversationStreamStatus'
import type { ConversationRef } from '@shared/ai/conversation'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback } from 'react'

export function useMessageActivityState(
  conversation: ConversationRef,
  partsMap?: Record<string, CherryMessagePart[]> | null
): (message: MessageListItem) => MessageActivityState {
  void partsMap
  const { activeExecutions, awaitingInteractionExecutions } = useConversationStreamStatus(conversation)

  return useCallback(
    (message: MessageListItem) => {
      const isActiveExecutionTarget = activeExecutions.some((execution) => execution.outputNodeId === message.id)
      const isApprovalAnchor = awaitingInteractionExecutions.some((execution) => execution.outputNodeId === message.id)
      const isProcessing = isMessageListItemProcessing(message) || isActiveExecutionTarget || isApprovalAnchor

      return {
        isProcessing,
        isStreamTarget: isProcessing,
        isApprovalAnchor
      }
    },
    [activeExecutions, awaitingInteractionExecutions]
  )
}

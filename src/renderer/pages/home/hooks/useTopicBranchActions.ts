import { useMutation } from '@data/hooks/useDataApi'
import { useConversationStreamStatus } from '@renderer/hooks/useConversationStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { ConversationKind, ConversationStatus } from '@shared/ai/conversation'
import { useCallback } from 'react'

import { getTopicBranchCachePaths } from './useTopicMessagesCache'

export function useTopicBranchActions(topicId: string) {
  const { isPending, status } = useConversationStreamStatus({ kind: ConversationKind.Chat, id: topicId })
  const branchCachePaths = getTopicBranchCachePaths(topicId)
  const { trigger: reserveBranchTrigger } = useMutation('POST', '/messages/:id/branches', {
    refresh: branchCachePaths
  })
  const { trigger: deleteReservedBranchTrigger } = useMutation('DELETE', '/messages/:id', {
    refresh: branchCachePaths
  })

  const reserveBranch = useCallback(
    async (anchorMessageId: string) => {
      const activate = !isPending && status !== ConversationStatus.AwaitingInteraction
      await reserveBranchTrigger({
        params: { id: anchorMessageId },
        body: { activate }
      })

      if (activate) {
        void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId })
      }
    },
    [isPending, reserveBranchTrigger, status, topicId]
  )

  const deleteReservedBranch = useCallback(
    (messageId: string) =>
      deleteReservedBranchTrigger({
        params: { id: messageId },
        query: { awaitingInputOnly: true }
      }),
    [deleteReservedBranchTrigger]
  )

  return { reserveBranch, deleteReservedBranch }
}

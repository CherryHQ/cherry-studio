import { useCallback } from 'react'

import { useMutation } from '@data/hooks/useDataApi'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { trackProductEvent } from '@renderer/services/productAnalytics'

import { getTopicBranchCachePaths } from './useTopicMessagesCache'

export function useTopicBranchActions(topicId: string) {
  const { isPending, status } = useTopicStreamStatus(topicId)
  const branchCachePaths = getTopicBranchCachePaths(topicId)
  const { trigger: reserveBranchTrigger } = useMutation('POST', '/messages/:id/branches', {
    refresh: branchCachePaths
  })
  const { trigger: deleteBranchTrigger } = useMutation('DELETE', '/messages/:id/branch', {
    refresh: branchCachePaths
  })
  const { trigger: deleteReservedBranchTrigger } = useMutation('DELETE', '/messages/:id', {
    refresh: branchCachePaths
  })

  const reserveBranch = useCallback(
    async (anchorMessageId: string) => {
      const activate = !isPending && status !== 'awaiting-approval'
      await reserveBranchTrigger({
        params: { id: anchorMessageId },
        body: { activate }
      })
      trackProductEvent({ event: 'chat_branch_used', action: 'created', source: 'manual' })

      if (activate) {
        void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId })
      }
    },
    [isPending, reserveBranchTrigger, status, topicId]
  )

  const deleteBranch = useCallback(
    async (messageId: string, awaitingInputOnly: boolean) => {
      if (awaitingInputOnly) {
        await deleteReservedBranchTrigger({ params: { id: messageId }, query: { awaitingInputOnly: true } })
      } else {
        await deleteBranchTrigger({ params: { id: messageId }, query: { topicId } })
      }
      trackProductEvent({ event: 'chat_branch_used', action: 'deleted' })
    },
    [deleteBranchTrigger, deleteReservedBranchTrigger, topicId]
  )

  return { reserveBranch, deleteBranch }
}

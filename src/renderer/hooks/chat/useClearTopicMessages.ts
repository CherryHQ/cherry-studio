import { useCallback } from 'react'

import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { messageEditingSessionService } from '@renderer/services/MessageEditingSessionService'
import { invalidateCachedMessageUiStates } from '@renderer/services/messageUiStateCache'

const logger = loggerService.withContext('useClearTopicMessages')

export function useClearTopicMessages() {
  const { trigger } = useMutation('DELETE', '/topics/:topicId/messages', {
    refresh: ({ args }) => {
      const topicId = args!.params.topicId
      return [
        '/topics',
        `/topics/${topicId}`,
        '/topics/latest',
        `/topics/${topicId}/messages`,
        `/topics/${topicId}/tree`
      ]
    }
  })

  return useCallback(
    async (topicId: string) => {
      const result = await trigger({ params: { topicId } })
      invalidateCachedMessageUiStates(result.deletedIds)
      messageEditingSessionService.invalidateMessages(result.deletedIds, topicId)
      logger.info('Cleared all messages', { topicId, count: result.deletedIds.length })
    },
    [trigger]
  )
}

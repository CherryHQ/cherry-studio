import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useCallback } from 'react'

import { invalidateCachedMessageUiStates } from '../utils/messageUiStateCache'

const logger = loggerService.withContext('useClearTopicMessages')

export function useClearTopicMessages() {
  const { trigger } = useMutation('DELETE', '/topics/:topicId/messages', {
    refresh: ({ args }) => [`/topics/${args!.params.topicId}/messages`, `/topics/${args!.params.topicId}/tree`]
  })

  return useCallback(
    async (topicId: string) => {
      const result = await trigger({ params: { topicId } })
      invalidateCachedMessageUiStates(result.deletedIds)
      logger.info('Cleared all messages', { topicId, count: result.deletedIds.length })
    },
    [trigger]
  )
}

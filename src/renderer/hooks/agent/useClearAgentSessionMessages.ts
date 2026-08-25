import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { invalidateCachedMessageUiStates } from '@renderer/services/messageUiStateCache'
import { useCallback } from 'react'

const logger = loggerService.withContext('useClearAgentSessionMessages')

export function useClearAgentSessionMessages() {
  const { trigger } = useMutation('DELETE', '/agent-sessions/:sessionId/messages', {
    refresh: ({ args }) => {
      const sessionId = args!.params.sessionId
      return [
        '/agent-sessions',
        `/agent-sessions/${sessionId}`,
        '/agent-sessions/latest',
        `/agent-sessions/${sessionId}/messages`
      ]
    }
  })

  return useCallback(
    async (sessionId: string) => {
      const result = await trigger({ params: { sessionId } })
      invalidateCachedMessageUiStates(result.deletedIds)
      logger.info('Cleared all Agent session messages', { sessionId, count: result.deletedIds.length })
    },
    [trigger]
  )
}

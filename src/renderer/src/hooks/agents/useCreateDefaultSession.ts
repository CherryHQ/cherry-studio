import { loggerService } from '@logger'
import { cacheService } from '@renderer/data/CacheService'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import type { CreateSessionForm } from '@renderer/types'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useCreateDefaultSession')

/**
 * Returns a stable callback that creates a default agent session and updates UI state.
 */
export const useCreateDefaultSession = (agentId: string | null) => {
  const { agent } = useAgent(agentId)
  const { createSession } = useSessions(agentId)
  const { t } = useTranslation()
  const [creatingSession, setCreatingSession] = useState(false)

  const createDefaultSession = useCallback(async () => {
    if (!agentId || !agent || creatingSession) {
      return null
    }

    setCreatingSession(true)
    try {
      const session = {
        ...agent,
        id: undefined,
        name: t('common.unnamed')
      } satisfies CreateSessionForm

      const created = await createSession(session)

      if (created) {
        const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
        cacheService.set('agent.session.active_id_map', { ...currentMap, [agentId]: created.id })
        cacheService.set('chat.active_view', 'session')
      }

      return created
    } catch (error) {
      logger.error('Error creating default session:', error as Error)
      return null
    } finally {
      setCreatingSession(false)
    }
  }, [agentId, agent, createSession, creatingSession, t])

  return {
    createDefaultSession,
    creatingSession
  }
}

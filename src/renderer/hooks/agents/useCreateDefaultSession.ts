import { loggerService } from '@logger'
import { cacheService } from '@renderer/data/CacheService'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { type CreateSessionForm, useSessions } from '@renderer/hooks/agents/useSession'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useCreateDefaultSession')

/**
 * Returns a stable callback that creates a default agent session and updates UI state.
 */
export const useCreateDefaultSession = (agentId: string | null, workspace: AgentSessionWorkspaceSource | null) => {
  const { agent } = useAgent(agentId)
  const { createSession } = useSessions(agentId)
  const { t } = useTranslation()
  const [creatingSession, setCreatingSession] = useState(false)

  const createDefaultSession = useCallback(async () => {
    if (!agentId || !agent || !workspace || creatingSession) {
      return null
    }

    if (!agent.model) {
      window.toast.error(t('error.model.not_exists'))
      return null
    }

    setCreatingSession(true)
    try {
      const session = {
        name: t('common.unnamed'),
        workspace
      } satisfies CreateSessionForm

      const created = await createSession(session)

      if (created) {
        cacheService.set('agent.active_session_id', created.id)
      }

      return created
    } catch (error) {
      logger.error('Error creating default session:', error as Error)
      return null
    } finally {
      setCreatingSession(false)
    }
  }, [agentId, agent, workspace, createSession, creatingSession, t])

  return {
    createDefaultSession,
    creatingSession
  }
}

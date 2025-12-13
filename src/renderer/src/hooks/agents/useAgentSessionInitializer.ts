import { loggerService } from '@logger'
import { cacheService } from '@renderer/data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useCallback, useEffect } from 'react'

import { useAgentClient } from './useAgentClient'

const logger = loggerService.withContext('useAgentSessionInitializer')

/**
 * Hook to automatically initialize and load the latest session for an agent
 * when the agent is activated. This ensures that when switching to an agent,
 * its most recent session is automatically selected.
 */
export const useAgentSessionInitializer = () => {
  const client = useAgentClient()
  const [activeAgentId] = useCache('agent.active_id')
  const [activeSessionIdMap] = useCache('agent.session.active_id_map')

  /**
   * Initialize session for the given agent by loading its sessions
   * and setting the latest one as active
   */
  const initializeAgentSession = useCallback(
    async (agentId: string) => {
      if (!agentId) return

      try {
        // Check if this agent already has an active session
        const currentSessionId = activeSessionIdMap[agentId]
        if (currentSessionId) {
          // Session already exists, just switch to session view
          cacheService.set('chat.active_view', 'session')
          return
        }

        // Load sessions for this agent
        const response = await client.listSessions(agentId)
        const sessions = response.data

        if (sessions && sessions.length > 0) {
          // Get the latest session (first in the list, assuming they're sorted by updatedAt)
          const latestSession = sessions[0]

          // Set the latest session as active
          const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
          cacheService.set('agent.session.active_id_map', { ...currentMap, [agentId]: latestSession.id })
          cacheService.set('chat.active_view', 'session')
        } else {
          // No sessions exist, we might want to create one
          // But for now, just switch to session view and let the Sessions component handle it
          cacheService.set('chat.active_view', 'session')
        }
      } catch (error) {
        logger.error('Failed to initialize agent session:', error as Error)
        // Even if loading fails, switch to session view
        cacheService.set('chat.active_view', 'session')
      }
    },
    [client, activeSessionIdMap]
  )

  /**
   * Auto-initialize when activeAgentId changes
   */
  useEffect(() => {
    if (activeAgentId) {
      // Check if we need to initialize this agent's session
      const hasActiveSession = activeSessionIdMap[activeAgentId]
      if (!hasActiveSession) {
        initializeAgentSession(activeAgentId)
      }
    }
  }, [activeAgentId, activeSessionIdMap, initializeAgentSession])

  return {
    initializeAgentSession
  }
}

import { loggerService } from '@logger'
import { cacheService } from '@renderer/data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useCallback, useEffect, useRef } from 'react'

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

  // Use a ref to keep the callback stable across activeSessionIdMap changes
  const activeSessionIdMapRef = useRef(activeSessionIdMap)
  activeSessionIdMapRef.current = activeSessionIdMap

  /**
   * Initialize session for the given agent by loading its sessions
   * and setting the latest one as active
   */
  const initializeAgentSession = useCallback(
    async (agentId: string) => {
      if (!agentId) return

      try {
        // Check if this agent has already been initialized (key exists in map)
        if (agentId in activeSessionIdMapRef.current) {
          // Already initialized, nothing to do
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
        } else {
          // Mark as initialized with no session (null vs undefined distinction)
          const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
          cacheService.set('agent.session.active_id_map', { ...currentMap, [agentId]: null })
        }
      } catch (error) {
        logger.error('Failed to initialize agent session:', error as Error)
      }
    },
    [client]
  )

  /**
   * Auto-initialize when activeAgentId changes
   */
  useEffect(() => {
    if (activeAgentId) {
      // Check if we need to initialize this agent's session (key not yet in map)
      if (!(activeAgentId in activeSessionIdMapRef.current)) {
        initializeAgentSession(activeAgentId)
      }
    }
  }, [activeAgentId, initializeAgentSession])

  return {
    initializeAgentSession
  }
}

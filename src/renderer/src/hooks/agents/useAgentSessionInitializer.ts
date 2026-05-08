import { loggerService } from '@logger'
import { cacheService } from '@renderer/data/CacheService'
import { dataApiService } from '@renderer/data/DataApiService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useCallback, useEffect, useRef } from 'react'

const logger = loggerService.withContext('useAgentSessionInitializer')

/**
 * Hook to automatically initialize and load the latest session for an agent
 * when the agent is activated. This ensures that when switching to an agent,
 * its most recent session is automatically selected.
 */
export const useAgentSessionInitializer = () => {
  const [activeAgentId] = useCache('agent.active_id')
  const [activeSessionIdMap] = useCache('agent.session.active_id_map')

  // Use a ref to keep the callback stable across activeSessionIdMap changes
  const activeSessionIdMapRef = useRef(activeSessionIdMap)
  activeSessionIdMapRef.current = activeSessionIdMap

  /**
   * Initialize session for the given agent by loading its sessions
   * and setting the latest one as active
   */
  const initializeAgentSession = useCallback(async (agentId: string) => {
    if (!agentId) return
    try {
      // Check if this agent has already been initialized (key exists in map)
      if (agentId in activeSessionIdMapRef.current) return

      const { items: sessions } = await dataApiService.get('/sessions', { query: { agentId, limit: 1 } })

      const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
      cacheService.set('agent.session.active_id_map', {
        ...currentMap,
        [agentId]: sessions.length > 0 ? sessions[0].id : null
      })
    } catch (error) {
      logger.error('Failed to initialize agent session:', error as Error)
    }
  }, [])

  /**
   * Auto-initialize when activeAgentId changes
   */
  useEffect(() => {
    if (activeAgentId && !(activeAgentId in activeSessionIdMapRef.current)) {
      void initializeAgentSession(activeAgentId)
    }
  }, [activeAgentId, initializeAgentSession])

  return {
    initializeAgentSession
  }
}

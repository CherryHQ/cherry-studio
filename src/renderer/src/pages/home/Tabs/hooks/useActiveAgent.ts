import { cacheService } from '@renderer/data/CacheService'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useCallback } from 'react'

export const useActiveAgent = () => {
  const { initializeAgentSession } = useAgentSessionInitializer()

  const setActiveAgentId = useCallback(
    async (id: string) => {
      cacheService.set('agent.active_id', id)
      await initializeAgentSession(id)
    },
    [initializeAgentSession]
  )

  return { setActiveAgentId }
}

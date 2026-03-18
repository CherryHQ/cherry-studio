import { useCache } from '@renderer/data/hooks/useCache'
import { useCallback } from 'react'

import { useAgent } from './useAgent'
import { useAgentSessionInitializer } from './useAgentSessionInitializer'

export const useActiveAgent = () => {
  const [activeAgentId, setActiveAgentIdAction] = useCache('agent.active_id')
  const { initializeAgentSession } = useAgentSessionInitializer()

  const setActiveAgentId = useCallback(
    async (id: string) => {
      setActiveAgentIdAction(id)
      await initializeAgentSession(id)
    },
    [setActiveAgentIdAction, initializeAgentSession]
  )

  return { ...useAgent(activeAgentId), setActiveAgentId }
}

import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId as setActiveAgentIdAction } from '@renderer/store/runtime'
import { useCallback } from 'react'

export const useActiveAgent = () => {
  const dispatch = useAppDispatch()
  const { initializeAgentSession } = useAgentSessionInitializer()

  const setActiveAgentId = useCallback(
    async (id: string) => {
      dispatch(setActiveAgentIdAction(id))
      await initializeAgentSession(id)
    },
    [dispatch, initializeAgentSession]
  )

  return { setActiveAgentId }
}

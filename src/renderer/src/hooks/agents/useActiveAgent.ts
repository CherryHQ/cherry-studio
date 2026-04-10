import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId as setActiveAgentIdAction } from '@renderer/store/runtime'
import { useCallback } from 'react'

import { useRuntime } from '../useRuntime'
import { useAgent } from './useAgent'
import { useAgentSessionInitializer } from './useAgentSessionInitializer'

export const useActiveAgent = () => {
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const dispatch = useAppDispatch()
  const { initializeAgentSession } = useAgentSessionInitializer()

  const setActiveAgentId = useCallback(
    async (id: string) => {
      dispatch(setActiveAgentIdAction(id))
      await initializeAgentSession(id)
    },
    [dispatch, initializeAgentSession]
  )

  return { ...useAgent(activeAgentId), setActiveAgentId }
}

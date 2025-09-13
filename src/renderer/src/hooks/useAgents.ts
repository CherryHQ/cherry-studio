import { useAppDispatch } from '@renderer/store'
import { addAgent, removeAgent, setAgents, updateAgent } from '@renderer/store/agents'
import { AgentEntity } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { useCallback } from 'react'

export const useAgents = () => {
  const dispatch = useAppDispatch()
  /**
   * Adds a new agent to the store
   * @param config - The configuration object for the new agent (without id)
   */
  const addAgent_ = useCallback(
    (config: Omit<AgentEntity, 'id'>) => {
      const entity = {
        ...config,
        id: uuid()
      } as const
      dispatch(addAgent(entity))
    },
    [dispatch]
  )

  /**
   * Removes an agent from the store
   * @param id - The ID of the agent to remove
   */
  const removeAgent_ = useCallback(
    (id: AgentEntity['id']) => {
      dispatch(removeAgent({ id }))
    },
    [dispatch]
  )

  /**
   * Updates an existing agent in the store
   * @param update - Partial agent data with required ID field
   */
  const updateAgent_ = useCallback(
    (update: Partial<AgentEntity> & { id: AgentEntity['id'] }) => {
      dispatch(updateAgent(update))
    },
    [dispatch]
  )

  /**
   * Sets the entire agents array in the store
   * @param agents - Array of agent entities to set
   */
  const setAgents_ = useCallback(
    (agents: AgentEntity[]) => {
      dispatch(setAgents(agents))
    },
    [dispatch]
  )

  return {
    addAgent: addAgent_,
    removeAgent: removeAgent_,
    updateAgent: updateAgent_,
    setAgents: setAgents_
  }
}

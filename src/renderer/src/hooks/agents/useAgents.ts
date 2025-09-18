import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addAgent, removeAgent, setAgents, updateAgent } from '@renderer/store/agents'
import { AgentEntity } from '@renderer/types'
// import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export const useAgents = () => {
  // const qc = useQueryClient()
  // const { data, isLoading, error } = useQuery({
  //   queryKey: ['agents'],
  //   queryFn: async () => {}
  // })
  const agents = useAppSelector((state) => state.agents.agentsNew)
  const dispatch = useAppDispatch()
  /**
   * Adds a new agent to the store
   * @param agent - The complete agent entity to add
   */
  const addAgent_ = useCallback(
    (agent: AgentEntity) => {
      dispatch(addAgent(agent))
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
    agents,
    addAgent: addAgent_,
    removeAgent: removeAgent_,
    updateAgent: updateAgent_,
    setAgents: setAgents_
  }
}

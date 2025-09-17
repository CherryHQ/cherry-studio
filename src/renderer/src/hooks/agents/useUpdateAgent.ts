import { AgentEntity } from '@renderer/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const useUpdateAgent = () => {
  const qc = useQueryClient()

  // TODO: use api
  return useMutation({
    mutationFn: async (agentUpdate: Partial<AgentEntity> & { id: string }) => {
      throw new Error(`useUpdateAgent mutationFn not implemented for agent ${agentUpdate.id}`)
    },
    onSuccess: (updated: AgentEntity) => {
      qc.setQueryData<AgentEntity[]>(['todos'], (old) =>
        old ? old.map((t) => (t.id === updated.id ? updated : t)) : []
      )
    }
  })
}

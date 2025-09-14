import { AgentEntity } from '@renderer/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const useAddAgent = () => {
  const qc = useQueryClient()

  // TODO: use api
  return useMutation({
    mutationFn: async (agent: AgentEntity) => {
      return agent
    },
    onSuccess: (added: AgentEntity) => {
      qc.setQueryData<AgentEntity[]>(['agents'], (old) => (old ? [...old, added] : [added]))
    }
  })
}

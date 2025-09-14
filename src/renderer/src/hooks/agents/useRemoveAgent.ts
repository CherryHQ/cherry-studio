import { AgentEntity } from '@renderer/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const useRemoveAgent = () => {
  const qc = useQueryClient()

  // TODO: use api
  return useMutation({
    mutationFn: async (id: string) => {
      return id
    },
    onSuccess: (deletedId: string) => {
      qc.setQueryData<AgentEntity[]>(['agents'], (old) => old?.filter((t) => t.id !== deletedId))
    }
  })
}

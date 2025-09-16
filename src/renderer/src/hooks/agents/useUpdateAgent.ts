import { AgentEntity } from '@renderer/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const useUpdateAgent = () => {
  const qc = useQueryClient()

  // TODO: use api
  return useMutation({
    // @ts-expect-error not-implemented
    mutationFn: async ({}: Partial<AgentEntity> & { id: string }) => {},
    onSuccess: (updated: AgentEntity) => {
      qc.setQueryData<AgentEntity[]>(['todos'], (old) =>
        old ? old.map((t) => (t.id === updated.id ? updated : t)) : []
      )
    }
  })
}

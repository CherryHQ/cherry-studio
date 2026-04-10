import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { GetAgentResponse } from '@renderer/types'

export const useAgent = (id: string | null) => {
  const path: `/agents/${string}` = `/agents/${id ?? '__pending__'}`
  const { data, error, isLoading, refetch } = useQuery(path, {
    enabled: !!id,
    swrOptions: {
      revalidateOnMount: true,
      dedupingInterval: 2000
    }
  })

  return {
    agent: data as GetAgentResponse | undefined,
    error: error ?? null,
    isLoading,
    revalidate: refetch
  }
}

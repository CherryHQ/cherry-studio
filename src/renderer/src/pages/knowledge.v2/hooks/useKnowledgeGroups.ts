import { useQuery } from '@data/hooks/useDataApi'
import { useMemo } from 'react'

export const useKnowledgeGroups = () => {
  const { data, isLoading, error, refetch } = useQuery('/groups', {
    query: { entityType: 'knowledge' }
  })

  const groups = useMemo(() => data ?? [], [data])

  return {
    groups,
    isLoading,
    error,
    refetch
  }
}

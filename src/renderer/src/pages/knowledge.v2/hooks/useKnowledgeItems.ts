import { useQuery } from '@data/hooks/useDataApi'
import { KNOWLEDGE_ITEMS_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import { useMemo } from 'react'

const KNOWLEDGE_V2_ITEMS_QUERY = {
  page: 1,
  limit: KNOWLEDGE_ITEMS_MAX_LIMIT
} as const

export const useKnowledgeItems = (baseId: string) => {
  const { data, isLoading, error, refetch } = useQuery('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query: KNOWLEDGE_V2_ITEMS_QUERY,
    enabled: Boolean(baseId)
  })

  const items = useMemo(() => {
    return (data?.items ?? []).filter((item) => item.groupId == null)
  }, [data])

  return {
    items,
    total: data?.total ?? 0,
    isLoading,
    error,
    refetch
  }
}

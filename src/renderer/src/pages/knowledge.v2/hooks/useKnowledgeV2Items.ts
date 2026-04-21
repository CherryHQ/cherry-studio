import { useQuery } from '@data/hooks/useDataApi'
import { KNOWLEDGE_ITEMS_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import { useMemo } from 'react'

import type { KnowledgeV2Item } from '../types'
import { filterKnowledgeV2TopLevelItems } from '../utils/knowledgeItems'

const DISABLED_KNOWLEDGE_BASE_ID = '__disabled__'

const KNOWLEDGE_V2_ITEMS_QUERY = {
  page: 1,
  limit: KNOWLEDGE_ITEMS_MAX_LIMIT
} as const

export const useKnowledgeV2Items = (baseId: string) => {
  const { data, isLoading, error, refetch } = useQuery('/knowledge-bases/:id/items', {
    params: { id: baseId || DISABLED_KNOWLEDGE_BASE_ID },
    query: KNOWLEDGE_V2_ITEMS_QUERY,
    enabled: Boolean(baseId)
  })

  const items = useMemo(() => filterKnowledgeV2TopLevelItems((data?.items ?? []) as KnowledgeV2Item[]), [data])

  return {
    items,
    total: data?.total ?? 0,
    isLoading,
    error,
    refetch
  }
}

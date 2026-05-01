import { useQuery } from '@data/hooks/useDataApi'
import { KNOWLEDGE_ITEMS_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItemStatus } from '@shared/data/types/knowledge'

const KNOWLEDGE_V2_ITEMS_QUERY = {
  page: 1,
  limit: KNOWLEDGE_ITEMS_MAX_LIMIT,
  groupId: null
} as const

const KNOWLEDGE_ITEMS_POLLING_INTERVAL = 2000
const TERMINAL_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])

export const useKnowledgeItems = (baseId: string) => {
  const { data, isLoading, error, refetch } = useQuery('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query: KNOWLEDGE_V2_ITEMS_QUERY,
    enabled: Boolean(baseId),
    swrOptions: {
      refreshInterval: (data) =>
        data?.items.some((item) => !TERMINAL_STATUSES.has(item.status)) ? KNOWLEDGE_ITEMS_POLLING_INTERVAL : 0
    }
  })

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    refetch
  }
}

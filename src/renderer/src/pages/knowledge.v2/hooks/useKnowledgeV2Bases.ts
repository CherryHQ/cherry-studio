import { useQuery } from '@data/hooks/useDataApi'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import { useMemo } from 'react'

const KNOWLEDGE_V2_BASES_QUERY = {
  page: 1,
  limit: KNOWLEDGE_BASES_MAX_LIMIT
} as const

export const useKnowledgeV2Bases = () => {
  const { data, isLoading, error, refetch } = useQuery('/knowledge-bases', {
    query: KNOWLEDGE_V2_BASES_QUERY
  })

  const bases = useMemo(() => data?.items ?? [], [data])

  return {
    bases,
    isLoading,
    error,
    refetch
  }
}

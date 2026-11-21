import { useQuery } from '@data/hooks/useDataApi'

/** Predict the same (any base exists && this request scopes a base) gate as buildAgentParams. */
export function useScopedKnowledgeToolSignals(knowledgeBaseIds: readonly string[] | undefined): boolean {
  const hasScope = (knowledgeBaseIds?.length ?? 0) > 0
  const { data } = useQuery('/knowledge-bases', {
    query: { limit: 1 },
    enabled: hasScope,
    swrOptions: { keepPreviousData: false }
  })
  // Main also treats a failed existence lookup as present. Do not restore a
  // native-search/function-tool conflict while the existence check is pending.
  return hasScope && (data === undefined || data.total > 0)
}

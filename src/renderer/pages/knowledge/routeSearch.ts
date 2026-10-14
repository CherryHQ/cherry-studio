export type KnowledgeRouteSearch = {
  baseId?: string
}

export function parseKnowledgeRouteSearch(search: Record<string, unknown>): KnowledgeRouteSearch {
  return { baseId: typeof search.baseId === 'string' && search.baseId.length > 0 ? search.baseId : undefined }
}

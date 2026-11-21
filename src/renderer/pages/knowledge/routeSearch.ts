export type KnowledgeRouteSearch = {
  baseId?: string
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Raw query values are unvalidated; accept only a nonempty baseId string and ignore unrelated keys.
export function parseKnowledgeRouteSearch(search: Record<string, unknown>): KnowledgeRouteSearch {
  return { baseId: typeof search.baseId === 'string' && search.baseId.length > 0 ? search.baseId : undefined }
}

export type ChatRouteSearch = {
  assistantId?: string
  topicId?: string
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- URL queries include invalid values and legacy keys; only assistantId/topicId are narrowed below.
export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const assistantId = typeof search.assistantId === 'string' ? search.assistantId : undefined
  const topicId = typeof search.topicId === 'string' ? search.topicId : undefined

  return { assistantId, topicId }
}

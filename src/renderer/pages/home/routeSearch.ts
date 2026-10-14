export type ChatRouteSearch = {
  assistantId?: string
  topicId?: string
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const assistantId = typeof search.assistantId === 'string' ? search.assistantId : undefined
  const topicId = typeof search.topicId === 'string' ? search.topicId : undefined

  return { assistantId, topicId }
}

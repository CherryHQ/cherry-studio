export const MESSAGE_VIEW = 'message' as const

export type ChatRouteSearch = {
  assistantId?: string
  quoteRequestId?: string
  topicId?: string
  view?: typeof MESSAGE_VIEW
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const assistantId = typeof search.assistantId === 'string' ? search.assistantId : undefined
  const quoteRequestId = typeof search.quoteRequestId === 'string' ? search.quoteRequestId : undefined
  const topicId = typeof search.topicId === 'string' ? search.topicId : undefined
  const view = search.view === MESSAGE_VIEW ? MESSAGE_VIEW : undefined

  return { assistantId, quoteRequestId, topicId, view }
}

export const MESSAGE_VIEW = 'message' as const

export type ChatRouteSearch = {
  topicId?: string
  view?: typeof MESSAGE_VIEW
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const topicId = typeof search.topicId === 'string' ? search.topicId : undefined
  const view = search.view === MESSAGE_VIEW ? MESSAGE_VIEW : undefined

  return { topicId, view }
}

export const MESSAGE_VIEW = 'message' as const

export type AgentRouteSearch = {
  sessionId?: string
  view?: typeof MESSAGE_VIEW
}

export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined
  const view = search.view === MESSAGE_VIEW ? MESSAGE_VIEW : undefined

  return { sessionId, view }
}

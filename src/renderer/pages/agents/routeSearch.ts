export const MESSAGE_VIEW = 'message' as const

export type AgentRouteSearch = {
  intent?: 'feedback'
  sessionId?: string
  view?: typeof MESSAGE_VIEW
}

export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const intent = search.intent === 'feedback' ? 'feedback' : undefined
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined
  const view = search.view === MESSAGE_VIEW ? MESSAGE_VIEW : undefined

  return { intent, sessionId, view }
}

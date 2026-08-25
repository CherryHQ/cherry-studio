export const MESSAGE_VIEW = 'message' as const

export type AgentRouteSearch = {
  agentId?: string
  intent?: 'feedback'
  sessionId?: string
  view?: typeof MESSAGE_VIEW
}

export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const agentId = typeof search.agentId === 'string' ? search.agentId : undefined
  const intent = search.intent === 'feedback' ? 'feedback' : undefined
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined
  const view = search.view === MESSAGE_VIEW ? MESSAGE_VIEW : undefined

  return { agentId, intent, sessionId, view }
}

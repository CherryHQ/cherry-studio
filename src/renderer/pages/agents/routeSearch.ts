export type AgentRouteSearch = {
  agentId?: string
  intent?: 'feedback'
  sessionId?: string
}

export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const agentId = typeof search.agentId === 'string' ? search.agentId : undefined
  const intent = search.intent === 'feedback' ? 'feedback' : undefined
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined

  return { agentId, intent, sessionId }
}

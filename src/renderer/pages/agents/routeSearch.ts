export type AgentRouteSearch = {
  agentId?: string
  intent?: 'feedback'
  sessionId?: string
  forkReturnSessionId?: string
}

export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const agentId = typeof search.agentId === 'string' ? search.agentId : undefined
  const intent = search.intent === 'feedback' ? 'feedback' : undefined
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined

  const forkReturnSessionId = typeof search.forkReturnSessionId === 'string' ? search.forkReturnSessionId : undefined

  return { agentId, intent, sessionId, ...(forkReturnSessionId ? { forkReturnSessionId } : {}) }
}

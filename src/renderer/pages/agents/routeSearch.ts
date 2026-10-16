export type AgentRouteSearch = {
  agentId?: string
  intent?: 'feedback' | 'skill'
  sessionId?: string
  forkReturnSessionId?: string
  skillId?: string
}

export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const agentId = typeof search.agentId === 'string' ? search.agentId : undefined
  const intent = search.intent === 'feedback' || search.intent === 'skill' ? search.intent : undefined
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined
  const forkReturnSessionId = typeof search.forkReturnSessionId === 'string' ? search.forkReturnSessionId : undefined
  const skillId = intent === 'skill' && typeof search.skillId === 'string' ? search.skillId : undefined

  return {
    agentId,
    intent,
    sessionId,
    ...(forkReturnSessionId ? { forkReturnSessionId } : {}),
    ...(skillId ? { skillId } : {})
  }
}

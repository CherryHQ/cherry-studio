export type AgentRouteSearch = {
  agentId?: string
  intent?: 'feedback' | 'skill' | 'task'
  sessionId?: string
  forkReturnSessionId?: string
  skillId?: string
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- URL queries include invalid values and legacy keys; the checks below own the accepted Agent navigation fields.
export function parseAgentRouteSearch(search: Record<string, unknown>): AgentRouteSearch {
  const agentId = typeof search.agentId === 'string' ? search.agentId : undefined
  const intent =
    search.intent === 'feedback' || search.intent === 'skill' || search.intent === 'task' ? search.intent : undefined
  const sessionId = typeof search.sessionId === 'string' ? search.sessionId : undefined
  const forkReturnSessionId = typeof search.forkReturnSessionId === 'string' ? search.forkReturnSessionId : undefined
  const skillId = intent === 'skill' && typeof search.skillId === 'string' ? search.skillId : undefined

  const parsed: AgentRouteSearch = {
    agentId,
    intent,
    sessionId
  }
  if (forkReturnSessionId) parsed.forkReturnSessionId = forkReturnSessionId
  if (skillId) parsed.skillId = skillId
  return parsed
}

import { createFileRoute, redirect } from '@tanstack/react-router'

import AgentPage from '@renderer/pages/agents/AgentPage'
import { parseAgentRouteSearch } from '@renderer/pages/agents/routeSearch'
import { resolveAgentEntrySessionId, resolveAgentEntrySessionIdForAgent } from '@renderer/utils/conversationEntry'

export const Route = createFileRoute('/app/agents')({
  validateSearch: (search) => parseAgentRouteSearch(search),
  // Resolving before mount renders the final conversation in one pass. A sidebar
  // `?agentId=` entry must resume that agent, not a leftover All Agents sessionId.
  beforeLoad: async ({ search }) => {
    if (search.intent === 'feedback') return
    if (search.agentId) {
      const sessionId = await resolveAgentEntrySessionIdForAgent(search.agentId)
      if (sessionId) {
        if (search.sessionId === sessionId) return
        throw redirect({ to: '/app/agents', search: { sessionId, agentId: search.agentId }, replace: true })
      }
      if (search.sessionId) {
        throw redirect({ to: '/app/agents', search: { agentId: search.agentId }, replace: true })
      }
      return
    }
    if (search.sessionId) return
    const sessionId = await resolveAgentEntrySessionId()
    if (sessionId) throw redirect({ to: '/app/agents', search: { sessionId }, replace: true })
  },
  component: AgentPage
})

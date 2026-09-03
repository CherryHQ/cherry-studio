import AgentPage from '@renderer/pages/agents/AgentPage'
import { parseAgentRouteSearch } from '@renderer/pages/agents/routeSearch'
import { resolveAgentEntrySessionId, resolveAgentEntrySessionIdForAgent } from '@renderer/utils/conversationEntry'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/agents')({
  validateSearch: (search) => parseAgentRouteSearch(search),
  // Resolving before mount renders the final conversation in one pass. A sidebar
  // `?agentId=` entry must resume that agent, not the globally last-focused session.
  beforeLoad: async ({ search }) => {
    if (search.sessionId || search.intent) return
    if (search.agentId) {
      const sessionId = await resolveAgentEntrySessionIdForAgent(search.agentId)
      if (sessionId) throw redirect({ to: '/app/agents', search: { sessionId }, replace: true })
      return
    }
    const sessionId = await resolveAgentEntrySessionId()
    if (sessionId) throw redirect({ to: '/app/agents', search: { sessionId }, replace: true })
  },
  component: AgentPage
})

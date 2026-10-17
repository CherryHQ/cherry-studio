import { createFileRoute, redirect } from '@tanstack/react-router'

import AgentPage from '@renderer/pages/agents/AgentPage'
import { parseAgentRouteSearch } from '@renderer/pages/agents/routeSearch'
import { resolveAgentEntrySessionId, resolveAgentEntrySessionIdForAgent } from '@renderer/utils/conversationEntry'

export const Route = createFileRoute('/app/agents')({
  validateSearch: (search) => parseAgentRouteSearch(search),
  search: {
    middlewares: [
      ({ search, next }) => {
        const destination = next(search)
        if (!destination.agentId || destination.intent) return destination

        const normalized = { ...destination }
        delete normalized.sessionId
        return normalized
      }
    ]
  },
  beforeLoad: async ({ search }) => {
    if (search.sessionId || search.intent) return

    if (search.agentId) {
      const sessionId = await resolveAgentEntrySessionIdForAgent(search.agentId)
      if (sessionId) {
        throw redirect({ to: '/app/agents', search: { sessionId }, replace: true })
      }
      return
    }

    const sessionId = await resolveAgentEntrySessionId()
    if (sessionId) {
      throw redirect({ to: '/app/agents', search: { sessionId }, replace: true })
    }
  },
  component: AgentPage
})

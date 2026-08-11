import AgentPage from '@renderer/pages/agents/AgentPage'
import { parseAgentRouteSearch } from '@renderer/pages/agents/routeSearch'
import { resolveAgentEntrySessionId, resolveAgentEntrySessionIdForAgent } from '@renderer/utils/conversationEntry'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/agents')({
  validateSearch: (search) => parseAgentRouteSearch(search),
  // Bare entries resolve their session here, before the page mounts, so the page
  // renders the final conversation in one pass. Explicit targets and the
  // feedback entries pass through untouched. A sidebar `?agentId=` entry
  // resolves that agent's most recent session instead of the global
  // last-focused one. Message-only entries already carry a session id; a stray
  // `view=message` without one is still a bare entry. No resolvable session →
  // fall through bare; the page creates the first session itself (bound to the
  // pinned agent).
  beforeLoad: async ({ search }) => {
    if (search.sessionId || search.intent === 'feedback') return
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

import AgentPage from '@renderer/pages/agents/AgentPage'
import { parseAgentRouteSearch } from '@renderer/pages/agents/routeSearch'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/agents')({
  validateSearch: (search) => parseAgentRouteSearch(search),
  component: AgentPage
})

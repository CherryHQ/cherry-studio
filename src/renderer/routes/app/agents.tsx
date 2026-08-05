import { createFileRoute } from '@tanstack/react-router'

import AgentPage from '@renderer/pages/agents/AgentPage'
import { parseAgentRouteSearch } from '@renderer/pages/agents/routeSearch'

export const Route = createFileRoute('/app/agents')({
  validateSearch: (search) => parseAgentRouteSearch(search),
  component: AgentPage
})

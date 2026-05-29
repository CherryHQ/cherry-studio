import AgentPage from '@renderer/pages/agents/AgentPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/agents')({
  component: AgentPage
})

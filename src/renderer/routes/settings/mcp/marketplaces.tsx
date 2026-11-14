import { createFileRoute, redirect } from '@tanstack/react-router'

export function redirectToMcpSources() {
  throw redirect({ to: '/app/marketplace', search: { mcpView: 'sources' } })
}

export const Route = createFileRoute('/settings/mcp/marketplaces')({ beforeLoad: redirectToMcpSources })

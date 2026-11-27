import { createFileRoute, redirect } from '@tanstack/react-router'

export function redirectToMcpCatalog() {
  throw redirect({ to: '/app/marketplace', search: { mcpView: 'curated' } })
}

export const Route = createFileRoute('/settings/mcp/builtin')({ beforeLoad: redirectToMcpCatalog })

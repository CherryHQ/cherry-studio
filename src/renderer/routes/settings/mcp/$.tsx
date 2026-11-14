import { createFileRoute, redirect } from '@tanstack/react-router'

import { MCP_PROVIDER_ENTRIES } from '@renderer/utils/mcpDiscovery'

export function redirectToMcpProvider(providerKey: string | undefined) {
  const provider = MCP_PROVIDER_ENTRIES.find(({ key }) => key === providerKey)
  if (!provider) throw redirect({ to: '/settings/mcp/servers' })
  throw redirect({ to: '/app/marketplace', search: { mcpView: 'sources', mcpProvider: provider.key } })
}

export const Route = createFileRoute('/settings/mcp/$')({
  beforeLoad: ({ params }) => redirectToMcpProvider(params._splat)
})

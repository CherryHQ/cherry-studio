import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/pages/settings/McpSettings/McpSettingsPage', () => ({ default: () => null }))

import { Route } from '../mcp'

function createMcpRouter(initialEntry: string) {
  const root = createRootRoute()
  const mcp = createRoute({
    getParentRoute: () => root,
    path: '/settings/mcp',
    validateSearch: Route.options.validateSearch,
    search: Route.options.search
  })
  const servers = createRoute({ getParentRoute: () => mcp, path: 'servers' })
  const detail = createRoute({ getParentRoute: () => mcp, path: 'settings/$serverId' })
  return createRouter({
    routeTree: root.addChildren([mcp.addChildren([servers, detail])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] })
  })
}

describe('standalone MCP navigation', () => {
  it('preserves server-only mode when opening a new Settings tab from a URL', async () => {
    const router = createMcpRouter('/settings/mcp/servers?mcpStandalone=true')
    await router.load()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ mcpStandalone: 'true' })
  })

  it('preserves server-only mode when retargeting an existing tab and opening server details', async () => {
    const router = createMcpRouter('/settings/mcp/servers')
    await router.load()
    expect(router.state.matches.at(-1)?.search.mcpStandalone).toBeUndefined()
    await router.navigate({ to: '/settings/mcp/servers', search: { mcpStandalone: 'true' } })
    expect(router.state.matches.at(-1)?.search).toMatchObject({ mcpStandalone: 'true' })
    await router.navigate({ to: '/settings/mcp/settings/$serverId', params: { serverId: 'server-1' } })
    expect(router.state.matches.at(-1)?.search).toMatchObject({ mcpStandalone: 'true' })
  })
})

import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPage from '@renderer/pages/settings/SettingsPage'
import {
  OPEN_MAIN_ROUTE_EVENT,
  type OpenMainRouteEvent,
  openSettingsTab
} from '@renderer/services/mainWindowNavigation'

import { Route } from '../mcp'
import { redirectToMcpServers } from '../mcp.index'
import { Route as ServersRoute } from '../mcp/servers'
import { Route as DetailRoute } from '../mcp/settings.$serverId'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/pages/settings/McpSettings/McpServersList', () => ({ default: () => <h1>Server content</h1> }))
vi.mock('@renderer/pages/settings/McpSettings/McpSettings', () => ({ default: () => <h1>Server details</h1> }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) } }))

function createMcpRouter(initialEntry: string) {
  const root = createRootRoute()
  const settings = createRoute({ getParentRoute: () => root, path: '/settings', component: SettingsPage })
  const prompts = createRoute({
    getParentRoute: () => settings,
    path: 'prompts',
    component: () => <h1>Prompt content</h1>
  })
  const mcp = createRoute({
    getParentRoute: () => settings,
    path: 'mcp',
    validateSearch: Route.options.validateSearch,
    search: Route.options.search,
    component: Route.options.component
  })
  const index = createRoute({ getParentRoute: () => mcp, path: '/', beforeLoad: redirectToMcpServers })
  const servers = createRoute({
    getParentRoute: () => mcp,
    path: 'servers',
    validateSearch: ServersRoute.options.validateSearch,
    component: ServersRoute.options.component
  })
  const detail = createRoute({
    getParentRoute: () => mcp,
    path: 'settings/$serverId',
    validateSearch: DetailRoute.options.validateSearch,
    component: DetailRoute.options.component
  })
  return createRouter({
    routeTree: root.addChildren([settings.addChildren([prompts, mcp.addChildren([index, servers, detail])])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] })
  })
}

beforeEach(async () => {
  await i18next.changeLanguage('en-us')
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('standalone MCP navigation', () => {
  it('keeps settings navigation and server content but omits the MCP submenu for a marketplace URL', async () => {
    const router = createMcpRouter('/settings/mcp/servers?mcpStandalone=true')
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: 'Server content' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Search settings' })).toBeVisible()
    expect(screen.queryByText('Builtin Servers')).not.toBeInTheDocument()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ mcpStandalone: 'true' })
  })

  it('retargets an existing tab, retains the mode in details, and retains it across other settings only in this settings instance', async () => {
    const user = userEvent.setup()
    const router = createMcpRouter('/settings/mcp/servers')
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('Builtin Servers')).toBeVisible()
    // Use the real public navigation event and the same URL split as TabRouter.
    let navigation: Promise<unknown> | undefined
    const listener = (event: Event) => {
      event.preventDefault()
      const [to, search] = (event as OpenMainRouteEvent).detail.path.split('?')
      navigation = router.navigate({ to, search: Object.fromEntries(new URLSearchParams(search)) })
    }
    window.addEventListener(OPEN_MAIN_ROUTE_EVENT, listener)
    try {
      await act(async () => {
        openSettingsTab('/settings/mcp/servers?mcpStandalone=true')
        await navigation
      })
    } finally {
      window.removeEventListener(OPEN_MAIN_ROUTE_EVENT, listener)
    }
    expect(screen.queryByText('Builtin Servers')).not.toBeInTheDocument()
    await act(async () => {
      await router.navigate({ to: '/settings/mcp/settings/$serverId', params: { serverId: 'server-1' } })
    })
    expect(await screen.findByRole('heading', { name: 'Server details' })).toBeVisible()
    expect(screen.queryByText('Builtin Servers')).not.toBeInTheDocument()
    await act(async () => {
      await router.navigate({ to: '/settings/prompts' })
    })
    expect(await screen.findByRole('heading', { name: 'Prompt content' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /ModelContextProtocol MCP/ }))
    expect(screen.queryByText('Builtin Servers')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Server content' })).toBeVisible()
    expect(router.state.matches.at(-1)?.search).toMatchObject({ mcpStandalone: 'true' })
    cleanup()
    const freshRouter = createMcpRouter('/settings/mcp/servers')
    await freshRouter.load()
    render(<RouterProvider router={freshRouter} />)
    expect(await screen.findByText('Builtin Servers')).toBeVisible()
  })
})

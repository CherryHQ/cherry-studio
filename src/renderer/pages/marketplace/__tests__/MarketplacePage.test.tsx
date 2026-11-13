import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type * as assistantCatalog from '@renderer/hooks/useAssistantCatalogPresets'
import { Route as MarketplaceRoute } from '@renderer/routes/app/marketplace'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/hooks/useAgentCatalogPresets', () => ({
  useAgentCatalogPresets: () => ({ items: [], isLoading: false })
}))
vi.mock('@renderer/hooks/useAssistantCatalogPresets', async (importOriginal) => ({
  ...(await importOriginal<typeof assistantCatalog>()),
  useAssistantCatalogPresets: () => ({ presets: [], isLoading: false })
}))
vi.mock('@renderer/hooks/useBuiltinMcpCatalog', () => ({
  useBuiltinMcpCatalog: () => ({ presets: [], mcpServers: [], adding: new Set(), isLoading: false })
}))
vi.mock('../useMarketplace', () => ({
  useMarketplace: () => ({ catalog: { data: [] }, installed: { loading: false }, mutating: new Set(), skipped: 0 })
}))

beforeEach(async () => {
  await i18next.changeLanguage('en-us')
  MockUsePreferenceUtils.setPreferenceValue('ui.marketplace.skill_sources', [])
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps resource and MCP source choices in sync with the route when reopened', async () => {
  const user = userEvent.setup()
  const root = createRootRoute()
  const marketplace = createRoute({
    getParentRoute: () => root,
    path: '/app/marketplace',
    validateSearch: MarketplaceRoute.options.validateSearch,
    component: MarketplaceRoute.options.component
  })
  const router = createRouter({
    routeTree: root.addChildren([marketplace]),
    history: createMemoryHistory({ initialEntries: ['/app/marketplace?mcpView=sources'] })
  })
  await router.load()
  render(<RouterProvider router={router} />)
  const navigation = within(await screen.findByRole('navigation'))

  await user.click(navigation.getByRole('button', { name: /^Skill / }))
  await waitFor(() => expect(router.state.location.search).toEqual({}))
  await act(async () => {
    await router.navigate({ to: '/app/marketplace', search: { mcpView: 'sources' } })
  })
  expect(navigation.getByRole('button', { name: /MCP/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'More sources' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(screen.getByRole('button', { name: 'Picks' }))
  await waitFor(() => expect(router.state.location.search).toEqual({ mcpView: 'curated' }))
  await act(async () => {
    await router.navigate({ to: '/app/marketplace', search: { mcpView: 'sources' } })
  })
  expect(screen.getByRole('button', { name: 'More sources' })).toHaveAttribute('aria-pressed', 'true')
})

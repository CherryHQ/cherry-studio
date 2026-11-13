import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type * as assistantCatalog from '@renderer/hooks/useAssistantCatalogPresets'
import { Route as MarketplaceRoute } from '@renderer/routes/app/marketplace'
import type { MarketplaceSkill } from '@shared/types/skillMarketplace'

const marketplaceState = vi.hoisted(() => ({ data: [] as MarketplaceSkill[] }))

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
  useMarketplace: () => ({
    catalog: { data: marketplaceState.data },
    installed: { loading: false },
    installedCount: () => 0,
    mutating: new Set(),
    failures: {},
    skipped: 0
  })
}))

beforeEach(async () => {
  await i18next.changeLanguage('en-us')
  marketplaceState.data = []
  MockUsePreferenceUtils.setPreferenceValue('ui.marketplace.skill_sources', [])
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

it('filters curated skills by category and search while keeping categories available', async () => {
  const user = userEvent.setup()
  MockUsePreferenceUtils.setPreferenceValue('ui.marketplace.skill_sources', [
    { id: 'team', name: 'Team skills', url: 'https://example.com/skills.zip', kind: 'zip' }
  ])
  const base: MarketplaceSkill = {
    id: 'docs',
    name: { en: 'Document helper', zh: null },
    description: { en: 'Read files', zh: null },
    domain: 'Documentation',
    author: '',
    version: '',
    tags: [],
    githubRepoUrl: null,
    sourceUrl: null,
    icon: null,
    packageName: null,
    packageSize: null,
    hasPackage: true,
    downloadUrl: null,
    downloads: 0,
    releaseDate: '',
    members: [],
    membersKnown: false,
    isCollection: false
  }
  marketplaceState.data = [
    base,
    {
      ...base,
      id: 'dev',
      name: { en: 'Code helper', zh: null },
      domain: 'Developer Tools'
    }
  ]
  const root = createRootRoute()
  const marketplace = createRoute({
    getParentRoute: () => root,
    path: '/app/marketplace',
    validateSearch: MarketplaceRoute.options.validateSearch,
    component: MarketplaceRoute.options.component
  })
  const router = createRouter({
    routeTree: root.addChildren([marketplace]),
    history: createMemoryHistory({ initialEntries: ['/app/marketplace'] })
  })
  await router.load()
  render(<RouterProvider router={router} />)
  const navigation = within(await screen.findByRole('navigation'))
  expect(screen.queryByRole('group', { name: 'Categories' })).not.toBeInTheDocument()
  await user.click(navigation.getByRole('button', { name: /^Skill / }))
  const categories = within(screen.getByRole('group', { name: 'Categories' }))
  expect(categories.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(categories.getByRole('button', { name: 'Documentation' }))
  expect(screen.getByRole('button', { name: /Document helper Read files/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: /Code helper Read files/ })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox'), 'Code')
  expect(screen.getByText('No resources found')).toBeVisible()
  expect(categories.getByRole('button', { name: 'Documentation' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(categories.getByRole('button', { name: 'Developer Tools' }))
  expect(screen.getByRole('button', { name: /Code helper Read files/ })).toBeVisible()
  await user.clear(screen.getByRole('textbox'))
  await user.click(categories.getByRole('button', { name: 'All' }))
  expect(screen.getByRole('button', { name: /Document helper Read files/ })).toBeVisible()
  expect(screen.getByRole('button', { name: /Code helper Read files/ })).toBeVisible()
  await user.click(categories.getByRole('button', { name: 'Developer Tools' }))
  await user.click(screen.getByRole('button', { name: 'Team skills' }))
  expect(screen.queryByRole('group', { name: 'Categories' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Document helper Read files/ })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Picks' }))
  expect(screen.queryByRole('button', { name: /Document helper Read files/ })).not.toBeInTheDocument()
  await user.click(navigation.getByRole('button', { name: /^All / }))
  expect(screen.queryByRole('group', { name: 'Categories' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Document helper Read files/ })).toBeVisible()
  expect(screen.getByRole('button', { name: /Code helper Read files/ })).toBeVisible()
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

// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useSearch
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AgentRouteSearch } from '@renderer/pages/agents/routeSearch'

const fixtures = vi.hoisted(() => ({
  latestByAgent: {} as Record<string, string | null>,
  sessionOwners: { 'session-b': 'agent-b', 'session-a': 'agent-a' } as Record<string, string>
}))

vi.mock('@renderer/pages/agents/AgentPage', () => ({ default: () => null }))
vi.mock('@renderer/utils/conversationEntry', () => ({
  resolveAgentEntrySessionId: async () => 'session-b',
  resolveAgentEntrySessionIdForAgent: async (agentId: string) => fixtures.latestByAgent[agentId] ?? null
}))

import { Route } from '../agents'

beforeAll(() => {
  window.scrollTo = vi.fn()
})
afterEach(cleanup)

function SelectedConversation() {
  const search = useSearch({ strict: false }) as AgentRouteSearch
  return (
    <output aria-label="Selected conversation">
      {search.sessionId ? `${search.sessionId}:${fixtures.sessionOwners[search.sessionId]}` : `entry:${search.agentId}`}
    </output>
  )
}

describe('mounted Agent entry normalization', () => {
  it.each([true, false])(
    'normalizes the initial dual-id destination before load (Agent has session: %s)',
    async (hasSession) => {
      fixtures.latestByAgent = { 'agent-a': hasSession ? 'session-a' : null }
      const searches: AgentRouteSearch[] = []
      const root = createRootRoute()
      const route = createRoute({
        getParentRoute: () => root,
        path: '/app/agents',
        validateSearch: Route.options.validateSearch,
        search: Route.options.search,
        beforeLoad: async (context) => {
          searches.push({ ...context.search })
          return (Route.options.beforeLoad as (args: { search: AgentRouteSearch }) => Promise<void>)(context)
        },
        component: SelectedConversation
      })
      const router = createRouter({
        routeTree: root.addChildren([route]),
        history: createMemoryHistory({ initialEntries: ['/app/agents?agentId=agent-a&sessionId=session-b'] })
      })

      render(<RouterProvider router={router} />)

      await waitFor(() =>
        expect(screen.getByLabelText('Selected conversation').textContent).toBe(
          hasSession ? 'session-a:agent-a' : 'entry:agent-a'
        )
      )
      expect(searches[0]).toMatchObject({ agentId: 'agent-a' })
      expect(searches[0].sessionId).toBeUndefined()
      expect(router.state.location.search).toMatchObject(
        hasSession ? { sessionId: 'session-a' } : { agentId: 'agent-a' }
      )
      expect(hasSession ? router.state.location.search.agentId : router.state.location.search.sessionId).toBeUndefined()
    }
  )

  it.each(['feedback', 'skill'] as const)('preserves both ids for a prepared %s intent', async (intent) => {
    fixtures.latestByAgent = { 'agent-a': 'session-a' }
    const searches: AgentRouteSearch[] = []
    const root = createRootRoute()
    const route = createRoute({
      getParentRoute: () => root,
      path: '/app/agents',
      validateSearch: Route.options.validateSearch,
      search: Route.options.search,
      beforeLoad: async (context) => {
        searches.push({ ...context.search })
        return (Route.options.beforeLoad as (args: { search: AgentRouteSearch }) => Promise<void>)(context)
      },
      component: SelectedConversation
    })
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({
        initialEntries: [`/app/agents?agentId=agent-a&sessionId=session-b&intent=${intent}`]
      })
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => expect(screen.getByLabelText('Selected conversation').textContent).toBe('session-b:agent-b'))
    expect(searches[0]).toMatchObject({ agentId: 'agent-a', sessionId: 'session-b', intent })
    expect(router.state.location.search).toMatchObject({ agentId: 'agent-a', sessionId: 'session-b', intent })
  })

  it('normalizes the destination returned by the rest of the middleware chain', () => {
    const incoming = { sessionId: 'session-b' }
    const destination = { agentId: 'agent-a', sessionId: 'session-b' }
    const middleware = Route.options.search!.middlewares![0]
    expect(middleware({ search: incoming, next: () => destination })).toEqual({ agentId: 'agent-a' })
    expect(destination).toEqual({ agentId: 'agent-a', sessionId: 'session-b' })
  })
})

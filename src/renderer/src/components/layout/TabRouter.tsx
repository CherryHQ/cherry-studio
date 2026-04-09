import AgentPage from '@renderer/pages/agents/AgentPage'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity } from 'react'
import { useEffect, useMemo } from 'react'

import { routeTree } from '../../routeTree.gen'

const AGENT_ROUTE_PATHS = new Set(['/agents', '/app/agents'])

function getTabPathname(url: string): string {
  return new URL(url, 'https://www.cherry-ai.com/').pathname
}

interface TabRouterProps {
  tab: Tab
  isActive: boolean
  onUrlChange: (url: string) => void
}

/**
 * TabRouter - Independent MemoryRouter for each Tab
 *
 * Each tab maintains its own router instance with isolated history,
 * enabling true KeepAlive behavior via React 19's Activity component.
 */
export const TabRouter = ({ tab, isActive, onUrlChange }: TabRouterProps) => {
  const isAgentRoute = AGENT_ROUTE_PATHS.has(getTabPathname(tab.url))

  // Create independent router instance per tab (only once)
  const router = useMemo(() => {
    if (isAgentRoute) {
      return null
    }

    const history = createMemoryHistory({ initialEntries: [tab.url] })
    return createRouter({ routeTree, history })
  }, [isAgentRoute, tab.url])

  // Sync internal navigation back to tab state
  useEffect(() => {
    if (!router) {
      return
    }

    return router.subscribe('onResolved', ({ toLocation }) => {
      const nextHref = toLocation.href
      if (nextHref !== tab.url) {
        onUrlChange(nextHref)
      }
    })
  }, [router, tab.url, onUrlChange])

  // Navigate when tab.url changes externally (e.g., from Sidebar)
  useEffect(() => {
    if (!router) {
      return
    }

    const currentHref = router.state.location.href
    if (tab.url !== currentHref) {
      void router.navigate({ to: tab.url })
    }
  }, [router, tab.url])

  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <div className="h-full w-full">{router ? <RouterProvider router={router} /> : <AgentPage />}</div>
    </Activity>
  )
}

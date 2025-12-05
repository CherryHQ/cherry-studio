import type { Tab } from '@shared/data/cache/cacheSchemas'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity } from 'react'
import { useEffect, useMemo } from 'react'

import { routeTree } from '../../routeTree.gen'

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
  // Create independent router instance per tab (only once)
  const router = useMemo(() => {
    const history = createMemoryHistory({ initialEntries: [tab.url] })
    return createRouter({ routeTree, history })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // Sync internal navigation back to tab state
  useEffect(() => {
    return router.subscribe('onResolved', ({ toLocation }) => {
      if (toLocation.pathname !== tab.url) {
        onUrlChange(toLocation.pathname)
      }
    })
  }, [router, tab.url, onUrlChange])

  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <div className="h-full w-full">
        <RouterProvider router={router} />
      </div>
    </Activity>
  )
}

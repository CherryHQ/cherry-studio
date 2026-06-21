import { PortalContainerProvider } from '@cherrystudio/ui'
import { isMac } from '@renderer/config/constant'
import { TabIdProvider } from '@renderer/context/TabIdContext'
import { routeTree } from '@renderer/routeTree.gen'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity } from 'react'
import { useEffect, useMemo, useState } from 'react'

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
      const nextHref = toLocation.href
      if (nextHref !== tab.url) {
        onUrlChange(nextHref)
      }
    })
  }, [router, tab.url, onUrlChange])

  // Navigate when tab.url changes externally (e.g., from Sidebar)
  useEffect(() => {
    const currentHref = router.state.location.href
    if (tab.url !== currentHref) {
      void router.navigate({ to: tab.url })
    }
  }, [router, tab.url])

  const [tabPortalContainer, setTabPortalContainer] = useState<HTMLElement | null>(null)

  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <TabIdProvider tabId={tab.id}>
        <div
          ref={setTabPortalContainer}
          data-page-side-panel-root={!isMac && isActive ? 'true' : undefined}
          className="relative flex h-full min-h-0 w-full flex-1 flex-col">
          <PortalContainerProvider container={tabPortalContainer}>
            <RouterProvider router={router} />
          </PortalContainerProvider>
        </div>
      </TabIdProvider>
    </Activity>
  )
}

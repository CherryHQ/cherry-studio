import {
  DialogPortalContainerProvider,
  PageSidePanelPositioningProvider,
  PortalContainerProvider
} from '@cherrystudio/ui'
import { RouteErrorFallback } from '@renderer/components/layout/RouteErrorFallback'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { routeTree } from '@renderer/routeTree.gen'
import { isMac } from '@renderer/utils/platform'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
    // defaultErrorComponent contains a route render error to its tab; without it the
    // error bubbles to the window-level boundary and tears down the whole window.
    return createRouter({ routeTree, history, defaultErrorComponent: RouteErrorFallback })
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
  // Latch the captured node across Activity hide/show: a hidden tab detaches the ref
  // (node === null) while its DOM node lives on, and clearing the container would
  // un-scope a still-open overlay/PageSidePanel to a full-window document.body portal.
  const captureTabPortalContainer = useCallback((node: HTMLElement | null) => {
    if (node) setTabPortalContainer(node)
  }, [])

  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <TabIdProvider tabId={tab.id}>
        {/* This tab root owns page-level portals so background-tab surfaces stay hidden.
            PageSidePanel keeps container positioning on Windows/Linux and uses viewport
            positioning on macOS while its fixed backdrop covers the whole window. */}
        <div ref={captureTabPortalContainer} className="relative flex h-full min-h-0 w-full flex-1 flex-col">
          <PortalContainerProvider container={tabPortalContainer}>
            <DialogPortalContainerProvider container={tabPortalContainer}>
              <PageSidePanelPositioningProvider positioning={isMac ? 'viewport' : 'container'}>
                <RouterProvider router={router} />
              </PageSidePanelPositioningProvider>
            </DialogPortalContainerProvider>
          </PortalContainerProvider>
        </div>
      </TabIdProvider>
    </Activity>
  )
}

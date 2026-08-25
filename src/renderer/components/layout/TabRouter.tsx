import { DialogPortalContainerProvider, PortalContainerProvider } from '@cherrystudio/ui'
import { RouteErrorFallback } from '@renderer/components/layout/RouteErrorFallback'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { routeTree } from '@renderer/routeTree.gen'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity } from 'react'
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'

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
    return createRouter({
      routeTree,
      history,
      defaultErrorComponent: RouteErrorFallback
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // Read the latest props inside the subscription without re-subscribing:
  // every shell/tab state update recreates the onUrlChange closure, and with
  // it in the effect deps each retained router unsubscribed and resubscribed
  // on unrelated tab operations (#19211).
  const currentTabUrl = useEffectEvent(() => tab.url)
  const reportUrlChange = useEffectEvent((nextHref: string) => onUrlChange(nextHref))

  // Sync internal navigation back to tab state. Keyed by router only: the
  // subscription lives for the router's lifetime, and the effect events above
  // always observe the latest tab.url / onUrlChange.
  useEffect(() => {
    return router.subscribe('onResolved', ({ toLocation }) => {
      const nextHref = toLocation.href
      if (nextHref !== currentTabUrl()) {
        reportUrlChange(nextHref)
      }
    })
    // `currentTabUrl` and `reportUrlChange` are Effect Events — they read the
    // latest render's props, so they stay out of the deps (measured: their
    // identities are not stable under this component's Activity boundary, and
    // listing them re-triggered the subscription on every unrelated render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

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
        {/* This tab's content root is the portal target for overlays and PageSidePanel
            scoped to the tab (`relative` anchors the scoped panel's absolute layout), so a
            background tab's still-open surface stays hidden with its owning tab. */}
        <div ref={captureTabPortalContainer} className="relative flex h-full min-h-0 w-full flex-1 flex-col">
          <PortalContainerProvider container={tabPortalContainer}>
            <DialogPortalContainerProvider container={tabPortalContainer}>
              <RouterProvider router={router} />
            </DialogPortalContainerProvider>
          </PortalContainerProvider>
        </div>
      </TabIdProvider>
    </Activity>
  )
}

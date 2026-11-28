import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DialogPortalContainerProvider, PortalContainerProvider } from '@cherrystudio/ui'
import { CommandFocusScope } from '@renderer/components/command'
import { RouteErrorFallback } from '@renderer/components/layout/RouteErrorFallback'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { routeTree } from '@renderer/routeTree.gen'
import type { AppRouter } from '@renderer/types/router'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

type KeepAliveRouteSlot = 'chat' | 'agents'
type RouteSlot = KeepAliveRouteSlot | 'default'

const getRouteSlot = (url: string): RouteSlot => {
  const pathname = url.split('?')[0]?.split('#')[0] ?? ''
  if (pathname === '/app/chat') return 'chat'
  if (pathname === '/app/agents') return 'agents'
  return 'default'
}

const isBareKeepAliveUrl = (url: string): boolean => url === '/app/chat' || url === '/app/agents'

const navigateRouterToHref = (router: AppRouter, href: string): Promise<void> => {
  // Parse the query separately because search validation can lose parameters
  // when the query is passed inside `to`.
  const [pathname, search] = href.split('?')
  return router.navigate({
    to: pathname,
    search: search ? Object.fromEntries(new URLSearchParams(search)) : undefined
  })
}

// The annotation keeps this in step with the registered `AppRouter`: options that change the
// router's type fail here instead of silently diverging from what pages are typed against.
const createTabRouter = (url: string): AppRouter =>
  createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    // defaultErrorComponent contains a route render error to its tab; without it the
    // error bubbles to the window-level boundary and tears down the whole window.
    defaultErrorComponent: RouteErrorFallback
  })

interface TabRouteSlotProps {
  tabId: string
  slot: RouteSlot
  initialUrl: string
  targetUrl?: string
  isActive: boolean
  isSlotSelected: boolean
  startCovered: boolean
  onSlotUrlChange: (url: string) => void
}

const TabRouteSlot = ({
  tabId,
  slot,
  initialUrl,
  targetUrl,
  isActive,
  isSlotSelected,
  startCovered,
  onSlotUrlChange
}: TabRouteSlotProps) => {
  // Create independent router instance per tab slot (only once per slot lifetime)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const router = useMemo(() => createTabRouter(initialUrl), [tabId, slot])
  const [isResolving, setIsResolving] = useState(startCovered)
  const lastOwnHrefRef = useRef(initialUrl)
  const revertingCrossSlotRef = useRef(false)
  const isSlotSelectedRef = useRef(isSlotSelected)
  const targetUrlRef = useRef(targetUrl)
  const onSlotUrlChangeRef = useRef(onSlotUrlChange)
  isSlotSelectedRef.current = isSlotSelected
  targetUrlRef.current = targetUrl
  onSlotUrlChangeRef.current = onSlotUrlChange

  useEffect(() => {
    const syncResolvedState = () => {
      const nextHref = router.state.location.href
      if (revertingCrossSlotRef.current) {
        revertingCrossSlotRef.current = false
        lastOwnHrefRef.current = nextHref
        setIsResolving(false)
        return
      }

      if (slot !== 'default' && getRouteSlot(nextHref) !== slot) {
        onSlotUrlChangeRef.current(nextHref)
        revertingCrossSlotRef.current = true
        void navigateRouterToHref(router, lastOwnHrefRef.current)
        return
      }

      lastOwnHrefRef.current = nextHref
      setIsResolving(false)
      if (isSlotSelectedRef.current && nextHref !== targetUrlRef.current) {
        onSlotUrlChangeRef.current(nextHref)
      }
    }

    const unsubscribeResolved = router.subscribe('onResolved', syncResolvedState)
    if (router.state.status === 'idle' && router.state.matches.length > 0 && router.state.location.href === targetUrl) {
      setIsResolving(false)
    }
    return unsubscribeResolved
  }, [router, slot, targetUrl])

  useEffect(() => {
    if (!isSlotSelected || !targetUrl) return
    const currentHref = router.state.location.href
    if (targetUrl === currentHref) {
      if (router.state.status === 'idle') {
        setIsResolving(false)
      }
      return
    }

    // Returning to `/app/chat` or `/app/agents` from another primary nav entry restores the
    // keep-alive slot's existing conversation URL instead of overwriting it with bare defaults.
    if (slot !== 'default' && isBareKeepAliveUrl(targetUrl) && getRouteSlot(currentHref) === slot) {
      setIsResolving(false)
      onSlotUrlChangeRef.current(currentHref)
      return
    }

    setIsResolving(true)
    void navigateRouterToHref(router, targetUrl)
  }, [isSlotSelected, router, slot, targetUrl])

  const contentRef = useRef<HTMLElement | null>(null)
  const [tabPortalContainer, setTabPortalContainer] = useState<HTMLElement | null>(null)
  // Latch the captured node across Activity hide/show: a hidden slot detaches the ref
  // (node === null) while its DOM node lives on, and clearing the container would
  // un-scope a still-open overlay/PageSidePanel to a full-window document.body portal.
  const captureTabPortalContainer = useCallback((node: HTMLElement | null) => {
    if (node) {
      contentRef.current = node
      setTabPortalContainer(node)
    }
  }, [])

  return (
    <CommandFocusScope rootRef={contentRef} active={isActive && !isResolving}>
      <Activity mode={isActive ? 'visible' : 'hidden'}>
        <TabIdProvider tabId={tabId} isActive={isActive}>
          {/* This slot's content root is the portal target for overlays and PageSidePanel
            scoped to the slot (`relative` anchors the scoped panel's absolute layout), so a
            hidden tab or keep-alive route keeps its open surface hidden with its owning root. */}
          <div ref={captureTabPortalContainer} className="relative flex h-full min-h-0 w-full flex-1 flex-col">
            <PortalContainerProvider container={tabPortalContainer}>
              <DialogPortalContainerProvider container={tabPortalContainer}>
                <RouterProvider router={router} />
              </DialogPortalContainerProvider>
            </PortalContainerProvider>
            {isResolving && (
              <div
                data-testid="tab-route-transition-cover"
                className="absolute inset-0 z-50 bg-card"
                aria-hidden="true"
              />
            )}
          </div>
        </TabIdProvider>
      </Activity>
    </CommandFocusScope>
  )
}

interface TabRouterProps {
  tab: Tab
  isActive: boolean
  onUrlChange: (url: string) => void
}

/**
 * TabRouter - Independent MemoryRouter per Tab, with Activity KeepAlive for primary routes
 *
 * Keeps `/app/chat` and `/app/agents` mounted per tab via React 19's `Activity` once visited
 * so single-tab switching between primary workspaces toggles visibility rather than unmounting
 * and rebuilding the entire tree. Non-primary routes still share a single `'default'` slot.
 */
type KeepAliveSlotEntry = {
  initialUrl: string
  startCovered: boolean
}

export const TabRouter = ({ tab, isActive, onUrlChange }: TabRouterProps) => {
  const activeSlot = getRouteSlot(tab.url)
  const [keepAliveSlots, setKeepAliveSlots] = useState<Partial<Record<KeepAliveRouteSlot, KeepAliveSlotEntry>>>(() =>
    activeSlot === 'default' ? {} : { [activeSlot]: { initialUrl: tab.url, startCovered: false } }
  )
  const lastInternalUrlRef = useRef<string | null>(null)

  if (activeSlot !== 'default' && !keepAliveSlots[activeSlot]) {
    const startCovered = lastInternalUrlRef.current !== tab.url
    setKeepAliveSlots((prev) =>
      prev[activeSlot] ? prev : { ...prev, [activeSlot]: { initialUrl: tab.url, startCovered } }
    )
  }

  const handleSlotUrlChange = useCallback(
    (nextUrl: string) => {
      lastInternalUrlRef.current = nextUrl
      onUrlChange(nextUrl)
    },
    [onUrlChange]
  )

  return (
    <>
      {(['chat', 'agents'] as const).map((slot) => {
        const entry = keepAliveSlots[slot]
        if (!entry) return null
        const isSlotSelected = activeSlot === slot

        return (
          <TabRouteSlot
            key={`${tab.id}:${slot}`}
            tabId={tab.id}
            slot={slot}
            initialUrl={entry.initialUrl}
            targetUrl={isSlotSelected ? tab.url : undefined}
            isActive={isActive && isSlotSelected}
            isSlotSelected={isSlotSelected}
            startCovered={entry.startCovered}
            onSlotUrlChange={handleSlotUrlChange}
          />
        )
      })}
      {activeSlot === 'default' && (
        <TabRouteSlot
          key={`${tab.id}:default`}
          tabId={tab.id}
          slot="default"
          initialUrl={tab.url}
          targetUrl={tab.url}
          isActive={isActive}
          isSlotSelected
          startCovered={false}
          onSlotUrlChange={handleSlotUrlChange}
        />
      )}
    </>
  )
}

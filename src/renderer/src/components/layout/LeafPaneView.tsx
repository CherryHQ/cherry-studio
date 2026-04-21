import { useDroppable } from '@dnd-kit/core'
import { cn } from '@renderer/utils'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity, useCallback, useEffect, useMemo, useRef } from 'react'

import type { LeafPane, PaneTab } from '../../hooks/usePanes'
import { usePanesActions } from '../../hooks/usePanes'
import { routeTree } from '../../routeTree.gen'
import { PaneDropIndicator } from './PaneDropIndicator'
import type { PaneGeometry } from './PaneGeometryContext'
import { useRegisterPaneGeometry } from './PaneGeometryContext'
import { PaneTabBar } from './PaneTabBar'
import { ShellTabBarActions, useShellTabBarLayout } from './ShellTabBarActions'

interface LeafPaneViewProps {
  pane: LeafPane
  /** Is this leaf the root of the window? Drives shell actions + left padding. */
  isRootLeaf: boolean
  /** Is this leaf the currently focused pane? */
  isActivePane: boolean
  /** Running inside a detached window? */
  isDetached?: boolean
}

/**
 * Renders a leaf pane: its tab bar + the active tab's content.
 *
 * Every tab in the leaf that is not dormant gets its own MemoryRouter kept
 * alive inside a React `<Activity>` — the active tab is `visible`, the rest
 * are `hidden`. This matches the legacy KeepAlive behaviour but now scoped
 * to a pane's tabs rather than the global tab list.
 *
 * Also acts as the drop target for the content area's edge/center zones (via
 * `useDroppable`) and publishes its geometry (tab-bar rect, content rect, and
 * per-tab-button rects) to `PaneGeometryContext` for DnD hit-testing.
 */
export function LeafPaneView({ pane, isRootLeaf, isActivePane, isDetached = false }: LeafPaneViewProps) {
  const { updateTab, setActivePane } = usePanesActions()
  const { rightPaddingClass } = useShellTabBarLayout(isDetached)
  const updateGeometry = useRegisterPaneGeometry(pane.paneId)

  const handleFocus = useCallback(() => {
    if (!isActivePane) {
      setActivePane(pane.paneId)
    }
  }, [isActivePane, setActivePane, pane.paneId])

  const liveTabs = useMemo(() => pane.tabs.filter((t) => !t.isDormant), [pane.tabs])

  const shellActions = isRootLeaf && !isDetached ? () => <ShellTabBarActions isDetached={false} /> : undefined
  const shellPadding = isRootLeaf && !isDetached ? rightPaddingClass : ''

  // Content area is a droppable for cross-pane move / edge split.
  const { setNodeRef: setContentDropRef } = useDroppable({ id: `${pane.paneId}:content` })

  // Geometry bookkeeping — tab bar, content area, per-tab-button rects.
  const tabBarElRef = useRef<HTMLElement | null>(null)
  const contentElRef = useRef<HTMLElement | null>(null)
  const tabButtonElsRef = useRef<Map<string, HTMLElement>>(new Map())

  // Keep the latest tabs order in a ref so `publish` can stay stable (no deps).
  const tabsRef = useRef(pane.tabs)
  tabsRef.current = pane.tabs

  // rAF batching: multiple `publish()` calls in the same frame collapse into one.
  const rafIdRef = useRef<number | null>(null)

  const publish = useCallback(() => {
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      const tabBarEl = tabBarElRef.current
      const contentEl = contentElRef.current
      if (!tabBarEl || !contentEl) return
      const tabBarRect = tabBarEl.getBoundingClientRect()
      const contentRect = contentEl.getBoundingClientRect()
      const tabs = tabsRef.current
      const tabButtonRects: { tabId: string; rect: DOMRect }[] = []
      for (const t of tabs) {
        const el = tabButtonElsRef.current.get(t.id)
        if (el) tabButtonRects.push({ tabId: t.id, rect: el.getBoundingClientRect() })
      }
      const geometry: PaneGeometry = { tabBarRect, contentRect, tabButtonRects }
      updateGeometry(geometry)
    })
  }, [updateGeometry])

  // Re-publish when the pane's tab list (identity or count) changes.
  useEffect(() => {
    publish()
  }, [publish, pane.tabs])

  // Attach ResizeObservers once — the scrollable content inside a tab doesn't
  // move the pane's own rect, so no global scroll listener is needed.
  useEffect(() => {
    const tabBarEl = tabBarElRef.current
    const contentEl = contentElRef.current
    const ros: ResizeObserver[] = []
    if (tabBarEl) {
      const ro = new ResizeObserver(() => publish())
      ro.observe(tabBarEl)
      ros.push(ro)
    }
    if (contentEl) {
      const ro = new ResizeObserver(() => publish())
      ro.observe(contentEl)
      ros.push(ro)
    }
    return () => {
      for (const ro of ros) ro.disconnect()
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [publish])

  const handleTabBarRef = useCallback(
    (el: HTMLElement | null) => {
      tabBarElRef.current = el
      publish()
    },
    [publish]
  )

  const handleTabButtonRef = useCallback(
    (tabId: string, el: HTMLElement | null) => {
      if (el) {
        tabButtonElsRef.current.set(tabId, el)
      } else {
        tabButtonElsRef.current.delete(tabId)
      }
      publish()
    },
    [publish]
  )

  const handleContentRef = useCallback(
    (el: HTMLElement | null) => {
      contentElRef.current = el
      setContentDropRef(el)
      publish()
    },
    [setContentDropRef, publish]
  )

  return (
    <div
      className={cn('relative flex h-full w-full flex-col', !isActivePane && 'opacity-95')}
      onPointerDownCapture={handleFocus}>
      <PaneTabBar
        pane={pane}
        isActivePane={isActivePane}
        renderShellActions={shellActions}
        rightPaddingClass={shellPadding}
        hideAddButton={isDetached}
        tabBarRef={handleTabBarRef}
        onTabButtonRef={handleTabButtonRef}
      />

      <main
        ref={handleContentRef}
        className={cn('relative flex-1 overflow-hidden bg-background', isRootLeaf ? 'rounded-[16px]' : '')}>
        {liveTabs.map((tab) => {
          const isActiveTab = tab.id === pane.activeTabId
          if (tab.type === 'webview') {
            return <WebviewSlot key={tab.id} tab={tab} isActiveTab={isActiveTab} />
          }
          return (
            <TabRouterSlot
              key={tab.id}
              tab={tab}
              paneId={pane.paneId}
              isActiveTab={isActiveTab}
              onUrlChange={(url) => updateTab(pane.paneId, tab.id, { url })}
            />
          )
        })}
      </main>

      <PaneDropIndicator paneId={pane.paneId} />
    </div>
  )
}

interface TabRouterSlotProps {
  tab: PaneTab
  paneId: string
  isActiveTab: boolean
  onUrlChange: (url: string) => void
}

/**
 * One MemoryRouter per PaneTab, keyed by tab.id. Wrapped in `<Activity>` so
 * the active tab is rendered and the rest stay alive but hidden.
 */
function TabRouterSlot({ tab, isActiveTab, onUrlChange }: TabRouterSlotProps) {
  const router = useMemo(() => {
    const history = createMemoryHistory({ initialEntries: [tab.url] })
    return createRouter({ routeTree, history })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => {
    return router.subscribe('onResolved', ({ toLocation }) => {
      const nextHref = toLocation.href
      if (nextHref !== tab.url) {
        onUrlChange(nextHref)
      }
    })
  }, [router, tab.url, onUrlChange])

  useEffect(() => {
    const currentHref = router.state.location.href
    if (tab.url !== currentHref) {
      void router.navigate({ to: tab.url })
    }
  }, [router, tab.url])

  return (
    <Activity mode={isActiveTab ? 'visible' : 'hidden'}>
      <div className="h-full w-full">
        <RouterProvider router={router} />
      </div>
    </Activity>
  )
}

interface WebviewSlotProps {
  tab: PaneTab
  isActiveTab: boolean
}

/**
 * Placeholder for a webview-type tab. Kept as a visual stub until the real
 * MinApp/webview integration lands — mirrors the Phase-1 mock but scoped to
 * the leaf pane's tab list.
 */
function WebviewSlot({ tab, isActiveTab }: WebviewSlotProps) {
  return (
    <Activity mode={isActiveTab ? 'visible' : 'hidden'}>
      <div className="flex h-full w-full flex-col items-center justify-center bg-background">
        <div className="mb-2 font-bold text-lg">Webview App</div>
        <code className="rounded bg-muted p-2">{tab.url}</code>
      </div>
    </Activity>
  )
}

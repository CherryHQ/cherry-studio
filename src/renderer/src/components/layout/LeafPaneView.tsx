import { cn } from '@renderer/utils'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { Activity, useCallback, useEffect, useMemo } from 'react'

import type { LeafPane, PaneTab } from '../../hooks/usePanes'
import { usePanes } from '../../hooks/usePanes'
import { routeTree } from '../../routeTree.gen'
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
 */
export function LeafPaneView({ pane, isRootLeaf, isActivePane, isDetached = false }: LeafPaneViewProps) {
  const { updateTab, setActivePane } = usePanes()
  const { rightPaddingClass } = useShellTabBarLayout(isDetached)

  const handleFocus = useCallback(() => {
    if (!isActivePane) {
      setActivePane(pane.paneId)
    }
  }, [isActivePane, setActivePane, pane.paneId])

  const liveTabs = useMemo(() => pane.tabs.filter((t) => !t.isDormant), [pane.tabs])

  const shellActions = isRootLeaf && !isDetached ? () => <ShellTabBarActions isDetached={false} /> : undefined
  const shellPadding = isRootLeaf && !isDetached ? rightPaddingClass : ''

  return (
    <div
      className={cn('flex h-full w-full flex-col', !isActivePane && 'opacity-95')}
      onPointerDownCapture={handleFocus}>
      <PaneTabBar
        pane={pane}
        isRootLeaf={isRootLeaf}
        isActivePane={isActivePane}
        renderShellActions={shellActions}
        rightPaddingClass={shellPadding}
        hideAddButton={isDetached}
      />

      <main className={cn('relative flex-1 overflow-hidden bg-background', isRootLeaf ? 'rounded-[16px]' : '')}>
        {liveTabs.map((tab) => (
          <TabRouterSlot
            key={tab.id}
            tab={tab}
            paneId={pane.paneId}
            isActiveTab={tab.id === pane.activeTabId}
            onUrlChange={(url) => updateTab(pane.paneId, tab.id, { url })}
          />
        ))}
      </main>
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

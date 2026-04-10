import type { SplitDirection, SplitLayout, SplitPane } from '@shared/data/cache/cacheValueTypes'
import { useCallback, useMemo } from 'react'

import { uuid } from '../utils'
import { getDefaultRouteTitle } from '../utils/routeTitle'
import {
  collectAllPaneIds,
  findPaneById,
  removePaneById,
  replacePaneById,
  updatePaneInLayout,
  updateRatioAtPath
} from '../utils/splitLayout'
import { useTabs } from './useTabs'

export function useSplitView(tabId: string) {
  const { tabs, updateTab } = useTabs()
  const tab = useMemo(() => tabs.find((t) => t.id === tabId), [tabs, tabId])

  /**
   * Split the current active pane (or whole tab if single view) into two panes.
   */
  const splitPane = useCallback(
    (direction: SplitDirection, newUrl?: string) => {
      if (!tab) return

      const targetUrl = newUrl ?? tab.url
      const newPaneId = uuid()

      if (!tab.splitLayout) {
        // Single view → create split layout
        const existingPane: SplitPane = {
          type: 'leaf',
          paneId: tab.id,
          url: tab.url,
          title: tab.title
        }
        const newPane: SplitPane = {
          type: 'leaf',
          paneId: newPaneId,
          url: targetUrl,
          title: getDefaultRouteTitle(targetUrl)
        }
        const splitLayout: SplitLayout = {
          type: 'split',
          direction,
          ratio: 50,
          children: [existingPane, newPane]
        }
        updateTab(tabId, { splitLayout, activePaneId: newPaneId })
        return
      }

      // Already split → split the active pane further
      const activePaneId = tab.activePaneId ?? collectAllPaneIds(tab.splitLayout)[0]
      if (!activePaneId) return

      const existingPane = findPaneById(tab.splitLayout, activePaneId)
      if (!existingPane) return

      const newPane: SplitPane = {
        type: 'leaf',
        paneId: newPaneId,
        url: targetUrl,
        title: getDefaultRouteTitle(targetUrl)
      }

      const replacement: SplitLayout = {
        type: 'split',
        direction,
        ratio: 50,
        children: [existingPane, newPane]
      }

      const updatedLayout = replacePaneById(tab.splitLayout, activePaneId, replacement)
      updateTab(tabId, { splitLayout: updatedLayout, activePaneId: newPaneId })
    },
    [tab, tabId, updateTab]
  )

  /**
   * Close a pane. If only one pane remains, revert to single-view mode.
   */
  const closePane = useCallback(
    (paneId: string) => {
      if (!tab?.splitLayout) return

      const remaining = removePaneById(tab.splitLayout, paneId)

      if (!remaining || remaining.type === 'leaf') {
        // Collapsed to single view
        updateTab(tabId, {
          splitLayout: undefined,
          activePaneId: undefined,
          url: remaining?.url ?? tab.url,
          title: remaining?.title ?? tab.title
        })
        return
      }

      // Still a split — update activePaneId if needed
      const allIds = collectAllPaneIds(remaining)
      const newActivePaneId = tab.activePaneId === paneId ? allIds[0] : tab.activePaneId

      updateTab(tabId, { splitLayout: remaining, activePaneId: newActivePaneId })
    },
    [tab, tabId, updateTab]
  )

  /**
   * Update a pane's URL within the split layout tree.
   */
  const updatePaneUrl = useCallback(
    (paneId: string, url: string) => {
      if (!tab?.splitLayout) return

      const title = getDefaultRouteTitle(url)
      const updatedLayout = updatePaneInLayout(tab.splitLayout, paneId, { url, title })
      const updates: Record<string, unknown> = { splitLayout: updatedLayout }

      // Keep tab.url in sync with the active pane
      if (paneId === tab.activePaneId) {
        updates.url = url
        updates.title = title
      }

      updateTab(tabId, updates)
    },
    [tab, tabId, updateTab]
  )

  /**
   * Set the active (focused) pane.
   */
  const setActivePane = useCallback(
    (paneId: string) => {
      if (!tab?.splitLayout) return
      updateTab(tabId, { activePaneId: paneId })
    },
    [tab, tabId, updateTab]
  )

  /**
   * Update the resize ratio at a given tree path.
   */
  const updateRatio = useCallback(
    (path: number[], ratio: number) => {
      if (!tab?.splitLayout) return
      const updatedLayout = updateRatioAtPath(tab.splitLayout, path, ratio)
      updateTab(tabId, { splitLayout: updatedLayout })
    },
    [tab, tabId, updateTab]
  )

  /**
   * Exit split view — keep the active pane as the single view.
   */
  const unsplit = useCallback(() => {
    if (!tab?.splitLayout) return

    const currentActivePaneId = tab.activePaneId ?? collectAllPaneIds(tab.splitLayout)[0]
    const activePane = findPaneById(tab.splitLayout, currentActivePaneId)

    updateTab(tabId, {
      splitLayout: undefined,
      activePaneId: undefined,
      url: activePane?.url ?? tab.url,
      title: activePane?.title ?? tab.title
    })
  }, [tab, tabId, updateTab])

  return {
    splitPane,
    closePane,
    updatePaneUrl,
    setActivePane,
    updateRatio,
    unsplit,
    isSplit: !!tab?.splitLayout,
    activePaneId: tab?.activePaneId
  }
}

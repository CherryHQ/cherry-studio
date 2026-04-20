import type { SplitDirection, SplitLayout, SplitPane } from '@shared/data/cache/cacheValueTypes'
import { useCallback, useMemo } from 'react'

import { uuid } from '../utils'
import { getDefaultRouteTitle } from '../utils/routeTitle'
import {
  collectAllPaneIds,
  findPaneById,
  findPreviewPane,
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
   *
   * Navigating within a preview pane promotes it to persistent — this mirrors
   * VSCode's behaviour where acting inside a preview tab makes it a real tab.
   */
  const updatePaneUrl = useCallback(
    (paneId: string, url: string) => {
      if (!tab?.splitLayout) return

      const title = getDefaultRouteTitle(url)
      const pane = findPaneById(tab.splitLayout, paneId)
      const shouldPromote = pane?.isPreview === true && pane.url !== url

      const updatedLayout = updatePaneInLayout(tab.splitLayout, paneId, {
        url,
        title,
        ...(shouldPromote ? { isPreview: false } : {})
      })
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
   * Open a URL in a preview pane — the VSCode "preview tab" semantics applied
   * to panes: at most one preview pane lives per Tab, and re-calling this
   * replaces its URL instead of stacking new panes.
   *
   * - If a preview pane already exists, its URL is replaced in place.
   * - Otherwise, a new preview pane is opened next to `anchorPaneId`
   *   (defaulting to the active pane or the tab itself for single-view).
   */
  const openPreview = useCallback(
    (url: string, options?: { anchorPaneId?: string; direction?: SplitDirection }) => {
      if (!tab) return

      const direction = options?.direction ?? 'horizontal'
      const title = getDefaultRouteTitle(url)

      // 1. Existing preview pane → replace its url in place.
      if (tab.splitLayout) {
        const existingPreview = findPreviewPane(tab.splitLayout)
        if (existingPreview) {
          const updatedLayout = updatePaneInLayout(tab.splitLayout, existingPreview.paneId, {
            url,
            title,
            isPreview: true
          })
          const updates: Record<string, unknown> = {
            splitLayout: updatedLayout,
            activePaneId: existingPreview.paneId
          }
          if (existingPreview.paneId === tab.activePaneId) {
            updates.url = url
            updates.title = title
          }
          updateTab(tabId, updates)
          return
        }
      }

      // 2. No preview pane yet → create one as a sibling of the anchor.
      const newPaneId = uuid()
      const newPane: SplitPane = {
        type: 'leaf',
        paneId: newPaneId,
        url,
        title,
        isPreview: true
      }

      if (!tab.splitLayout) {
        const existingPane: SplitPane = {
          type: 'leaf',
          paneId: tab.id,
          url: tab.url,
          title: tab.title
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

      const anchorPaneId = options?.anchorPaneId ?? tab.activePaneId ?? collectAllPaneIds(tab.splitLayout)[0]
      if (!anchorPaneId) return

      const anchor = findPaneById(tab.splitLayout, anchorPaneId)
      if (!anchor) return

      const replacement: SplitLayout = {
        type: 'split',
        direction,
        ratio: 50,
        children: [anchor, newPane]
      }

      const updatedLayout = replacePaneById(tab.splitLayout, anchorPaneId, replacement)
      updateTab(tabId, { splitLayout: updatedLayout, activePaneId: newPaneId })
    },
    [tab, tabId, updateTab]
  )

  /**
   * Promote a preview pane to a persistent pane. No-op for panes that are
   * already persistent or do not exist.
   */
  const promotePane = useCallback(
    (paneId: string) => {
      if (!tab?.splitLayout) return
      const pane = findPaneById(tab.splitLayout, paneId)
      if (!pane?.isPreview) return
      const updatedLayout = updatePaneInLayout(tab.splitLayout, paneId, { isPreview: false })
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
    openPreview,
    promotePane,
    closePane,
    updatePaneUrl,
    setActivePane,
    updateRatio,
    unsplit,
    isSplit: !!tab?.splitLayout,
    activePaneId: tab?.activePaneId
  }
}

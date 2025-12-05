import { useCallback, useEffect, useMemo } from 'react'

import { usePersistCache } from '../data/hooks/useCache'
import { uuid } from '../utils'

// Re-export types from shared schema
export type { Tab, TabsState, TabType } from '@shared/data/cache/cacheSchemas'
import type { Tab, TabType } from '@shared/data/cache/cacheSchemas'

const DEFAULT_TAB: Tab = {
  id: 'home',
  type: 'route',
  url: '/',
  title: 'Home'
}

/**
 * Options for opening a tab
 */
export interface OpenTabOptions {
  /** Force open a new tab even if one with the same URL exists */
  forceNew?: boolean
  /** Tab title (defaults to URL path) */
  title?: string
  /** Tab type (defaults to 'route') */
  type?: TabType
  /** Custom tab ID (auto-generated if not provided) */
  id?: string
}

export function useTabs() {
  const [tabsState, setTabsState] = usePersistCache('ui.tab.state')

  // Ensure at least one default tab exists
  useEffect(() => {
    if (tabsState.tabs.length === 0) {
      setTabsState({ tabs: [DEFAULT_TAB], activeTabId: DEFAULT_TAB.id })
    }
  }, [tabsState.tabs.length, setTabsState])

  const tabs = useMemo(() => (tabsState.tabs.length > 0 ? tabsState.tabs : [DEFAULT_TAB]), [tabsState.tabs])
  const activeTabId = tabsState.activeTabId || DEFAULT_TAB.id

  const addTab = useCallback(
    (tab: Tab) => {
      const exists = tabs.find((t) => t.id === tab.id)
      if (exists) {
        setTabsState({ ...tabsState, activeTabId: tab.id })
        return
      }
      const newTabs = [...tabs, tab]
      setTabsState({ tabs: newTabs, activeTabId: tab.id })
    },
    [tabs, tabsState, setTabsState]
  )

  const closeTab = useCallback(
    (id: string) => {
      const newTabs = tabs.filter((t) => t.id !== id)
      let newActiveId = activeTabId

      if (activeTabId === id) {
        const index = tabs.findIndex((t) => t.id === id)
        const nextTab = newTabs[index - 1] || newTabs[index]
        newActiveId = nextTab ? nextTab.id : ''
      }

      setTabsState({ tabs: newTabs, activeTabId: newActiveId })
    },
    [tabs, activeTabId, setTabsState]
  )

  const setActiveTab = useCallback(
    (id: string) => {
      if (id !== activeTabId) {
        setTabsState({ ...tabsState, activeTabId: id })
      }
    },
    [activeTabId, tabsState, setTabsState]
  )

  const updateTab = useCallback(
    (id: string, updates: Partial<Tab>) => {
      const newTabs = tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
      setTabsState({ ...tabsState, tabs: newTabs })
    },
    [tabs, tabsState, setTabsState]
  )

  const setTabs = useCallback(
    (newTabs: Tab[] | ((prev: Tab[]) => Tab[])) => {
      const resolvedTabs = typeof newTabs === 'function' ? newTabs(tabs) : newTabs
      setTabsState({ ...tabsState, tabs: resolvedTabs })
    },
    [tabs, tabsState, setTabsState]
  )

  /**
   * Open a Tab - reuses existing tab or creates new one
   *
   * @example
   * // Basic usage - reuses existing tab if URL matches
   * openTab('/settings')
   *
   * @example
   * // With custom title
   * openTab('/chat/123', { title: 'Chat with Alice' })
   *
   * @example
   * // Force open new tab (e.g., Cmd+Click)
   * openTab('/settings', { forceNew: true })
   *
   * @example
   * // Open webview tab
   * openTab('https://example.com', { type: 'webview', title: 'Example' })
   */
  const openTab = useCallback(
    (url: string, options: OpenTabOptions = {}) => {
      const { forceNew = false, title, type = 'route', id } = options

      // Try to find existing tab with same URL (unless forceNew)
      if (!forceNew) {
        const existingTab = tabs.find((t) => t.type === type && t.url === url)
        if (existingTab) {
          setActiveTab(existingTab.id)
          return existingTab.id
        }
      }

      // Create new tab
      const newTab: Tab = {
        id: id || uuid(),
        type,
        url,
        title: title || url.split('/').pop() || url
      }

      addTab(newTab)
      return newTab.id
    },
    [tabs, setActiveTab, addTab]
  )

  /**
   * Get the currently active tab
   */
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId])

  return {
    // State
    tabs,
    activeTabId,
    activeTab,
    isLoading: false,

    // Basic operations
    addTab,
    closeTab,
    setActiveTab,
    updateTab,
    setTabs,

    // High-level Tab operations
    openTab
  }
}

import { useCallback, useMemo } from 'react'

import { usePersistCache } from '../data/hooks/useCache'

// Re-export types from shared schema
export type { Tab, TabsState, TabType } from '@shared/data/cache/cacheSchemas'
import type { Tab } from '@shared/data/cache/cacheSchemas'

export function useTabs() {
  const [tabsState, setTabsState] = usePersistCache('tabs_state')

  const tabs = useMemo(() => tabsState.tabs, [tabsState.tabs])
  const activeTabId = tabsState.activeTabId

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

  return {
    tabs,
    activeTabId,
    isLoading: false,
    addTab,
    closeTab,
    setActiveTab,
    updateTab,
    setTabs
  }
}

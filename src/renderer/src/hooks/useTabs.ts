import { loggerService } from '@logger'
import { useCallback, useMemo } from 'react'

import { useMutation, useQuery } from '../data/hooks/useDataApi'

const logger = loggerService.withContext('useTabs')

export type TabType = 'webview' | 'url' | 'browser'

export interface Tab {
  id: string
  type: TabType
  url: string
  title: string
  icon?: string
  isKeepAlive?: boolean
  metadata?: Record<string, any>
}

interface TabsState {
  tabs: Tab[]
  activeTabId: string
}

const TABS_STORAGE_KEY = 'tabs_state'
const DEFAULT_STATE: TabsState = { tabs: [], activeTabId: '' }

export function useTabs() {
  // Load state from DB
  // We cast the path because we haven't fully updated the concrete path types globally yet
  const {
    data: tabsState,
    mutate: mutateState,
    loading: isLoading
  } = useQuery(`/app/state/${TABS_STORAGE_KEY}` as any, {
    swrOptions: {
      revalidateOnFocus: false,
      fallbackData: DEFAULT_STATE
    }
  })

  // Ensure we always have a valid object structure
  const currentState: TabsState = useMemo(
    () => (tabsState && typeof tabsState === 'object' ? (tabsState as TabsState) : DEFAULT_STATE),
    [tabsState]
  )
  const tabs = useMemo(() => (Array.isArray(currentState.tabs) ? currentState.tabs : []), [currentState.tabs])
  const activeTabId = currentState.activeTabId || ''

  // Mutation for saving
  const saveMutation = useMutation('PUT', `/app/state/${TABS_STORAGE_KEY}` as any)

  // Unified update helper
  const updateState = useCallback(
    async (newState: TabsState) => {
      // 1. Optimistic update local cache
      await mutateState(newState, { revalidate: false })

      // 2. Sync to DB
      saveMutation.mutate({ body: newState }).catch((err) => logger.error('Failed to save tabs state:', err))
    },
    [mutateState, saveMutation]
  )

  const addTab = useCallback(
    (tab: Tab) => {
      const exists = tabs.find((t) => t.id === tab.id)
      if (exists) {
        updateState({ ...currentState, activeTabId: tab.id })
        return
      }
      const newTabs = [...tabs, tab]
      updateState({ tabs: newTabs, activeTabId: tab.id })
    },
    [tabs, currentState, updateState]
  )

  const closeTab = useCallback(
    (id: string) => {
      const newTabs = tabs.filter((t) => t.id !== id)
      let newActiveId = activeTabId

      if (activeTabId === id) {
        // Activate adjacent tab
        const index = tabs.findIndex((t) => t.id === id)
        // Try to go left, then right
        const nextTab = newTabs[index - 1] || newTabs[index]
        newActiveId = nextTab ? nextTab.id : ''
      }

      updateState({ tabs: newTabs, activeTabId: newActiveId })
    },
    [tabs, activeTabId, updateState]
  )

  const setActiveTab = useCallback(
    (id: string) => {
      if (id !== activeTabId) {
        updateState({ ...currentState, activeTabId: id })
      }
    },
    [activeTabId, currentState, updateState]
  )

  const updateTab = useCallback(
    (id: string, updates: Partial<Tab>) => {
      const newTabs = tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
      updateState({ ...currentState, tabs: newTabs })
    },
    [tabs, currentState, updateState]
  )

  return {
    tabs,
    activeTabId,
    isLoading,
    addTab,
    closeTab,
    setActiveTab,
    updateTab
  }
}

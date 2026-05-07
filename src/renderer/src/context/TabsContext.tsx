import { loggerService } from '@logger'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { TabLRUManager } from '@renderer/services/TabLRUManager'
import { uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { Tab, TabSavedState, TabType } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('TabsContext')

const DEFAULT_TAB: Tab = {
  id: 'home',
  type: 'route',
  url: '/home',
  title: '',
  lastAccessTime: Date.now(),
  isDormant: false
}

function withLocalizedRouteTitle(tab: Tab): Tab {
  if (tab.type !== 'route') {
    return tab
  }
  return { ...tab, title: getDefaultRouteTitle(tab.url) }
}

function isSettingsRouteTab(tab: Tab): boolean {
  return tab.type === 'route' && tab.url.startsWith('/settings')
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

export interface TabsContextValue {
  // State
  tabs: Tab[]
  activeTabId: string
  activeTab: Tab | undefined
  isLoading: boolean

  // Basic operations
  addTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  setTabs: (newTabs: Tab[] | ((prev: Tab[]) => Tab[])) => void

  // High-level Tab operations
  openTab: (url: string, options?: OpenTabOptions) => string

  // LRU operations
  hibernateTab: (tabId: string) => void
  wakeTab: (tabId: string) => void
  pinTab: (id: string) => void
  unpinTab: (id: string) => void

  // Drag and drop
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void

  // Detach
  detachTab: (tabId: string) => void

  // Attach (from detached window)
  attachTab: (tabData: Tab) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

export function TabsProvider({ children }: { children: ReactNode }) {
  // Pinned tabs - persistent storage
  const [pinnedTabs, setPinnedTabsRaw] = usePersistCache('ui.tab.pinned_tabs')

  // Use ref to keep a reference to the latest pinnedTabs, avoiding closure issues
  const pinnedTabsRef = useRef(pinnedTabs)
  pinnedTabsRef.current = pinnedTabs

  // Wrap setter to support functional updates
  const setPinnedTabs = useCallback(
    (updater: Tab[] | ((prev: Tab[]) => Tab[])) => {
      if (typeof updater === 'function') {
        const newValue = updater(pinnedTabsRef.current || [])
        setPinnedTabsRaw(newValue)
      } else {
        setPinnedTabsRaw(updater)
      }
    },
    [setPinnedTabsRaw]
  )

  // Normal tabs - in-memory storage (cleared on restart), excludes home tab
  const [normalTabs, setNormalTabs] = useState<Tab[]>([])

  // Active tab ID - in-memory storage
  const [activeTabId, setActiveTabIdState] = useState<string>(DEFAULT_TAB.id)
  const didNotifyAttachReady = useRef(false)

  // LRU manager (singleton)
  const lruManagerRef = useRef<TabLRUManager | null>(null)
  if (!lruManagerRef.current) {
    lruManagerRef.current = new TabLRUManager()
  }

  // LRU auto-hibernation: check normalTabs and hibernate excess tabs
  const performLRUCheck = useCallback((newActiveTabId: string) => {
    if (!lruManagerRef.current) return
    setNormalTabs((prev) => {
      const toHibernate = lruManagerRef.current!.checkAndGetDormantCandidates(prev, newActiveTabId)
      if (toHibernate.length === 0) return prev
      return prev.map((t) => {
        if (toHibernate.includes(t.id)) {
          logger.info('Tab auto-hibernated (LRU)', { tabId: t.id, route: t.url })
          const savedState: TabSavedState = { scrollPosition: 0 }
          return { ...t, isDormant: true, savedState }
        }
        return t
      })
    })
  }, [])

  // Merge tabs: home + pinned + normal (route titles follow current i18n language)
  const tabs = useMemo(() => {
    const home = withLocalizedRouteTitle({ ...DEFAULT_TAB })
    return [home, ...(pinnedTabs || []).map(withLocalizedRouteTitle), ...normalTabs.map(withLocalizedRouteTitle)]
  }, [pinnedTabs, normalTabs])

  /**
   * Hibernate tab (manual)
   */
  const hibernateTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab || tab.isDormant) return

      const savedState: TabSavedState = { scrollPosition: 0 }
      logger.info('Tab hibernated (manual)', { tabId, route: tab.url })

      if (tab.isPinned) {
        setPinnedTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isDormant: true, savedState } : t)))
      } else {
        setNormalTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isDormant: true, savedState } : t)))
      }
    },
    [tabs, setPinnedTabs]
  )

  /**
   * Wake up tab
   */
  const wakeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab || !tab.isDormant) return

      logger.info('Tab awakened', { tabId, route: tab.url })

      if (tab.isPinned) {
        setPinnedTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, isDormant: false, lastAccessTime: Date.now() } : t))
        )
      } else {
        setNormalTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, isDormant: false, lastAccessTime: Date.now() } : t))
        )
      }
    },
    [tabs, setPinnedTabs]
  )

  const updateTab = useCallback(
    (id: string, updates: Partial<Tab>) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return

      if (tab.isPinned) {
        setPinnedTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      } else {
        setNormalTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      }
    },
    [tabs, setPinnedTabs]
  )

  const setActiveTab = useCallback(
    (id: string) => {
      if (id === activeTabId) return

      const targetTab = tabs.find((t) => t.id === id)
      if (!targetTab) return

      // If a dormant tab was awakened, log it
      if (targetTab.isDormant) {
        logger.info('Tab awakened', { tabId: id, route: targetTab.url })
      }

      // Update lastAccessTime and wake state
      if (targetTab.isPinned) {
        setPinnedTabs((prev) =>
          prev.map((t) => (t.id === id ? { ...t, lastAccessTime: Date.now(), isDormant: false } : t))
        )
      } else {
        setNormalTabs((prev) =>
          prev.map((t) => (t.id === id ? { ...t, lastAccessTime: Date.now(), isDormant: false } : t))
        )
      }

      setActiveTabIdState(id)
      performLRUCheck(id)
    },
    [activeTabId, tabs, setPinnedTabs, performLRUCheck]
  )

  const addTab = useCallback(
    (tab: Tab) => {
      const exists = tabs.find((t) => t.id === tab.id)
      if (exists) {
        setActiveTab(tab.id)
        return
      }

      const newTab: Tab = {
        ...tab,
        lastAccessTime: Date.now(),
        isDormant: false
      }

      if (tab.isPinned) {
        setPinnedTabs((prev) => [...prev, newTab])
      } else {
        setNormalTabs((prev) => [...prev, newTab])
        performLRUCheck(tab.id)
      }

      setActiveTabIdState(tab.id)
    },
    [tabs, setActiveTab, setPinnedTabs, performLRUCheck]
  )

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return

      // Calculate new activeTabId
      let newActiveId = activeTabId
      if (activeTabId === id) {
        const index = tabs.findIndex((t) => t.id === id)
        const remainingTabs = tabs.filter((t) => t.id !== id)
        const nextTab = remainingTabs[index - 1] || remainingTabs[index] || remainingTabs[0]
        newActiveId = nextTab ? nextTab.id : ''
      }

      if (tab.isPinned) {
        setPinnedTabs((prev) => prev.filter((t) => t.id !== id))
      } else {
        setNormalTabs((prev) => prev.filter((t) => t.id !== id))
      }

      setActiveTabIdState(newActiveId)
    },
    [tabs, activeTabId, setPinnedTabs]
  )

  const setTabs = useCallback(
    (newTabs: Tab[] | ((prev: Tab[]) => Tab[])) => {
      const resolvedTabs = typeof newTabs === 'function' ? newTabs(tabs) : newTabs
      const pinned = resolvedTabs.filter((t) => t.isPinned)
      const normal = resolvedTabs.filter((t) => !t.isPinned)
      setPinnedTabs(pinned)
      setNormalTabs(normal)
    },
    [tabs, setPinnedTabs]
  )

  /**
   * Open a Tab - reuses existing tab or creates new one
   */
  const openTab = useCallback(
    (url: string, options: OpenTabOptions = {}) => {
      const { forceNew = false, title, type = 'route', id } = options

      if (!forceNew) {
        const existingTab = tabs.find((t) => t.type === type && t.url === url)
        if (existingTab) {
          setActiveTab(existingTab.id)
          return existingTab.id
        }
      }

      const newTab: Tab = {
        id: id || uuid(),
        type,
        url,
        title: title || getDefaultRouteTitle(url),
        lastAccessTime: Date.now(),
        isDormant: false
      }

      addTab(newTab)
      return newTab.id
    },
    [tabs, setActiveTab, addTab]
  )

  /**
   * Pin a tab (exempt from LRU hibernation)
   */
  const pinTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab || tab.isPinned) return

      // Remove from normalTabs
      setNormalTabs((prev) => prev.filter((t) => t.id !== id))
      // Add to pinnedTabs
      setPinnedTabs((prev) => [...prev, { ...tab, isPinned: true }])

      logger.info('Tab pinned', { tabId: id })
    },
    [tabs, setPinnedTabs]
  )

  /**
   * Unpin a tab
   */
  const unpinTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab || !tab.isPinned) return

      // Remove from pinnedTabs
      setPinnedTabs((prev) => prev.filter((t) => t.id !== id))
      // Add to normalTabs
      setNormalTabs((prev) => [...prev, { ...tab, isPinned: false }])

      logger.info('Tab unpinned', { tabId: id })
    },
    [tabs, setPinnedTabs]
  )

  /**
   * Reorder tabs within their own list (for drag and drop)
   */
  const reorderTabs = useCallback(
    (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      if (type === 'pinned') {
        setPinnedTabs((prev) => {
          const newTabs = [...prev]
          const [removed] = newTabs.splice(oldIndex, 1)
          newTabs.splice(newIndex, 0, removed)
          return newTabs
        })
      } else {
        setNormalTabs((prev) => {
          const newTabs = [...prev]
          const [removed] = newTabs.splice(oldIndex, 1)
          newTabs.splice(newIndex, 0, removed)
          return newTabs
        })
      }
    },
    [setPinnedTabs]
  )

  /**
   * Detach a tab to a new window
   */
  const detachTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return

      // Send IPC message to create new window
      window.electron.ipcRenderer.send(IpcChannel.Tab_Detach, tab)

      // Remove tab from current window — closeTab handles both pinned and normal tabs
      closeTab(tabId)
    },
    [tabs, closeTab]
  )

  /**
   * Attach a tab from detached window
   */
  const attachTab = useCallback(
    (tabData: Tab) => {
      if (isSettingsRouteTab(tabData)) {
        const existingSettingsTab = tabs.find(isSettingsRouteTab)

        if (existingSettingsTab) {
          updateTab(existingSettingsTab.id, {
            url: tabData.url,
            title: getDefaultRouteTitle(tabData.url),
            isDormant: false,
            savedState: undefined
          })
          setActiveTab(existingSettingsTab.id)
          logger.info('Settings tab already exists, activating', { tabId: existingSettingsTab.id, url: tabData.url })
          return
        }
      }

      // Check if tab already exists
      const exists = tabs.find((t) => t.id === tabData.id)
      if (exists) {
        setActiveTab(tabData.id)
        logger.info('Tab already exists, activating', { tabId: tabData.id })
        return
      }

      // Restore tab with updated timestamp
      const restoredTab: Tab = {
        ...tabData,
        lastAccessTime: Date.now(),
        isDormant: false
      }

      // Add to appropriate storage
      if (restoredTab.isPinned) {
        setPinnedTabs((prev) => [...prev, restoredTab])
      } else {
        setNormalTabs((prev) => [...prev, restoredTab])
      }

      setActiveTabIdState(restoredTab.id)
      logger.info('Tab attached from detached window', { tabId: tabData.id, url: tabData.url })
    },
    [tabs, setActiveTab, setPinnedTabs, updateTab]
  )

  // Listen for tab attach requests (from Main Process)
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return

    const handleAttachRequest = (_event: any, tabData: Tab) => {
      attachTab(tabData)
    }

    const removeAttachRequest = window.electron.ipcRenderer.on(IpcChannel.Tab_Attach, handleAttachRequest)
    if (!didNotifyAttachReady.current) {
      didNotifyAttachReady.current = true
      void window.electron.ipcRenderer.invoke(IpcChannel.Tab_AttachReady).catch((error) => {
        didNotifyAttachReady.current = false
        logger.warn('Failed to notify tab attach readiness', error as Error)
      })
    }

    return removeAttachRequest
  }, [attachTab])

  /**
   * Get the currently active tab
   */
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId])

  const value: TabsContextValue = {
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
    openTab,

    // LRU operations
    hibernateTab,
    wakeTab,
    pinTab,
    unpinTab,

    // Detach
    detachTab,

    // Attach
    attachTab,

    // Drag and drop
    reorderTabs
  }

  return <TabsContext value={value}>{children}</TabsContext>
}

export function useTabsContext() {
  const context = use(TabsContext)
  if (!context) {
    throw new Error('useTabsContext must be used within a TabsProvider')
  }
  return context
}

export function useOptionalTabsContext() {
  return use(TabsContext)
}

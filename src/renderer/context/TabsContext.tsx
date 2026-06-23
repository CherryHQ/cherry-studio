import { loggerService } from '@logger'
import { resolveSidebarAppTabEntryUrl } from '@renderer/config/sidebar'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { TabLruManager } from '@renderer/services/TabLruManager'
import { getDefaultRouteTitle, isPageTitledRoute, isTopLevelRoute } from '@renderer/utils/routeTitle'
import type { Tab, TabSavedState, TabType } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'

const logger = loggerService.withContext('TabsContext')

const DEFAULT_TAB: Tab = {
  id: 'home',
  type: 'route',
  url: '/app/chat',
  title: '',
  lastAccessTime: Date.now(),
  isDormant: false
}

function withLocalizedRouteTitle(tab: Tab): Tab {
  if (tab.type !== 'route') return tab
  // Chat / agent tabs are page-titled (topic / session name + assistant / agent
  // emoji set by their page) — never auto-localize, or the route title clobbers
  // the page title even for the bare `/app/chat` default tab.
  if (isPageTitledRoute(tab.url)) {
    return tab.title ? tab : { ...tab, title: getDefaultRouteTitle(tab.url) }
  }
  if (tab.id === 'home') return { ...tab, title: getDefaultRouteTitle(tab.url) }
  // Only auto-localize titles for top-level and settings routes. Parameterized
  // routes (e.g. /app/mini-app/<id>) preserve the title supplied at openTab
  // time so callers can pass per-entity names like a mini-app's display name.
  if (!isTopLevelRoute(tab.url) && !isSettingsRouteTab(tab)) return tab
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
  /** Per-entity icon descriptor (e.g. mini-app logo string); rendered in the tab bar when set */
  icon?: string
  /** Optional tab metadata copied into the newly-created tab. */
  metadata?: Tab['metadata']
  /**
   * Materialize the tab as pinned. Set when a detached sub-window re-creates a tab
   * from its init payload so the pinned state survives the detach → re-attach round-trip.
   */
  isPinned?: boolean
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

type TabsProviderProps = {
  children: ReactNode
  initialDefaultTab?: Tab | null
  includePinnedTabs?: boolean
}

export function TabsProvider({
  children,
  initialDefaultTab = DEFAULT_TAB,
  includePinnedTabs = true
}: TabsProviderProps) {
  // Route-derived tab titles are localized, so recompute them on language change.
  const { i18n } = useTranslation()

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

  // Whether a tab's `isPinned` should route it into the persistent pinned list. The main
  // window surfaces pinned tabs, so it follows the flag. A detached sub-window passes
  // `includePinnedTabs={false}`: it has no pinned section and must never write the shared
  // `ui.tab.pinned_tabs` cache, so every tab lives in the normal list there — `isPinned`
  // is kept on the object only to round-trip the pinned state back on re-attach.
  const storesPinned = useCallback(
    (tab: Pick<Tab, 'isPinned'>) => includePinnedTabs && !!tab.isPinned,
    [includePinnedTabs]
  )

  // Normal tabs - in-memory storage (cleared on restart)
  const [normalTabs, setNormalTabs] = useState<Tab[]>(() => (initialDefaultTab ? [initialDefaultTab] : []))

  // Active tab ID - in-memory storage
  const [activeTabId, setActiveTabIdState] = useState<string>(() => initialDefaultTab?.id ?? '')

  // LRU manager (singleton)
  const lruManagerRef = useRef<TabLruManager | null>(null)
  if (!lruManagerRef.current) {
    lruManagerRef.current = new TabLruManager()
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

  // Merge tabs: pinned + normal (route titles follow current i18n language)
  const tabs = useMemo(() => {
    const currentPinnedTabs = includePinnedTabs ? pinnedTabs || [] : []
    return [...currentPinnedTabs.map(withLocalizedRouteTitle), ...normalTabs.map(withLocalizedRouteTitle)]
  }, [includePinnedTabs, pinnedTabs, normalTabs, i18n.language])

  /**
   * Hibernate tab (manual)
   */
  const hibernateTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab || tab.isDormant) return

      const savedState: TabSavedState = { scrollPosition: 0 }
      logger.info('Tab hibernated (manual)', { tabId, route: tab.url })

      if (storesPinned(tab)) {
        setPinnedTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isDormant: true, savedState } : t)))
      } else {
        setNormalTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isDormant: true, savedState } : t)))
      }
    },
    [tabs, setPinnedTabs, storesPinned]
  )

  /**
   * Wake up tab
   */
  const wakeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab || !tab.isDormant) return

      logger.info('Tab awakened', { tabId, route: tab.url })

      if (storesPinned(tab)) {
        setPinnedTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, isDormant: false, lastAccessTime: Date.now() } : t))
        )
      } else {
        setNormalTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, isDormant: false, lastAccessTime: Date.now() } : t))
        )
      }
    },
    [tabs, setPinnedTabs, storesPinned]
  )

  const updateTab = useCallback(
    (id: string, updates: Partial<Tab>) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return

      if (storesPinned(tab)) {
        setPinnedTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      } else {
        setNormalTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      }
    },
    [tabs, setPinnedTabs, storesPinned]
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
      if (storesPinned(targetTab)) {
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
    [activeTabId, tabs, setPinnedTabs, performLRUCheck, storesPinned]
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

      if (storesPinned(tab)) {
        setPinnedTabs((prev) => [...prev, newTab])
      } else {
        setNormalTabs((prev) => [...prev, newTab])
        performLRUCheck(tab.id)
      }

      setActiveTabIdState(tab.id)
    },
    [tabs, setActiveTab, setPinnedTabs, performLRUCheck, storesPinned]
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

      if (storesPinned(tab)) {
        setPinnedTabs((prev) => prev.filter((t) => t.id !== id))
      } else {
        setNormalTabs((prev) => prev.filter((t) => t.id !== id))
      }

      setActiveTabIdState(newActiveId)
    },
    [tabs, activeTabId, setPinnedTabs, storesPinned]
  )

  const setTabs = useCallback(
    (newTabs: Tab[] | ((prev: Tab[]) => Tab[])) => {
      const resolvedTabs = typeof newTabs === 'function' ? newTabs(tabs) : newTabs
      const pinned = resolvedTabs.filter((t) => storesPinned(t))
      const normal = resolvedTabs.filter((t) => !storesPinned(t))
      setPinnedTabs(pinned)
      setNormalTabs(normal)
    },
    [tabs, setPinnedTabs, storesPinned]
  )

  /**
   * Open a Tab - reuses existing tab or creates new one
   */
  const openTab = useCallback(
    (url: string, options: OpenTabOptions = {}) => {
      const { forceNew = false, title, type = 'route', id, icon, metadata, isPinned } = options

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
        icon,
        metadata,
        isPinned,
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
      window.electron.ipcRenderer.send(IpcChannel.Tab_Detach, {
        ...tab,
        url: resolveSidebarAppTabEntryUrl(tab)
      })

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
      if (storesPinned(restoredTab)) {
        setPinnedTabs((prev) => [...prev, restoredTab])
      } else {
        setNormalTabs((prev) => [...prev, restoredTab])
      }

      setActiveTabIdState(restoredTab.id)
      logger.info('Tab attached from detached window', { tabId: tabData.id, url: tabData.url })
    },
    [tabs, setActiveTab, setPinnedTabs, storesPinned]
  )

  // Listen for tab attach requests (from Main Process)
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return

    const handleAttachRequest = (_event: any, tabData: Tab) => {
      attachTab(tabData)
    }

    const removeAttachRequest = window.electron.ipcRenderer.on(IpcChannel.Tab_Attach, handleAttachRequest)

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

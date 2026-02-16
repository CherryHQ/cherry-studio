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
  title: getDefaultRouteTitle('/home'),
  lastAccessTime: Date.now(),
  isDormant: false
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
  // Pinned tabs - 持久化存储
  const [pinnedTabs, setPinnedTabsRaw] = usePersistCache('ui.tab.pinned_tabs')

  // 使用 ref 来保持对最新 pinnedTabs 的引用，避免闭包问题
  const pinnedTabsRef = useRef(pinnedTabs)
  pinnedTabsRef.current = pinnedTabs

  // 包装 setter 以支持函数式更新
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

  // Normal tabs - 内存存储（重启后清空），不包含 home tab
  const [normalTabs, setNormalTabs] = useState<Tab[]>([])

  // Active tab ID - 内存存储
  const [activeTabId, setActiveTabIdState] = useState<string>(DEFAULT_TAB.id)

  // LRU 管理器（单例）
  const lruManagerRef = useRef<TabLRUManager | null>(null)
  if (!lruManagerRef.current) {
    lruManagerRef.current = new TabLRUManager()
  }

  // 合并 tabs: home + pinned + normal
  const tabs = useMemo(() => {
    return [DEFAULT_TAB, ...(pinnedTabs || []), ...normalTabs]
  }, [pinnedTabs, normalTabs])

  /**
   * 内部方法：执行休眠检查并休眠超额标签
   * TODO: 暂时注释掉，等待 LRU 策略确定（只针对 normalTabs 还是全体 tabs）
   */
  // const performHibernationCheck = useCallback((currentTabs: Tab[], newActiveTabId: string) => {
  //   const toHibernate = lruManagerRef.current?.checkAndGetDormantCandidates(currentTabs, newActiveTabId) || []

  //   if (toHibernate.length === 0) {
  //     return currentTabs
  //   }

  //   // 批量休眠
  //   return currentTabs.map((tab) => {
  //     if (toHibernate.includes(tab.id)) {
  //       logger.info('Tab hibernated', { tabId: tab.id, route: tab.url })
  //       const savedState: TabSavedState = { scrollPosition: 0 }
  //       return { ...tab, isDormant: true, savedState }
  //     }
  //     return tab
  //   })
  // }, [])

  /**
   * 休眠标签（手动）
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
   * 唤醒标签
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

      // 如果唤醒了休眠标签，记录日志
      if (targetTab.isDormant) {
        logger.info('Tab awakened', { tabId: id, route: targetTab.url })
      }

      // 更新 lastAccessTime 和唤醒状态
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
    },
    [activeTabId, tabs, setPinnedTabs]
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
      }

      setActiveTabIdState(tab.id)
    },
    [tabs, setActiveTab, setPinnedTabs]
  )

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return

      // 计算新的 activeTabId
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

      // 从 normalTabs 移除
      setNormalTabs((prev) => prev.filter((t) => t.id !== id))
      // 添加到 pinnedTabs
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

      // 从 pinnedTabs 移除
      setPinnedTabs((prev) => prev.filter((t) => t.id !== id))
      // 添加到 normalTabs
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

      // Close tab in current window
      // If it's a pinned tab, we unpin it first to remove it from the list
      if (tab.isPinned) {
        setPinnedTabs((prev) => prev.filter((t) => t.id !== tabId))
      }
      setNormalTabs((prev) => prev.filter((t) => t.id !== tabId))

      // If it was the active tab, closeTab logic will handle switching to another tab
      // But since we manually removed it from lists above, we need to handle active tab switch manually if needed
      // Actually, standard closeTab handles both removal and active switch.
      // Let's just use closeTab?
      // closeTab handles pinned/normal distinction.
      // But for pinned tabs, closeTab only removes it if we unpin it first (or if we modify closeTab).
      // Wait, normal closeTab logic:
      /*
      if (tab.isPinned) {
        setPinnedTabs((prev) => prev.filter((t) => t.id !== id))
      } else {
        setNormalTabs((prev) => prev.filter((t) => t.id !== id))
      }
      */
      // So closeTab is sufficient for removal.

      closeTab(tabId)
    },
    [tabs, closeTab, setPinnedTabs] // setPinnedTabs added to deps
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
      if (restoredTab.isPinned) {
        setPinnedTabs((prev) => [...prev, restoredTab])
      } else {
        setNormalTabs((prev) => [...prev, restoredTab])
      }

      setActiveTabIdState(restoredTab.id)
      logger.info('Tab attached from detached window', { tabId: tabData.id, url: tabData.url })
    },
    [tabs, setActiveTab, setPinnedTabs]
  )

  // Listen for tab attach requests (from Main Process)
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return

    const handleAttachRequest = (_event: any, tabData: Tab) => {
      attachTab(tabData)
    }

    return window.electron.ipcRenderer.on(IpcChannel.Tab_Attach, handleAttachRequest)
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

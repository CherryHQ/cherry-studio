import { loggerService } from '@logger'
import { TabLRUManager } from '@renderer/services/TabLRUManager'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { usePersistCache } from '../data/hooks/useCache'
import { uuid } from '../utils'
import { getDefaultRouteTitle } from '../utils/routeTitle'

// Re-export types from shared schema
export type { Tab, TabsState, TabType } from '@shared/data/cache/cacheValueTypes'
import type { Tab, TabSavedState, TabType } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('useTabs')

const DEFAULT_TAB: Tab = {
  id: 'home',
  type: 'route',
  url: '/',
  title: getDefaultRouteTitle('/'),
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

export function useTabs() {
  const [tabsState, setTabsState] = usePersistCache('ui.tab.state')

  // LRU 管理器（单例）
  const lruManagerRef = useRef<TabLRUManager | null>(null)
  if (!lruManagerRef.current) {
    lruManagerRef.current = new TabLRUManager()
  }
  const lruManager = lruManagerRef.current

  // Ensure at least one default tab exists
  useEffect(() => {
    if (tabsState.tabs.length === 0) {
      setTabsState({ tabs: [DEFAULT_TAB], activeTabId: DEFAULT_TAB.id })
    }
  }, [tabsState.tabs.length, setTabsState])

  const tabs = useMemo(() => (tabsState.tabs.length > 0 ? tabsState.tabs : [DEFAULT_TAB]), [tabsState.tabs])
  const activeTabId = tabsState.activeTabId || DEFAULT_TAB.id

  /**
   * 内部方法：执行休眠检查并休眠超额标签
   */
  const performHibernationCheck = useCallback(
    (currentTabs: Tab[], newActiveTabId: string) => {
      const toHibernate = lruManager.checkAndGetDormantCandidates(currentTabs, newActiveTabId)

      if (toHibernate.length === 0) {
        return currentTabs
      }

      // 批量休眠
      return currentTabs.map((tab) => {
        if (toHibernate.includes(tab.id)) {
          logger.info('Tab hibernated', { tabId: tab.id, route: tab.url })
          // TODO: 保存滚动位置等状态
          const savedState: TabSavedState = { scrollPosition: 0 }
          return { ...tab, isDormant: true, savedState }
        }
        return tab
      })
    },
    [lruManager]
  )

  /**
   * 休眠标签（手动）
   *
   * TODO: 目前 savedState 仅为占位符，后续需实现：
   * - 捕获真实滚动位置
   * - 保存必要的草稿/表单状态
   */
  const hibernateTab = useCallback(
    (tabId: string) => {
      const tab = tabsState.tabs.find((t) => t.id === tabId)
      if (!tab || tab.isDormant) return

      // TODO: 实现真实的状态捕获
      const savedState: TabSavedState = { scrollPosition: 0 }

      logger.info('Tab hibernated (manual)', { tabId, route: tab.url })

      setTabsState({
        ...tabsState,
        tabs: tabsState.tabs.map((t) => (t.id === tabId ? { ...t, isDormant: true, savedState } : t))
      })
    },
    [tabsState, setTabsState]
  )

  /**
   * 唤醒标签
   *
   * TODO: 目前仅清除 isDormant 标记，后续需实现：
   * - 从 savedState 恢复滚动位置
   * - 恢复草稿/表单状态
   */
  const wakeTab = useCallback(
    (tabId: string) => {
      const tab = tabsState.tabs.find((t) => t.id === tabId)
      if (!tab || !tab.isDormant) return

      logger.info('Tab awakened', { tabId, route: tab.url })

      // TODO: 实现真实的状态恢复（从 tab.savedState）
      setTabsState({
        ...tabsState,
        tabs: tabsState.tabs.map((t) => (t.id === tabId ? { ...t, isDormant: false, lastAccessTime: Date.now() } : t))
      })
    },
    [tabsState, setTabsState]
  )

  const updateTab = useCallback(
    (id: string, updates: Partial<Tab>) => {
      setTabsState({
        ...tabsState,
        tabs: tabsState.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
      })
    },
    [tabsState, setTabsState]
  )

  const setActiveTab = useCallback(
    (id: string) => {
      if (id === activeTabId) return

      const targetTab = tabs.find((t) => t.id === id)
      if (!targetTab) return

      // 1. 准备更新后的标签列表
      let updatedTabs = tabsState.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              lastAccessTime: Date.now(),
              // 如果目标是休眠状态，唤醒它
              isDormant: false
            }
          : t
      )

      // 2. 如果唤醒了休眠标签，记录日志
      if (targetTab.isDormant) {
        logger.info('Tab awakened', { tabId: id, route: targetTab.url })
      }

      // 3. 执行休眠检查（可能需要休眠其他标签）
      updatedTabs = performHibernationCheck(updatedTabs, id)

      // 4. 更新状态
      setTabsState({ tabs: updatedTabs, activeTabId: id })
    },
    [activeTabId, tabs, tabsState, setTabsState, performHibernationCheck]
  )

  const addTab = useCallback(
    (tab: Tab) => {
      const exists = tabs.find((t) => t.id === tab.id)
      if (exists) {
        setActiveTab(tab.id)
        return
      }

      // 添加 LRU 字段，保留完整 URL（含 search/hash）
      const newTab: Tab = {
        ...tab,
        lastAccessTime: Date.now(),
        isDormant: false
      }

      // 执行休眠检查
      let newTabs = [...tabs, newTab]
      newTabs = performHibernationCheck(newTabs, tab.id)

      setTabsState({ tabs: newTabs, activeTabId: tab.id })
    },
    [tabs, setTabsState, setActiveTab, performHibernationCheck]
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

      // Create new tab with default route title and LRU fields
      const newTab: Tab = {
        id: id || uuid(),
        type,
        url, // full URL including search/hash
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
      updateTab(id, { isPinned: true })
      logger.info('Tab pinned', { tabId: id })
    },
    [updateTab]
  )

  /**
   * Unpin a tab
   */
  const unpinTab = useCallback(
    (id: string) => {
      updateTab(id, { isPinned: false })
      logger.info('Tab unpinned', { tabId: id })
    },
    [updateTab]
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
    openTab,

    // LRU operations
    hibernateTab,
    wakeTab,
    pinTab,
    unpinTab
  }
}

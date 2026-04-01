import { useCallback, useMemo, useState } from 'react'

import type { SidebarMenuItem, SidebarTab } from './types'

interface CreateMiniAppInput {
  id: string
  name: string
  color: string
  initial: string
  url: string
  logoUrl?: string
}

interface UseSidebarTabsOptions {
  initialTabs?: SidebarTab[]
  initialActiveTabId?: string
  multiInstanceItemIds?: string[]
}

export function useSidebarTabs(menuItems: SidebarMenuItem[], options: UseSidebarTabsOptions = {}) {
  const [tabs, setTabs] = useState<SidebarTab[]>(options.initialTabs ?? [])
  const [activeTabId, setActiveTabId] = useState(options.initialActiveTabId ?? '')
  const multiInstanceItemIds = options.multiInstanceItemIds ?? []

  const createTabForMenuItem = useCallback(
    (menuItemId: string) => {
      const menuItem = menuItems.find((item) => item.id === menuItemId)
      if (!menuItem) return

      const newId = `sidebar-tab-${Date.now()}`
      const nextTab: SidebarTab = {
        id: newId,
        title: menuItem.label,
        icon: menuItem.icon,
        closeable: true,
        menuItemId
      }

      setTabs((prev) => [...prev, nextTab])
      setActiveTabId(newId)
    },
    [menuItems]
  )

  const activateMenuItem = useCallback(
    (menuItemId: string) => {
      const existing = tabs.find((tab) => tab.menuItemId === menuItemId && !tab.sidebarDocked)

      if (existing && !multiInstanceItemIds.includes(menuItemId)) {
        setActiveTabId(existing.id)
        return
      }

      createTabForMenuItem(menuItemId)
    },
    [createTabForMenuItem, multiInstanceItemIds, tabs]
  )

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const nextTabs = prev.filter((tab) => tab.id !== tabId)

        if (activeTabId === tabId) {
          const fallbackTab = nextTabs[nextTabs.length - 1]
          setActiveTabId(fallbackTab ? fallbackTab.id : '')
        }

        return nextTabs
      })
    },
    [activeTabId]
  )

  const dockToSidebar = useCallback((tabId: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, sidebarDocked: true, pinned: false } : tab)))
  }, [])

  const undockFromSidebar = useCallback((tabId: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, sidebarDocked: false } : tab)))
  }, [])

  const openMiniApp = useCallback(
    (app: CreateMiniAppInput) => {
      const existing = tabs.find((tab) => tab.miniAppId === app.id)
      if (existing) {
        setActiveTabId(existing.id)
        return
      }

      const nextTab: SidebarTab = {
        id: `mini-app-${Date.now()}`,
        title: app.name,
        icon: menuItems.find((item) => item.id === 'miniapp')?.icon ?? menuItems[0]?.icon,
        closeable: true,
        miniAppId: app.id,
        miniAppColor: app.color,
        miniAppInitial: app.initial,
        miniAppUrl: app.url,
        miniAppLogoUrl: app.logoUrl
      }

      if (!nextTab.icon) return

      setTabs((prev) => [...prev, nextTab])
      setActiveTabId(nextTab.id)
    },
    [menuItems, tabs]
  )

  const dockedTabs = useMemo(() => tabs.filter((tab) => tab.sidebarDocked), [tabs])

  const activeMiniAppTabs = useMemo(() => tabs.filter((tab) => tab.miniAppId && !tab.sidebarDocked), [tabs])

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    createTabForMenuItem,
    activateMenuItem,
    closeTab,
    dockToSidebar,
    undockFromSidebar,
    openMiniApp,
    dockedTabs,
    activeMiniAppTabs
  }
}

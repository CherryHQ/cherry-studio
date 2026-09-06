import { useCache } from '@data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { TabsContext, useTabs } from '@renderer/hooks/tab'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import { ipcApi } from '@renderer/ipc'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import { isMac } from '@renderer/utils/platform'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import { isSettingsPath } from '@shared/data/types/settingsPath'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import Sidebar from '../app/Sidebar'
import { createRecentRouteEntryFromTab, recordGlobalSearchRecentEntry } from '../GlobalSearch/globalSearchGroups'
import GlobalSearchPopup from '../GlobalSearch/GlobalSearchPopup'
import MiniAppTabsPool from '../MiniApp/MiniAppTabsPool'
import { ResourceViewSourceProvider } from '../ResourceViewSourceProvider'
import { AppShellTabBar } from './AppShellTabBar'
import { TabRouter } from './TabRouter'

// Routes whose pages stay usable below the global minimum window width.
const isCompactMinWidthRoute = (url?: string): boolean =>
  !!url && (url.startsWith('/app/chat') || url.startsWith('/app/agents'))

export const AppShell = () => {
  const isMacTransparentWindow = useMacTransparentWindow()
  const tabsApi = useTabs()
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    closeTabs,
    updateTab,
    reorderTabs,
    pinTab,
    unpinTab,
    detachTab,
    openTab
  } = tabsApi
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])
  const canCycleTabs = tabs.length > 1 && !!activeTab
  const isSettingsTabActive = isSettingsPath(activeTab?.url)
  const previousWorkspaceTabIdRef = useRef<string | undefined>(undefined)
  if (activeTab && !isSettingsTabActive) {
    previousWorkspaceTabIdRef.current = activeTab.id
  } else if (isSettingsTabActive && !previousWorkspaceTabIdRef.current) {
    previousWorkspaceTabIdRef.current = tabs.reduce<(typeof tabs)[number] | undefined>((latest, tab) => {
      if (isSettingsPath(tab.url)) return latest
      return !latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest
    }, undefined)?.id
  }
  const tabBarTabs = useMemo(
    () => (isSettingsTabActive && activeTab ? [activeTab] : tabs),
    [activeTab, isSettingsTabActive, tabs]
  )
  const isFullscreen = useNativeFullscreen()
  const [splitOpen, setSplitOpen] = useCache('mini_app.split_open')
  const [splitMiniAppId, setSplitMiniAppId] = useCache('mini_app.split_id')
  const { currentMiniAppId, openedOneOffMiniApp, setOpenedKeepAliveMiniApps, setCurrentMiniAppId, setMiniAppShow } =
    useMiniApps()

  // Split state is window-wide and does not follow the last mini-app tab out, so
  // the next mini app would open into a stale split with its app still pooled.
  // Single source of truth for split lifetime vs. tab lifetime — used by
  // single close, bulk close, and detach so policy cannot drift.
  const takeClearingSplitId = useCallback(
    (closedIds: readonly string[]): string | undefined => {
      if (!splitOpen || !splitMiniAppId) return undefined
      let closingMiniAppFound = false
      for (const id of closedIds) {
        const tab = tabs.find((t) => t.id === id)
        if (miniAppIdFromTabUrl(tab?.url)) {
          closingMiniAppFound = true
          break
        }
      }
      if (!closingMiniAppFound) return undefined
      const hasSurvivingMiniAppTab = tabs.some((t) => !closedIds.includes(t.id) && miniAppIdFromTabUrl(t.url) !== null)
      if (hasSurvivingMiniAppTab) return undefined
      const id = splitMiniAppId
      setSplitOpen(false)
      setSplitMiniAppId('')
      return id
    },
    [tabs, splitOpen, splitMiniAppId, setSplitOpen, setSplitMiniAppId]
  )

  const evictMiniAppsForClosedTabs = useCallback(
    (closedIds: readonly string[], clearingSplitId?: string) => {
      const closedIdSet = new Set(closedIds)
      // Collect mini app ids whose tabs are being closed
      const closingMiniAppIds = new Set<string>()
      for (const id of closedIds) {
        const tab = tabs.find((t) => t.id === id)
        const appId = miniAppIdFromTabUrl(tab?.url)
        if (appId) closingMiniAppIds.add(appId)
      }
      if (clearingSplitId) closingMiniAppIds.add(clearingSplitId)
      if (closingMiniAppIds.size === 0) return
      // Check which of those ids still have a surviving tab after the close,
      // or are still shown in the split pane (splitPooledIds has no expiry).
      const survivingMiniAppIds = new Set<string>()
      for (const tab of tabs) {
        if (closedIdSet.has(tab.id)) continue
        const appId = miniAppIdFromTabUrl(tab.url)
        if (appId) survivingMiniAppIds.add(appId)
      }
      if (splitOpen && splitMiniAppId && splitMiniAppId !== clearingSplitId) {
        survivingMiniAppIds.add(splitMiniAppId)
      }
      const orphanedIds = [...closingMiniAppIds].filter((id) => !survivingMiniAppIds.has(id))
      if (orphanedIds.length === 0) return
      const orphanedSet = new Set(orphanedIds)
      setOpenedKeepAliveMiniApps((prev) => prev.filter((app) => !orphanedSet.has(app.appId)))
      for (const appId of orphanedIds) clearWebviewState(appId)
      // If the current mini app was among the orphaned, clear its global show state
      if (currentMiniAppId && orphanedSet.has(currentMiniAppId) && openedOneOffMiniApp?.appId !== currentMiniAppId) {
        setCurrentMiniAppId('')
        setMiniAppShow(false)
      }
    },
    [
      tabs,
      splitOpen,
      splitMiniAppId,
      currentMiniAppId,
      openedOneOffMiniApp,
      setOpenedKeepAliveMiniApps,
      setCurrentMiniAppId,
      setMiniAppShow
    ]
  )

  const handleCloseTab = useCallback(
    (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id)
      if (isSettingsPath(tab?.url)) {
        closeTabs([id], previousWorkspaceTabIdRef.current)
        return
      }
      const clearingSplitId = takeClearingSplitId([id])
      evictMiniAppsForClosedTabs([id], clearingSplitId)
      closeTab(id)
    },
    [closeTab, closeTabs, evictMiniAppsForClosedTabs, tabs, takeClearingSplitId]
  )

  const handleCloseTabs = useCallback(
    (ids: readonly string[], activateId?: string) => {
      // Capture the split id before the async cache write so eviction can
      // include the split-only app (no tab) and not protect the stale id.
      const clearingSplitId = takeClearingSplitId(ids)
      evictMiniAppsForClosedTabs(ids, clearingSplitId)
      closeTabs(ids, activateId)
    },
    [closeTabs, evictMiniAppsForClosedTabs, takeClearingSplitId]
  )

  const handleDetachTab = useCallback(
    (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id)
      const clearingSplitId = takeClearingSplitId([id])
      evictMiniAppsForClosedTabs([id], clearingSplitId)
      detachTab(id)
      if (isSettingsPath(tab?.url) && previousWorkspaceTabIdRef.current) {
        setActiveTab(previousWorkspaceTabIdRef.current)
      }
    },
    [detachTab, evictMiniAppsForClosedTabs, setActiveTab, tabs, takeClearingSplitId]
  )

  const handleOpenGlobalSearch = useCallback(() => {
    if (isSettingsTabActive) return
    void GlobalSearchPopup.show()
  }, [isSettingsTabActive])

  // Pinned tabs join the same flat cycle, matching Chrome / VS Code Ctrl+Tab.
  const cycleTab = useCallback(
    (direction: 'next' | 'prev') => {
      if (tabs.length <= 1) return
      const currentIndex = tabs.findIndex((t) => t.id === activeTabId)
      if (currentIndex === -1) return

      const offset = direction === 'next' ? 1 : -1
      const nextIndex = (currentIndex + offset + tabs.length) % tabs.length
      setActiveTab(tabs[nextIndex].id)
    },
    [tabs, activeTabId, setActiveTab]
  )

  useCommandHandler('app.search', handleOpenGlobalSearch)
  useCommandHandler('tab.next', () => cycleTab('next'), { enabled: canCycleTabs })
  useCommandHandler('tab.prev', () => cycleTab('prev'), { enabled: canCycleTabs })

  useEffect(() => {
    if (isSettingsTabActive) {
      GlobalSearchPopup.hide()
    }
  }, [isSettingsTabActive])

  // The compact minimum tracks the active tab's route here, at window level.
  // It must not live in the pages themselves: they sit inside <Activity>, whose
  // hide/show re-runs mount effects, so a per-page []-dep effect re-issues this
  // IPC pair on every tab switch.
  const activeTabAllowsCompactWidth = isCompactMinWidthRoute(activeTab?.url)
  useEffect(() => {
    if (!activeTabAllowsCompactWidth) return
    void ipcApi.request('window.main.set_minimum_size', { width: SECOND_MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT })
    return () => {
      void ipcApi.request('window.main.reset_minimum_size')
    }
  }, [activeTabAllowsCompactWidth])

  const recordRouteVisit = useCallback((tab: typeof activeTab, lastAccessTime = tab?.lastAccessTime) => {
    if (!tab) return

    const entry = createRecentRouteEntryFromTab(tab, lastAccessTime)
    if (!entry) return

    recordGlobalSearchRecentEntry(entry)
  }, [])

  useEffect(() => {
    recordRouteVisit(activeTab)
  }, [activeTab, recordRouteVisit])

  // Sync internal navigation back to tab state. For route-titled tabs we also
  // refresh the title and clear the per-entity icon (it was supplied for a
  // specific URL, e.g. a mini-app logo on /app/mini-app/<id>, and no longer
  // applies once the user navigates elsewhere inside the tab). Chat / agent
  // tabs are page-titled — their HomePage/AgentPage owns title + icon (topic /
  // session name + assistant / agent emoji), so we only sync the url and leave
  // title/icon alone, or navigating between topics would wipe them.
  const handleUrlChange = (tabId: string, url: string) => {
    const isPageTitled = isPageTitledRoute(url)
    const tab = tabs.find((candidate) => candidate.id === tabId)
    const patch = isPageTitled
      ? { url, lastAccessTime: Date.now() }
      : {
          url,
          title: getDefaultRouteTitle(url),
          icon: undefined,
          lastAccessTime: Date.now(),
          metadata: undefined
        }
    updateTab(tabId, patch)

    if (tab) {
      recordRouteVisit({ ...tab, ...patch }, Date.now())
    }
  }

  const tabBar = (
    <AppShellTabBar
      tabs={tabBarTabs}
      activeTabId={activeTabId}
      isFullscreen={isFullscreen}
      isFocusedTab={isSettingsTabActive}
      setActiveTab={setActiveTab}
      closeTab={handleCloseTab}
      closeTabs={handleCloseTabs}
      reorderTabs={reorderTabs}
      pinTab={pinTab}
      unpinTab={unpinTab}
      detachTab={handleDetachTab}
      openTab={openTab}
    />
  )

  // Expose an eviction-aware close through TabsContext so in-page surfaces
  // (MiniAppPage toolbar) benefit from the same cleanup as the tab bar.
  const tabsContextValue = useMemo(
    () => ({
      ...tabsApi,
      closeTab: handleCloseTab,
      closeTabs: handleCloseTabs
    }),
    [tabsApi, handleCloseTab, handleCloseTabs]
  )

  const contentArea = (
    <TabsContext value={tabsContextValue}>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col pb-2', isSettingsTabActive ? 'px-2' : 'pr-2')}>
        <main
          data-ui="app.content"
          className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border-[0.5px] border-border bg-background">
          {/* Route Tabs: Only render non-dormant tabs */}
          <ResourceViewSourceProvider>
            {tabs
              .filter((t) => t.type === 'route' && !t.isDormant)
              .map((tab) => (
                <TabRouter
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onUrlChange={(url) => handleUrlChange(tab.id, url)}
                />
              ))}
          </ResourceViewSourceProvider>

          {/* MiniApp keep-alive WebView pool — global, shared across modes */}
          <MiniAppTabsPool />
        </main>
      </div>
    </TabsContext>
  )

  const contentColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {tabBar}
      {contentArea}
    </div>
  )

  if (!isMac) {
    return (
      <div
        className={cn(
          'flex h-screen w-screen flex-row overflow-hidden text-foreground',
          isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
        )}>
        {!isSettingsTabActive && <Sidebar />}
        {contentColumn}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-screen w-screen flex-row overflow-hidden text-foreground',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      {!isFullscreen && (
        <div
          aria-hidden="true"
          data-testid="macos-traffic-light-drag-region"
          className="pointer-events-none absolute top-0 left-0 h-11 w-[env(titlebar-area-x)] [-webkit-app-region:drag]"
        />
      )}
      {!isSettingsTabActive && (
        <div className="flex h-full min-h-0 shrink-0 flex-col [&>#app-sidebar]:min-h-0 [&>#app-sidebar]:flex-1">
          {!isFullscreen && (
            <div
              aria-hidden="true"
              data-testid="macos-traffic-light-spacer"
              className="h-11 shrink-0 [-webkit-app-region:drag]"
            />
          )}
          <Sidebar />
        </div>
      )}
      {contentColumn}
    </div>
  )
}

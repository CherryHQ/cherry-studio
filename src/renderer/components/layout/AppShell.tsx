import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react'

import { useCache } from '@data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { useTabs } from '@renderer/hooks/tab'
import { useLeadingWindowControlsOverlay } from '@renderer/hooks/useLeadingWindowControlsOverlay'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import { ipcApi } from '@renderer/ipc'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import { getTabWorkspaceKey, getWorkspaceKeyForUrl } from '@renderer/utils/navigationWorkspace'
import { isMac } from '@renderer/utils/platform'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { isSettingsPath } from '@shared/data/types/settingsPath'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'

import Sidebar from '../app/Sidebar'
import { createRecentRouteEntryFromTab, recordGlobalSearchRecentEntry } from '../GlobalSearch/globalSearchGroups'
import GlobalSearchPopup from '../GlobalSearch/GlobalSearchPopup'
import MiniAppTabsPool from '../MiniApp/MiniAppTabsPool'
import { ResourceViewSourceProvider } from '../ResourceViewSourceProvider'
import { AppShellTabBar } from './AppShellTabBar'
import { AppShellTitleBar } from './AppShellTitleBar'
import { TabRouter } from './TabRouter'
import { TabTaskDormancyRuntime } from './TabTaskDormancyRuntime'

// Routes whose pages stay usable below the global minimum window width.
const isCompactMinWidthRoute = (url?: string): boolean =>
  !!url && (url.startsWith('/app/chat') || url.startsWith('/app/agents'))

export const AppShell = () => {
  const isMacTransparentWindow = useMacTransparentWindow()
  const tabsApi = useTabs()
  const {
    tabs,
    tabBarTabs,
    activeTabId,
    setActiveTab,
    closeTab,
    closeTabs,
    updateTab,
    reorderTabs,
    pinTab,
    unpinTab,
    detachTab,
    openTab,
    navigationLayout,
    closeFocusedRoute
  } = tabsApi
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])
  const canCloseTab = !!activeTab
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
  const isFocusedTabActive =
    navigationLayout === 'both' ? isSettingsTabActive : !!activeTab && !getTabWorkspaceKey(activeTab)
  const showsTabBar = navigationLayout !== 'sidebar'
  const showsSidebar = navigationLayout === 'sidebar' || (navigationLayout === 'both' && !isFocusedTabActive)
  const visibleTabBarTabs = useMemo(
    () => (isFocusedTabActive && activeTab ? [activeTab] : tabBarTabs),
    [activeTab, isFocusedTabActive, tabBarTabs]
  )
  const canCycleTabs = visibleTabBarTabs.length > 1 && visibleTabBarTabs.some((tab) => tab.id === activeTabId)
  const isFullscreen = useNativeFullscreen()
  const [split, setSplit] = useCache('mini_app.split')
  const hasMiniAppTab = tabs.some((tab) => miniAppIdFromTabUrl(tab.url) !== null)
  const hadMiniAppTabRef = useRef(hasMiniAppTab)

  // Split state is window-wide and does not follow the last mini-app tab out, so
  // the next mini app would open into a stale split with its app still pooled.
  const clearSplitWithLastMiniAppTab = useCallback(
    (id: string, url: string | undefined) => {
      if (!split || !miniAppIdFromTabUrl(url)) return
      const hasOtherMiniAppTab = tabs.some(
        (candidate) => candidate.id !== id && miniAppIdFromTabUrl(candidate.url) !== null
      )
      if (hasOtherMiniAppTab) return
      setSplit(null)
    },
    [setSplit, split, tabs]
  )

  useEffect(() => {
    const hadMiniAppTab = hadMiniAppTabRef.current
    hadMiniAppTabRef.current = hasMiniAppTab
    if (!split || hasMiniAppTab || !hadMiniAppTab) return
    setSplit(null)
  }, [hasMiniAppTab, setSplit, split])

  const hasLeadingWindowControls = useLeadingWindowControlsOverlay()
  const handleCloseTab = useCallback(
    (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id)
      if (navigationLayout === 'both' && isSettingsPath(tab?.url)) {
        closeTabs([id], previousWorkspaceTabIdRef.current)
        return
      }
      if (navigationLayout !== 'both' && tab && !getTabWorkspaceKey(tab)) {
        closeFocusedRoute()
        return
      }
      clearSplitWithLastMiniAppTab(id, tab?.url)
      closeTab(id)
    },
    [clearSplitWithLastMiniAppTab, closeFocusedRoute, closeTab, closeTabs, navigationLayout, tabs]
  )

  const handleDetachTab = useCallback(
    (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id)
      const returnWorkspaceId =
        typeof tab?.metadata?.returnWorkspaceId === 'string' ? tab.metadata.returnWorkspaceId : undefined
      const fallbackId =
        navigationLayout === 'both' && isSettingsPath(tab?.url)
          ? previousWorkspaceTabIdRef.current
          : tab && !getTabWorkspaceKey(tab)
            ? returnWorkspaceId
            : undefined
      clearSplitWithLastMiniAppTab(id, tab?.url)
      detachTab(id, fallbackId)
    },
    [clearSplitWithLastMiniAppTab, detachTab, navigationLayout, tabs]
  )

  const handleOpenGlobalSearch = useCallback(() => {
    if (navigationLayout === 'both' && isSettingsTabActive) return
    void GlobalSearchPopup.show()
  }, [isSettingsTabActive, navigationLayout])

  // Pinned tabs join the same flat cycle, matching Chrome / VS Code Ctrl+Tab.
  const cycleTab = useCallback(
    (direction: 'next' | 'prev') => {
      if (visibleTabBarTabs.length <= 1) return
      const currentIndex = visibleTabBarTabs.findIndex((t) => t.id === activeTabId)
      if (currentIndex === -1) return

      const offset = direction === 'next' ? 1 : -1
      const nextIndex = (currentIndex + offset + visibleTabBarTabs.length) % visibleTabBarTabs.length
      setActiveTab(visibleTabBarTabs[nextIndex].id)
    },
    [visibleTabBarTabs, activeTabId, setActiveTab]
  )

  const handleCloseActiveTab = useCallback(() => {
    if (!activeTabId) return
    handleCloseTab(activeTabId)
  }, [activeTabId, handleCloseTab])

  useCommandHandler('app.search', handleOpenGlobalSearch)
  useCommandHandler('tab.close', handleCloseActiveTab, { enabled: canCloseTab })
  useCommandHandler('tab.next', () => cycleTab('next'), { enabled: canCycleTabs })
  useCommandHandler('tab.prev', () => cycleTab('prev'), { enabled: canCycleTabs })

  useEffect(() => {
    if (navigationLayout === 'both' && isSettingsTabActive) GlobalSearchPopup.hide()
  }, [isSettingsTabActive, navigationLayout])

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

  // Chat / agent tabs are page-titled (topic / session name + emoji), so navigation keeps them.
  const handleUrlChange = (tabId: string, url: string) => {
    const isPageTitled = isPageTitledRoute(url)
    const tab = tabs.find((candidate) => candidate.id === tabId)
    const workspaceKey = getWorkspaceKeyForUrl(url)
    const patch = isPageTitled
      ? { url, workspaceKey, lastAccessTime: Date.now() }
      : {
          url,
          title: getDefaultRouteTitle(url),
          icon: undefined,
          workspaceKey,
          lastAccessTime: Date.now(),
          metadata: workspaceKey ? undefined : tab?.metadata
        }
    updateTab(tabId, patch)

    if (tab) {
      recordRouteVisit({ ...tab, ...patch }, Date.now())
    }
  }

  const tabBar = (
    <AppShellTabBar
      tabs={visibleTabBarTabs}
      activeTabId={activeTabId}
      isFullscreen={isFullscreen}
      isFocusedTab={isFocusedTabActive}
      legacyCombinedLayout={navigationLayout === 'both'}
      setActiveTab={setActiveTab}
      closeTab={handleCloseTab}
      closeTabs={closeTabs}
      reorderTabs={reorderTabs}
      pinTab={pinTab}
      unpinTab={unpinTab}
      detachTab={handleDetachTab}
      openTab={openTab}
    />
  )

  const titleBar = (
    <AppShellTitleBar
      activeTab={activeTab}
      isFocused={isFocusedTabActive}
      isFullscreen={isFullscreen}
      onBack={closeFocusedRoute}
    />
  )

  const contentArea = (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col pb-1.5', showsSidebar ? 'pr-1.5' : 'px-1.5')}>
      <main
        data-ui="app.content"
        className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border-[0.5px] border-border bg-background">
        {/* Route Tabs: Only render non-dormant tabs */}
        <ResourceViewSourceProvider>
          {tabs
            .filter((t) => t.type === 'route' && !t.isDormant)
            .map((tab) => (
              <Fragment key={tab.id}>
                {navigationLayout !== 'sidebar' && <TabTaskDormancyRuntime tab={tab} updateTab={updateTab} />}
                <TabRouter
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onUrlChange={(url) => handleUrlChange(tab.id, url)}
                />
              </Fragment>
            ))}
        </ResourceViewSourceProvider>

        {/* MiniApp keep-alive WebView pool — global, shared across modes */}
        <MiniAppTabsPool />
      </main>
    </div>
  )

  const contentColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {showsTabBar ? tabBar : titleBar}
      {contentArea}
    </div>
  )

  // Leading Linux WCO controls take the top-left corner like macOS traffic lights do.
  if (!isMac && !hasLeadingWindowControls) {
    return (
      <div
        className={cn(
          'flex h-screen w-screen flex-row overflow-hidden text-foreground',
          isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
        )}>
        {showsSidebar && <Sidebar isFullscreen={isFullscreen} />}
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
      {showsSidebar && (
        <div className="flex h-full min-h-0 shrink-0 flex-col [&>#app-sidebar]:min-h-0 [&>#app-sidebar]:flex-1">
          {!isFullscreen && (
            <div
              aria-hidden="true"
              data-testid="macos-traffic-light-spacer"
              className="h-11 shrink-0 [-webkit-app-region:drag]"
            />
          )}
          <Sidebar isFullscreen={isFullscreen} />
        </div>
      )}
      {contentColumn}
    </div>
  )
}

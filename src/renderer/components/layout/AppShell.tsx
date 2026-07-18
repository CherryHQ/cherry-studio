import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import { useMainWindowNavigation, useTabs } from '@renderer/hooks/tab'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { isMac } from '@renderer/utils/platform'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { clearTabInstanceMetadata } from '@renderer/utils/tabInstanceMetadata'
import { useCallback, useEffect, useMemo, useState } from 'react'

import Sidebar from '../app/Sidebar'
import { createRecentRouteEntryFromTab, upsertGlobalSearchRecentEntry } from '../GlobalSearch/globalSearchGroups'
import GlobalSearchPopup from '../GlobalSearch/GlobalSearchPopup'
import MiniAppTabsPool from '../MiniApp/MiniAppTabsPool'
import { AppShellTabBar } from './AppShellTabBar'
import { TabRouter } from './TabRouter'

export const AppShell = () => {
  const isMacTransparentWindow = useMacTransparentWindow()
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
  } = useTabs()
  const [, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])
  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleOpenGlobalSearch = useCallback(() => {
    void GlobalSearchPopup.show()
  }, [])

  useCommandHandler('app.search', handleOpenGlobalSearch)
  useMainWindowNavigation()

  useEffect(() => {
    if (!isMac) return

    let cancelled = false
    void ipcApi
      .request('window.is_full_screen')
      .then((value) => {
        if (!cancelled) {
          setIsFullscreen(value)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useIpcOn('window.fullscreen_changed', (value) => {
    if (isMac) {
      setIsFullscreen(value)
    }
  })

  const recordRouteVisit = useCallback(
    (tab: typeof activeTab, lastAccessTime = tab?.lastAccessTime) => {
      if (!tab) return

      const entry = createRecentRouteEntryFromTab(tab, lastAccessTime)
      if (!entry) return

      // Functional update resolves against the latest persisted value; upsert
      // returns the same reference when nothing changes, so the CacheService
      // isEqual short-circuit drops the no-op write.
      setRecentItems((prev) => upsertGlobalSearchRecentEntry(prev, entry))
    },
    [setRecentItems]
  )

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
          metadata: clearTabInstanceMetadata(tab?.metadata)
        }
    updateTab(tabId, patch)

    if (tab) {
      recordRouteVisit({ ...tab, ...patch }, Date.now())
    }
  }

  const tabBar = (
    <AppShellTabBar
      tabs={tabs}
      activeTabId={activeTabId}
      isFullscreen={isFullscreen}
      setActiveTab={setActiveTab}
      closeTab={closeTab}
      closeTabs={closeTabs}
      reorderTabs={reorderTabs}
      pinTab={pinTab}
      unpinTab={unpinTab}
      detachTab={detachTab}
      openTab={openTab}
    />
  )

  const contentArea = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col pr-2 pb-2">
      <main className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border-[0.5px] border-border bg-background">
        {/* Route Tabs: Only render non-dormant tabs */}
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

        {/* MiniApp keep-alive WebView pool — global, shared across modes */}
        <MiniAppTabsPool />
      </main>
    </div>
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
        <Sidebar />
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
      {contentColumn}
    </div>
  )
}

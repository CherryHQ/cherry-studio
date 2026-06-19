import '@renderer/databases'

import { clearTabInstanceMetadata } from '@renderer/config/tabInstanceMetadata'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCommandHandler } from '@renderer/hooks/command'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { useTabs } from '@renderer/hooks/useTabs'
import { cn } from '@renderer/utils'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import { useCallback, useEffect, useMemo } from 'react'

import Sidebar from '../app/Sidebar'
import { createRecentRouteEntryFromTab, upsertGlobalSearchRecentEntry } from '../GlobalSearch/globalSearchGroups'
import MiniAppTabsPool from '../MiniApp/MiniAppTabsPool'
import SearchPopup from '../Popups/SearchPopup'
import { AppShellTabBar } from './AppShellTabBar'
import { TabRouter } from './TabRouter'

export const AppShell = () => {
  const isMacTransparentWindow = useMacTransparentWindow()
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, reorderTabs, pinTab, unpinTab, detachTab, openTab } =
    useTabs()
  const [recentItems, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])

  const handleOpenGlobalSearch = useCallback(() => {
    void SearchPopup.show()
  }, [])

  useCommandHandler('app.search', handleOpenGlobalSearch)

  const recordRouteVisit = useCallback(
    (tab: typeof activeTab, lastAccessTime = tab?.lastAccessTime) => {
      if (!tab) return

      const entry = createRecentRouteEntryFromTab(tab, lastAccessTime)
      if (!entry) return

      const nextItems = upsertGlobalSearchRecentEntry(recentItems, entry)
      if (nextItems !== recentItems) {
        setRecentItems(nextItems)
      }
    },
    [recentItems, setRecentItems]
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

  return (
    <div
      className={cn(
        'flex h-screen w-screen flex-col overflow-hidden text-foreground',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      {/* Zone 1: Tab Bar (spans full width) */}
      <AppShellTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        setActiveTab={setActiveTab}
        closeTab={closeTab}
        reorderTabs={reorderTabs}
        pinTab={pinTab}
        unpinTab={unpinTab}
        detachTab={detachTab}
        openTab={openTab}
      />

      {/* Zone 2: Main Area (Sidebar + Content) */}
      <div className="flex h-full min-h-0 w-full flex-1 flex-row overflow-hidden">
        {/* Zone 2a: Sidebar */}
        <Sidebar />

        {/* Zone 2b: Content Area - Multi MemoryRouter Architecture */}
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
      </div>
    </div>
  )
}

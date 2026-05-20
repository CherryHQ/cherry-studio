import '@renderer/databases'

import { usePersistCache } from '@renderer/data/hooks/useCache'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { useCallback, useEffect, useMemo } from 'react'

import { useTabs } from '../../hooks/useTabs'
import Sidebar from '../app/Sidebar'
import { createRecentRouteEntryFromTab, upsertGlobalSearchRecentEntry } from '../global-search/globalSearchGroups'
import MiniAppTabsPool from '../MiniApp/MiniAppTabsPool'
import { AppShellTabBar } from './AppShellTabBar'
import { TabRouter } from './TabRouter'

export const AppShell = () => {
  const isMacTransparentWindow = useMacTransparentWindow()
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, reorderTabs, pinTab, unpinTab } = useTabs()
  const [recentItems, setRecentItems] = usePersistCache('ui.global_search.recent_items')
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])

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

  // Sync internal navigation back to tab state. Clear the per-entity icon
  // override too — it was supplied for a specific URL (e.g. a mini-app's
  // logo on /app/mini-app/<id>) and no longer applies once the user
  // navigates elsewhere inside the same tab.
  const handleUrlChange = (tabId: string, url: string) => {
    const title = getDefaultRouteTitle(url)
    updateTab(tabId, { url, title, icon: undefined, lastAccessTime: Date.now() })

    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (tab) {
      recordRouteVisit({ ...tab, url, title, icon: undefined }, Date.now())
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
      />

      {/* Zone 2: Main Area (Sidebar + Content) */}
      <div className="flex h-full w-full flex-1 flex-row overflow-hidden">
        {/* Zone 2a: Sidebar */}
        <Sidebar />

        {/* Zone 2b: Content Area - Multi MemoryRouter Architecture */}
        <div className="flex min-w-0 flex-1 flex-col pr-2 pb-2">
          <main className="relative flex-1 overflow-hidden rounded-[16px] bg-background">
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

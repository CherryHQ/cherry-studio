import '@renderer/databases'

import { useWindowInitData } from '@renderer/core/hooks/useWindowInitData'
import { useTabs } from '@renderer/hooks/useTabs'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SubWindowInitData } from '@shared/types/subWindow'
import { Activity, useEffect, useRef } from 'react'

import { AppShellTabBar } from '../../components/layout/AppShellTabBar'
import { TabRouter } from '../../components/layout/TabRouter'

// Mock Webview component (TODO: Replace with actual MinApp/Webview)
const WebviewContainer = ({ url, isActive }: { url: string; isActive: boolean }) => (
  <Activity mode={isActive ? 'visible' : 'hidden'}>
    <div className="flex h-full w-full flex-col items-center justify-center bg-background">
      <div className="mb-2 font-bold text-lg">Webview App</div>
      <code className="rounded bg-muted p-2">{url}</code>
    </div>
  </Activity>
)

export const SubWindowAppShell = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, addTab, reorderTabs, openTab, pinTab, unpinTab } =
    useTabs()
  const initialized = useRef(false)
  const init = useWindowInitData<SubWindowInitData>()

  // Initialize tab from WindowManager init data (delivered via useWindowInitData).
  // First render returns `init === null`; the effect re-runs after one IPC round-trip
  // when the payload arrives. The `initialized` ref still guards against re-entry.
  useEffect(() => {
    if (!init || initialized.current) return
    initialized.current = true

    if (init.isPinned) {
      // Pinned Tab is already loaded via usePersistCache across windows; just activate.
      setActiveTab(init.tabId)
    } else {
      openTab(init.url, {
        id: init.tabId,
        title: init.title,
        type: init.type || 'route',
        forceNew: true
      })
    }
  }, [init, openTab, setActiveTab])

  // Close tab in sub window. closeTab handles both pinned and normal tabs correctly.
  // Do NOT call unpinTab before closeTab — unpinTab moves the tab to normalTabs,
  // then closeTab's closure still sees isPinned=true and filters the wrong list.
  const handleCloseTab = (id: string) => {
    closeTab(id)

    // tabs is the pre-update snapshot (React state updates are async).
    // Compute remaining count excluding both the closed tab and the always-present home tab.
    const remainingUserTabs = tabs.filter((t) => t.id !== id && t.id !== 'home')
    if (remainingUserTabs.length === 0) {
      window.close()
    }
  }

  // Sync internal navigation back to tab state with default title
  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url, title: getDefaultRouteTitle(url) })
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Zone 1: Tab Bar (Full width, no sidebar gap) */}
      <AppShellTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        setActiveTab={setActiveTab}
        closeTab={handleCloseTab}
        addTab={addTab}
        reorderTabs={reorderTabs}
        pinTab={pinTab}
        unpinTab={unpinTab}
        isDetached={true}
      />

      {/* Zone 2: Content Area - Multi MemoryRouter Architecture */}
      <main className="relative flex-1 overflow-hidden bg-background">
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

        {/* Webview Tabs: Only render non-dormant tabs */}
        {tabs
          .filter((t) => t.type === 'webview' && !t.isDormant)
          .map((tab) => (
            <WebviewContainer key={tab.id} url={tab.url} isActive={tab.id === activeTabId} />
          ))}
      </main>
    </div>
  )
}

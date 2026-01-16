import '@renderer/databases'

import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { Activity } from 'react'

import { useTabs } from '../../hooks/useTabs'
import Sidebar from '../app/Sidebar'
import { AppShellTabBar } from './AppShellTabBar'
import { TabRouter } from './TabRouter'

// Mock Webview component (TODO: Replace with actual MinApp/Webview)
const WebviewContainer = ({ url, isActive }: { url: string; isActive: boolean }) => (
  <Activity mode={isActive ? 'visible' : 'hidden'}>
    <div className="flex h-full w-full flex-col items-center justify-center bg-background">
      <div className="mb-2 font-bold text-lg">Webview App</div>
      <code className="rounded bg-muted p-2">{url}</code>
    </div>
  </Activity>
)

export const AppShell = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, addTab, reorderTabs } = useTabs()

  // Sync internal navigation back to tab state with default title
  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url, title: getDefaultRouteTitle(url) })
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-sidebar text-foreground">
      {/* Zone 1: Tab Bar (横跨整个宽度) */}
      <AppShellTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        setActiveTab={setActiveTab}
        closeTab={closeTab}
        addTab={addTab}
        reorderTabs={reorderTabs}
      />

      {/* Zone 2: Main Area (Sidebar + Content) */}
      <div className="flex h-full w-full flex-1 flex-row overflow-hidden">
        {/* Zone 2a: Sidebar */}
        <Sidebar />

        {/* Zone 2b: Content Area - Multi MemoryRouter Architecture */}
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
    </div>
  )
}

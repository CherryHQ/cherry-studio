import '@renderer/databases'

import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { useNavigate } from '@tanstack/react-router'
import { Activity } from 'react'
import { v4 as uuid } from 'uuid'

import { useTabs } from '../../hooks/useTabs'
import Sidebar from '../app/Sidebar'
import { AppHeader } from './AppHeader'
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

// Track last settings path for returning to same settings page
let lastSettingsPath = '/settings/provider'

export const AppShell = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, addTab } = useTabs()
  const navigate = useNavigate()

  // Sync internal navigation back to tab state with default title (url may include search/hash)
  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url, title: getDefaultRouteTitle(url) })

    // Track last settings path for returning to same settings page
    if (url.startsWith('/settings/')) {
      lastSettingsPath = url
    }
  }

  // Navigate to settings page
  const handleSettingsClick = () => {
    navigate({ to: lastSettingsPath })
  }

  // Add new tab (opens home page by default)
  const handleAddTab = () => {
    addTab({
      id: uuid(),
      type: 'route',
      url: '/',
      title: getDefaultRouteTitle('/')
    })
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-foreground">
      {/* Zone 1: Tab Bar - spans entire window width at the top */}
      <AppHeader
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={setActiveTab}
        onTabClose={closeTab}
        onAddTab={handleAddTab}
        onSettingsClick={handleSettingsClick}
      />

      {/* Zone 2: Main Content Area - Sidebar + Content */}
      <div className="flex flex-1 flex-row overflow-hidden bg-(--color-background-mute) pr-1.5 pb-1.5">
        {/* Sidebar */}
        <Sidebar />

        {/* Zone 3: Content Area - Multi MemoryRouter Architecture */}
        <main className="relative flex-1 overflow-hidden rounded-2xs bg-background">
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

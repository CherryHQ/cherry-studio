import '@renderer/databases'

import { loggerService } from '@logger'
import type { Tab } from '@renderer/hooks/useTabs'
import { useTabs } from '@renderer/hooks/useTabs'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { TabType } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { Activity, useEffect, useRef } from 'react'

import { AppShellTabBar } from '../../components/layout/AppShellTabBar'
import { TabRouter } from '../../components/layout/TabRouter'

const logger = loggerService.withContext('DetachedAppShell')

// Mock Webview component (TODO: Replace with actual MinApp/Webview)
const WebviewContainer = ({ url, isActive }: { url: string; isActive: boolean }) => (
  <Activity mode={isActive ? 'visible' : 'hidden'}>
    <div className="flex h-full w-full flex-col items-center justify-center bg-background">
      <div className="mb-2 font-bold text-lg">Webview App</div>
      <code className="rounded bg-muted p-2">{url}</code>
    </div>
  </Activity>
)

export const DetachedAppShell = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, addTab, reorderTabs, openTab, unpinTab } = useTabs()
  const initialized = useRef(false)

  // Initialize tab from URL parameters
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const searchParams = new URLSearchParams(window.location.search)
    const url = searchParams.get('url')
    const title = searchParams.get('title')
    const tabId = searchParams.get('tabId')
    const type = searchParams.get('type') as TabType
    const isPinned = searchParams.get('isPinned') === 'true'

    if (url && tabId) {
      // If it's a Pinned Tab, it should already be loaded via usePersistCache
      // But we need to make sure it's selected
      if (isPinned) {
        // Storage sync may take a moment, or it already exists
        // We try to select it
        setActiveTab(tabId)
      } else {
        // If it's a Normal Tab, we need to manually add it
        openTab(url, {
          id: tabId,
          title: title || undefined,
          type: type || 'route',
          forceNew: true
        })
      }
    }
  }, [openTab, setActiveTab])

  // Custom close handler for pinned tabs in detached window
  const handleCloseTab = (id: string) => {
    const tab = tabs.find((t) => t.id === id)
    if (tab?.isPinned) {
      // Unpin (will be removed from persistent storage)
      unpinTab(id)
      // Note: after unpinTab it becomes a normal tab and stays in the list
      // We need to make sure it gets closed
      // Since state updates are async, we may need a way to ensure subsequent closing
      // But in the current Context implementation, unpinTab only modifies the lists
      // We can call closeTab right after since the id hasn't changed
    }
    closeTab(id)

    // If the last tab was closed, the window should close
    // This is typically handled by Main Process listening to tab count changes, or Renderer sends a command
    if (tabs.length <= 1) {
      // TODO: IPC call to close window
      // window.electron.ipcRenderer.send('window:close')
    }
  }

  // Sync internal navigation back to tab state with default title
  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url, title: getDefaultRouteTitle(url) })
  }

  // Attach tab back to main window
  const handleAttachTab = async (tab: Tab) => {
    try {
      // Send IPC message to main window
      await window.electron.ipcRenderer.invoke(IpcChannel.Tab_Attach, tab)

      logger.info('Tab attached to main window', { tabId: tab.id, url: tab.url })

      // Close tab in detached window (handles unpinning if needed)
      handleCloseTab(tab.id)

      // Detached window only has one tab, close it directly after attach
      window.api.windowControls.close()
    } catch (error) {
      logger.error('Failed to attach tab', { tabId: tab.id, error })
    }
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
        attachTab={handleAttachTab}
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

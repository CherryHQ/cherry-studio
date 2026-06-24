import '@renderer/databases'

import { type WindowFrame, WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { SubWindowControls } from '@renderer/components/layout/SubWindowControls'
import { SubWindowTitle } from '@renderer/components/layout/SubWindowTitle'
import { TabRouter } from '@renderer/components/layout/TabRouter'
import MiniAppTabsPool from '@renderer/components/MiniApp/MiniAppTabsPool'
import { clearTabInstanceMetadata } from '@renderer/config/tabInstanceMetadata'
import { useTabs } from '@renderer/hooks/useTabs'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import type { SubWindowInitData } from '@shared/types/subWindow'
import { Activity, useEffect, useRef } from 'react'

import { SubWindowTitleBar } from './SubWindowTitleBar'

// The sub-window owns its title-bar chrome (it's the only layer that knows what a detached
// window's title + controls are) and injects it into the hosted page's ConversationShell.
const WINDOW_FRAME: WindowFrame = {
  mode: 'window',
  chrome: {
    titleLeading: <SubWindowTitle className="shrink" />,
    titleTrailing: <SubWindowControls />
  }
}

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
  const { tabs, activeTabId, updateTab, openTab } = useTabs()
  const initialized = useRef(false)
  const init = useWindowInitData<SubWindowInitData>()

  // Initialize tab from WindowManager init data (delivered via useWindowInitData).
  // First render returns `init === null`; the effect re-runs after one IPC round-trip
  // when the payload arrives. The `initialized` ref still guards against re-entry.
  useEffect(() => {
    if (!init || initialized.current) return
    initialized.current = true

    openTab(init.url, {
      id: init.tabId,
      title: init.title,
      icon: init.icon,
      type: init.type || 'route',
      metadata: init.metadata,
      isPinned: init.isPinned,
      forceNew: true
    })
  }, [init, openTab])

  // Sync internal navigation back to tab state. Mirror the main AppShell:
  // clear the per-entity icon override so a mini-app logo doesn't stick onto
  // an unrelated route after navigation inside the same tab.
  const handleUrlChange = (tabId: string, url: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    // Chat / agent tabs are page-titled (topic / session name + emoji set by
    // their page); only sync the url so navigating topics doesn't wipe them.
    if (isPageTitledRoute(url)) {
      updateTab(tabId, { url })
      return
    }
    updateTab(tabId, {
      url,
      title: getDefaultRouteTitle(url),
      icon: undefined,
      metadata: clearTabInstanceMetadata(tab?.metadata)
    })
  }

  // Chat / agent pages merge the window chrome into their own navbar (ConversationShell,
  // gated on isPageTitledRoute). Every OTHER page (mini-app, settings, files, …) has no
  // such navbar, so without a standalone title bar the window would be undraggable — give
  // those a fallback title bar here.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const showFallbackTitleBar = !!activeTab && !isPageTitledRoute(activeTab.url)

  return (
    // The window frame tells the hosted page (HomePage / AgentPage) it owns the whole
    // window: hide the in-page list + sidebar toggle (lock to one conversation) and turn
    // the page navbar into the window title bar via the injected chrome. See ConversationShell.
    <WindowFrameProvider value={WINDOW_FRAME}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        {showFallbackTitleBar && <SubWindowTitleBar />}
        {/* Content Area - Multi MemoryRouter Architecture */}
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

          {/* Mini-app keep-alive WebView pool — needed for /app/mini-app/<id>
              route tabs, same as the main AppShell. The cache backing the pool
              is per-window (Memory tier) so this sub-window manages its own
              list independently of the main window. */}
          <MiniAppTabsPool />
        </main>
      </div>
    </WindowFrameProvider>
  )
}

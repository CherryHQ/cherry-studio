import { Activity, type CSSProperties, useCallback, useEffect, useRef } from 'react'

import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { TabRouter } from '@renderer/components/layout/TabRouter'
import MiniAppTabsPool from '@renderer/components/MiniApp/MiniAppTabsPool'
import { ResourceViewSourceProvider } from '@renderer/components/ResourceViewSourceProvider'
import { WINDOW_CONTROLS_OVERLAY_WIDTH } from '@renderer/components/WindowControls'
import { useCommandHandler } from '@renderer/hooks/command'
import { useTabs } from '@renderer/hooks/tab'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import type { WindowFrame } from '@renderer/hooks/useWindowFrame'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import { isLinux, isWin } from '@renderer/utils/platform'
import { getDefaultRouteTitle, isConversationRoute } from '@renderer/utils/routeTitle'
import type { SubWindowInitData } from '@shared/types/subWindow'

import { SubWindowTitleBar } from './SubWindowTitleBar'

const WINDOW_FRAME: WindowFrame = { mode: 'window' }

// Mock Webview component (TODO: Replace with actual MinApp/Webview)
const WebviewContainer = ({ url, isActive }: { url: string; isActive: boolean }) => (
  <Activity mode={isActive ? 'visible' : 'hidden'}>
    <div className="flex h-full w-full flex-col items-center justify-center bg-background">
      <div className="mb-2 text-lg font-bold">Webview App</div>
      <code className="rounded bg-muted p-2">{url}</code>
    </div>
  </Activity>
)

export const SubWindowAppShell = () => {
  const { tabs, activeTabId, updateTab, attachTab } = useTabs()
  const initialized = useRef(false)
  const init = useWindowInitData<SubWindowInitData>()
  const isFullscreen = useNativeFullscreen()
  const handleCloseTab = useCallback(() => {
    void ipcApi.request('window.close')
  }, [])
  useCommandHandler('tab.close', handleCloseTab)

  // Initialize tab from WindowManager init data (delivered via useWindowInitData).
  // First render returns `init === null`; the effect re-runs after one IPC round-trip
  // when the payload arrives. The `initialized` ref still guards against re-entry.
  useEffect(() => {
    if (!init || initialized.current) return
    initialized.current = true

    attachTab({
      id: init.tabId,
      url: init.url,
      title: init.title ?? '',
      icon: init.icon,
      type: init.type ?? 'route',
      isPinned: init.isPinned,
      metadata: init.metadata
    })
  }, [init, attachTab])

  // Sync internal navigation back to tab state. Mirror the main AppShell:
  // clear the per-entity icon override so a mini-app logo doesn't stick onto
  // an unrelated route after navigation inside the same tab.
  const handleUrlChange = (tabId: string, url: string) => {
    // Conversation visuals are normalized by TabsProvider; navigation only updates identity.
    if (isConversationRoute(url)) {
      updateTab(tabId, { url })
      return
    }
    updateTab(tabId, {
      url,
      title: getDefaultRouteTitle(url),
      icon: undefined,
      metadata: undefined
    })
  }

  return (
    // The window frame keeps detached-page behavior scoped to this window. The standalone
    // title bar stays outside every route so hosted pages can keep their normal page chrome.
    <WindowFrameProvider value={WINDOW_FRAME}>
      <div
        data-ui="app.detached-window"
        className="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
        style={
          {
            '--window-controls-width': !isFullscreen && (isWin || isLinux) ? WINDOW_CONTROLS_OVERLAY_WIDTH : '0px'
          } as CSSProperties
        }>
        <SubWindowTitleBar isFullscreen={isFullscreen} />
        {/* Content Area - Multi MemoryRouter Architecture */}
        <main className="relative flex-1 overflow-hidden bg-background">
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

          {/* Webview Tabs: Only render non-dormant tabs */}
          {tabs
            .filter((t) => t.type === 'webview' && !t.isDormant)
            .map((tab) => (
              <WebviewContainer key={tab.id} url={tab.url} isActive={tab.id === activeTabId} />
            ))}

          {/* Keep window-local guests outside route Activities so page dormancy does not release them. */}
          <MiniAppTabsPool />
        </main>
      </div>
    </WindowFrameProvider>
  )
}

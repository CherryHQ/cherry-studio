import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { TabRouter } from '@renderer/components/layout/TabRouter'
import { TITLE_BAR_HEIGHT_CLASS } from '@renderer/components/layout/titleBar'
import MiniAppTabsCleanup from '@renderer/components/MiniApp/MiniAppTabsCleanup'
import MiniAppTabsPool from '@renderer/components/MiniApp/MiniAppTabsPool'
import { useHasWindowControls, WindowControls } from '@renderer/components/WindowControls'
import { useTabs } from '@renderer/hooks/tab'
import type { WindowFrame } from '@renderer/hooks/useWindowFrame'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import { resolveSidebarAppTabEntryUrl } from '@renderer/utils/sidebar'
import { cn } from '@renderer/utils/style'
import { clearTabInstanceMetadata } from '@renderer/utils/tabInstanceMetadata'
import type { SubWindowInitData } from '@shared/types/subWindow'
import { Activity, type CSSProperties, useEffect, useRef } from 'react'

import { SubWindowTitleBar } from './SubWindowTitleBar'

const WINDOW_FRAME: WindowFrame = { mode: 'window' }

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

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  // Conversation pages switch topics/sessions inside their existing tab and
  // publish the current instance through metadata. Keep the tab URL canonical
  // so route state and a later reattach both point at the visible conversation.
  useEffect(() => {
    if (!activeTab || !isPageTitledRoute(activeTab.url)) return
    const url = resolveSidebarAppTabEntryUrl(activeTab)
    if (url === activeTab.url) return
    updateTab(activeTab.id, { url })
  }, [activeTab, updateTab])

  // Windows/Linux sub-windows are frameless, so the OS draws no min/max/close. Draw them
  // ourselves in the top-right corner and publish their width as --window-controls-width so
  // the standalone title bar can reserve that corner. macOS keeps its native traffic lights,
  // so there are no controls and the var stays 0.
  const hasWindowControls = useHasWindowControls()

  return (
    // The window frame keeps detached-page behavior scoped to this window. The standalone
    // title bar stays outside every route so hosted pages can keep their normal page chrome.
    <WindowFrameProvider value={WINDOW_FRAME}>
      <div
        className="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
        style={{ '--window-controls-width': hasWindowControls ? '138px' : '0px' } as CSSProperties}>
        <SubWindowTitleBar />
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
          <MiniAppTabsCleanup />
        </main>

        {/* OS window controls overlay — flush in the corner, above the title bar (z-[9999]),
            sitting in the space it reserves via --window-controls-width. Self-gated to
            Win/Linux, so this branch never renders on macOS. */}
        {hasWindowControls && (
          <div
            className={cn('absolute top-0 right-0 z-[9999] flex [-webkit-app-region:no-drag]', TITLE_BAR_HEIGHT_CLASS)}>
            <WindowControls />
          </div>
        )}
      </div>
    </WindowFrameProvider>
  )
}

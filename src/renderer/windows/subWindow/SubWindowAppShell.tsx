import { useCache } from '@data/hooks/useCache'
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { TabRouter } from '@renderer/components/layout/TabRouter'
import { TITLE_BAR_HEIGHT_CLASS } from '@renderer/components/layout/titleBar'
import MiniAppTabsPool from '@renderer/components/MiniApp/MiniAppTabsPool'
import { ResourceViewSourceProvider } from '@renderer/components/ResourceViewSourceProvider'
import { useHasWindowControls, WindowControls } from '@renderer/components/WindowControls'
import { TabsContext, useTabs } from '@renderer/hooks/tab'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import type { WindowFrame } from '@renderer/hooks/useWindowFrame'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import type { SubWindowInitData } from '@shared/types/subWindow'
import { Activity, type CSSProperties, useCallback, useEffect, useMemo, useRef } from 'react'

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
  const tabsApi = useTabs()
  const { tabs, activeTabId, updateTab, openTab, closeTab, closeTabs } = tabsApi
  const initialized = useRef(false)
  const init = useWindowInitData<SubWindowInitData>()
  const isFullscreen = useNativeFullscreen()
  const [splitOpen, setSplitOpen] = useCache('mini_app.split_open')
  const [splitMiniAppId, setSplitMiniAppId] = useCache('mini_app.split_id')
  const [currentMiniAppId, setCurrentMiniAppId] = useCache('mini_app.current_id')
  const [openedOneOffMiniApp] = useCache('mini_app.opened_oneoff')
  const [, setMiniAppShow] = useCache('mini_app.show')
  const [openedKeepAliveMiniApps, setOpenedKeepAliveMiniApps] = useCache('mini_app.opened_keep_alive')

  const takeClearingSplitId = useCallback(
    (closedIds: readonly string[]): string | undefined => {
      if (!splitOpen || !splitMiniAppId) return undefined
      let closingMiniAppFound = false
      for (const id of closedIds) {
        const tab = tabs.find((t) => t.id === id)
        if (miniAppIdFromTabUrl(tab?.url)) {
          closingMiniAppFound = true
          break
        }
      }
      if (!closingMiniAppFound) return undefined
      const hasSurvivingMiniAppTab = tabs.some(
        (t) => !closedIds.includes(t.id as string) && miniAppIdFromTabUrl(t.url) !== null
      )
      if (hasSurvivingMiniAppTab) return undefined
      const id = splitMiniAppId
      setSplitOpen(false)
      setSplitMiniAppId('')
      return id
    },
    [tabs, splitOpen, splitMiniAppId, setSplitOpen, setSplitMiniAppId]
  )

  const evictMiniAppsForClosedTabs = useCallback(
    (closedIds: readonly string[], clearingSplitId?: string) => {
      const closedIdSet = new Set(closedIds)
      const closingMiniAppIds = new Set<string>()
      for (const id of closedIds) {
        const tab = tabs.find((t) => t.id === id)
        const appId = miniAppIdFromTabUrl(tab?.url)
        if (appId) closingMiniAppIds.add(appId)
      }
      if (clearingSplitId) closingMiniAppIds.add(clearingSplitId)
      if (closingMiniAppIds.size === 0) return
      const survivingMiniAppIds = new Set<string>()
      for (const tab of tabs) {
        if (closedIdSet.has(tab.id)) continue
        const appId = miniAppIdFromTabUrl(tab.url)
        if (appId) survivingMiniAppIds.add(appId)
      }
      if (splitOpen && splitMiniAppId && splitMiniAppId !== clearingSplitId) {
        survivingMiniAppIds.add(splitMiniAppId)
      }
      const orphanedIds = [...closingMiniAppIds].filter((id) => !survivingMiniAppIds.has(id))
      if (orphanedIds.length === 0) return
      const orphanedSet = new Set(orphanedIds)
      setOpenedKeepAliveMiniApps((prev) => prev.filter((app) => !orphanedSet.has(app.appId)))
      for (const appId of orphanedIds) clearWebviewState(appId)
      if (currentMiniAppId && orphanedSet.has(currentMiniAppId) && openedOneOffMiniApp?.appId !== currentMiniAppId) {
        setCurrentMiniAppId('')
        setMiniAppShow(false)
      }
    },
    [
      tabs,
      splitOpen,
      splitMiniAppId,
      currentMiniAppId,
      openedOneOffMiniApp,
      setOpenedKeepAliveMiniApps,
      setCurrentMiniAppId,
      setMiniAppShow
    ]
  )

  const handleCloseTab = useCallback(
    (id: string) => {
      const clearingSplitId = takeClearingSplitId([id])
      evictMiniAppsForClosedTabs([id], clearingSplitId)
      closeTab(id)
    },
    [closeTab, evictMiniAppsForClosedTabs, takeClearingSplitId]
  )

  const handleCloseTabs = useCallback(
    (ids: readonly string[], activateId?: string) => {
      const clearingSplitId = takeClearingSplitId(ids)
      evictMiniAppsForClosedTabs(ids, clearingSplitId)
      closeTabs(ids, activateId)
    },
    [closeTabs, evictMiniAppsForClosedTabs, takeClearingSplitId]
  )

  const tabsContextValue = useMemo(
    () => ({ ...tabsApi, closeTab: handleCloseTab, closeTabs: handleCloseTabs }),
    [tabsApi, handleCloseTab, handleCloseTabs]
  )

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
      isPinned: init.isPinned,
      forceNew: true
    })
  }, [init, openTab])

  // Sync internal navigation back to tab state. Mirror the main AppShell:
  // clear the per-entity icon override so a mini-app logo doesn't stick onto
  // an unrelated route after navigation inside the same tab.
  const handleUrlChange = (tabId: string, url: string) => {
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
      metadata: undefined
    })
  }

  // Windows/Linux sub-windows are frameless, so the OS draws no min/max/close. Draw them
  // ourselves in the top-right corner and publish their width as --window-controls-width so
  // the standalone title bar can reserve that corner. macOS keeps its native traffic lights,
  // so there are no controls and the var stays 0.
  const hasWindowControls = useHasWindowControls()

  return (
    // The window frame keeps detached-page behavior scoped to this window. The standalone
    // title bar stays outside every route so hosted pages can keep their normal page chrome.
    <WindowFrameProvider value={WINDOW_FRAME}>
      <TabsContext value={tabsContextValue}>
        <div
          data-ui="app.detached-window"
          className="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
          style={{ '--window-controls-width': hasWindowControls ? '138px' : '0px' } as CSSProperties}>
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

            {/* Mini-app keep-alive WebView pool — needed for /app/mini-app/<id>
                route tabs, same as the main AppShell. The cache backing the pool
                is per-window (Memory tier) so this sub-window manages its own
                list independently of the main window. */}
            <MiniAppTabsPool />
          </main>

          {/* OS window controls overlay — flush in the corner, above the title bar (z-[9999]),
              sitting in the space it reserves via --window-controls-width. Self-gated to
              Win/Linux, so this branch never renders on macOS. */}
          {hasWindowControls && (
            <div
              className={cn(
                'absolute top-0 right-0 z-[9999] flex [-webkit-app-region:no-drag]',
                TITLE_BAR_HEIGHT_CLASS
              )}>
              <WindowControls />
            </div>
          )}
        </div>
      </TabsContext>
    </WindowFrameProvider>
  )
}

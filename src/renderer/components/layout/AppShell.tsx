import { Button } from '@cherrystudio/ui'
import { useCommandHandler } from '@renderer/hooks/command'
import { useTabs } from '@renderer/hooks/tab'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { isMac } from '@renderer/utils/platform'
import { getDefaultRouteTitle, isPageTitledRoute } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { clearTabInstanceMetadata } from '@renderer/utils/tabInstanceMetadata'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { isSettingsPath } from '@shared/data/types/settingsPath'
import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Sidebar from '../app/Sidebar'
import { createRecentRouteEntryFromTab, recordGlobalSearchRecentEntry } from '../GlobalSearch/globalSearchGroups'
import GlobalSearchPopup from '../GlobalSearch/GlobalSearchPopup'
import MiniAppTabsPool from '../MiniApp/MiniAppTabsPool'
import { ResourceViewSourceProvider } from '../ResourceViewSourceProvider'
import { WindowControls } from '../WindowControls'
import { AppShellTabBar } from './AppShellTabBar'
import { useSettingsSurface } from './SettingsSurfaceProvider'
import { TabRouter } from './TabRouter'

const IMMERSIVE_SETTINGS_TAB_ID = 'immersive-settings'

type ImmersiveSettingsShellProps = {
  isFullscreen: boolean
  isMacTransparentWindow: boolean
  onBack: () => void
  onUrlChange: (url: string) => void
  settingsPath: string
}

function ImmersiveSettingsShell({
  isFullscreen,
  isMacTransparentWindow,
  onBack,
  onUrlChange,
  settingsPath
}: ImmersiveSettingsShellProps) {
  const { t } = useTranslation()
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const settingsTab = useMemo<Tab>(
    () => ({
      id: IMMERSIVE_SETTINGS_TAB_ID,
      type: 'route',
      url: settingsPath,
      title: t('settings.title'),
      isDormant: false
    }),
    [settingsPath, t]
  )

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    backButtonRef.current?.focus()

    return () => previouslyFocusedElement?.focus()
  }, [])

  return (
    <section
      data-testid="settings-shell"
      className={cn(
        'flex h-screen w-screen flex-col overflow-hidden text-foreground',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      {/* Two deliberate offsets keep Back on the traffic lights' line:
          - the divider is an overlay, not a border, so it does not shrink the content box;
          - macOS draws the lights from `trafficLightPosition` y=16 (windowRegistry) at ~13.5px, so
            their centre sits ~0.75px below the centre of the 44px chrome. `pt-[1.5px]` moves the
            row's centre down by exactly that much. Fullscreen hides the lights, so it drops out. */}
      <header
        data-testid="settings-title-bar"
        className={cn(
          "relative flex h-[var(--app-top-chrome-height)] shrink-0 items-center [-webkit-app-region:drag] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-border after:content-['']",
          isMac && !isFullscreen && 'pt-[1.5px]'
        )}>
        {isMac && !isFullscreen && (
          <div
            aria-hidden="true"
            data-testid="settings-macos-traffic-light-spacer"
            className="h-full w-[env(titlebar-area-x)] shrink-0"
          />
        )}
        <div className="flex h-full items-center px-2 [-webkit-app-region:no-drag]">
          <Button
            ref={backButtonRef}
            type="button"
            variant="ghost"
            aria-label={t('common.back')}
            onClick={onBack}
            className="h-8 text-foreground text-sm dark:text-foreground">
            <ArrowLeft size={16} />
            <span>{t('common.back')}</span>
          </Button>
        </div>
        <div className="ml-auto h-full">
          <WindowControls />
        </div>
      </header>
      <main className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <ResourceViewSourceProvider>
          <TabRouter tab={settingsTab} isActive onUrlChange={onUrlChange} />
        </ResourceViewSourceProvider>
      </main>
    </section>
  )
}

export const AppShell = () => {
  const isMacTransparentWindow = useMacTransparentWindow()
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    closeTabs,
    updateTab,
    reorderTabs,
    pinTab,
    unpinTab,
    detachTab,
    openTab
  } = useTabs()
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { settingsPath, setSettingsPath, closeSettings } = useSettingsSurface()

  const handleOpenGlobalSearch = useCallback(() => {
    if (settingsPath) return
    void GlobalSearchPopup.show()
  }, [settingsPath])

  useCommandHandler('app.search', handleOpenGlobalSearch)

  // Blocking `show()` only covers searches started from here. A deep link or a menu entry can open
  // Settings while global search is already up, and the popup lives in the window-level PopupHost —
  // so it would keep covering the surface. Dismiss it as Settings takes over.
  useEffect(() => {
    if (settingsPath) {
      GlobalSearchPopup.hide()
    }
  }, [settingsPath])

  useEffect(() => {
    if (!isMac) return

    let cancelled = false
    void ipcApi
      .request('window.is_full_screen')
      .then((value) => {
        if (!cancelled) {
          setIsFullscreen(value)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useIpcOn('window.fullscreen_changed', (value) => {
    if (isMac) {
      setIsFullscreen(value)
    }
  })

  const recordRouteVisit = useCallback((tab: typeof activeTab, lastAccessTime = tab?.lastAccessTime) => {
    if (!tab) return

    const entry = createRecentRouteEntryFromTab(tab, lastAccessTime)
    if (!entry) return

    recordGlobalSearchRecentEntry(entry)
  }, [])

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
    if (isSettingsPath(url)) {
      setSettingsPath(url)
      return
    }

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

  const tabBar = (
    <AppShellTabBar
      tabs={tabs}
      activeTabId={activeTabId}
      isFullscreen={isFullscreen}
      setActiveTab={setActiveTab}
      closeTab={closeTab}
      closeTabs={closeTabs}
      reorderTabs={reorderTabs}
      pinTab={pinTab}
      unpinTab={unpinTab}
      detachTab={detachTab}
      openTab={openTab}
    />
  )

  const contentArea = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col pr-2 pb-2">
      <main
        data-ui="app.content"
        className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border-[0.5px] border-border bg-background">
        {/* Route Tabs: Only render non-dormant tabs */}
        <ResourceViewSourceProvider>
          {tabs
            .filter((t) => t.type === 'route' && !t.isDormant)
            .map((tab) => (
              <TabRouter
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId && !settingsPath}
                onUrlChange={(url) => handleUrlChange(tab.id, url)}
              />
            ))}
        </ResourceViewSourceProvider>

        {/* MiniApp keep-alive WebView pool — global, shared across modes */}
        <MiniAppTabsPool />
      </main>
    </div>
  )

  const contentColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {tabBar}
      {contentArea}
    </div>
  )

  const workspaceShell = !isMac ? (
    <div
      data-testid="workspace-shell"
      className={cn(
        'flex h-screen w-screen flex-row overflow-hidden text-foreground',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar',
        settingsPath && 'hidden'
      )}>
      <Sidebar />
      {contentColumn}
    </div>
  ) : (
    <div
      data-testid="workspace-shell"
      className={cn(
        'relative flex h-screen w-screen flex-row overflow-hidden text-foreground',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar',
        settingsPath && 'hidden'
      )}>
      {!isFullscreen && (
        <div
          aria-hidden="true"
          data-testid="macos-traffic-light-drag-region"
          className="pointer-events-none absolute top-0 left-0 h-11 w-[env(titlebar-area-x)] [-webkit-app-region:drag]"
        />
      )}
      <div className="flex h-full min-h-0 shrink-0 flex-col [&>#app-sidebar]:min-h-0 [&>#app-sidebar]:flex-1">
        {!isFullscreen && (
          <div
            aria-hidden="true"
            data-testid="macos-traffic-light-spacer"
            className="h-11 shrink-0 [-webkit-app-region:drag]"
          />
        )}
        <Sidebar />
      </div>
      {contentColumn}
    </div>
  )

  return (
    <>
      {workspaceShell}
      {settingsPath && (
        <ImmersiveSettingsShell
          settingsPath={settingsPath}
          isFullscreen={isFullscreen}
          isMacTransparentWindow={isMacTransparentWindow}
          onBack={closeSettings}
          onUrlChange={setSettingsPath}
        />
      )}
    </>
  )
}

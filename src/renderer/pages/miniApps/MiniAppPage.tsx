import { cacheService } from '@data/CacheService'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { useCurrentTab, useCurrentTabId, useIsActiveTab } from '@renderer/hooks/tab'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { toTransientMiniApp, useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

// Tab mode page shell — relies on the global MiniAppTabsPool instead of creating WebViews directly
import MiniAppPane from './components/MiniAppPane'
import SplitPanePicker from './components/SplitPanePicker'

const logger = loggerService.withContext('MiniAppPage')
const MINI_APP_LOADING_COLOR = 'var(--muted-foreground)'

// currentTab.url is always the app-relative route written by openTab(`/app/mini-app/<id>`),
// never an absolute or live webview URL, so a direct compare is enough.
function isMiniAppTabUrl(url: string, appId: string): boolean {
  return url === `/app/mini-app/${appId}`
}

const MiniAppPage: FC = () => {
  const { t } = useTranslation()
  const { appId } = useParams({ strict: false })
  const currentTabId = useCurrentTabId()
  const currentTab = useCurrentTab()
  const isActiveTab = useIsActiveTab()
  const tabsContext = useOptionalTabsContext()
  const updateTab = tabsContext?.updateTab
  const { openMiniAppKeepAlive, openSplit, closeSplit, closeMiniApp } = useMiniAppPopup()
  const closeTab = tabsContext?.closeTab
  const { allApps, openedKeepAliveMiniApps, splitOpen, splitMiniAppId, isLoading, error } = useMiniApps()

  // Authoritative descriptor for a transient app (no database row, opened via openSmartMiniApp).
  // Every window's keep-alive entry is only a local snapshot of this cross-window value.
  const transientDescriptor = useSharedCacheValue(`mini_app.transient_descriptor.${appId ?? ''}` as const)

  // Find the app from all available apps (including transient ones in the keep-alive list)
  const app = useMemo((): MiniApp | null => {
    if (!appId) return null
    const found = allApps.find((a) => a.appId === appId)
    if (found) return found
    // Prefer the shared transient descriptor over a window-local keep-alive snapshot.
    // Reopening OpenClaw republishes its live URL; detached windows must observe it too.
    if (transientDescriptor) return toTransientMiniApp(transientDescriptor)
    const cached = openedKeepAliveMiniApps.find((a) => a.appId === appId)
    return cached ?? null
  }, [appId, allApps, openedKeepAliveMiniApps, transientDescriptor])

  const displayName = useMemo(() => {
    if (!app) return null
    return app.nameKey ? t(app.nameKey) : app.name
  }, [app, t])

  useEffect(() => {
    if (!app || !displayName || !currentTabId || !currentTab || !updateTab) return
    if (!isMiniAppTabUrl(currentTab.url, app.appId)) return
    // Uploaded logo → main-resolved `logoSrc`; preset key → `logo`.
    const tabIcon = app.logoSrc ?? app.logo
    if (currentTab.title === displayName && currentTab.icon === tabIcon) return

    updateTab(currentTabId, {
      title: displayName,
      icon: tabIcon
    })
  }, [app, currentTab, currentTabId, displayName, updateTab])

  useEffect(() => {
    // Only the active tab drives the keep-alive pool. `openMiniAppKeepAlive`
    // mutates *global* state — `currentMiniAppId` and the LRU order of the
    // shared keep-alive list. Background mini-app pages stay mounted (React 19
    // Activity keep-alive), so without this guard two mounted pages — e.g. a
    // pinned mini-app tab plus the one just opened — would each keep claiming
    // `currentMiniAppId` and reordering themselves to the tail, ping-ponging the
    // shared state into an infinite render loop (Maximum update depth). Each app
    // still registers itself when it becomes active and, being kept alive, stays
    // in the pool afterward.
    if (!isActiveTab) return
    if (isLoading) return
    if (error) {
      logger.error('Failed to load mini apps', error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (!app) return
    openMiniAppKeepAlive(app)
  }, [isActiveTab, app, openMiniAppKeepAlive, isLoading, error])

  // -------------- Tab Shell logic --------------
  // The shared cache syncs from Main asynchronously and does not block renderer startup,
  // so in a window that just opened — exactly the detached-tab case — the descriptor is
  // not readable on the first render. Hold the not-found verdict until it is, or the
  // window flashes "app not found" before resolving. Mirrors useApiGateway.
  const [sharedCacheReady, setSharedCacheReady] = useState(() => cacheService.isSharedCacheReady())
  useEffect(() => {
    if (sharedCacheReady) return
    return cacheService.onSharedCacheReady(() => setSharedCacheReady(true))
  }, [sharedCacheReady])
  // The keep-alive fallback lets a transient app (no database row) hold the pane;
  // a split id equal to the active app is dropped, one `<webview>` fills one pane.
  const splitApp = useMemo((): MiniApp | null => {
    if (!splitOpen || !splitMiniAppId || splitMiniAppId === appId) return null
    return (
      allApps.find((a) => a.appId === splitMiniAppId) ??
      openedKeepAliveMiniApps.find((a) => a.appId === splitMiniAppId) ??
      null
    )
  }, [allApps, appId, openedKeepAliveMiniApps, splitMiniAppId, splitOpen])

  // Both panes mount a search overlay and the host `keydown` listener is global,
  // so exactly one may answer Ctrl/Cmd+F — otherwise one press opens both.
  const [activePane, setActivePane] = useState<'primary' | 'split'>('primary')
  const activatePrimaryPane = useCallback(() => setActivePane('primary'), [])
  const activateSplitPane = useCallback(() => setActivePane('split'), [])
  useEffect(() => {
    if (!splitOpen) setActivePane('primary')
  }, [splitOpen])

  const handleClose = useCallback(() => {
    if (!appId || !app) return
    const tabs = tabsContext?.tabs ?? []
    // Delegate eviction to the surrounding TabsContext when available. The main
    // window's AppShell wraps `closeTab` with keep-alive and split orphan
    // handling, so doing it here as well would duplicate webview-state and
    // keep-alive updates. Detached windows have no such wrapper and fall
    // through to `closeMiniApp`, which cleans its own pool.
    const tabId = currentTabId && currentTab && isMiniAppTabUrl(currentTab.url, app.appId) ? currentTabId : null
    if (tabId && closeTab) {
      closeTab(tabId)
      return
    }
    const fallbackTab = tabs.find((t) => {
      try {
        return new URL(t.url, 'https://www.cherry-ai.com').pathname === `/app/mini-app/${app.appId}`
      } catch {
        return t.url === `/app/mini-app/${app.appId}`
      }
    })
    if (fallbackTab?.id && tabsContext?.closeTab) {
      tabsContext.closeTab(fallbackTab.id)
      return
    }
    closeMiniApp(app.appId)
  }, [app, appId, currentTab, currentTabId, closeTab, closeMiniApp, tabsContext])

  // While loading, show a loading indicator instead of returning null
  if (isLoading) {
    return (
      <div className="pointer-events-none relative z-3 flex h-full w-full flex-col *:pointer-events-auto">
        <div className="absolute inset-x-0 top-8.75 bottom-0 z-4 flex flex-col items-center justify-center gap-3 bg-card">
          <BeatLoader color={MINI_APP_LOADING_COLOR} size={8} />
        </div>
      </div>
    )
  }

  // Show error state for DataApi errors
  if (error) {
    const isNotFound = error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND
    return (
      <div className="pointer-events-none relative z-3 flex h-full w-full flex-col *:pointer-events-auto">
        <div className="absolute inset-x-0 top-8.75 bottom-0 z-4 flex flex-col items-center justify-center gap-3 bg-card">
          <div className="text-[14px] text-muted-foreground">
            {t(isNotFound ? 'miniApp.error.not_found' : 'miniApp.error.load_failed')}
          </div>
        </div>
      </div>
    )
  }

  // appId in the URL doesn't match any known app — render a not-found state
  // instead of redirecting away, so the user sees what happened. A transient app
  // can still arrive with the shared-cache hydration, so keep loading until then.
  if (!app) {
    return (
      <div className="pointer-events-none relative z-3 flex h-full w-full flex-col *:pointer-events-auto">
        <div className="absolute inset-x-0 top-8.75 bottom-0 z-4 flex flex-col items-center justify-center gap-3 bg-card">
          {sharedCacheReady ? (
            <div className="text-[14px] text-muted-foreground">{t('miniApp.error.not_found')}</div>
          ) : (
            <BeatLoader color={MINI_APP_LOADING_COLOR} size={8} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none relative z-3 flex h-full w-full flex-row">
      <MiniAppPane
        app={app}
        splitMode="open"
        splitActive={splitOpen}
        onSplit={splitOpen ? closeSplit : openSplit}
        onClose={handleClose}
        hostShortcutEnabled={!splitOpen || activePane === 'primary'}
        onActivate={activatePrimaryPane}
        className={splitOpen ? 'w-1/2' : 'w-full'}
      />
      {splitOpen &&
        (splitApp ? (
          <MiniAppPane
            app={splitApp}
            splitMode="close"
            onSplit={closeSplit}
            hostShortcutEnabled={activePane === 'split'}
            onActivate={activateSplitPane}
            className="w-1/2 border-border border-l"
          />
        ) : (
          <SplitPanePicker occupiedAppId={app.appId} onClose={closeSplit} className="w-1/2 border-border border-l" />
        ))}
    </div>
  )
}

export default MiniAppPage

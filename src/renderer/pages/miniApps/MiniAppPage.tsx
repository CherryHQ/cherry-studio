import { cacheService } from '@data/CacheService'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import MiniAppLogoAvatar from '@renderer/components/icons/MiniAppLogoAvatar'
import { useCurrentTab, useCurrentTabId, useIsActiveTab } from '@renderer/hooks/tab'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { toTransientMiniApp, useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { getWebviewLoaded, onWebviewStateChange, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useParams } from '@tanstack/react-router'
import type { WebviewTag } from 'electron'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

// Tab mode page shell — relies on the global MiniAppTabsPool instead of creating WebViews directly
import MinimalToolbar from './components/MinimalToolbar'
import WebviewSearch from './components/WebviewSearch'

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
  const { openMiniAppKeepAlive } = useMiniAppPopup()
  const { allApps, openedKeepAliveMiniApps, isLoading, error } = useMiniApps()

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
  // Hooks must be called before any return, so define them early with null-checks inside
  const webviewRef = useRef<WebviewTag | null>(null)
  // Seed isReady from `appId` (synchronously available via useParams), not
  // from `app` (which goes through async DataApi/useMemo and is null on the
  // first render after a tab wakes from LRU hibernation). Otherwise the
  // loading mask flashes over a still-alive webview every time the user
  // switches back to the mini-app, looking like a reload.
  const [isReady, setIsReady] = useState<boolean>(() => (appId ? getWebviewLoaded(appId) : false))

  // The shared cache syncs from Main asynchronously and does not block renderer startup,
  // so in a window that just opened — exactly the detached-tab case — the descriptor is
  // not readable on the first render. Hold the not-found verdict until it is, or the
  // window flashes "app not found" before resolving. Mirrors useApiGateway.
  const [sharedCacheReady, setSharedCacheReady] = useState(() => cacheService.isSharedCacheReady())
  useEffect(() => {
    if (sharedCacheReady) return
    return cacheService.onSharedCacheReady(() => setSharedCacheReady(true))
  }, [sharedCacheReady])
  const [currentUrl, setCurrentUrl] = useState<string | null>(app?.url ?? null)

  // Get the webview element from the pool (avoid re-running on openedKeepAliveMiniApps.length changes)
  const webviewCleanupRef = useRef<(() => void) | null>(null)

  const detachWebview = useCallback(() => {
    webviewCleanupRef.current?.()
    webviewCleanupRef.current = null
    webviewRef.current = null
  }, [])

  const attachWebview = useCallback(() => {
    if (!app) return true // No app — stop monitoring
    const selector = `webview[data-mini-app-id="${CSS.escape(app.appId)}"]`
    const el = document.querySelector<WebviewTag>(selector)
    if (!el) return false

    if (webviewRef.current === el) return true // Already attached

    detachWebview()
    webviewRef.current = el
    const handleInPageNav = (e: any) => setCurrentUrl(e.url)
    el.addEventListener('did-navigate-in-page', handleInPageNav)
    webviewCleanupRef.current = () => {
      el.removeEventListener('did-navigate-in-page', handleInPageNav)
    }
    return true
  }, [app, detachWebview])

  useEffect(() => {
    if (!app || !isReady) {
      detachWebview()
      return
    }

    // Try immediate attachment first
    if (attachWebview()) return detachWebview

    // If not yet created, observe DOM changes (lightweight + auto-disconnect)
    const observer = new MutationObserver(() => {
      if (attachWebview()) {
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      detachWebview()
    }
  }, [app, attachWebview, detachWebview, isReady])

  // Keep local readiness synchronized across load, LRU eviction, and recreation.
  useEffect(() => {
    if (!app) {
      setIsReady(false)
      return
    }

    const unsubscribe = onWebviewStateChange(app.appId, setIsReady)
    setIsReady(getWebviewLoaded(app.appId))
    return unsubscribe
  }, [app])

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

  const handleReload = () => {
    if (!app || !isReady || !getWebviewLoaded(app.appId)) return
    const webview = webviewRef.current
    if (!webview?.isConnected) return

    setWebviewLoaded(app.appId, false)
    setIsReady(false)
    webview.reload()
  }

  const handleOpenDevTools = () => {
    webviewRef.current?.openDevTools()
  }

  return (
    <div className="pointer-events-none relative z-3 flex h-full w-full flex-col *:pointer-events-auto">
      <div className="shrink-0">
        <MinimalToolbar
          app={app}
          webviewRef={webviewRef}
          // currentUrl may be null (navigation not yet captured); fallback to app.url when opening externally
          currentUrl={currentUrl}
          isWebviewReady={isReady}
          isHostActive={isActiveTab}
          onReload={handleReload}
          onOpenDevTools={handleOpenDevTools}
        />
      </div>
      <WebviewSearch webviewRef={webviewRef} isWebviewReady={isReady} appId={app.appId} />
      {!isReady && (
        <div className="absolute inset-x-0 top-8.75 bottom-0 z-4 flex flex-col items-center justify-center gap-3 bg-card">
          <MiniAppLogoAvatar logo={app.logoSrc ?? app.logo} size={60} />
          <BeatLoader color={MINI_APP_LOADING_COLOR} size={8} style={{ marginTop: 12 }} />
        </div>
      )}
    </div>
  )
}

export default MiniAppPage

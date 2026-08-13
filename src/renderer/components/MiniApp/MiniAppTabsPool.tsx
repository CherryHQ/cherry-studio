import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MiniApp/WebviewContainer'
import { useTabs } from '@renderer/hooks/tab'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import {
  DEFAULT_MAX_KEEP_ALIVE_MINI_APPS,
  miniAppIdFromTabUrl,
  trimMiniAppKeepAlive
} from '@renderer/utils/miniAppKeepAlive'
import { cn } from '@renderer/utils/style'
import { clearWebviewState, getWebviewLoaded, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import type { WebviewTag } from 'electron'
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

/**
 * Global mini-app WebView pool — keeps `<webview>` elements alive across
 * route changes for opened keep-alive miniApps. Mounted once at the AppShell
 * level (outside any per-tab Router) so both sidebar and top-navbar modes
 * share the same pool.
 *
 * Visibility:
 *  - The active app's webview is shown (display: inline-flex) when the active
 *    tab points at `/app/mini-app/<id>`
 *  - All other webviews stay mounted but display:none (keep-alive)
 */
const logger = loggerService.withContext('MiniAppTabsPool')

const MiniAppTabsPool: React.FC = () => {
  const { openedKeepAliveMiniApps, currentMiniAppId, setOpenedKeepAliveMiniApps } = useMiniApps()
  const [maxKeepAliveMiniApps] = usePreference('feature.mini_app.max_keep_alive')
  const cap = maxKeepAliveMiniApps ?? DEFAULT_MAX_KEEP_ALIVE_MINI_APPS
  // Read the active tab's URL from the v2 tabs cache. We can't use the
  // `@tanstack/react-router` `useLocation` here — the Pool sits above the
  // per-tab MemoryRouter, with no Router context.
  const { tabs, activeTabId } = useTabs()

  // webview refs (pool-internal, used to control show/hide)
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())

  const activeMiniAppId = useMemo(() => {
    const url = tabs.find((t) => t.id === activeTabId)?.url ?? ''
    return miniAppIdFromTabUrl(url)
  }, [tabs, activeTabId])
  const shouldShow = activeMiniAppId !== null

  // Reconcile retention here, not in MiniAppPage: the pool remains mounted when
  // the hard tab fuse hibernates every route that could otherwise run that hook.
  const protectedAppIds = useMemo(() => {
    const ids = new Set<string>()
    if (activeMiniAppId) ids.add(activeMiniAppId)
    for (const tab of tabs) {
      if (!tab.isPinned || tab.isDormant) continue
      const appId = miniAppIdFromTabUrl(tab.url)
      if (appId) ids.add(appId)
    }
    return ids
  }, [activeMiniAppId, tabs])
  const retention = useMemo(
    () => trimMiniAppKeepAlive(openedKeepAliveMiniApps, cap, protectedAppIds),
    [cap, openedKeepAliveMiniApps, protectedAppIds]
  )

  // Commit the render-time retention decision before MiniAppPage passive
  // effects can add or touch entries in the shared keep-alive cache.
  useLayoutEffect(() => {
    if (retention.evicted.length === 0) return
    setOpenedKeepAliveMiniApps(retention.keep)
    for (const app of retention.evicted) clearWebviewState(app.appId)
  }, [retention, setOpenedKeepAliveMiniApps])

  // Render the pool in a stable order (by appId), independent of the LRU
  // ordering inside `openedKeepAliveMiniApps`. Order in the cache is correct
  // for eviction (oldest at the head) but using it as the render order causes
  // React to move <webview> DOM nodes around when the LRU touches an app —
  // and Electron `<webview>` elements lose their content on detach/reattach
  // (known platform limitation). A stable sort breaks that link: every
  // surviving webview keeps the same DOM position across reorders, so
  // switching tabs never re-loads.
  const appMetadataSignature = retention.keep
    .map((a) => JSON.stringify([a.appId, a.url]))
    .sort()
    .join('|')

  const apps = useMemo(() => {
    const sorted = [...retention.keep]
    sorted.sort((a, b) => (a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0))
    return sorted
    // The metadata hash captures membership and webview URL values without
    // order — when the LRU reorders the same set, useMemo returns the previous
    // reference, but URL edits to an opened app still reach WebviewContainer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMetadataSignature])

  /** 设置 ref 回调 */
  const handleSetRef = (appid: string, el: WebviewTag | null) => {
    if (el) {
      webviewRefs.current.set(appid, el)
    } else {
      webviewRefs.current.delete(appid)
    }
  }

  /** WebView 加载完成回调 */
  const handleLoaded = (appid: string) => {
    setWebviewLoaded(appid, true)
    logger.debug(`TabPool webview loaded: ${appid}`)
  }

  /** Record navigation (URL state not yet exposed; can integrate with global URL Map later) */
  const handleNavigate = (appid: string, url: string) => {
    logger.debug(`TabPool webview navigate: ${appid} -> ${url}`)
  }

  /** Toggle display: only the active one is visible, the rest are hidden */
  useEffect(() => {
    webviewRefs.current.forEach((ref, id) => {
      if (!ref) return
      const active = id === currentMiniAppId && shouldShow
      ref.style.display = active ? 'inline-flex' : 'none'
    })
  }, [currentMiniAppId, shouldShow, apps.length])

  /** When an entry is in the Map but no longer in openedKeepAlive, remove the ref (React unmounts the element itself) */
  useEffect(() => {
    // Build Set for O(1) lookups (js-set-map-lookups)
    const activeIds = new Set<string>(apps.map((a) => a.appId))
    for (const id of webviewRefs.current.keys()) {
      if (!activeIds.has(id)) {
        webviewRefs.current.delete(id)
        if (getWebviewLoaded(id)) {
          setWebviewLoaded(id, false)
        }
      }
    }
  }, [apps])

  // Hide directly when not shown to avoid flicker; keep DOM for keep-alive
  const toolbarHeight = 35 // Match MinimalToolbar height

  return (
    <div
      className="pointer-events-none absolute right-0 bottom-0 left-0 z-[1] w-full overflow-hidden rounded-b-md [&_webview]:pointer-events-auto"
      style={
        shouldShow
          ? {
              visibility: 'visible',
              top: toolbarHeight,
              height: `calc(100% - ${toolbarHeight}px)`
            }
          : { visibility: 'hidden' }
      }
      data-mini-app-tabs-pool
      aria-hidden={!shouldShow}>
      {apps.map((app) => (
        <div
          key={app.appId}
          className={cn(
            'absolute inset-0 h-full w-full',
            app.appId === currentMiniAppId ? 'pointer-events-auto' : 'pointer-events-none'
          )}>
          <WebviewContainer
            appid={app.appId}
            url={app.url}
            onSetRefCallback={handleSetRef}
            onLoadedCallback={handleLoaded}
            onNavigateCallback={handleNavigate}
          />
        </div>
      ))}
    </div>
  )
}

export default MiniAppTabsPool

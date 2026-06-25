import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MiniApp/WebviewContainer'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useTabs } from '@renderer/hooks/useTabs'
import { cn } from '@renderer/utils/style'
import { getWebviewLoaded, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import type { WebviewTag } from 'electron'
import React, { useEffect, useMemo, useRef } from 'react'

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
  const { openedKeepAliveMiniApps, currentMiniAppId } = useMiniApps()
  // Read the active tab's URL from the v2 tabs cache. We can't use the
  // `@tanstack/react-router` `useLocation` here — the Pool sits above the
  // per-tab MemoryRouter, with no Router context.
  const { tabs, activeTabId } = useTabs()

  // webview refs (pool-internal, used to control show/hide)
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())

  // Show only when the active tab's URL points at a specific miniapp detail.
  const shouldShow = useMemo(() => {
    const url = tabs.find((t) => t.id === activeTabId)?.url ?? ''
    if (url === '/app/mini-app') return false
    if (!url.startsWith('/app/mini-app/')) return false
    const parts = url.split('/').filter(Boolean) // ['app', 'mini-app', '<id>', ...]
    return parts.length >= 3
  }, [tabs, activeTabId])

  // Render the pool in a stable order (by appId), independent of the LRU
  // ordering inside `openedKeepAliveMiniApps`. Order in the cache is correct
  // for eviction (oldest at the head) but using it as the render order causes
  // React to move <webview> DOM nodes around when the LRU touches an app —
  // and Electron `<webview>` elements lose their content on detach/reattach
  // (known platform limitation). A stable sort breaks that link: every
  // surviving webview keeps the same DOM position across reorders, so
  // switching tabs never re-loads.
  const apps = useMemo(() => {
    const sorted = [...openedKeepAliveMiniApps]
    sorted.sort((a, b) => (a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0))
    return sorted
    // The id-set hash captures membership without order — when the LRU
    // reorders the same set, useMemo returns the previous reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    openedKeepAliveMiniApps
      .map((a) => a.appId)
      .sort()
      .join('\u0000')
  ])

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

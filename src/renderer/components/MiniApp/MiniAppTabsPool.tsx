import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MiniApp/WebviewContainer'
import { useCommandContextKey } from '@renderer/hooks/command'
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
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

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

/**
 * Horizontal placement of one pane. Only the CSS box changes between split and
 * full width — the `<webview>` node itself never moves in the DOM, which would
 * blank its content on reattach.
 */
function paneGeometry(isSplit: boolean, isPrimary: boolean, isSecondary: boolean): string {
  if (!isSplit) return 'left-0 w-full'
  if (isPrimary) return 'left-0 w-1/2'
  if (isSecondary) return 'left-1/2 w-1/2'
  return 'left-0 w-full'
}

const MiniAppTabsPool: React.FC = () => {
  const {
    openedKeepAliveMiniApps,
    currentMiniAppId,
    splitOpen,
    splitMiniAppId,
    openedOneOffMiniApp,
    setOpenedKeepAliveMiniApps,
    setCurrentMiniAppId,
    setMiniAppShow
  } = useMiniApps()
  const [maxKeepAliveMiniApps] = usePreference('feature.mini_app.max_keep_alive')
  const cap = maxKeepAliveMiniApps ?? DEFAULT_MAX_KEEP_ALIVE_MINI_APPS
  // Read the active tab's URL from the v2 tabs cache. We can't use the
  // `@tanstack/react-router` `useLocation` here — the Pool sits above the
  // per-tab MemoryRouter, with no Router context.
  const { tabs, activeTabId } = useTabs()

  // webview refs (pool-internal, used to control show/hide)
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())

  const tabMiniAppIds = useMemo(() => {
    const ids = new Set<string>()
    for (const tab of tabs) {
      const id = miniAppIdFromTabUrl(tab.url)
      if (id) ids.add(id)
    }
    return ids
  }, [tabs])

  // One `<webview>` cannot render in two panes, and switching tabs can make the
  // active app equal the split one, so drop the split instead of blanking a pane.
  const paneSplitId = splitOpen && splitMiniAppId !== currentMiniAppId ? splitMiniAppId : ''

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
    // The split pane's app owns no tab of its own, so nothing else keeps this
    // retention pass from evicting the webview shown beside the active one.
    if (splitOpen && splitMiniAppId) ids.add(splitMiniAppId)
    return ids
  }, [activeMiniAppId, splitMiniAppId, splitOpen, tabs])
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

  // closeSplit's contract keeps split-opened apps pooled (the cap-LRU retires them), so remember
  // every app the split pane ever showed: orphan cleanup only evicts entries no tab references
  // and the split never owned.
  const splitPooledIds = useRef(new Set<string>())

  useEffect(() => {
    if (splitOpen && splitMiniAppId) splitPooledIds.current.add(splitMiniAppId)
    const isReferenced = (appId: string) => tabMiniAppIds.has(appId) || splitPooledIds.current.has(appId)
    const orphanedApps = openedKeepAliveMiniApps.filter((app) => !isReferenced(app.appId))
    if (orphanedApps.length === 0) return

    // The updater filters the latest stored pool, which can hold apps this render never
    // saw — current/show must not be derived here; the realign effect below owns that.
    setOpenedKeepAliveMiniApps((prev) => prev.filter((app) => isReferenced(app.appId)))
    for (const app of orphanedApps) clearWebviewState(app.appId)
  }, [openedKeepAliveMiniApps, setOpenedKeepAliveMiniApps, splitMiniAppId, splitOpen, tabMiniAppIds])

  // Realign a current id that resolves to no shown app. Always-on, not gated behind orphan
  // cleanup: a stale-snapshot decision then self-heals on the fresh-pool re-run.
  useEffect(() => {
    // One-off apps live outside the keep-alive pool but legitimately own the current id.
    if (currentMiniAppId === openedOneOffMiniApp?.appId) return
    if (openedKeepAliveMiniApps.some((app) => app.appId === currentMiniAppId)) return

    if (activeMiniAppId && openedKeepAliveMiniApps.some((app) => app.appId === activeMiniAppId)) {
      setCurrentMiniAppId(activeMiniAppId)
      setMiniAppShow(true)
      return
    }

    setCurrentMiniAppId('')
    setMiniAppShow(false)
  }, [
    activeMiniAppId,
    currentMiniAppId,
    openedKeepAliveMiniApps,
    openedOneOffMiniApp,
    setCurrentMiniAppId,
    setMiniAppShow
  ])

  /** 设置 ref 回调 */
  const handleSetRef = useCallback((appid: string, el: WebviewTag | null) => {
    if (el) {
      webviewRefs.current.set(appid, el)
    } else {
      webviewRefs.current.delete(appid)
    }
  }, [])

  /** WebView 加载完成回调 */
  const handleLoaded = useCallback((appid: string) => {
    // A load event can land after the pool evicted the app; don't resurrect its cleared state.
    if (!webviewRefs.current.has(appid)) return
    setWebviewLoaded(appid, true)
    logger.debug(`TabPool webview loaded: ${appid}`)
  }, [])

  /** Record navigation (URL state not yet exposed; can integrate with global URL Map later) */
  const handleNavigate = useCallback((appid: string, url: string) => {
    logger.debug(`TabPool webview navigate: ${appid} -> ${url}`)
  }, [])

  // The context key is registered here rather than per pane: every container's effect
  // stays alive for the pool's lifetime, and the registry resolves to whichever
  // registered last — so a pane mounting behind a focused one would clear the key.
  const [focusedAppId, setFocusedAppId] = useState<string | null>(null)
  const handleFocusChange = useCallback((appid: string, focused: boolean) => {
    // A pane's blur can land after the next pane's focus, so only the pane that still
    // holds the key may clear it.
    setFocusedAppId((current) => (focused ? appid : current === appid ? null : current))
  }, [])
  // Lets no-modifier commands opt out of guest keys via `when: '!webview.focused'`.
  useCommandContextKey('webview.focused', focusedAppId !== null)

  /** Toggle display: only the active pane(s) are visible, the rest are hidden */
  useEffect(() => {
    webviewRefs.current.forEach((ref, id) => {
      if (!ref) return
      const active = (id === currentMiniAppId || id === paneSplitId) && shouldShow
      ref.style.display = active ? 'inline-flex' : 'none'
    })
  }, [currentMiniAppId, paneSplitId, shouldShow, apps.length])

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
      {apps.map((app) => {
        const isPrimaryPane = app.appId === currentMiniAppId
        const isSplitPane = app.appId === paneSplitId
        return (
          <div
            key={app.appId}
            className={cn(
              'absolute top-0 bottom-0 h-full',
              isPrimaryPane || isSplitPane ? 'pointer-events-auto' : 'pointer-events-none',
              paneGeometry(splitOpen, isPrimaryPane, isSplitPane)
            )}>
            <WebviewContainer
              appid={app.appId}
              url={app.url}
              onSetRefCallback={handleSetRef}
              onLoadedCallback={handleLoaded}
              onNavigateCallback={handleNavigate}
              onFocusChange={handleFocusChange}
            />
          </div>
        )
      })}
    </div>
  )
}

export default MiniAppTabsPool

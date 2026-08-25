import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ipcApi } from '@renderer/ipc'
import {
  DEFAULT_MAX_KEEP_ALIVE_MINI_APPS,
  miniAppIdFromTabUrl,
  trimMiniAppKeepAlive
} from '@renderer/utils/miniAppKeepAlive'
import { clearWebviewState, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { fileUrlToPath } from '@shared/utils/file'
import { isEqual } from 'es-toolkit/compat'
import { useCallback, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useMiniAppPopup')

/** Brand a raw string as MiniAppId. Safe — caller controls the string. */
function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

type MiniAppInput = Omit<MiniApp, 'appId' | 'presetMiniAppId' | 'status' | 'orderKey'> & {
  appId: string
}

/**
 * Rebuild a keep-alive entry from a raw descriptor. Exported for `MiniAppPage`,
 * which resolves transient apps from the shared descriptor registry and must apply
 * the same convention as the window that opened them.
 */
export function toTransientMiniApp(input: MiniAppInput): MiniApp {
  return {
    ...input,
    appId: brandId(input.appId),
    // Transient apps opened from raw config (URL bar / openMiniApp(rawApp)) are
    // not preset rows and not custom rows persisted via DataApi — they live
    // only in the keep-alive cache. Use `null` to mark "no preset linkage",
    // matching the same convention used for custom apps in the schema. Setting
    // it to `input.appId` falsely claims this transient app shadows a preset
    // with that id, which bleeds into preset-vs-custom checks downstream.
    presetMiniAppId: null,
    status: 'enabled',
    orderKey: ''
  }
}

/**
 * Cleanup performed when a miniapp is removed from the keep-alive list.
 * Clears persisted webview state. Tab closing in the v2 AppShell layout is
 * driven by the tabs cache directly; closing a v1 Redux tab here is no
 * longer meaningful (v2 layout does not render v1 tabs).
 */
function evictMiniApp(appId: string) {
  try {
    clearWebviewState(appId)
  } catch (error) {
    logger.error('Error during miniapp eviction', error as Error)
  }
}

function openExternalMiniAppUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') {
      void ipcApi.request('system.shell.open_path', fileUrlToPath(parsed))
      return
    }
  } catch {
    // Fall through to openWebsite so the existing main-process URL guard handles it.
  }

  void ipcApi.request('system.shell.open_website', url)
}

/**
 * Usage:
 *
 *   To open miniapps, you can use the following hooks:
 *     import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
 *
 *   in the component:
 *     const { openMiniAppKeepAlive, openMiniAppInSplit, openSplit, closeSplit,
 *             openSmartMiniApp } = useMiniAppPopup()
 *
 *   Exiting an app is `exitMiniApp` on `useMiniApps`; closing its tab exits it
 *   too, via the pool's orphan cleanup.
 */
export const useMiniAppPopup = () => {
  const {
    openedKeepAliveMiniApps,
    currentMiniAppId,
    splitMiniAppId,
    setOpenedKeepAliveMiniApps,
    setCurrentMiniAppId,
    setSplitOpen,
    setSplitMiniAppId
  } = useMiniApps()
  const [maxKeepAliveMiniApps] = usePreference('feature.mini_app.max_keep_alive')

  const cap = maxKeepAliveMiniApps ?? DEFAULT_MAX_KEEP_ALIVE_MINI_APPS

  // Mirror the React-synced keep-alive list into a ref so callbacks can read
  // the latest value without going through the cache service directly. Avoids
  // stale closures on a value that changes more frequently than callback deps.
  const keepAliveRef = useRef<MiniApp[]>(openedKeepAliveMiniApps)
  keepAliveRef.current = openedKeepAliveMiniApps

  // Pinned AppShell tabs are exempt while opening. The global WebView pool owns
  // dormancy reconciliation because it remains mounted when route hooks do not.
  // Isolated renderer surfaces can open mini-app content without AppShell tabs;
  // in that case skip eviction because pin state is not observable there.
  const tabsContext = useOptionalTabsContext()
  const tabs = tabsContext?.tabs
  const openTab = tabsContext?.openTab
  const pinnedMiniAppIds = useMemo(() => {
    if (!tabs) return null
    const ids = new Set<string>()
    for (const tab of tabs) {
      if (!tab.isPinned) continue
      const id = miniAppIdFromTabUrl(tab.url)
      if (id) ids.add(id)
    }
    // The split pane shows an app that owns no tab of its own, so nothing else
    // stops the cap from evicting the webview the user is reading beside.
    if (splitMiniAppId) ids.add(splitMiniAppId)
    return ids
  }, [tabs, splitMiniAppId])
  const pinnedMiniAppIdsRef = useRef(pinnedMiniAppIds)
  pinnedMiniAppIdsRef.current = pinnedMiniAppIds

  /** Open a miniapp into the keep-alive pool and make it the current one */
  const openMiniAppKeepAlive = useCallback(
    (app: MiniApp) => {
      const list = keepAliveRef.current
      const cachedIndex = list.findIndex((item) => item.appId === app.appId)
      if (cachedIndex !== -1) {
        const cached = list[cachedIndex]
        const isTail = cachedIndex === list.length - 1
        const changed = !isEqual(cached, app)
        if (!isTail || changed) {
          if (changed && cached.url !== app.url) {
            setWebviewLoaded(app.appId, false)
          }
          const reordered = [...list.filter((item) => item.appId !== app.appId), app]
          setOpenedKeepAliveMiniApps(reordered)
        }
        setCurrentMiniAppId(app.appId)
        return
      }
      // Evict from the existing list to make room for the newcomer,
      // exempting pinned tabs. The newcomer itself is never evicted by
      // its own open call — that would silently no-op the user's click.
      // If every existing entry is pinned, the list grows past cap until the
      // window-level pool observes a hard-fuse dormancy change.
      const targetSize = Math.max(cap - 1, 0)
      const { keep, evicted } = trimMiniAppKeepAlive(list, targetSize, pinnedMiniAppIdsRef.current)
      const next = [...keep, app]
      setOpenedKeepAliveMiniApps(next)
      for (const evictedApp of evicted) evictMiniApp(evictedApp.appId)
      setCurrentMiniAppId(app.appId)
    },
    [cap, setOpenedKeepAliveMiniApps, setCurrentMiniAppId]
  )

  /**
   * Show `app` in the split pane beside the active one.
   *
   * Unlike {@link openMiniApp}, this loads the app into the keep-alive pool
   * *without* claiming `currentMiniAppId` — the split pane sits next to the
   * active mini app rather than replacing it. The pane owns no route, so no
   * `MiniAppPage` mounts to register the app itself.
   */
  const openMiniAppInSplit = useCallback(
    (app: MiniApp) => {
      const list = keepAliveRef.current
      if (!list.some((item) => item.appId === app.appId)) {
        // Exempt the pane the user is already reading: without this, filling
        // the split on a full pool can evict the app right next to it.
        const pinnedIds = pinnedMiniAppIdsRef.current
        const exempt =
          pinnedIds === null ? null : currentMiniAppId ? new Set([...pinnedIds, currentMiniAppId]) : pinnedIds
        const { keep, evicted } = trimMiniAppKeepAlive(list, Math.max(cap - 1, 0), exempt)
        setOpenedKeepAliveMiniApps([...keep, app])
        for (const evictedApp of evicted) evictMiniApp(evictedApp.appId)
      }
      setSplitMiniAppId(app.appId)
      setSplitOpen(true)
    },
    [cap, currentMiniAppId, setOpenedKeepAliveMiniApps, setSplitMiniAppId, setSplitOpen]
  )

  /** Split the view and leave the new pane awaiting a pick. */
  const openSplit = useCallback(() => {
    setSplitOpen(true)
  }, [setSplitOpen])

  /** Leave split view. Apps stay in the pool; only the pane closes. */
  const closeSplit = useCallback(() => {
    setSplitOpen(false)
    setSplitMiniAppId('')
  }, [setSplitMiniAppId, setSplitOpen])

  /**
   * Open a miniapp from a transient config (e.g., a shared link). Adds to the
   * keep-alive list and opens the detail route in a tab — the global pool then
   * renders the webview. Same path for sidebar and top-navbar layouts.
   */
  const openSmartMiniApp = useCallback(
    (config: MiniAppInput) => {
      if (!openTab) {
        openExternalMiniAppUrl(config.url)
        return
      }

      const app = toTransientMiniApp(config)

      // A transient app has no database row, so `/app/mini-app/<id>` is unresolvable
      // anywhere but here. Publish the descriptor to the shared cache so any window —
      // one this tab is detached into, or this one after the keep-alive LRU evicted the
      // entry — can still resolve it. Rewritten on every open: the URL carries live
      // state (the OpenClaw dashboard's gateway token changes per launch).
      cacheService.setShared(`mini_app.transient_descriptor.${app.appId}` as const, {
        appId: app.appId,
        name: app.name,
        url: app.url,
        ...(app.logo !== undefined && { logo: app.logo }),
        ...(app.logoSrc !== undefined && { logoSrc: app.logoSrc })
      })

      const list = keepAliveRef.current
      const cachedIndex = list.findIndex((item) => item.appId === app.appId)
      const wasCached = cachedIndex !== -1
      if (!wasCached) {
        const targetSize = Math.max(cap - 1, 0)
        const { keep, evicted } = trimMiniAppKeepAlive(list, targetSize, pinnedMiniAppIdsRef.current)
        const next = [...keep, app]
        setOpenedKeepAliveMiniApps(next)
        for (const evictedApp of evicted) evictMiniApp(evictedApp.appId)
      } else {
        const cached = list[cachedIndex]
        if (cached.url !== app.url) {
          setWebviewLoaded(app.appId, false)
          const next = [...list]
          next[cachedIndex] = app
          setOpenedKeepAliveMiniApps(next)
        }
      }

      setCurrentMiniAppId(app.appId)

      // Always activate the mini-app tab even when the keep-alive entry
      // already exists. `MiniAppTabsPool.shouldShow` keys off the active tab
      // URL, not pool membership. An unchanged URL keeps the existing webview;
      // a changed transient URL updates that webview through the pool.
      // Uploaded logo → main-resolved `logoSrc`; preset key → `logo`.
      openTab(`/app/mini-app/${app.appId}`, {
        title: app.name,
        icon: app.logoSrc ?? app.logo,
        metadata: { transientMiniApp: true }
      })
    },
    [cap, openTab, setOpenedKeepAliveMiniApps, setCurrentMiniAppId]
  )

  return {
    openMiniAppKeepAlive,
    openMiniAppInSplit,
    openSplit,
    closeSplit,
    openSmartMiniApp
  }
}

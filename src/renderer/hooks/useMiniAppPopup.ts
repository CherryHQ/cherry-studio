import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { ipcApi } from '@renderer/ipc'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppUrl'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'
import { fileUrlToPath } from '@shared/utils/file'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useMiniAppPopup')

const DEFAULT_MAX_KEEP_ALIVE = 10

/** Brand a raw string as MiniAppId. Safe — caller controls the string. */
function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

type MiniAppInput = Omit<MiniApp, 'appId' | 'presetMiniAppId' | 'status' | 'orderKey'> & {
  appId: string
}

function toMiniApp(input: MiniAppInput): MiniApp {
  return {
    ...input,
    appId: brandId(input.appId),
    // Transient apps opened from raw config (URL bar / openSmartMiniApp) are
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

/**
 * Reduce `list` to length `<= cap` by dropping the oldest non-pinned entries
 * head-first. Apps whose AppShell tab is pinned are never evicted — pinning
 * is the user explicitly saying "keep this loaded", and it overrides the
 * cap. If every entry is pinned, the list stays as-is regardless of cap.
 */
function evictWithPinExemption(
  list: MiniApp[],
  cap: number,
  pinnedAppIds: ReadonlySet<string> | null
): { keep: MiniApp[]; evicted: MiniApp[] } {
  let toDrop = list.length - cap
  if (toDrop <= 0 || pinnedAppIds === null) return { keep: list, evicted: [] }
  const keep: MiniApp[] = []
  const evicted: MiniApp[] = []
  for (const app of list) {
    if (toDrop > 0 && !pinnedAppIds.has(app.appId)) {
      evicted.push(app)
      toDrop--
    } else {
      keep.push(app)
    }
  }
  return { keep, evicted }
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

export const useMiniAppPopup = () => {
  const { openedKeepAliveMiniApps, setOpenedKeepAliveMiniApps, setCurrentMiniAppId } = useMiniApps()
  const [maxKeepAliveMiniApps] = usePreference('feature.mini_app.max_keep_alive')

  const cap = maxKeepAliveMiniApps ?? DEFAULT_MAX_KEEP_ALIVE

  // Mirror the React-synced keep-alive list into a ref so callbacks can read
  // the latest value without going through the cache service directly. Avoids
  // stale closures on a value that changes more frequently than callback deps.
  const keepAliveRef = useRef<MiniApp[]>(openedKeepAliveMiniApps)
  keepAliveRef.current = openedKeepAliveMiniApps

  // Pinned AppShell tabs are exempt from keep-alive eviction. The user pins a
  // tab to say "keep this state alive across switches"; honoring that here
  // prevents the cap from quietly throwing away webviews behind a pinned tab.
  // Isolated renderer surfaces can open mini-app content without AppShell tabs;
  // in that case skip eviction because pin state is not observable there.
  const tabsContext = useOptionalTabsContext()
  const tabs = tabsContext?.tabs ?? []
  const openTab = tabsContext?.openTab
  const pinnedMiniAppIds = useMemo(() => {
    if (!tabsContext) return null
    const ids = new Set<string>()
    for (const tab of tabs) {
      if (!tab.isPinned) continue
      const id = miniAppIdFromTabUrl(tab.url)
      if (id) ids.add(id)
    }
    return ids
  }, [tabs, tabsContext])
  const pinnedMiniAppIdsRef = useRef(pinnedMiniAppIds)
  pinnedMiniAppIdsRef.current = pinnedMiniAppIds

  // Trim the kept-alive list when the user lowers the cap. Evicts the oldest
  // non-pinned entries (head of the list) so the most-recently-touched ones —
  // and any pinned tabs regardless of recency — survive.
  useEffect(() => {
    const list = keepAliveRef.current
    if (list.length <= cap) return
    const { keep, evicted } = evictWithPinExemption(list, cap, pinnedMiniAppIdsRef.current)
    if (evicted.length === 0) return
    setOpenedKeepAliveMiniApps(keep)
    for (const app of evicted) evictMiniApp(app.appId)
  }, [cap, setOpenedKeepAliveMiniApps])

  /** Open a miniapp into the keep-alive pool (LRU touch when already open). */
  const openMiniAppKeepAlive = useCallback(
    (app: MiniApp) => {
      const list = keepAliveRef.current
      const exists = list.some((item) => item.appId === app.appId)
      if (exists) {
        const tail = list[list.length - 1]
        if (tail?.appId !== app.appId) {
          const reordered = [...list.filter((item) => item.appId !== app.appId), app]
          setOpenedKeepAliveMiniApps(reordered)
        }
        setCurrentMiniAppId(app.appId)
        return
      }
      // Evict from the existing list to make room for the newcomer,
      // exempting pinned tabs. The newcomer itself is never evicted by
      // its own open call — that would silently no-op the user's click.
      // If every existing entry is pinned, the list grows past cap.
      const targetSize = Math.max(cap - 1, 0)
      const { keep, evicted } = evictWithPinExemption(list, targetSize, pinnedMiniAppIdsRef.current)
      setOpenedKeepAliveMiniApps([...keep, app])
      for (const evictedApp of evicted) evictMiniApp(evictedApp.appId)
      setCurrentMiniAppId(app.appId)
    },
    [cap, setOpenedKeepAliveMiniApps, setCurrentMiniAppId]
  )

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

      const app = toMiniApp(config)
      const list = keepAliveRef.current
      const wasCached = list.some((item: MiniApp) => item.appId === app.appId)
      if (!wasCached) {
        const targetSize = Math.max(cap - 1, 0)
        const { keep, evicted } = evictWithPinExemption(list, targetSize, pinnedMiniAppIdsRef.current)
        const next = [...keep, app]
        setOpenedKeepAliveMiniApps(next)
        for (const evictedApp of evicted) evictMiniApp(evictedApp.appId)
      }

      setCurrentMiniAppId(app.appId)

      // Always activate the mini-app tab even when the keep-alive entry
      // already exists. `MiniAppTabsPool.shouldShow` keys off the active tab
      // URL, not pool membership. Webview re-use stays correct: when cached we
      // don't recreate the entry or reset `src`, only the tab route activates.
      // Uploaded logo → main-resolved `logoSrc`; preset key → `logo`.
      openTab(`/app/mini-app/${app.appId}`, {
        title: app.name,
        icon: app.logoSrc ?? app.logo
      })
    },
    [cap, openTab, setOpenedKeepAliveMiniApps, setCurrentMiniAppId]
  )

  return {
    openMiniAppKeepAlive,
    openSmartMiniApp
  }
}

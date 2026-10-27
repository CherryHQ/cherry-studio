import { isEqual, isPlainObject } from 'es-toolkit/compat'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'

import { loggerService } from '@logger'
import { AgentBrowserRuntimeHost } from '@renderer/components/AgentBrowserRuntimeHost'
import { usePersistCache, usePersistCacheReader } from '@renderer/data/hooks/useCache'
import {
  type CloseConversationTabs,
  CloseConversationTabsContext,
  findClosableConversationTabIds,
  type OpenTabOptions,
  TabsContext,
  type TabsContextValue,
  useConversationNavigationOwner
} from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { TabLruManager } from '@renderer/services/TabLruManager'
import { getDefaultRouteTitle, isConversationRoute, isTopLevelRoute } from '@renderer/utils/routeTitle'
import type { Tab, TabSavedState } from '@shared/data/cache/cacheValueTypes'

import { type PinnedTabFeedbackEpisode, pinnedTabFeedbackService } from './PinnedTabFeedbackService'

const logger = loggerService.withContext('TabsProvider')

const DEFAULT_TAB: Tab = {
  id: 'home',
  type: 'route',
  url: '/app/chat',
  title: '',
  lastAccessTime: Date.now(),
  isDormant: false
}

function createLaunchpadFallbackTab(): Tab {
  return {
    id: uuid(),
    type: 'route',
    url: '/app/launchpad',
    title: getDefaultRouteTitle('/app/launchpad'),
    lastAccessTime: Date.now(),
    isDormant: false
  }
}

function hibernateTab(tab: Tab, hibernatedIds: ReadonlySet<string>): Tab {
  if (tab.isDormant || !hibernatedIds.has(tab.id)) return tab

  const savedState: TabSavedState = { scrollPosition: 0 }
  return { ...tab, isDormant: true, savedState }
}

// Route no longer served — its orphaned pinned tabs are dropped on restore.
const LEGACY_LIBRARY_ROUTE_PATH = '/app/library'
// OpenClaw was folded into the Code page (its sidebar entry + `/app/openclaw` route were removed),
// so an already-persisted OpenClaw pin is redirected here rather than restoring to a dead route.
const LEGACY_OPENCLAW_ROUTE_PATH = '/app/openclaw'
const CODE_ROUTE_PATH = '/app/code'

function routePathOfTab(tab: Tab): string | null {
  if (tab.type !== 'route') return null
  try {
    return new URL(tab.url, 'https://www.cherry-ai.com').pathname
  } catch {
    return null
  }
}

function isTransientMiniAppTab(tab: Tab): boolean {
  return tab.metadata?.transientMiniApp === true
}

/**
 * Reconcile persisted pinned tabs against routes that have since been removed or relocated: drop
 * `/app/library` pins outright, and redirect `/app/openclaw` pins to `/app/code` (deduping so the
 * redirect never produces a second Code pin). `changed` is true when anything was dropped or
 * rewritten, signalling the caller to write the reconciled list back to the persistent cache.
 */
export function migratePinnedTabs(pinnedTabs: Tab[]): { tabs: Tab[]; changed: boolean } {
  let hasCodePin = pinnedTabs.some((tab) => routePathOfTab(tab) === CODE_ROUTE_PATH)
  const tabs: Tab[] = []
  let changed = false
  for (const tab of pinnedTabs) {
    if (isTransientMiniAppTab(tab)) {
      changed = true
      continue
    }
    const path = routePathOfTab(tab)
    if (path === LEGACY_LIBRARY_ROUTE_PATH) {
      changed = true
      continue
    }
    if (path === LEGACY_OPENCLAW_ROUTE_PATH) {
      changed = true
      if (hasCodePin) continue // a Code pin already exists — drop rather than duplicate it
      hasCodePin = true
      tabs.push({ ...tab, url: CODE_ROUTE_PATH, title: getDefaultRouteTitle(CODE_ROUTE_PATH) })
      continue
    }
    tabs.push(tab)
  }
  return { tabs, changed }
}

export type PinnedRepairResult = { tabs: Tab[]; changed: boolean }

export function repairPinnedTabs(raw: unknown, normalTabs: readonly Tab[]): PinnedRepairResult {
  if (raw === undefined) return { tabs: [], changed: false }
  if (!Array.isArray(raw)) return { tabs: [], changed: true }

  const valid: Tab[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue
    if (typeof entry.id !== 'string' || !entry.id.trim()) continue
    if (entry.type !== 'route' && entry.type !== 'webview') continue
    if (typeof entry.url !== 'string' || !entry.url.trim()) continue
    try {
      new URL(entry.url, 'https://www.cherry-ai.com')
    } catch {
      continue
    }
    const tab = { ...entry } as Tab
    if (typeof tab.title !== 'string') tab.title = getDefaultRouteTitle(tab.url)
    tab.isPinned = true
    if ('isDormant' in tab && typeof tab.isDormant !== 'boolean') tab.isDormant = true
    if (typeof tab.lastAccessTime !== 'number' || !Number.isFinite(tab.lastAccessTime)) delete tab.lastAccessTime
    if (typeof tab.icon !== 'string') delete tab.icon
    if ('metadata' in tab && !isPlainObject(tab.metadata)) delete tab.metadata
    if ('savedState' in tab) {
      if (tab.savedState === undefined || !isPlainObject(tab.savedState)) delete tab.savedState
      else if ('scrollPosition' in tab.savedState && !Number.isFinite(tab.savedState.scrollPosition)) {
        tab.savedState = { ...tab.savedState }
        delete tab.savedState.scrollPosition
      }
    }
    valid.push(tab)
  }
  const seen = new Set(normalTabs.map((tab) => tab.id))
  const tabs = migratePinnedTabs(valid).tabs.filter((tab) => {
    if (seen.has(tab.id)) return false
    seen.add(tab.id)
    return true
  })
  return { tabs, changed: !isEqual(raw, tabs) }
}

function withLocalizedRouteTitle(tab: Tab): Tab {
  if (tab.type !== 'route') return tab
  if (isConversationRoute(tab.url)) {
    return { ...tab, title: getDefaultRouteTitle(tab.url), icon: undefined }
  }
  // Only auto-localize titles for top-level and settings routes. Parameterized
  // routes (e.g. /app/mini-app/<id>) preserve the title supplied at openTab
  // time so callers can pass per-entity names like a mini-app's display name.
  //
  // The `home` tab follows the SAME rule — it must not be special-cased into an
  // unconditional route-default title. When the home tab is reused for a
  // per-entity route (e.g. opening a mini-app from the sidebar), forcing the
  // route default here clobbers the caller-supplied title every render and
  // fights MiniAppPage's title-sync effect, spinning into an infinite
  // `updateTab` loop ("Maximum update depth exceeded"). On top-level / settings
  // routes the branch below still relocalizes the home tab, so language changes
  // are unaffected.
  if (!isTopLevelRoute(tab.url) && !isSettingsRouteTab(tab)) return tab
  return { ...tab, title: getDefaultRouteTitle(tab.url) }
}

function isSettingsRouteTab(tab: Tab): boolean {
  return tab.type === 'route' && tab.url.startsWith('/settings')
}

type InitialSession = { normalTabs: Tab[]; pinnedTabs: Tab[]; activeTabId: string }

function restoreTabs(tabs: readonly Tab[], activeTabId: string): Tab[] {
  return tabs.map((tab) => ({ ...tab, isDormant: tab.id !== activeTabId }))
}

/**
 * Compute the initial normal-tab list and active tab id at mount.
 *
 * Detached sub-windows (`!includePinnedTabs`) keep the old ephemeral behavior. The main window
 * restores its persisted session: every restored tab is forced dormant except the active one, so
 * `AppShell` mounts exactly one `TabRouter` at startup regardless of how many tabs were open
 * (dormant tabs wake lazily on click).
 */
function computeInitialSession(params: {
  includePinnedTabs: boolean
  initialDefaultTab: Tab | null
  pinnedTabs: Tab[]
  persistedNormalTabs: Tab[]
  persistedActiveTabId: string
}): InitialSession {
  const { includePinnedTabs, initialDefaultTab, pinnedTabs, persistedNormalTabs, persistedActiveTabId } = params
  const restorableNormalTabs = persistedNormalTabs.filter((tab) => !isTransientMiniAppTab(tab))

  const freshSession: InitialSession = {
    normalTabs:
      initialDefaultTab && !pinnedTabs.some((tab) => tab.id === initialDefaultTab.id) ? [initialDefaultTab] : [],
    pinnedTabs: [],
    activeTabId: initialDefaultTab?.id ?? ''
  }

  // Detached windows never persist/restore a session.
  if (!includePinnedTabs) return freshSession

  const pinnedHasActive = !!persistedActiveTabId && pinnedTabs.some((t) => t.id === persistedActiveTabId)

  // Empty persisted session (incl. first-ever launch) → fresh default. If the last active tab was a
  // pinned one (no unpinned tabs were open), honor that selection — the default tab stays as a
  // dormant fallback so the user lands back on the pinned tab they left.
  if (restorableNormalTabs.length === 0) {
    const activeTabId = pinnedHasActive
      ? persistedActiveTabId
      : (freshSession.normalTabs[0]?.id ?? pinnedTabs[0]?.id ?? '')
    return {
      normalTabs: restoreTabs(freshSession.normalTabs, activeTabId),
      pinnedTabs: restoreTabs(pinnedTabs, activeTabId),
      activeTabId
    }
  }

  // Resolve the active tab id FIRST, then derive dormancy from it. Keying dormancy off the resolved
  // id (not the raw persisted one) guarantees the active tab is always awake — otherwise an empty or
  // stale persisted id leaves every tab dormant, AppShell mounts zero TabRouters, and the content
  // area is blank until the user clicks a tab.
  const activeInSession =
    pinnedHasActive || (!!persistedActiveTabId && restorableNormalTabs.some((t) => t.id === persistedActiveTabId))
  const activeTabId = activeInSession
    ? persistedActiveTabId
    : (restorableNormalTabs[0]?.id ?? pinnedTabs[0]?.id ?? initialDefaultTab?.id ?? '')

  // Only the active tab stays awake; everything else restores dormant.
  return {
    normalTabs: restoreTabs(restorableNormalTabs, activeTabId),
    pinnedTabs: restoreTabs(pinnedTabs, activeTabId),
    activeTabId
  }
}

type TabsProviderProps = {
  children: ReactNode
  initialDefaultTab?: Tab | null
  includePinnedTabs?: boolean
}

export function TabsProvider({
  children,
  initialDefaultTab = DEFAULT_TAB,
  includePinnedTabs = true
}: TabsProviderProps) {
  // Route-derived tab titles are localized, so recompute them on language change.
  const { i18n } = useTranslation()

  // Pinned tabs - persistent storage. The setter natively supports functional
  // updates resolved against the latest persisted value, so callers can use
  // `setPinnedTabs(prev => ...)` directly (no manual ref mirroring needed).
  const [pinnedTabs, persistPinnedTabs] = usePersistCache('ui.tab.pinned_tabs')
  const readPinnedTabs = usePersistCacheReader('ui.tab.pinned_tabs')

  // Whether a tab's `isPinned` should route it into the persistent pinned list. The main
  // window surfaces pinned tabs, so it follows the flag. A detached sub-window passes
  // `includePinnedTabs={false}`: it has no pinned section and must never write the shared
  // `ui.tab.pinned_tabs` cache, so every tab lives in the normal list there — `isPinned`
  // is kept on the object only to round-trip the pinned state back on re-attach.
  const storesPinned = useCallback(
    (tab: Pick<Tab, 'isPinned'>) => includePinnedTabs && !!tab.isPinned,
    [includePinnedTabs]
  )
  const [persistedNormalTabs, setPersistedNormalTabs] = usePersistCache('ui.tab.normal_tabs')
  const [persistedActiveTabId, setPersistedActiveTabId] = usePersistCache('ui.tab.active_tab_id')

  // Compute the restored session once at mount. This relies on the persist cache being hydrated
  // SYNCHRONOUSLY in the CacheService constructor (loadPersistCache reads localStorage on
  // construction), so these reads already hold last session's values on the first render. If persist
  // ever switches to async hydration, the first render would see empty defaults AND the write-back
  // effects below would immediately persist that empty session over the real one — restore would
  // have to be reworked (e.g. re-seed when the hydrated value arrives) before that change lands.
  const initialSessionRef = useRef<InitialSession | null>(null)
  if (!initialSessionRef.current) {
    const restorableNormals = (persistedNormalTabs ?? []).filter((tab) => !isTransientMiniAppTab(tab))
    const initialPins =
      includePinnedTabs && !pinnedTabFeedbackService.episode.closed
        ? repairPinnedTabs(pinnedTabs, restorableNormals).tabs
        : []
    initialSessionRef.current = computeInitialSession({
      includePinnedTabs,
      initialDefaultTab,
      // Check the active-pinned tab against the migrated set that actually renders, not the raw
      // persisted pins — a pin dropped/redirected by migratePinnedTabs must not resolve as active.
      pinnedTabs: initialPins,
      persistedNormalTabs: persistedNormalTabs ?? [],
      persistedActiveTabId: persistedActiveTabId ?? ''
    })
  }

  // Normal tabs - in-memory storage, seeded from the restored session
  const [normalTabs, setNormalTabs] = useState<Tab[]>(() => initialSessionRef.current!.normalTabs)

  const normalTabsRef = useRef(normalTabs)
  useLayoutEffect(() => {
    normalTabsRef.current = normalTabs
  }, [normalTabs])
  const renderEpisode = pinnedTabFeedbackService.episode
  const beginPinnedEpisode = useCallback(() => {
    if (!includePinnedTabs) return
    if (pinnedTabFeedbackService.episode.closed) persistPinnedTabs([])
    pinnedTabFeedbackService.begin()
  }, [includePinnedTabs, persistPinnedTabs])
  const setPinnedTabs = useCallback(
    (
      action: Tab[] | ((prev: readonly Tab[]) => Tab[]),
      episode: PinnedTabFeedbackEpisode = pinnedTabFeedbackService.episode,
      survivingNormals = normalTabsRef.current
    ) => {
      if (!includePinnedTabs || episode !== pinnedTabFeedbackService.episode || episode.closed) return
      persistPinnedTabs((raw) => {
        const repaired = repairPinnedTabs(raw, survivingNormals).tabs
        const candidate = repairPinnedTabs(
          typeof action === 'function' ? action(repaired) : action,
          survivingNormals
        ).tabs
        return isEqual(raw, candidate) ? (raw as Tab[]) : candidate
      })
    },
    [includePinnedTabs, persistPinnedTabs]
  )
  const pinnedEpisodeClosed = renderEpisode.closed
  const availablePinnedTabs = useMemo(
    () => (includePinnedTabs && !pinnedEpisodeClosed ? repairPinnedTabs(pinnedTabs, normalTabs).tabs : []),
    [includePinnedTabs, pinnedTabs, normalTabs, pinnedEpisodeClosed]
  )

  // Active tab ID - in-memory storage, seeded from the restored session
  const [activeTabId, setActiveTabIdState] = useState<string>(() => initialSessionRef.current!.activeTabId)

  const activeTabIdRef = useRef(activeTabId)
  const setActiveTabId = useCallback((id: string) => {
    activeTabIdRef.current = id
    setActiveTabIdState(id)
  }, [])

  // Render the normalized pinned set on the first pass, then commit it to the persistent cache.
  // This avoids mounting background pinned routers before the effect runs while keeping the cache
  // as the source of truth for all subsequent pinned-tab updates.
  const hasRestoredPinnedTabsRef = useRef(!includePinnedTabs)
  const pinnedTabsForRender = hasRestoredPinnedTabsRef.current
    ? availablePinnedTabs
    : initialSessionRef.current.pinnedTabs

  // Write the session back on every change (main window only). Depends on the in-memory state,
  // not the persisted value, so there is no feedback loop; the cache's isEqual + 350ms debounce
  // coalesces redundant writes.
  useEffect(() => {
    if (!includePinnedTabs) return
    setPersistedNormalTabs(normalTabs.filter((tab) => !isTransientMiniAppTab(tab)))
  }, [includePinnedTabs, normalTabs, setPersistedNormalTabs])

  useEffect(() => {
    if (!includePinnedTabs) return
    setPersistedActiveTabId(activeTabId)
  }, [includePinnedTabs, activeTabId, setPersistedActiveTabId])

  // LRU manager (singleton)
  const lruManagerRef = useRef<TabLruManager | null>(null)
  if (!lruManagerRef.current) {
    lruManagerRef.current = new TabLruManager()
  }

  // Merge tabs: pinned + normal (route titles follow current i18n language)
  const tabs = useMemo(() => {
    const currentPinnedTabs = includePinnedTabs ? pinnedTabsForRender : []
    return [...currentPinnedTabs.map(withLocalizedRouteTitle), ...normalTabs.map(withLocalizedRouteTitle)]
  }, [includePinnedTabs, pinnedTabsForRender, normalTabs, i18n.language])

  // Local actions can span the normal and persisted pinned stores before React commits.
  // Keep a projected merged state for those batches, then reset it to committed state.
  const projectedTabsRef = useRef(tabs)
  useLayoutEffect(() => {
    projectedTabsRef.current = tabs
  }, [tabs])

  const applyTabLimit = useCallback((nextTabs: Tab[], nextActiveTabId: string) => {
    const awake = nextTabs.map((tab) =>
      tab.id === nextActiveTabId && tab.isDormant ? { ...tab, isDormant: false } : tab
    )
    const hibernatedIds = new Set(lruManagerRef.current!.checkAndGetDormantCandidates(awake, nextActiveTabId))
    const prepared = awake.map((tab) => hibernateTab(tab, hibernatedIds))
    projectedTabsRef.current = prepared
    return prepared
  }, [])

  const commitTabs = useCallback(
    (nextTabs: Tab[], primaryId: string) => {
      if (includePinnedTabs && (primaryId !== activeTabIdRef.current || !isEqual(projectedTabsRef.current, nextTabs))) {
        beginPinnedEpisode()
      }
      const prepared = applyTabLimit(nextTabs, primaryId)
      const normal = prepared.filter((tab) => !storesPinned(tab))
      normalTabsRef.current = normal
      setNormalTabs((prev) => (isEqual(prev, normal) ? prev : normal))
      if (includePinnedTabs) {
        const pinned = prepared.filter(storesPinned)
        setPinnedTabs(() => pinned, undefined, normal)
      }
      setActiveTabId(primaryId)
    },
    [applyTabLimit, storesPinned, includePinnedTabs, setPinnedTabs, setActiveTabId, beginPinnedEpisode]
  )

  // Repair later ingress before LRU preparation; startup dormancy is mount-only.
  useEffect(() => {
    if (includePinnedTabs && renderEpisode !== pinnedTabFeedbackService.episode) return
    const restoring = !hasRestoredPinnedTabsRef.current
    hasRestoredPinnedTabsRef.current = true
    const activeId = activeTabIdRef.current
    const prepared = applyTabLimit(tabs, activeTabId)
    if (includePinnedTabs) {
      const hibernatedIds = new Set(
        prepared.filter((tab, index) => tab.isDormant && !tabs[index].isDormant).map((tab) => tab.id)
      )
      const preparePins = (latest: readonly Tab[]): Tab[] => {
        const restored = restoring ? restoreTabs(latest, activeId) : [...latest]
        const localized = restored.map(withLocalizedRouteTitle)
        const next = localized.map((tab) =>
          hibernateTab(tab.id === activeId && tab.isDormant ? { ...tab, isDormant: false } : tab, hibernatedIds)
        )
        return next.every((tab, index) => tab === localized[index]) ? restored : next
      }
      const observedPinnedTabs = readPinnedTabs()
      const repair = repairPinnedTabs(observedPinnedTabs, normalTabsRef.current)
      if (!renderEpisode.closed) {
        const candidate = repairPinnedTabs(preparePins(repair.tabs), normalTabsRef.current).tabs
        if (pinnedTabFeedbackService.observe(renderEpisode, observedPinnedTabs, candidate) === 'tripped') {
          logger.warn('Pinned cache recovery', {
            key: 'ui.tab.pinned_tabs',
            reason: 'automatic feedback budget exhausted',
            count: renderEpisode.revisions
          })
        }
      }
      if (renderEpisode.closed) {
        const surviving = normalTabsRef.current.length ? normalTabsRef.current : [createLaunchpadFallbackTab()]
        const nextActiveId = surviving.some((tab) => tab.id === activeId) ? activeId : surviving[0].id
        const awake = surviving.map((tab) => (tab.id === nextActiveId ? { ...tab, isDormant: false } : tab))
        normalTabsRef.current = awake
        projectedTabsRef.current = awake
        setNormalTabs((prev) => (isEqual(prev, awake) ? prev : awake))
        setActiveTabId(nextActiveId)
        if (!isEqual(pinnedTabs, [])) persistPinnedTabs([])
        return
      }
      if (repair.changed) logger.info('Repaired pinned cache value', { key: 'ui.tab.pinned_tabs' })
      setPinnedTabs(preparePins, renderEpisode)
    }
    const changed = prepared.filter((tab, index) => tab !== tabs[index])
    if (changed.some((tab) => !storesPinned(tab))) setNormalTabs(prepared.filter((tab) => !storesPinned(tab)))
  }, [
    tabs,
    pinnedTabs,
    readPinnedTabs,
    activeTabId,
    applyTabLimit,
    storesPinned,
    includePinnedTabs,
    setPinnedTabs,
    persistPinnedTabs,
    renderEpisode,
    setActiveTabId
  ])

  const updateTab = useCallback(
    (id: string, updates: Partial<Tab>) => {
      const tab = projectedTabsRef.current.find((t) => t.id === id)
      if (!tab) return
      const updated = { ...tab, ...updates }
      if (isEqual(tab, updated)) return
      projectedTabsRef.current = projectedTabsRef.current.map((t) => (t.id === id ? updated : t))

      if (storesPinned(tab)) {
        setPinnedTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      } else {
        normalTabsRef.current = normalTabsRef.current.map((t) => (t.id === id ? { ...t, ...updates } : t))
        setNormalTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      }
    },
    [setPinnedTabs, storesPinned]
  )

  const setActiveTab = useCallback(
    (id: string) => {
      const targetTab = projectedTabsRef.current.find((t) => t.id === id)
      if (!targetTab) return
      if (id === activeTabId && !targetTab.isDormant) return

      // If a dormant tab was awakened, log it
      if (targetTab.isDormant) {
        logger.info('Tab awakened', { tabId: id, route: targetTab.url })
      }

      const lastAccessTime = Date.now()
      const nextTabs = projectedTabsRef.current.map((tab) =>
        tab.id === id ? { ...tab, lastAccessTime, isDormant: false } : tab
      )
      commitTabs(nextTabs, id)
    },
    [activeTabId, commitTabs]
  )

  const addTab = useCallback(
    (tab: Tab) => {
      const currentTabs = projectedTabsRef.current
      const exists = currentTabs.some((item) => item.id === tab.id)
      const activeIndex = currentTabs.findIndex((item) => item.id === activeTabIdRef.current)
      const refreshed = { ...tab, lastAccessTime: Date.now(), isDormant: false }
      const next = exists
        ? currentTabs.map((item) => (item.id === tab.id ? refreshed : item))
        : currentTabs.toSpliced(activeIndex < 0 ? currentTabs.length : activeIndex + 1, 0, refreshed)
      commitTabs(next, tab.id)
    },
    [commitTabs]
  )

  const closeTabs = useCallback(
    (ids: readonly string[], activateId?: string) => {
      const closingIdSet = new Set(ids)
      if (closingIdSet.size === 0) return

      const currentTabs = projectedTabsRef.current
      const closingTabs = currentTabs.filter((tab) => closingIdSet.has(tab.id))
      if (closingTabs.length === 0) return

      const remainingTabs = currentTabs.filter((tab) => !closingIdSet.has(tab.id))
      const fallbackTab = remainingTabs.length === 0 ? createLaunchpadFallbackTab() : null

      const currentActiveId = activeTabIdRef.current
      let newActiveId = currentActiveId
      if (fallbackTab) {
        newActiveId = fallbackTab.id
      } else if (closingIdSet.has(currentActiveId)) {
        // Prefer the caller-designated survivor (e.g. the tab whose menu ran
        // "close others"); otherwise hand the slot to the right neighbor and
        // fall back to the left one at the end of the strip.
        const preferredTab = activateId ? remainingTabs.find((tab) => tab.id === activateId) : undefined
        if (preferredTab) {
          newActiveId = preferredTab.id
        } else {
          const activeIndex = currentTabs.findIndex((tab) => tab.id === currentActiveId)
          const leftTab = [...currentTabs.slice(0, activeIndex)].reverse().find((tab) => !closingIdSet.has(tab.id))
          const rightTab = currentTabs.slice(activeIndex + 1).find((tab) => !closingIdSet.has(tab.id))
          newActiveId = (rightTab ?? leftTab)?.id ?? ''
        }
      }

      commitTabs(fallbackTab ? [fallbackTab] : remainingTabs, newActiveId)
    },
    [commitTabs]
  )

  const closeTab = useCallback((id: string) => closeTabs([id]), [closeTabs])

  const closeConversationTabsStateRef = useRef({ tabs, activeTabId, closeTabs })
  useLayoutEffect(() => {
    closeConversationTabsStateRef.current = { tabs, activeTabId, closeTabs }
  }, [tabs, activeTabId, closeTabs])

  const closeConversationTabs = useCallback<CloseConversationTabs>((appId, keys) => {
    const {
      tabs: latestTabs,
      activeTabId: latestActiveTabId,
      closeTabs: closeLatestTabs
    } = closeConversationTabsStateRef.current
    const tabIds = findClosableConversationTabIds(latestTabs, latestActiveTabId, appId, keys)
    if (tabIds.length > 0) closeLatestTabs(tabIds)
  }, [])

  /**
   * Open a Tab - reuses existing tab or creates new one
   */
  const openTab = useCallback(
    (url: string, options: OpenTabOptions = {}) => {
      const { forceNew = false, title, type = 'route', id, icon, metadata, isPinned } = options

      if (!forceNew) {
        const existingTab = projectedTabsRef.current.find((t) => t.type === type && t.url === url)
        if (existingTab) {
          addTab(existingTab)
          return existingTab.id
        }
      }

      const newTab: Tab = {
        id: id || uuid(),
        type,
        url,
        title: title || getDefaultRouteTitle(url),
        icon,
        metadata,
        isPinned,
        lastAccessTime: Date.now(),
        isDormant: false
      }

      addTab(newTab)
      return newTab.id
    },
    [addTab]
  )

  /**
   * Pin a tab in the tab bar. Pinned pages survive the soft budget but remain
   * subject to the hard memory fuse.
   */
  const pinTab = useCallback(
    (id: string) => {
      const tab = projectedTabsRef.current.find((t) => t.id === id)
      if (!tab || tab.isPinned || isTransientMiniAppTab(tab)) return

      if (!includePinnedTabs) {
        updateTab(id, { isPinned: true })
        return
      }

      beginPinnedEpisode()
      // Remove from normalTabs
      const normal = normalTabsRef.current.filter((t) => t.id !== id)
      normalTabsRef.current = normal
      projectedTabsRef.current = projectedTabsRef.current.map((t) => (t.id === id ? { ...t, isPinned: true } : t))
      setNormalTabs((prev) => prev.filter((t) => t.id !== id))
      // Add to pinnedTabs
      setPinnedTabs((prev) => [...prev, { ...tab, isPinned: true }], undefined, normal)

      logger.info('Tab pinned', { tabId: id })
    },
    [setPinnedTabs, includePinnedTabs, updateTab, beginPinnedEpisode]
  )

  /**
   * Unpin a tab
   */
  const unpinTab = useCallback(
    (id: string) => {
      const tab = projectedTabsRef.current.find((t) => t.id === id)
      if (!tab || !tab.isPinned) return

      if (!includePinnedTabs) {
        updateTab(id, { isPinned: false })
        return
      }

      beginPinnedEpisode()
      // Remove from pinnedTabs
      setPinnedTabs((prev) => prev.filter((t) => t.id !== id))
      // Add to normalTabs
      const normal = [...normalTabsRef.current, { ...tab, isPinned: false }]
      normalTabsRef.current = normal
      projectedTabsRef.current = projectedTabsRef.current.map((t) => (t.id === id ? { ...t, isPinned: false } : t))
      setNormalTabs((prev) => [...prev, { ...tab, isPinned: false }])

      logger.info('Tab unpinned', { tabId: id })
    },
    [setPinnedTabs, includePinnedTabs, updateTab, beginPinnedEpisode]
  )

  /**
   * Reorder tabs within their own list (for drag and drop)
   */
  const reorderTabs = useCallback(
    (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => {
      if (type === 'pinned' && !includePinnedTabs) return
      if (oldIndex === newIndex) return
      if (type === 'pinned') {
        beginPinnedEpisode()
        setPinnedTabs((prev) => {
          const newTabs = [...prev]
          const [removed] = newTabs.splice(oldIndex, 1)
          newTabs.splice(newIndex, 0, removed)
          return newTabs
        })
      } else {
        setNormalTabs((prev) => {
          const newTabs = [...prev]
          const [removed] = newTabs.splice(oldIndex, 1)
          newTabs.splice(newIndex, 0, removed)
          return newTabs
        })
      }
    },
    [setPinnedTabs, includePinnedTabs, beginPinnedEpisode]
  )

  /**
   * Detach a tab to a new window
   */
  const detachTab = useCallback(
    (tabId: string, activateId?: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return

      void ipcApi
        .request('tab.detach', tab)
        .then(() => closeTabs([tabId], activateId))
        .catch((error) => logger.error('Tab detach failed', error))
    },
    [tabs, closeTabs]
  )

  /**
   * Attach a tab from detached window
   */
  const attachTab = useCallback(
    (tab: Tab) => {
      if (projectedTabsRef.current.some((existing) => existing.id === tab.id)) {
        setActiveTab(tab.id)
      } else {
        addTab(tab)
      }
    },
    [addTab, setActiveTab]
  )

  // Listen for tab attach requests (from Main Process)
  useIpcOn('tab.attached', (tabData) => attachTab(tabData))

  useConversationNavigationOwner({ tabs, openTab, setActiveTab })

  /**
   * Get the currently active tab
   */
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId])

  const value: TabsContextValue = {
    // State
    tabs,
    activeTabId,
    activeTab,
    isLoading: false,

    // Basic operations
    addTab,
    closeTab,
    closeTabs,
    setActiveTab,
    updateTab,

    // High-level Tab operations
    openTab,

    // Pin operations
    pinTab,
    unpinTab,

    // Detach
    detachTab,

    // Attach
    attachTab,

    // Drag and drop
    reorderTabs
  }

  return (
    <CloseConversationTabsContext value={closeConversationTabs}>
      <TabsContext value={value}>
        {children}
        <AgentBrowserRuntimeHost />
      </TabsContext>
    </CloseConversationTabsContext>
  )
}

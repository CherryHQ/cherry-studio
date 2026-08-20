import { loggerService } from '@logger'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import {
  type OpenTabOptions,
  TabsContext,
  type TabsContextValue,
  useConversationNavigationOwner
} from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { TabLruManager } from '@renderer/services/TabLruManager'
import { getDefaultRouteTitle, isPageTitledRoute, isTopLevelRoute } from '@renderer/utils/routeTitle'
import type { Tab, TabSavedState } from '@shared/data/cache/cacheValueTypes'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'

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

function withLocalizedRouteTitle(tab: Tab): Tab {
  if (tab.type !== 'route') return tab
  // Chat / agent tabs are page-titled (topic / session name + assistant / agent
  // emoji set by their page) — never auto-localize, or the route title clobbers
  // the page title even for the bare `/app/chat` default tab.
  if (isPageTitledRoute(tab.url)) {
    return tab.title ? tab : { ...tab, title: getDefaultRouteTitle(tab.url) }
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

function restoreTabs(tabs: Tab[], activeTabId: string): Tab[] {
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
    normalTabs: initialDefaultTab ? [initialDefaultTab] : [],
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
    const activeTabId = pinnedHasActive ? persistedActiveTabId : (initialDefaultTab?.id ?? pinnedTabs[0]?.id ?? '')
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
  const [pinnedTabs, setPinnedTabs] = usePersistCache('ui.tab.pinned_tabs')

  // Whether a tab's `isPinned` should route it into the persistent pinned list. The main
  // window surfaces pinned tabs, so it follows the flag. A detached sub-window passes
  // `includePinnedTabs={false}`: it has no pinned section and must never write the shared
  // `ui.tab.pinned_tabs` cache, so every tab lives in the normal list there — `isPinned`
  // is kept on the object only to round-trip the pinned state back on re-attach.
  const storesPinned = useCallback(
    (tab: Pick<Tab, 'isPinned'>) => includePinnedTabs && !!tab.isPinned,
    [includePinnedTabs]
  )
  const restoredPinnedTabs = useMemo(() => pinnedTabs || [], [pinnedTabs])
  const migratedPinnedTabs = useMemo(() => migratePinnedTabs(restoredPinnedTabs), [restoredPinnedTabs])
  const availablePinnedTabs = migratedPinnedTabs.tabs

  // Normal tabs + active tab id - persisted so the session is restored on restart (main window
  // only). These remain the in-memory source of truth; the persist keys are read once for the
  // initial value and written back via effects below — none of the existing setters change.
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
    initialSessionRef.current = computeInitialSession({
      includePinnedTabs,
      initialDefaultTab,
      // Check the active-pinned tab against the migrated set that actually renders, not the raw
      // persisted pins — a pin dropped/redirected by migratePinnedTabs must not resolve as active.
      pinnedTabs: availablePinnedTabs,
      persistedNormalTabs: persistedNormalTabs ?? [],
      persistedActiveTabId: persistedActiveTabId ?? ''
    })
  }

  // Normal tabs - in-memory storage, seeded from the restored session
  const [normalTabs, setNormalTabs] = useState<Tab[]>(() => initialSessionRef.current!.normalTabs)

  // Active tab ID - in-memory storage, seeded from the restored session
  const [activeTabId, setActiveTabIdState] = useState<string>(() => initialSessionRef.current!.activeTabId)

  // Render the normalized pinned set on the first pass, then commit it to the persistent cache.
  // This avoids mounting background pinned routers before the effect runs while keeping the cache
  // as the source of truth for all subsequent pinned-tab updates.
  const hasRestoredPinnedTabsRef = useRef(!includePinnedTabs)
  const pinnedTabsForRender = hasRestoredPinnedTabsRef.current
    ? availablePinnedTabs
    : initialSessionRef.current.pinnedTabs
  useEffect(() => {
    if (!includePinnedTabs || hasRestoredPinnedTabsRef.current) return

    hasRestoredPinnedTabsRef.current = true
    setPinnedTabs(initialSessionRef.current!.pinnedTabs)
    if (migratedPinnedTabs.changed) {
      logger.info('Reconciled pinned tabs against removed/relocated routes', {
        before: restoredPinnedTabs.length,
        after: initialSessionRef.current!.pinnedTabs.length
      })
    }
  }, [includePinnedTabs, migratedPinnedTabs.changed, restoredPinnedTabs.length, setPinnedTabs])

  // Write the session back on every change (main window only). Depends on the in-memory state,
  // not the persisted value, so there is no feedback loop; the cache's isEqual + 200ms debounce
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

  const prepareTabsForCommit = useCallback((nextTabs: Tab[], nextActiveTabId: string) => {
    const hibernatedIds = new Set(lruManagerRef.current!.checkAndGetDormantCandidates(nextTabs, nextActiveTabId))
    if (hibernatedIds.size === 0) {
      projectedTabsRef.current = nextTabs
      return hibernatedIds
    }

    for (const tab of nextTabs) {
      if (hibernatedIds.has(tab.id)) {
        logger.info('Tab auto-hibernated (LRU)', { tabId: tab.id, route: tab.url })
      }
    }
    projectedTabsRef.current = nextTabs.map((tab) => hibernateTab(tab, hibernatedIds))
    return hibernatedIds
  }, [])

  // Run LRU over the merged stores so the hard fuse can see pinned tabs. This effect is
  // the fallback for external persisted-cache updates; local actions update both stores together.
  useEffect(() => {
    const hibernatedIdSet = prepareTabsForCommit(tabs, activeTabId)
    if (hibernatedIdSet.size === 0) return

    const hibernatingTabs = tabs.filter((tab) => hibernatedIdSet.has(tab.id))
    if (hibernatingTabs.some((tab) => !storesPinned(tab))) {
      setNormalTabs((prev) => prev.map((tab) => hibernateTab(tab, hibernatedIdSet)))
    }
    if (hibernatingTabs.some(storesPinned)) {
      setPinnedTabs((prev) => prev.map((tab) => hibernateTab(tab, hibernatedIdSet)))
    }
  }, [tabs, activeTabId, prepareTabsForCommit, storesPinned, setPinnedTabs])

  const updateTab = useCallback(
    (id: string, updates: Partial<Tab>) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return

      if (storesPinned(tab)) {
        setPinnedTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      } else {
        setNormalTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
      }
    },
    [tabs, setPinnedTabs, storesPinned]
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
      const hibernatedIds = prepareTabsForCommit(nextTabs, id)
      const hibernatingTabs = nextTabs.filter((tab) => hibernatedIds.has(tab.id))
      const update = (tab: Tab) =>
        hibernateTab(tab.id === id ? { ...tab, lastAccessTime, isDormant: false } : tab, hibernatedIds)

      if (storesPinned(targetTab) || hibernatingTabs.some(storesPinned)) {
        setPinnedTabs((prev) => prev.map(update))
      }
      if (!storesPinned(targetTab) || hibernatingTabs.some((tab) => !storesPinned(tab))) {
        setNormalTabs((prev) => prev.map(update))
      }

      setActiveTabIdState(id)
    },
    [activeTabId, prepareTabsForCommit, setPinnedTabs, storesPinned]
  )

  const addTab = useCallback(
    (tab: Tab) => {
      const exists = projectedTabsRef.current.find((t) => t.id === tab.id)
      if (exists) {
        setActiveTab(tab.id)
        return
      }

      const newTab: Tab = {
        ...tab,
        lastAccessTime: Date.now(),
        isDormant: false
      }

      const nextTabs = [...projectedTabsRef.current, newTab]
      const hibernatedIds = prepareTabsForCommit(nextTabs, newTab.id)
      const hibernatingTabs = nextTabs.filter((candidate) => hibernatedIds.has(candidate.id))
      const newTabIsPinned = storesPinned(newTab)

      if (newTabIsPinned || hibernatingTabs.some(storesPinned)) {
        setPinnedTabs((prev) => {
          const next = newTabIsPinned ? [...prev, newTab] : [...prev]
          return next.map((candidate) => hibernateTab(candidate, hibernatedIds))
        })
      }
      if (!newTabIsPinned || hibernatingTabs.some((candidate) => !storesPinned(candidate))) {
        setNormalTabs((prev) => {
          const next = newTabIsPinned ? prev : [...prev, newTab]
          return next.map((candidate) => hibernateTab(candidate, hibernatedIds))
        })
      }

      setActiveTabIdState(tab.id)
    },
    [prepareTabsForCommit, setActiveTab, setPinnedTabs, storesPinned]
  )

  const closeTabs = useCallback(
    (ids: readonly string[], activateId?: string) => {
      const closingIdSet = new Set(ids)
      if (closingIdSet.size === 0) return

      const closingTabs = tabs.filter((tab) => closingIdSet.has(tab.id))
      if (closingTabs.length === 0) return

      const remainingTabs = tabs.filter((tab) => !closingIdSet.has(tab.id))
      const fallbackTab = remainingTabs.length === 0 ? createLaunchpadFallbackTab() : null

      let newActiveId = activeTabId
      if (fallbackTab) {
        newActiveId = fallbackTab.id
      } else if (closingIdSet.has(activeTabId)) {
        // Prefer the caller-designated survivor (e.g. the tab whose menu ran
        // "close others"); otherwise hand the slot to the right neighbor and
        // fall back to the left one at the end of the strip.
        const preferredTab = activateId ? remainingTabs.find((tab) => tab.id === activateId) : undefined
        if (preferredTab) {
          newActiveId = preferredTab.id
        } else {
          const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
          const leftTab = [...tabs.slice(0, activeIndex)].reverse().find((tab) => !closingIdSet.has(tab.id))
          const rightTab = tabs.slice(activeIndex + 1).find((tab) => !closingIdSet.has(tab.id))
          newActiveId = (rightTab ?? leftTab)?.id ?? ''
        }
      }

      const pinnedIds = new Set(closingTabs.filter(storesPinned).map((tab) => tab.id))
      const normalIds = new Set(closingTabs.filter((tab) => !storesPinned(tab)).map((tab) => tab.id))

      // Activating a tab must also wake it — a dormant tab is not rendered, so
      // only switching activeTabId would leave the content area blank.
      const reselectedTab =
        newActiveId !== activeTabId ? remainingTabs.find((tab) => tab.id === newActiveId) : undefined
      const wakeInPinned = !!reselectedTab?.isDormant && storesPinned(reselectedTab)
      const wakeInNormal = !!reselectedTab?.isDormant && !storesPinned(reselectedTab)
      const wake = (tab: Tab) =>
        tab.id === newActiveId ? { ...tab, isDormant: false, lastAccessTime: Date.now() } : tab

      if (pinnedIds.size > 0 || wakeInPinned) {
        setPinnedTabs((prev) => {
          // The persist-cache updater receives a readonly view and must return
          // a fresh mutable array, so the no-filter branch copies.
          const next = pinnedIds.size > 0 ? prev.filter((tab) => !pinnedIds.has(tab.id)) : [...prev]
          return wakeInPinned ? next.map(wake) : next
        })
      }
      if (normalIds.size > 0 || fallbackTab || wakeInNormal) {
        setNormalTabs((prev) => {
          let next = normalIds.size > 0 ? prev.filter((tab) => !normalIds.has(tab.id)) : prev
          if (wakeInNormal) next = next.map(wake)
          return fallbackTab ? [fallbackTab] : next
        })
      }

      setActiveTabIdState(newActiveId)
    },
    [tabs, activeTabId, setPinnedTabs, storesPinned]
  )

  const closeTab = useCallback((id: string) => closeTabs([id]), [closeTabs])

  /**
   * Open a Tab - reuses existing tab or creates new one
   */
  const openTab = useCallback(
    (url: string, options: OpenTabOptions = {}) => {
      const { forceNew = false, title, type = 'route', id, icon, metadata, isPinned } = options

      if (!forceNew) {
        const existingTab = tabs.find((t) => t.type === type && t.url === url)
        if (existingTab) {
          setActiveTab(existingTab.id)
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
    [tabs, setActiveTab, addTab]
  )

  /**
   * Pin a tab in the tab bar. Pinned pages survive the soft budget but remain
   * subject to the hard memory fuse.
   */
  const pinTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab || tab.isPinned || isTransientMiniAppTab(tab)) return

      // Remove from normalTabs
      setNormalTabs((prev) => prev.filter((t) => t.id !== id))
      // Add to pinnedTabs
      setPinnedTabs((prev) => [...prev, { ...tab, isPinned: true }])

      logger.info('Tab pinned', { tabId: id })
    },
    [tabs, setPinnedTabs]
  )

  /**
   * Unpin a tab
   */
  const unpinTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab || !tab.isPinned) return

      // Remove from pinnedTabs
      setPinnedTabs((prev) => prev.filter((t) => t.id !== id))
      // Add to normalTabs
      setNormalTabs((prev) => [...prev, { ...tab, isPinned: false }])

      logger.info('Tab unpinned', { tabId: id })
    },
    [tabs, setPinnedTabs]
  )

  /**
   * Reorder tabs within their own list (for drag and drop)
   */
  const reorderTabs = useCallback(
    (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      if (type === 'pinned') {
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
    [setPinnedTabs]
  )

  /**
   * Detach a tab to a new window
   */
  const detachTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return

      // Send IPC message to create new window
      void ipcApi.request('tab.detach', tab)

      // Remove tab from current window — closeTab handles both pinned and normal tabs
      closeTab(tabId)
    },
    [tabs, closeTab]
  )

  /**
   * Attach a tab from detached window
   */
  const attachTab = useCallback(
    (tabData: Tab) => {
      // Check if tab already exists
      const exists = tabs.find((t) => t.id === tabData.id)
      if (exists) {
        setActiveTab(tabData.id)
        logger.info('Tab already exists, activating', { tabId: tabData.id })
        return
      }

      // Restore tab with updated timestamp. addTab applies the shared awake budget
      // before the attached route can be committed.
      const restoredTab: Tab = {
        ...tabData,
        lastAccessTime: Date.now(),
        isDormant: false
      }

      addTab(restoredTab)
      logger.info('Tab attached from detached window', { tabId: tabData.id, url: tabData.url })
    },
    [addTab, tabs, setActiveTab]
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

  return <TabsContext value={value}>{children}</TabsContext>
}

import { loggerService } from '@logger'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import {
  type CloseConversationTabs,
  CloseConversationTabsContext,
  findClosableConversationTabIds,
  type OpenTabOptions,
  TabsContext,
  type TabsContextValue,
  useConversationNavigationOwner
} from '@renderer/hooks/tab'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { TabLruManager } from '@renderer/services/TabLruManager'
import {
  getTabWorkspaceKey,
  getWorkspaceFavorite,
  getWorkspaceKeyForFavorite,
  getWorkspaceKeyForUrl,
  isNavigationWorkspaceKey,
  isTabVisibleInTabBar,
  LAUNCHPAD_WORKSPACE_KEY,
  type NavigationWorkspaceKey,
  normalizeSidebarWorkspaceSession
} from '@renderer/utils/navigationWorkspace'
import { getDefaultRouteTitle, isPageTitledRoute, isTopLevelRoute } from '@renderer/utils/routeTitle'
import type { Tab, TabSavedState } from '@shared/data/cache/cacheValueTypes'
import type { NavigationLayout } from '@shared/data/preference/preferenceTypes'
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
  workspaceKey: 'app:assistants',
  lastAccessTime: Date.now(),
  isDormant: false
}

function createLaunchpadFallbackTab(): Tab {
  return {
    id: uuid(),
    type: 'route',
    url: '/app/launchpad',
    title: getDefaultRouteTitle('/app/launchpad'),
    workspaceKey: LAUNCHPAD_WORKSPACE_KEY,
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
  const [preferredNavigationLayout] = usePreference('ui.navigation.layout')
  const navigationLayout: NavigationLayout = includePinnedTabs ? preferredNavigationLayout : 'tabs'
  const { favorites: sidebarFavorites, ensureFavoritesPinned } = useSidebarFavorites()

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
    const restoredSession = computeInitialSession({
      includePinnedTabs,
      initialDefaultTab,
      // Check the active-pinned tab against the migrated set that actually renders, not the raw
      // persisted pins — a pin dropped/redirected by migratePinnedTabs must not resolve as active.
      pinnedTabs: availablePinnedTabs,
      persistedNormalTabs: persistedNormalTabs ?? [],
      persistedActiveTabId: persistedActiveTabId ?? ''
    })
    if (navigationLayout === 'sidebar') {
      const normalized = normalizeSidebarWorkspaceSession(
        [...restoredSession.pinnedTabs, ...restoredSession.normalTabs],
        restoredSession.activeTabId
      )
      const fallbackTab = normalized.tabs.length === 0 ? createLaunchpadFallbackTab() : undefined
      initialSessionRef.current = {
        normalTabs: fallbackTab ? [fallbackTab] : normalized.tabs,
        pinnedTabs: [],
        activeTabId: fallbackTab?.id ?? normalized.activeTabId
      }
    } else {
      const revealActiveTab = (tab: Tab) =>
        tab.id === restoredSession.activeTabId && !isTabVisibleInTabBar(tab) ? { ...tab, isTabBarVisible: true } : tab
      initialSessionRef.current = {
        ...restoredSession,
        normalTabs: restoredSession.normalTabs.map(revealActiveTab),
        pinnedTabs: restoredSession.pinnedTabs.map(revealActiveTab)
      }
    }
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
  const tabBarTabs = useMemo(() => tabs.filter(isTabVisibleInTabBar), [tabs])

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

      const resolvedUpdates =
        updates.url !== undefined && !Object.prototype.hasOwnProperty.call(updates, 'workspaceKey')
          ? { ...updates, workspaceKey: getWorkspaceKeyForUrl(updates.url) }
          : updates

      if (storesPinned(tab)) {
        setPinnedTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...resolvedUpdates } : t)))
      } else {
        setNormalTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...resolvedUpdates } : t)))
      }
    },
    [tabs, setPinnedTabs, storesPinned]
  )

  const setActiveTab = useCallback(
    (id: string) => {
      const targetTab = projectedTabsRef.current.find((t) => t.id === id)
      if (!targetTab) return
      if (
        id === activeTabId &&
        !targetTab.isDormant &&
        (navigationLayout === 'sidebar' || isTabVisibleInTabBar(targetTab))
      ) {
        return
      }

      // If a dormant tab was awakened, log it
      if (targetTab.isDormant) {
        logger.info('Tab awakened', { tabId: id, route: targetTab.url })
      }

      const activeTab = projectedTabsRef.current.find((tab) => tab.id === activeTabId)
      const discardedFocusedTab =
        navigationLayout !== 'both' && activeTab && !getTabWorkspaceKey(activeTab) && getTabWorkspaceKey(targetTab)
          ? activeTab
          : undefined
      const lastAccessTime = Date.now()
      const nextTabs = projectedTabsRef.current
        .filter((tab) => tab.id !== discardedFocusedTab?.id)
        .map((tab) =>
          tab.id === id
            ? {
                ...tab,
                lastAccessTime,
                isDormant: false,
                isTabBarVisible: navigationLayout !== 'sidebar' ? true : tab.isTabBarVisible
              }
            : tab
        )
      const hibernatedIds = prepareTabsForCommit(nextTabs, id)
      const hibernatingTabs = nextTabs.filter((tab) => hibernatedIds.has(tab.id))
      const update = (tab: Tab) =>
        hibernateTab(
          tab.id === id
            ? {
                ...tab,
                lastAccessTime,
                isDormant: false,
                isTabBarVisible: navigationLayout !== 'sidebar' ? true : tab.isTabBarVisible
              }
            : tab,
          hibernatedIds
        )

      if (
        storesPinned(targetTab) ||
        hibernatingTabs.some(storesPinned) ||
        (discardedFocusedTab && storesPinned(discardedFocusedTab))
      ) {
        setPinnedTabs((prev) => prev.filter((tab) => tab.id !== discardedFocusedTab?.id).map(update))
      }
      if (
        !storesPinned(targetTab) ||
        hibernatingTabs.some((tab) => !storesPinned(tab)) ||
        (discardedFocusedTab && !storesPinned(discardedFocusedTab))
      ) {
        setNormalTabs((prev) => prev.filter((tab) => tab.id !== discardedFocusedTab?.id).map(update))
      }

      setActiveTabIdState(id)
    },
    [activeTabId, navigationLayout, prepareTabsForCommit, setPinnedTabs, storesPinned]
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
        isDormant: false,
        isTabBarVisible: navigationLayout !== 'sidebar'
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
    [navigationLayout, prepareTabsForCommit, setActiveTab, setPinnedTabs, storesPinned]
  )

  const closeTabs = useCallback(
    (ids: readonly string[], activateId?: string) => {
      const closingIdSet = new Set(ids)
      if (closingIdSet.size === 0) return

      const closingTabs = tabs.filter((tab) => closingIdSet.has(tab.id))
      if (closingTabs.length === 0) return

      const remainingTabs = tabs.filter((tab) => !closingIdSet.has(tab.id))
      const navigationTabs = navigationLayout !== 'sidebar' ? tabs.filter(isTabVisibleInTabBar) : tabs
      let fallbackTab: Tab | null = null
      let newActiveId = activeTabId
      if (closingIdSet.has(activeTabId)) {
        // Prefer the caller-designated survivor (e.g. the tab whose menu ran
        // "close others"); otherwise hand the slot to the right neighbor and
        // fall back to the left one at the end of the strip.
        const preferredTab = activateId ? remainingTabs.find((tab) => tab.id === activateId) : undefined
        if (preferredTab) {
          newActiveId = preferredTab.id
        } else {
          const activeIndex = navigationTabs.findIndex((tab) => tab.id === activeTabId)
          const leftTab = [...navigationTabs.slice(0, activeIndex)].reverse().find((tab) => !closingIdSet.has(tab.id))
          const rightTab = navigationTabs.slice(activeIndex + 1).find((tab) => !closingIdSet.has(tab.id))
          const hiddenLaunchpad =
            navigationLayout !== 'sidebar'
              ? remainingTabs.find(
                  (tab) => getTabWorkspaceKey(tab) === LAUNCHPAD_WORKSPACE_KEY && !isTabVisibleInTabBar(tab)
                )
              : undefined
          const nextTab = rightTab ?? leftTab ?? hiddenLaunchpad
          if (nextTab) {
            newActiveId = nextTab.id
          } else {
            fallbackTab = {
              ...createLaunchpadFallbackTab(),
              isTabBarVisible: navigationLayout !== 'sidebar'
            }
            newActiveId = fallbackTab.id
          }
        }
      }

      const pinnedIds = new Set(closingTabs.filter(storesPinned).map((tab) => tab.id))
      const normalIds = new Set(closingTabs.filter((tab) => !storesPinned(tab)).map((tab) => tab.id))

      // Activating a tab must also wake it — a dormant tab is not rendered, so
      // only switching activeTabId would leave the content area blank.
      const reselectedTab =
        newActiveId !== activeTabId ? remainingTabs.find((tab) => tab.id === newActiveId) : undefined
      const shouldRevealReselectedTab =
        navigationLayout !== 'sidebar' && !!reselectedTab && !isTabVisibleInTabBar(reselectedTab)
      const updateReselectedPinned =
        !!reselectedTab && (reselectedTab.isDormant || shouldRevealReselectedTab) && storesPinned(reselectedTab)
      const updateReselectedNormal =
        !!reselectedTab && (reselectedTab.isDormant || shouldRevealReselectedTab) && !storesPinned(reselectedTab)
      const select = (tab: Tab) =>
        tab.id === newActiveId
          ? {
              ...tab,
              isDormant: false,
              isTabBarVisible: navigationLayout !== 'sidebar' ? true : tab.isTabBarVisible,
              lastAccessTime: Date.now()
            }
          : tab

      if (pinnedIds.size > 0 || updateReselectedPinned) {
        setPinnedTabs((prev) => {
          // The persist-cache updater receives a readonly view and must return
          // a fresh mutable array, so the no-filter branch copies.
          const next = pinnedIds.size > 0 ? prev.filter((tab) => !pinnedIds.has(tab.id)) : [...prev]
          return updateReselectedPinned ? next.map(select) : next
        })
      }
      if (normalIds.size > 0 || fallbackTab || updateReselectedNormal) {
        setNormalTabs((prev) => {
          let next = normalIds.size > 0 ? prev.filter((tab) => !normalIds.has(tab.id)) : prev
          if (updateReselectedNormal) next = next.map(select)
          return fallbackTab ? [...next, fallbackTab] : next
        })
      }

      setActiveTabIdState(newActiveId)
    },
    [tabs, activeTabId, navigationLayout, setPinnedTabs, storesPinned]
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
  const openTabRaw = useCallback(
    (url: string, options: OpenTabOptions = {}) => {
      const { forceNew = false, title, type = 'route', id, icon, metadata, workspaceKey, isPinned } = options

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
        workspaceKey: workspaceKey ?? getWorkspaceKeyForUrl(url),
        metadata,
        isPinned: navigationLayout !== 'sidebar' ? isPinned : false,
        lastAccessTime: Date.now(),
        isDormant: false
      }

      addTab(newTab)
      return newTab.id
    },
    [addTab, navigationLayout, setActiveTab, tabs]
  )

  const ensureWorkspaceFavorites = useCallback(
    (workspaceKeys: readonly NavigationWorkspaceKey[]) => {
      const favoriteKeys = new Set(sidebarFavorites.flatMap((favorite) => getWorkspaceKeyForFavorite(favorite) ?? []))
      const additions = workspaceKeys.flatMap((workspaceKey) => {
        if (favoriteKeys.has(workspaceKey)) return []
        const favorite = getWorkspaceFavorite(workspaceKey)
        if (!favorite) return []
        favoriteKeys.add(workspaceKey)
        return [favorite]
      })
      if (additions.length > 0) ensureFavoritesPinned(additions)
    },
    [ensureFavoritesPinned, sidebarFavorites]
  )

  const activateWorkspace = useCallback(
    (workspaceKey: string, route: string, options: OpenTabOptions = {}) => {
      const resolvedWorkspaceKey = isNavigationWorkspaceKey(workspaceKey) ? workspaceKey : getWorkspaceKeyForUrl(route)
      if (!resolvedWorkspaceKey) return openTabRaw(route, options)

      if (navigationLayout === 'sidebar') ensureWorkspaceFavorites([resolvedWorkspaceKey])

      const existingTab = projectedTabsRef.current.find((tab) => getTabWorkspaceKey(tab) === resolvedWorkspaceKey)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return existingTab.id
      }

      const activeTab = projectedTabsRef.current.find((tab) => tab.id === activeTabId)
      if (activeTab && !getTabWorkspaceKey(activeTab)) {
        closeTabs([activeTab.id])
      }

      return openTabRaw(route, {
        ...options,
        forceNew: true,
        workspaceKey: resolvedWorkspaceKey
      })
    },
    [activeTabId, closeTabs, ensureWorkspaceFavorites, navigationLayout, openTabRaw, setActiveTab]
  )

  const openFocusedRoute = useCallback(
    (route: string, returnWorkspaceId?: string, options: OpenTabOptions = {}) => {
      const currentTabs = projectedTabsRef.current
      const active = currentTabs.find((tab) => tab.id === activeTabId)
      const focusedTab =
        active && !getTabWorkspaceKey(active) ? active : currentTabs.find((tab) => !getTabWorkspaceKey(tab))
      const duplicateFocusedTabIds = currentTabs
        .filter((tab) => !getTabWorkspaceKey(tab) && tab.id !== focusedTab?.id)
        .map((tab) => tab.id)
      const sourceWorkspaceId =
        returnWorkspaceId ??
        (active && getTabWorkspaceKey(active) ? active.id : undefined) ??
        (typeof active?.metadata?.returnWorkspaceId === 'string' ? active.metadata.returnWorkspaceId : undefined)
      const metadata = {
        ...options.metadata,
        ...(sourceWorkspaceId ? { returnWorkspaceId: sourceWorkspaceId } : {})
      }

      if (focusedTab) {
        if (duplicateFocusedTabIds.length > 0) closeTabs(duplicateFocusedTabIds, focusedTab.id)
        updateTab(focusedTab.id, {
          type: options.type ?? 'route',
          url: route,
          title: options.title ?? getDefaultRouteTitle(route),
          icon: options.icon,
          workspaceKey: undefined,
          metadata,
          lastAccessTime: Date.now(),
          isDormant: false
        })
        setActiveTab(focusedTab.id)
        return focusedTab.id
      }

      return openTabRaw(route, {
        ...options,
        forceNew: true,
        workspaceKey: undefined,
        metadata
      })
    },
    [activeTabId, closeTabs, openTabRaw, setActiveTab, updateTab]
  )

  const closeFocusedRoute = useCallback(() => {
    const active = projectedTabsRef.current.find((tab) => tab.id === activeTabId)
    if (!active || getTabWorkspaceKey(active)) return

    const requestedReturnId =
      typeof active.metadata?.returnWorkspaceId === 'string' ? active.metadata.returnWorkspaceId : undefined
    const returnWorkspace = projectedTabsRef.current.find(
      (tab) => tab.id === requestedReturnId && getTabWorkspaceKey(tab)
    )
    const fallbackWorkspace =
      returnWorkspace ??
      projectedTabsRef.current.reduce<Tab | undefined>((latest, tab) => {
        if (!getTabWorkspaceKey(tab)) return latest
        return !latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest
      }, undefined)

    closeTabs([active.id], fallbackWorkspace?.id)
  }, [activeTabId, closeTabs])

  const closeWorkspace = useCallback(
    (workspaceKey: string) => {
      if (!isNavigationWorkspaceKey(workspaceKey)) return
      const closingIds = projectedTabsRef.current
        .filter((tab) => getTabWorkspaceKey(tab) === workspaceKey)
        .map((tab) => tab.id)
      if (closingIds.length === 0) return

      const remainingWorkspace = projectedTabsRef.current.reduce<Tab | undefined>((latest, tab) => {
        if (closingIds.includes(tab.id) || !getTabWorkspaceKey(tab)) return latest
        return !latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest
      }, undefined)
      closeTabs(closingIds, remainingWorkspace?.id)
    },
    [closeTabs]
  )

  const openRoute = useCallback(
    (url: string, options: OpenTabOptions = {}) => {
      if (navigationLayout === 'both') return openTabRaw(url, options)

      const workspaceKey = getWorkspaceKeyForUrl(url)
      if (!workspaceKey) return openFocusedRoute(url, undefined, options)
      if (navigationLayout === 'tabs') {
        const activeTab = projectedTabsRef.current.find((tab) => tab.id === activeTabId)
        if (activeTab && !getTabWorkspaceKey(activeTab)) closeTabs([activeTab.id])
        return openTabRaw(url, { ...options, workspaceKey })
      }

      const existingTab = projectedTabsRef.current.find((tab) => getTabWorkspaceKey(tab) === workspaceKey)
      if (!existingTab) return activateWorkspace(workspaceKey, url, options)

      if (existingTab.url !== url || options.title || options.icon || options.metadata) {
        updateTab(existingTab.id, {
          type: options.type ?? existingTab.type,
          url,
          title: options.title ?? getDefaultRouteTitle(url),
          icon: options.icon,
          workspaceKey,
          metadata: { ...existingTab.metadata, ...options.metadata },
          lastAccessTime: Date.now(),
          isDormant: false,
          isPinned: false
        })
      }
      return activateWorkspace(workspaceKey, url, options)
    },
    [activateWorkspace, activeTabId, closeTabs, navigationLayout, openFocusedRoute, openTabRaw, updateTab]
  )

  const openTab = openRoute

  const previousNavigationLayoutRef = useRef<NavigationLayout | null>(null)
  useLayoutEffect(() => {
    const previousLayout = previousNavigationLayoutRef.current
    previousNavigationLayoutRef.current = navigationLayout

    if (navigationLayout === 'sidebar') {
      const normalized = normalizeSidebarWorkspaceSession(tabs, activeTabId)
      if (normalized.tabs.length === 0) {
        const fallbackTab = createLaunchpadFallbackTab()
        setPinnedTabs([])
        setNormalTabs([fallbackTab])
        setActiveTabIdState(fallbackTab.id)
        return
      }

      const workspaceKeys = normalized.tabs.flatMap((tab) => {
        const workspaceKey = getTabWorkspaceKey(tab)
        return workspaceKey ? [workspaceKey] : []
      })
      ensureWorkspaceFavorites(workspaceKeys)

      const needsRewrite =
        normalized.activeTabId !== activeTabId ||
        normalized.tabs.length !== tabs.length ||
        normalized.tabs.some((normalizedTab, index) => {
          const tab = tabs[index]
          return (
            !tab ||
            tab.id !== normalizedTab.id ||
            tab.workspaceKey !== normalizedTab.workspaceKey ||
            Boolean(tab.isPinned) !== Boolean(normalizedTab.isPinned)
          )
        })
      if (!needsRewrite) return

      setPinnedTabs([])
      setNormalTabs(normalized.tabs)
      setActiveTabIdState(normalized.activeTabId)
      return
    }

    if (navigationLayout === 'both') {
      const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
      if (!activeTab) return

      const retainedIds = new Set(
        previousLayout === 'sidebar' ? [] : tabs.filter(isTabVisibleInTabBar).map((tab) => tab.id)
      )
      retainedIds.add(activeTab.id)
      if (!getTabWorkspaceKey(activeTab)) {
        const requestedReturnId =
          typeof activeTab.metadata?.returnWorkspaceId === 'string' ? activeTab.metadata.returnWorkspaceId : undefined
        const returnWorkspace = tabs.find((tab) => tab.id === requestedReturnId && Boolean(getTabWorkspaceKey(tab)))
        const fallbackWorkspace =
          returnWorkspace ??
          tabs.reduce<Tab | undefined>((latest, tab) => {
            if (!getTabWorkspaceKey(tab)) return latest
            return !latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest
          }, undefined)
        if (fallbackWorkspace) retainedIds.add(fallbackWorkspace.id)
      }

      const combinedTabs = tabs
        .filter((tab) => retainedIds.has(tab.id))
        .map((tab) => ({
          ...tab,
          isPinned: previousLayout === 'sidebar' ? false : tab.isPinned,
          isTabBarVisible: true
        }))
      const exposureUnchanged =
        combinedTabs.length === tabs.length &&
        combinedTabs.every((tab, index) => {
          const previousTab = tabs[index]
          return (
            !!previousTab &&
            tab.id === previousTab.id &&
            isTabVisibleInTabBar(tab) === isTabVisibleInTabBar(previousTab) &&
            Boolean(tab.isPinned) === Boolean(previousTab.isPinned)
          )
        })
      if (exposureUnchanged) return

      setPinnedTabs(combinedTabs.filter(storesPinned))
      setNormalTabs(combinedTabs.filter((tab) => !storesPinned(tab)))
      return
    }

    if (previousLayout !== 'sidebar') return

    const topLayoutTabs = tabs.map((tab) => ({
      ...tab,
      isPinned: false,
      isTabBarVisible: tab.id === activeTabId
    }))
    const visibilityUnchanged = topLayoutTabs.every(
      (tab, index) =>
        tab.id === normalTabs[index]?.id &&
        !!normalTabs[index] &&
        isTabVisibleInTabBar(tab) === isTabVisibleInTabBar(normalTabs[index]) &&
        Boolean(tab.isPinned) === Boolean(normalTabs[index]?.isPinned)
    )
    if (visibilityUnchanged && topLayoutTabs.length === normalTabs.length) return

    setPinnedTabs([])
    setNormalTabs(topLayoutTabs)
  }, [activeTabId, ensureWorkspaceFavorites, navigationLayout, normalTabs, setPinnedTabs, storesPinned, tabs])

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
      const reorder = (currentTabs: readonly Tab[]) => {
        const reorderableTabs =
          navigationLayout !== 'sidebar' ? currentTabs.filter(isTabVisibleInTabBar) : [...currentTabs]
        const reorderedTabs = [...reorderableTabs]
        const [removed] = reorderedTabs.splice(oldIndex, 1)
        if (!removed) return [...currentTabs]
        reorderedTabs.splice(newIndex, 0, removed)

        const reorderableIds = new Set(reorderedTabs.map((tab) => tab.id))
        let reorderedIndex = 0
        return currentTabs.map((tab) => (reorderableIds.has(tab.id) ? reorderedTabs[reorderedIndex++] : tab))
      }

      if (type === 'pinned') {
        setPinnedTabs(reorder)
      } else {
        setNormalTabs(reorder)
      }
    },
    [navigationLayout, setPinnedTabs]
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
    tabBarTabs,
    activeTabId,
    activeTab,
    isLoading: false,
    navigationLayout,

    // Basic operations
    addTab,
    closeTab,
    closeTabs,
    setActiveTab,
    updateTab,

    // High-level Tab operations
    openTab,
    openRoute,
    activateWorkspace,
    closeWorkspace,
    closeFocusedRoute,

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
      <TabsContext value={value}>{children}</TabsContext>
    </CloseConversationTabsContext>
  )
}

import {
  buildTabInstanceMetadata,
  getTabInstanceAppId,
  getTabInstanceKey,
  hasTabInstanceMetadataForApp
} from '@renderer/utils/tabInstanceMetadata'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarFavorite, SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'

/**
 * Context passed to sidebar navigation handlers. Carries per-call state the
 * registry can't know on its own (preferences, persisted "last used" cache).
 */
export interface SidebarNavContext {
  defaultPaintingProvider: string
  /** Cross-window persistent "last focused chat topic" — drives `assistants` defaultKey. */
  lastUsedTopicId?: string | null
  /** Cross-window persistent "last focused agent session" — drives `agents` defaultKey. */
  lastUsedSessionId?: string | null
}

/**
 * Apps that hold navigable sub-instances (chat→topic, agent→session) carry an
 * `instanceKey`. Sidebar click then focuses the tab whose key matches the
 * "last focused" key (`defaultKey`) instead of focusing an arbitrary tab.
 * Apps without it (files / notes / paintings / …) are plain focus-or-open.
 */
export interface SidebarInstanceKey {
  /** Extract the instance key (topicId / sessionId) from an existing tab url. */
  keyFromUrl: (url: string) => string | undefined
  /** The instance key to target on sidebar click (cross-window "last focused"). */
  defaultKey: (ctx: SidebarNavContext) => string | undefined
  /** Build the tab url for an instance key (keeps dispatch app-agnostic). */
  urlForKey: (key: string) => string
}

interface SidebarAppDefinition<Id extends SidebarFavorite = SidebarFavorite> {
  id: Id
  routePrefix: string
  /** Url to open when no tab exists yet (defaults to `routePrefix`). */
  resolveUrl?: (ctx: SidebarNavContext) => string
  /** Focus only the exact base route instead of any sub-route owned by the app. */
  exactRouteFocus?: boolean
  instanceKey?: SidebarInstanceKey
}

function getNormalConversationSearchParamFromUrl(url: string, name: string): string | undefined {
  try {
    const params = new URL(url, 'app://x').searchParams
    if (params.get('view') === 'message') return undefined
    return params.get(name) ?? undefined
  } catch {
    return undefined
  }
}

function isMessageOnlyConversationUrl(url: string): boolean {
  try {
    return new URL(url, 'app://x').searchParams.get('view') === 'message'
  } catch {
    return false
  }
}

/**
 * Single source of truth for sidebar applications.
 * Order here is the canonical sidebar order and drives preference defaults.
 */
const SIDEBAR_APP_DEFINITIONS = [
  {
    id: 'assistants',
    routePrefix: '/app/chat',
    instanceKey: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, 'topicId'),
      defaultKey: ({ lastUsedTopicId }) => lastUsedTopicId ?? undefined,
      urlForKey: (key) => `/app/chat?topicId=${encodeURIComponent(key)}`
    }
  },
  {
    id: 'agents',
    routePrefix: '/app/agents',
    instanceKey: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, 'sessionId'),
      defaultKey: ({ lastUsedSessionId }) => lastUsedSessionId ?? undefined,
      urlForKey: (key) => `/app/agents?sessionId=${encodeURIComponent(key)}`
    }
  },
  {
    id: 'paintings',
    routePrefix: '/app/paintings',
    resolveUrl: ({ defaultPaintingProvider }) => `/app/paintings/${defaultPaintingProvider}`
  },
  {
    id: 'translate',
    routePrefix: '/app/translate'
  },
  {
    id: 'store',
    routePrefix: '/app/library'
  },
  {
    id: 'mini_app',
    routePrefix: '/app/mini-app',
    exactRouteFocus: true
  },
  {
    id: 'knowledge',
    routePrefix: '/app/knowledge'
  },
  {
    id: 'files',
    routePrefix: '/app/files'
  },
  {
    id: 'code_tools',
    routePrefix: '/app/code'
  },
  {
    id: 'notes',
    routePrefix: '/app/notes'
  },
  {
    id: 'openclaw',
    routePrefix: '/app/openclaw'
  }
] as const satisfies readonly SidebarAppDefinition[]

export type SidebarAppId = (typeof SIDEBAR_APP_DEFINITIONS)[number]['id']
export type SidebarApp = SidebarAppDefinition<SidebarAppId>

export const SIDEBAR_APPS: readonly SidebarApp[] = SIDEBAR_APP_DEFINITIONS

const SIDEBAR_APP_BY_ID: Record<SidebarAppId, SidebarApp> = SIDEBAR_APPS.reduce(
  (acc, app) => {
    acc[app.id] = app
    return acc
  },
  {} as Record<SidebarAppId, SidebarApp>
)

export function getSidebarApp(id: SidebarAppId): SidebarApp | undefined {
  return SIDEBAR_APP_BY_ID[id]
}

/**
 * A tab belongs to an app when its url is the route itself, a path sub-route,
 * or a query-param instance of it. Shared by the sidebar dispatcher and the
 * conversation-navigation boundary so the matcher lives in exactly one place.
 */
export function tabBelongsToApp(app: SidebarApp, url: string): boolean {
  return url === app.routePrefix || url.startsWith(`${app.routePrefix}/`) || url.startsWith(`${app.routePrefix}?`)
}

export function getSidebarAppTabInstanceKey(app: SidebarApp, tab: Pick<Tab, 'metadata' | 'url'>): string | undefined {
  if (!app.instanceKey) return undefined
  if (isMessageOnlyConversationUrl(tab.url)) return undefined
  const metadataKey = getTabInstanceKey(tab, app.id)
  if (metadataKey) return metadataKey
  if (hasTabInstanceMetadataForApp(tab, app.id)) return undefined
  return app.instanceKey.keyFromUrl(tab.url)
}

export function resolveSidebarAppTabEntryUrl(tab: Pick<Tab, 'metadata' | 'url'>): string {
  if (isMessageOnlyConversationUrl(tab.url)) return tab.url

  const appId = getTabInstanceAppId(tab)
  const app = appId ? getSidebarApp(appId) : undefined
  const key = app?.instanceKey ? getSidebarAppTabInstanceKey(app, tab) : undefined

  if (app?.instanceKey && key && tabBelongsToApp(app, tab.url)) {
    return app.instanceKey.urlForKey(key)
  }

  return tab.url
}

export function buildSidebarAppOpenMetadata(app: SidebarApp, key?: string): Tab['metadata'] {
  if (!app.instanceKey || !key) return undefined
  if (app.id !== 'assistants' && app.id !== 'agents') return undefined
  return buildTabInstanceMetadata(undefined, { appId: app.id, key })
}

/**
 * 侧边栏支持的完整菜单顺序。
 * Preference 默认值可能不包含新菜单，管理态列表仍需要覆盖当前全部支持项。
 */
export const SIDEBAR_FAVORITE_ORDER: SidebarAppId[] = SIDEBAR_APPS.map((app) => app.id)

/**
 * 必须显示的侧边栏收藏项（不能被隐藏）
 * 这些收藏项必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_FAVORITES: SidebarAppId[] = ['assistants']

const sidebarFavoriteSet = new Set<SidebarAppId>(SIDEBAR_FAVORITE_ORDER)

export function getSidebarMenuPath(favorite: SidebarAppId, defaultPaintingProvider: string): string {
  const app = getSidebarApp(favorite)
  if (!app) return ''
  return app.resolveUrl?.({ defaultPaintingProvider }) ?? app.routePrefix
}

export function resolveSidebarActiveItem(url: string): SidebarAppId | '' {
  const match = SIDEBAR_APPS.find((app) => (app.exactRouteFocus ? url === app.routePrefix : tabBelongsToApp(app, url)))
  return match?.id ?? ''
}

export function isSidebarAppId(value: string): value is SidebarAppId {
  return sidebarFavoriteSet.has(value as SidebarAppId)
}

export function createSidebarAppFavorite(id: SidebarAppId): SidebarFavoriteItem {
  return { type: 'app', id }
}

export function createSidebarMiniAppFavorite(id: string): SidebarFavoriteItem {
  return { type: 'mini_app', id }
}

function getSidebarFavoriteKey(favorite: SidebarFavoriteItem): string {
  return `${favorite.type}:${favorite.id}`
}

function normalizeSidebarFavoriteItem(favorite: SidebarFavoriteItem): SidebarFavoriteItem | undefined {
  if (favorite.type === 'app') {
    return isSidebarAppId(favorite.id) ? createSidebarAppFavorite(favorite.id) : undefined
  }

  if (favorite.type === 'mini_app') {
    return favorite.id ? createSidebarMiniAppFavorite(favorite.id) : undefined
  }

  return undefined
}

/** Normalize and dedupe the stored favorites into valid, ordered tagged items. */
export function getSidebarFavoriteItems(favorites: readonly SidebarFavoriteItem[] | undefined): SidebarFavoriteItem[] {
  const seen = new Set<string>()
  const items: SidebarFavoriteItem[] = []

  for (const favorite of favorites ?? []) {
    const item = normalizeSidebarFavoriteItem(favorite)
    if (!item) continue

    const key = getSidebarFavoriteKey(item)
    if (seen.has(key)) continue

    seen.add(key)
    items.push(item)
  }

  return items
}

function sanitizeSidebarFavorites(favorites: readonly SidebarFavoriteItem[] | undefined): SidebarAppId[] {
  return getSidebarFavoriteItems(favorites).flatMap((favorite) => (favorite.type === 'app' ? [favorite.id] : []))
}

/** Mini app sidebar favorites: an ordered, deduped list of mini app ids. */
export function getSidebarMiniAppFavoriteIds(favorites: readonly SidebarFavoriteItem[] | undefined): string[] {
  return getSidebarFavoriteItems(favorites).flatMap((favorite) => (favorite.type === 'mini_app' ? [favorite.id] : []))
}

export function getOrderedVisibleSidebarFavorites(
  favorites: readonly SidebarFavoriteItem[] | undefined
): SidebarAppId[] {
  const visible = sanitizeSidebarFavorites(favorites)

  for (const favorite of REQUIRED_SIDEBAR_FAVORITES) {
    if (visible.includes(favorite)) continue

    const favoriteOrder = SIDEBAR_FAVORITE_ORDER.indexOf(favorite)
    const insertIndex = visible.findIndex(
      (visibleFavorite) => SIDEBAR_FAVORITE_ORDER.indexOf(visibleFavorite) > favoriteOrder
    )
    visible.splice(insertIndex === -1 ? visible.length : insertIndex, 0, favorite)
  }

  return visible
}

// --- Favorites mutations -----------------------------------------------------
//
// The favorites preference stores apps and mini apps in one array. Each mutation
// touches a single partition and re-merges the other untouched, so callers never
// have to remember to preserve the partition they didn't change. The canonical
// storage order is apps-first (in visible order) followed by mini apps; the two
// sidebar zones render from their own partition, so cross-zone order is irrelevant.

/** Recombine the two partitions into the canonical apps-first storage order. */
function rebuildSidebarFavorites(
  appIds: readonly SidebarAppId[],
  miniAppIds: readonly string[]
): SidebarFavoriteItem[] {
  return [...appIds.map(createSidebarAppFavorite), ...miniAppIds.map(createSidebarMiniAppFavorite)]
}

/**
 * Pin or unpin a built-in app, preserving mini app favorites. Unpinning a
 * required app is a no-op — required apps are always visible.
 */
export function setSidebarAppPinned(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  id: SidebarAppId,
  pinned: boolean
): SidebarFavoriteItem[] {
  const currentApps = getOrderedVisibleSidebarFavorites(favorites)
  const miniAppIds = getSidebarMiniAppFavoriteIds(favorites)

  if (!pinned && REQUIRED_SIDEBAR_FAVORITES.includes(id)) {
    return rebuildSidebarFavorites(currentApps, miniAppIds)
  }

  const nextApps = currentApps.filter((app) => app !== id)
  if (pinned) nextApps.push(id)

  return rebuildSidebarFavorites(nextApps, miniAppIds)
}

/**
 * Reorder the app zone to `orderedAppIds` (a permutation of the visible apps),
 * preserving mini apps. Unknown ids are dropped and any visible app missing from
 * the list is kept at the end so a partial order never silently loses favorites.
 */
export function reorderSidebarApps(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  orderedAppIds: readonly string[]
): SidebarFavoriteItem[] {
  const currentApps = getOrderedVisibleSidebarFavorites(favorites)
  const currentSet = new Set(currentApps)
  const seen = new Set<SidebarAppId>()
  const reordered: SidebarAppId[] = []

  for (const id of orderedAppIds) {
    if (isSidebarAppId(id) && currentSet.has(id) && !seen.has(id)) {
      seen.add(id)
      reordered.push(id)
    }
  }
  for (const id of currentApps) {
    if (!seen.has(id)) reordered.push(id)
  }

  return rebuildSidebarFavorites(reordered, getSidebarMiniAppFavoriteIds(favorites))
}

/** Toggle a mini app favorite, preserving apps. Adding appends to the mini app zone. */
export function toggleSidebarMiniApp(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  id: string
): SidebarFavoriteItem[] {
  const miniAppIds = getSidebarMiniAppFavoriteIds(favorites)
  const nextMiniAppIds = miniAppIds.includes(id)
    ? miniAppIds.filter((existing) => existing !== id)
    : [...miniAppIds, id]

  return rebuildSidebarFavorites(getOrderedVisibleSidebarFavorites(favorites), nextMiniAppIds)
}

/** Remove a mini app favorite, preserving everything else. */
export function removeSidebarMiniApp(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  id: string
): SidebarFavoriteItem[] {
  return rebuildSidebarFavorites(
    getOrderedVisibleSidebarFavorites(favorites),
    getSidebarMiniAppFavoriteIds(favorites).filter((existing) => existing !== id)
  )
}

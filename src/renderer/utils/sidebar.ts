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

function isSidebarAppId(value: string): value is SidebarAppId {
  return sidebarFavoriteSet.has(value as SidebarAppId)
}

function createSidebarAppFavorite(id: SidebarAppId): SidebarFavoriteItem {
  return { type: 'app', id }
}

function createSidebarMiniAppFavorite(id: string): SidebarFavoriteItem {
  return { type: 'mini_app', id }
}

/**
 * Stable identity for a favorite — its react key and reorder-matching key.
 *
 * Keep the type namespace. Future item types (including `group`) must not collide
 * with app or mini-app ids.
 */
export function getSidebarFavoriteKey(favorite: SidebarFavoriteItem): string {
  return `${favorite.type}:${favorite.id}`
}

function isForwardCompatibleSidebarFavoriteItem(favorite: SidebarFavoriteItem): boolean {
  const item = favorite as { type?: unknown; id?: unknown }
  return (
    typeof item.type === 'string' &&
    item.type !== 'app' &&
    item.type !== 'mini_app' &&
    typeof item.id === 'string' &&
    item.id.length > 0
  )
}

function getForwardCompatibleSidebarFavoriteItems(
  favorites: readonly SidebarFavoriteItem[] | undefined
): SidebarFavoriteItem[] {
  const seen = new Set<string>()
  const items: SidebarFavoriteItem[] = []

  for (const favorite of favorites ?? []) {
    if (!isForwardCompatibleSidebarFavoriteItem(favorite)) continue

    const item = favorite as SidebarFavoriteItem & { type: string; id: string }
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) continue

    seen.add(key)
    items.push(favorite)
  }

  return items
}

function preserveForwardCompatibleSidebarFavoriteItems(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  nextItems: SidebarFavoriteItem[]
): SidebarFavoriteItem[] {
  const futureItems = getForwardCompatibleSidebarFavoriteItems(favorites)
  return futureItems.length ? [...nextItems, ...futureItems] : nextItems
}

function normalizeSidebarFavoriteItem(favorite: SidebarFavoriteItem): SidebarFavoriteItem | undefined {
  // Preserve the original item (spread) rather than rebuilding it from its id, so
  // any future per-item fields survive the normalize round-trip instead of being
  // silently dropped. Only the id is validated per type.
  switch (favorite.type) {
    case 'app':
      return isSidebarAppId(favorite.id) ? { ...favorite } : undefined
    case 'mini_app':
      return favorite.id ? { ...favorite } : undefined
    default: {
      // Untrusted storage boundary: an unknown type (corrupt or written by a newer
      // build) is dropped, not thrown, so a downgrade never crashes. The `never`
      // binding still makes adding a SidebarFavoriteItem variant a compile error
      // here until a case is added above.
      const _exhaustive: never = favorite
      void _exhaustive
      return undefined
    }
  }
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

/** Mini app sidebar favorites: an ordered, deduped list of mini app ids. */
export function getSidebarMiniAppFavoriteIds(favorites: readonly SidebarFavoriteItem[] | undefined): string[] {
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  return getSidebarFavoriteItems(favorites).flatMap((favorite) => (favorite.type === 'mini_app' ? [favorite.id] : []))
}

/**
 * The full ordered, deduped sidebar list — apps and mini apps interleaved in
 * their stored order. Required apps missing from storage are prepended so they
 * are always visible. This is the single source of truth the sidebar renders
 * from; every mutation below operates on this list in place, preserving the
 * mixed order instead of segregating apps before mini apps.
 */
export function getOrderedVisibleSidebarFavoriteItems(
  favorites: readonly SidebarFavoriteItem[] | undefined
): SidebarFavoriteItem[] {
  const items = getSidebarFavoriteItems(favorites)
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  const missingRequired = REQUIRED_SIDEBAR_FAVORITES.filter(
    (id) => !items.some((item) => item.type === 'app' && item.id === id)
  ).map(createSidebarAppFavorite)

  return [...missingRequired, ...items]
}

/** Built-in app ids projected out of the mixed list, in order. */
export function getOrderedVisibleSidebarFavorites(
  favorites: readonly SidebarFavoriteItem[] | undefined
): SidebarAppId[] {
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  return getOrderedVisibleSidebarFavoriteItems(favorites).flatMap((favorite) =>
    favorite.type === 'app' ? [favorite.id] : []
  )
}

// --- Favorites mutations -----------------------------------------------------
//
// The favorites preference stores apps and mini apps interleaved in one ordered
// array. Every mutation operates on the full mixed list (`getOrderedVisible-
// SidebarFavoriteItems`) in place: adds append to the end of the whole list,
// removes filter out, and reorders permute their target items while leaving the
// other type's items exactly where they sit. This keeps the sidebar's mixed
// order intact across any mutation, whichever surface (sidebar or launchpad)
// triggered it.

/**
 * Reorder the whole sidebar list to `orderedItems` (a permutation of the visible
 * favorites). Invalid known items are dropped, future item types are preserved at
 * the end, and any stored favorite missing from the list (e.g. a stale mini app
 * id) is kept at the end so a partial order never silently loses favorites.
 */
export function reorderSidebarFavorites(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  orderedItems: readonly SidebarFavoriteItem[]
): SidebarFavoriteItem[] {
  const items = getOrderedVisibleSidebarFavoriteItems(favorites)
  const byKey = new Map(items.map((item) => [getSidebarFavoriteKey(item), item]))
  const seen = new Set<string>()
  const reordered: SidebarFavoriteItem[] = []

  for (const requested of orderedItems) {
    const key = getSidebarFavoriteKey(requested)
    const item = byKey.get(key)
    if (item && !seen.has(key)) {
      seen.add(key)
      reordered.push(item)
    }
  }
  for (const item of items) {
    if (!seen.has(getSidebarFavoriteKey(item))) reordered.push(item)
  }

  return preserveForwardCompatibleSidebarFavoriteItems(favorites, reordered)
}

/**
 * Pin or unpin a built-in app, preserving everything else in place. Pinning
 * appends to the end of the list; unpinning a required app is a no-op — required
 * apps are always visible.
 */
export function setSidebarAppPinned(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  id: SidebarAppId,
  pinned: boolean
): SidebarFavoriteItem[] {
  const items = getOrderedVisibleSidebarFavoriteItems(favorites)
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  const isTarget = (item: SidebarFavoriteItem) => item.type === 'app' && item.id === id

  if (!pinned) {
    if (REQUIRED_SIDEBAR_FAVORITES.includes(id)) return preserveForwardCompatibleSidebarFavoriteItems(favorites, items)
    return preserveForwardCompatibleSidebarFavoriteItems(
      favorites,
      items.filter((item) => !isTarget(item))
    )
  }

  if (items.some(isTarget)) return preserveForwardCompatibleSidebarFavoriteItems(favorites, items)
  return preserveForwardCompatibleSidebarFavoriteItems(favorites, [...items, createSidebarAppFavorite(id)])
}

/** Toggle a mini app favorite, preserving everything else. Adding appends to the end. */
export function toggleSidebarMiniApp(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  id: string
): SidebarFavoriteItem[] {
  const items = getOrderedVisibleSidebarFavoriteItems(favorites)
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  const isTarget = (item: SidebarFavoriteItem) => item.type === 'mini_app' && item.id === id

  if (items.some(isTarget)) {
    return preserveForwardCompatibleSidebarFavoriteItems(
      favorites,
      items.filter((item) => !isTarget(item))
    )
  }
  return preserveForwardCompatibleSidebarFavoriteItems(favorites, [...items, createSidebarMiniAppFavorite(id)])
}

/** Remove a mini app favorite, preserving everything else in place. */
export function removeSidebarMiniApp(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  id: string
): SidebarFavoriteItem[] {
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  return preserveForwardCompatibleSidebarFavoriteItems(
    favorites,
    getOrderedVisibleSidebarFavoriteItems(favorites).filter((item) => !(item.type === 'mini_app' && item.id === id))
  )
}

// --- Launchpad app order --------------------------------------------------
//
// The launchpad orders its built-in app tiles through its own preference
// (`ui.launchpad.app_order`), completely independent of the sidebar favorites
// order. Mini app tiles are ordered by their global `orderKey` instead, so the
// launchpad never reads or writes `ui.sidebar.favorites`.

/**
 * The ordered launchpad app ids. Stored order is filtered to valid app ids and
 * deduped; any app missing from storage (e.g. an empty default or a newly added
 * app) is appended in canonical order, so a partial or empty store still yields
 * every app exactly once.
 */
export function getOrderedLaunchpadApps(stored: readonly string[] | undefined): SidebarAppId[] {
  const seen = new Set<SidebarAppId>()
  const ordered: SidebarAppId[] = []

  for (const id of stored ?? []) {
    if (isSidebarAppId(id) && !seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }
  for (const id of SIDEBAR_FAVORITE_ORDER) {
    if (!seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }

  return ordered
}

/**
 * Reorder the launchpad app list to `orderedIds` (typically the rendered tile
 * order after a drag). Unknown ids are dropped and any app missing from the
 * requested order is kept at the end so a partial order never loses apps.
 */
export function reorderLaunchpadApps(
  stored: readonly string[] | undefined,
  orderedIds: readonly string[]
): SidebarAppId[] {
  const current = getOrderedLaunchpadApps(stored)
  const currentSet = new Set(current)
  const seen = new Set<SidebarAppId>()
  const next: SidebarAppId[] = []

  for (const id of orderedIds) {
    if (isSidebarAppId(id) && currentSet.has(id) && !seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  for (const id of current) {
    if (!seen.has(id)) next.push(id)
  }

  return next
}

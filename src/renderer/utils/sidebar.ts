import type { SidebarFavorite, SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'

/**
 * Context passed to sidebar navigation handlers. Carries per-call state the
 * registry can't know on its own (preferences).
 */
export interface SidebarNavContext {
  defaultPaintingProvider: string
}

/**
 * Apps that hold conversations (chat→topic, agent→session) carry a
 * `conversationRoute`: the conversation-key↔URL mapping. Which
 * conversation a bare entry lands on is resolved by the routes' own `beforeLoad`
 * interceptors, not here. Apps without it (files / notes / paintings / …) are
 * plain route entries.
 */
export interface SidebarConversationRoute {
  /** Extract the conversation key (topicId / sessionId) from an existing tab URL. */
  keyFromUrl: (url: string) => string | undefined
  /** Build the tab URL for a conversation key (keeps dispatch app-agnostic). */
  urlForKey: (key: string) => string
}

interface SidebarAppDefinition<Id extends SidebarFavorite = SidebarFavorite> {
  id: Id
  routePrefix: string
  /** Url to open when no tab exists yet (defaults to `routePrefix`). */
  resolveUrl?: (ctx: SidebarNavContext) => string
  /** Highlight the sidebar entry only on the exact base route, not on sub-routes owned by the app. */
  exactRouteFocus?: boolean
  conversationRoute?: SidebarConversationRoute
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

export function isMessageOnlyConversationUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url, 'app://x')
    if (parsedUrl.searchParams.get('view') !== 'message') return false

    if (parsedUrl.pathname === '/app/chat') return Boolean(parsedUrl.searchParams.get('topicId'))
    if (parsedUrl.pathname === '/app/agents') return Boolean(parsedUrl.searchParams.get('sessionId'))
    return false
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
    conversationRoute: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, 'topicId'),
      urlForKey: (key) => `/app/chat?topicId=${encodeURIComponent(key)}`
    }
  },
  {
    id: 'agents',
    routePrefix: '/app/agents',
    conversationRoute: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, 'sessionId'),
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

/**
 * 侧边栏支持的完整菜单顺序。
 * Preference 默认值可能不包含新菜单，管理态列表仍需要覆盖当前全部支持项。
 */
export const SIDEBAR_FAVORITE_ORDER: SidebarAppId[] = SIDEBAR_APPS.map((app) => app.id)

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
 * their stored order. This is the single source of truth the sidebar renders
 * from; every mutation below operates on this list in place, preserving the
 * mixed order instead of segregating apps before mini apps.
 */
export function getOrderedVisibleSidebarFavoriteItems(
  favorites: readonly SidebarFavoriteItem[] | undefined
): SidebarFavoriteItem[] {
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  return getSidebarFavoriteItems(favorites)
}

/** Built-in app ids projected out of the mixed list, in order. */
export function getOrderedVisibleSidebarFavorites(
  favorites: readonly SidebarFavoriteItem[] | undefined
): SidebarAppId[] {
  // LEAF-ONLY: recurse into group.items when a 'group' variant is added.
  return getOrderedVisibleSidebarFavoriteItems(favorites).flatMap((favorite) =>
    favorite.type === 'app' && isSidebarAppId(favorite.id) ? [favorite.id] : []
  )
}

/**
 * The url to land on at launch: the first visible sidebar app, resolved through
 * its menu path. Mini apps are excluded — they need async data to resolve and a
 * stale id would land on an unusable tab. Returns `''` when no app is visible
 * (or only mini apps are), so the caller can fall back to its default tab.
 */
export function getSidebarDefaultLandingUrl(
  favorites: readonly SidebarFavoriteItem[] | undefined,
  defaultPaintingProvider: string
): string {
  const firstApp = getOrderedVisibleSidebarFavorites(favorites)[0]
  return firstApp ? getSidebarMenuPath(firstApp, defaultPaintingProvider) : ''
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
 * appends to the end of the list; unpinning removes the app from the list.
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

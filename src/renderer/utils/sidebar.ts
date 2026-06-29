import {
  buildTabInstanceMetadata,
  getTabInstanceAppId,
  getTabInstanceKey,
  hasTabInstanceMetadataForApp
} from '@renderer/utils/tabInstanceMetadata'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarBuiltinFavorite, SidebarFavorite } from '@shared/data/preference/preferenceTypes'

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

export interface SidebarApp {
  id: SidebarBuiltinFavorite
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
export const SIDEBAR_APPS: readonly SidebarApp[] = [
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
]

const SIDEBAR_APP_BY_ID: Record<SidebarBuiltinFavorite, SidebarApp> = SIDEBAR_APPS.reduce(
  (acc, app) => {
    acc[app.id] = app
    return acc
  },
  {} as Record<SidebarBuiltinFavorite, SidebarApp>
)

export function getSidebarApp(id: SidebarBuiltinFavorite): SidebarApp | undefined {
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
export const SIDEBAR_FAVORITE_ORDER: SidebarBuiltinFavorite[] = SIDEBAR_APPS.map((app) => app.id)

/**
 * 必须显示的侧边栏收藏项（不能被隐藏）
 * 这些收藏项必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_FAVORITES: SidebarBuiltinFavorite[] = ['assistants']

const sidebarFavoriteSet = new Set<SidebarBuiltinFavorite>(SIDEBAR_FAVORITE_ORDER)

export function getSidebarMenuPath(favorite: SidebarBuiltinFavorite, defaultPaintingProvider: string): string {
  const app = getSidebarApp(favorite)
  if (!app) return ''
  return app.resolveUrl?.({ defaultPaintingProvider }) ?? app.routePrefix
}

export function resolveSidebarActiveItem(url: string): SidebarBuiltinFavorite | '' {
  const match = SIDEBAR_APPS.find((app) => (app.exactRouteFocus ? url === app.routePrefix : tabBelongsToApp(app, url)))
  return match?.id ?? ''
}

export function isSidebarBuiltinFavorite(value: string): value is SidebarBuiltinFavorite {
  return sidebarFavoriteSet.has(value as SidebarBuiltinFavorite)
}

export function createSidebarAppFavorite(id: SidebarBuiltinFavorite): SidebarFavorite {
  return id
}

export function createSidebarMiniAppFavorite(id: string): SidebarFavorite {
  return id
}

export function getSidebarFavoriteIds(favorites: readonly SidebarFavorite[] | undefined): SidebarFavorite[] {
  const seen = new Set<string>()
  const ids: SidebarFavorite[] = []

  for (const favorite of favorites ?? []) {
    if (!favorite || seen.has(favorite)) continue

    seen.add(favorite)
    ids.push(favorite)
  }

  return ids
}

function sanitizeSidebarFavorites(favorites: readonly SidebarFavorite[] | undefined): SidebarBuiltinFavorite[] {
  const seen = new Set<SidebarBuiltinFavorite>()
  const sidebarFavorites: SidebarBuiltinFavorite[] = []

  for (const id of getSidebarFavoriteIds(favorites)) {
    if (!isSidebarBuiltinFavorite(id) || seen.has(id)) continue

    seen.add(id)
    sidebarFavorites.push(id)
  }

  return sidebarFavorites
}

export function getSidebarMiniAppFavoriteIds(favorites: readonly SidebarFavorite[] | undefined): string[] {
  return getSidebarFavoriteIds(favorites).filter((id) => !isSidebarBuiltinFavorite(id))
}

export function getOrderedVisibleSidebarFavorites(
  favorites: readonly SidebarFavorite[] | undefined
): SidebarBuiltinFavorite[] {
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

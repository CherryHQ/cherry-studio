import {
  createSidebarShortcutId,
  type SidebarFavorite,
  type SidebarShortcutItem,
  type SidebarShortcutTarget
} from '@shared/data/preference/preferenceTypes'
import { CONVERSATION_ROUTES, conversationRouteUrl } from '@shared/utils/conversationRoute'

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
    // `routePrefix` must stay a string literal — the knowledge-manifest generator reads it
    // with ts-morph. `conversationRoute` below carries the same path from the shared contract.
    routePrefix: '/app/chat',
    conversationRoute: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, CONVERSATION_ROUTES.assistant.keyParam),
      urlForKey: (key) => conversationRouteUrl({ conversationType: 'assistant', conversationId: key })
    }
  },
  {
    id: 'agents',
    routePrefix: '/app/agents',
    conversationRoute: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, CONVERSATION_ROUTES.agent.keyParam),
      urlForKey: (key) => conversationRouteUrl({ conversationType: 'agent', conversationId: key })
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

export const SIDEBAR_SHORTCUT_PROVIDER_IDS = {
  APP: 'core.app',
  MINI_APP: 'core.mini-app',
  AGENT: 'core.agent',
  ASSISTANT: 'core.assistant',
  KNOWLEDGE_BASE: 'core.knowledge-base',
  TOPIC: 'core.topic',
  AGENT_SESSION: 'core.agent-session',
  FILE_ENTRY: 'core.file-entry'
} as const

const RETIRED_SIDEBAR_SHORTCUT_PROVIDER_IDS = new Set(['core.skill', 'core.mcp-server', 'core.provider'])

export function createSidebarShortcutTarget(
  providerId: string,
  resourceId: string,
  activationId?: string
): SidebarShortcutTarget {
  return {
    kind: 'resource',
    locator: { providerId, resourceId },
    ...(activationId === undefined ? {} : { activationId })
  }
}

const REQUIRED_SIDEBAR_SHORTCUT_TARGETS = REQUIRED_SIDEBAR_FAVORITES.map((id) =>
  createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.APP, id)
)
const REQUIRED_SIDEBAR_SHORTCUT_IDS = new Set(REQUIRED_SIDEBAR_SHORTCUT_TARGETS.map(createSidebarShortcutId))
const LEGACY_PROVIDER_BY_TYPE = {
  app: SIDEBAR_SHORTCUT_PROVIDER_IDS.APP,
  mini_app: SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP,
  agent: SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT,
  assistant: SIDEBAR_SHORTCUT_PROVIDER_IDS.ASSISTANT
} as const

type StoredSidebarItem = Record<string, unknown>

function isRecord(value: unknown): value is StoredSidebarItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSidebarShortcutTarget(value: unknown): value is SidebarShortcutTarget {
  if (!isRecord(value) || value.kind !== 'resource' || !isRecord(value.locator)) return false
  const { providerId, resourceId } = value.locator
  return (
    typeof providerId === 'string' &&
    providerId.length > 0 &&
    typeof resourceId === 'string' &&
    resourceId.length > 0 &&
    (value.activationId === undefined || (typeof value.activationId === 'string' && value.activationId.length > 0))
  )
}

export function isSidebarShortcutItem(value: unknown): value is SidebarShortcutItem {
  return isRecord(value) && value.type === 'shortcut' && isSidebarShortcutTarget(value.target)
}

function normalizeKnownSidebarShortcut(value: StoredSidebarItem): SidebarShortcutItem | undefined {
  if (value.type === 'shortcut') {
    if (!isSidebarShortcutTarget(value.target)) return undefined
    if (RETIRED_SIDEBAR_SHORTCUT_PROVIDER_IDS.has(value.target.locator.providerId)) return undefined
    return {
      type: 'shortcut',
      id: createSidebarShortcutId(value.target),
      target: value.target,
      ...(typeof value.fallbackLabel === 'string' && value.fallbackLabel.length > 0
        ? { fallbackLabel: value.fallbackLabel }
        : {})
    }
  }

  if (typeof value.type !== 'string' || !(value.type in LEGACY_PROVIDER_BY_TYPE)) return undefined
  if (typeof value.id !== 'string' || value.id.length === 0) return undefined
  if (value.type === 'app' && !isSidebarAppId(value.id)) return undefined

  const providerId = LEGACY_PROVIDER_BY_TYPE[value.type as keyof typeof LEGACY_PROVIDER_BY_TYPE]
  const target = createSidebarShortcutTarget(providerId, value.id)
  return {
    type: 'shortcut',
    id: createSidebarShortcutId(target),
    target,
    ...(typeof value.fallbackLabel === 'string' && value.fallbackLabel.length > 0
      ? { fallbackLabel: value.fallbackLabel }
      : {})
  }
}

function isForwardCompatibleSidebarItem(value: StoredSidebarItem): boolean {
  return (
    typeof value.type === 'string' &&
    value.type !== 'shortcut' &&
    !(value.type in LEGACY_PROVIDER_BY_TYPE) &&
    typeof value.id === 'string' &&
    value.id.length > 0
  )
}

/** Normalize storage, migrate legacy leaves, preserve future items, and enforce required shortcuts. */
export function normalizeSidebarShortcutItems(values: readonly unknown[] | undefined): SidebarShortcutItem[] {
  const items: SidebarShortcutItem[] = []
  const seen = new Set<string>()

  for (const value of values ?? []) {
    if (!isRecord(value)) continue
    const shortcut = normalizeKnownSidebarShortcut(value)
    if (shortcut) {
      if (seen.has(shortcut.id)) continue
      seen.add(shortcut.id)
      items.push(shortcut)
      continue
    }
    if (!isForwardCompatibleSidebarItem(value)) continue

    const futureKey = `${String(value.type)}:${String(value.id)}`
    if (seen.has(futureKey)) continue
    seen.add(futureKey)
    items.push(value as unknown as SidebarShortcutItem)
  }

  const missingRequired = REQUIRED_SIDEBAR_SHORTCUT_TARGETS.flatMap((target) => {
    const id = createSidebarShortcutId(target)
    return seen.has(id) ? [] : [{ type: 'shortcut' as const, id, target }]
  })
  return [...missingRequired, ...items]
}

export function getVisibleSidebarShortcutItems(values: readonly unknown[] | undefined): SidebarShortcutItem[] {
  return normalizeSidebarShortcutItems(values).filter(isSidebarShortcutItem)
}

export function addSidebarShortcut(
  values: readonly unknown[] | undefined,
  target: SidebarShortcutTarget,
  fallbackLabel?: string
): SidebarShortcutItem[] {
  const items = normalizeSidebarShortcutItems(values)
  const id = createSidebarShortcutId(target)
  if (items.some((item) => isSidebarShortcutItem(item) && item.id === id)) return items
  return [
    ...items,
    {
      type: 'shortcut',
      id,
      target,
      ...(fallbackLabel ? { fallbackLabel } : {})
    }
  ]
}

export function removeSidebarShortcut(
  values: readonly unknown[] | undefined,
  target: SidebarShortcutTarget
): SidebarShortcutItem[] {
  const id = createSidebarShortcutId(target)
  const items = normalizeSidebarShortcutItems(values)
  if (REQUIRED_SIDEBAR_SHORTCUT_IDS.has(id)) return items
  return items.filter((item) => !isSidebarShortcutItem(item) || item.id !== id)
}

export function reorderSidebarShortcuts(
  values: readonly unknown[] | undefined,
  orderedItems: readonly SidebarShortcutItem[]
): SidebarShortcutItem[] {
  const items = normalizeSidebarShortcutItems(values)
  const shortcuts = items.filter(isSidebarShortcutItem)
  const byId = new Map(shortcuts.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const reordered: SidebarShortcutItem[] = []

  for (const requested of orderedItems) {
    const item = byId.get(requested.id)
    if (item && !seen.has(item.id)) {
      seen.add(item.id)
      reordered.push(item)
    }
  }
  for (const item of shortcuts) {
    if (!seen.has(item.id)) reordered.push(item)
  }

  let index = 0
  return items.map((item) => (isSidebarShortcutItem(item) ? reordered[index++] : item))
}

export function isSidebarShortcutPinned(
  values: readonly unknown[] | undefined,
  target: SidebarShortcutTarget
): boolean {
  const id = createSidebarShortcutId(target)
  return getVisibleSidebarShortcutItems(values).some((item) => item.id === id)
}

export function isRequiredSidebarShortcut(target: SidebarShortcutTarget): boolean {
  return REQUIRED_SIDEBAR_SHORTCUT_IDS.has(createSidebarShortcutId(target))
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

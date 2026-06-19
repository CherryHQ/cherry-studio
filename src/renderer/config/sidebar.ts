import { OpenClawSidebarIcon } from '@renderer/components/Icons/SvgIcon'
import type { SidebarMenuItem } from '@renderer/components/Sidebar/types'
import {
  getTabInstanceAppId,
  getTabInstanceKey,
  hasTabInstanceMetadataForApp
} from '@renderer/config/tabInstanceMetadata'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import {
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  Library,
  MessageSquare,
  MousePointerClick,
  NotepadText,
  Palette
} from 'lucide-react'

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
  id: SidebarIcon
  icon: SidebarMenuItem['icon']
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
    icon: MessageSquare,
    routePrefix: '/app/chat',
    instanceKey: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, 'topicId'),
      defaultKey: ({ lastUsedTopicId }) => lastUsedTopicId ?? undefined,
      urlForKey: (key) => `/app/chat?topicId=${encodeURIComponent(key)}`
    }
  },
  {
    id: 'agents',
    icon: MousePointerClick,
    routePrefix: '/app/agents',
    instanceKey: {
      keyFromUrl: (url) => getNormalConversationSearchParamFromUrl(url, 'sessionId'),
      defaultKey: ({ lastUsedSessionId }) => lastUsedSessionId ?? undefined,
      urlForKey: (key) => `/app/agents?sessionId=${encodeURIComponent(key)}`
    }
  },
  {
    id: 'paintings',
    icon: Palette,
    routePrefix: '/app/paintings',
    resolveUrl: ({ defaultPaintingProvider }) => `/app/paintings/${defaultPaintingProvider}`
  },
  {
    id: 'translate',
    icon: Languages,
    routePrefix: '/app/translate'
  },
  {
    id: 'store',
    icon: Library,
    routePrefix: '/app/library'
  },
  {
    id: 'mini_app',
    icon: LayoutGrid,
    routePrefix: '/app/mini-app',
    exactRouteFocus: true
  },
  {
    id: 'knowledge',
    icon: FileSearch,
    routePrefix: '/app/knowledge'
  },
  {
    id: 'files',
    icon: Folder,
    routePrefix: '/app/files'
  },
  {
    id: 'code_tools',
    icon: Code,
    routePrefix: '/app/code'
  },
  {
    id: 'notes',
    icon: NotepadText,
    routePrefix: '/app/notes'
  },
  {
    id: 'openclaw',
    icon: OpenClawSidebarIcon,
    routePrefix: '/app/openclaw'
  }
]

const SIDEBAR_APP_BY_ID: Record<SidebarIcon, SidebarApp> = SIDEBAR_APPS.reduce(
  (acc, app) => {
    acc[app.id] = app
    return acc
  },
  {} as Record<SidebarIcon, SidebarApp>
)

export function getSidebarApp(id: SidebarIcon): SidebarApp | undefined {
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

/**
 * 侧边栏支持的完整菜单顺序。
 * Preference 默认值可能不包含新菜单，管理态列表仍需要覆盖当前全部支持项。
 */
export const SIDEBAR_ICON_ORDER: SidebarIcon[] = SIDEBAR_APPS.map((app) => app.id)

/**
 * 必须显示的侧边栏图标（不能被隐藏）
 * 这些图标必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_ICONS: SidebarIcon[] = ['assistants']

const sidebarIconSet = new Set<SidebarIcon>(SIDEBAR_ICON_ORDER)

export const SIDEBAR_ICON_COMPONENTS: Record<SidebarIcon, SidebarMenuItem['icon']> = SIDEBAR_APPS.reduce(
  (acc, app) => {
    acc[app.id] = app.icon
    return acc
  },
  {} as Record<SidebarIcon, SidebarMenuItem['icon']>
)

export function getSidebarMenuPath(icon: SidebarIcon, defaultPaintingProvider: string): string {
  const app = getSidebarApp(icon)
  if (!app) return ''
  return app.resolveUrl?.({ defaultPaintingProvider }) ?? app.routePrefix
}

export function resolveSidebarActiveItem(url: string): SidebarIcon | '' {
  const match = SIDEBAR_APPS.find((app) => tabBelongsToApp(app, url))
  return match?.id ?? ''
}

export function sanitizeSidebarIcons(icons: readonly SidebarIcon[] | undefined): SidebarIcon[] {
  const seen = new Set<SidebarIcon>()

  return (icons ?? []).filter((icon) => {
    if (!sidebarIconSet.has(icon) || seen.has(icon)) {
      return false
    }

    seen.add(icon)
    return true
  })
}

export function getOrderedVisibleSidebarIcons(icons: readonly SidebarIcon[] | undefined): SidebarIcon[] {
  const visible = sanitizeSidebarIcons(icons)

  for (const icon of REQUIRED_SIDEBAR_ICONS) {
    if (visible.includes(icon)) continue

    const iconOrder = SIDEBAR_ICON_ORDER.indexOf(icon)
    const insertIndex = visible.findIndex((visibleIcon) => SIDEBAR_ICON_ORDER.indexOf(visibleIcon) > iconOrder)
    visible.splice(insertIndex === -1 ? visible.length : insertIndex, 0, icon)
  }

  return visible
}

export function getDefaultSidebarFavorites(): SidebarIcon[] {
  return getOrderedVisibleSidebarIcons(getDefaultValue('ui.sidebar.favorites'))
}

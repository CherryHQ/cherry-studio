import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import { isSidebarAppId, SIDEBAR_APPS, type SidebarAppId } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'

export const LAUNCHPAD_WORKSPACE_KEY = 'launchpad'

export type NavigationWorkspaceKey = `app:${SidebarAppId}` | `mini-app:${string}` | typeof LAUNCHPAD_WORKSPACE_KEY

export function getWorkspaceKeyForUrl(url: string): NavigationWorkspaceKey | undefined {
  let pathname: string
  try {
    pathname = new URL(url, 'app://cherry').pathname
  } catch {
    return undefined
  }

  if (pathname === '/app/launchpad') return LAUNCHPAD_WORKSPACE_KEY

  const miniAppId = miniAppIdFromTabUrl(pathname)
  if (miniAppId) return `mini-app:${miniAppId}`

  const app = SIDEBAR_APPS.find((candidate) =>
    candidate.exactRouteFocus
      ? pathname === candidate.routePrefix
      : pathname === candidate.routePrefix || pathname.startsWith(`${candidate.routePrefix}/`)
  )
  return app ? `app:${app.id}` : undefined
}

export function getTabWorkspaceKey(tab: Tab): NavigationWorkspaceKey | undefined {
  return isNavigationWorkspaceKey(tab.workspaceKey) ? tab.workspaceKey : getWorkspaceKeyForUrl(tab.url)
}

export function isTabVisibleInTabBar(tab: Tab): boolean {
  return tab.isTabBarVisible !== false
}

export function isNavigationWorkspaceKey(value: string | undefined): value is NavigationWorkspaceKey {
  if (!value) return false
  if (value === LAUNCHPAD_WORKSPACE_KEY) return true
  if (value.startsWith('mini-app:')) return value.length > 'mini-app:'.length
  if (!value.startsWith('app:')) return false
  return isSidebarAppId(value.slice('app:'.length))
}

export function getWorkspaceFavorite(workspaceKey: NavigationWorkspaceKey): SidebarFavoriteItem | undefined {
  if (workspaceKey === LAUNCHPAD_WORKSPACE_KEY) return undefined
  if (workspaceKey.startsWith('mini-app:')) {
    return { type: 'mini_app', id: workspaceKey.slice('mini-app:'.length) }
  }

  return { type: 'app', id: workspaceKey.slice('app:'.length) as SidebarAppId }
}

export function getWorkspaceKeyForFavorite(favorite: SidebarFavoriteItem): NavigationWorkspaceKey | undefined {
  if (favorite.type === 'mini_app') return `mini-app:${favorite.id}`
  return favorite.type === 'app' && isSidebarAppId(favorite.id) ? `app:${favorite.id}` : undefined
}

export interface SidebarWorkspaceSession {
  tabs: Tab[]
  activeTabId: string
}

/** Collapse a tab session to one mounted page per application workspace. */
export function normalizeSidebarWorkspaceSession(tabs: readonly Tab[], activeTabId: string): SidebarWorkspaceSession {
  const normalizedTabs = tabs.map((tab) => {
    const workspaceKey = getTabWorkspaceKey(tab)
    return {
      ...tab,
      workspaceKey,
      isPinned: false
    }
  })
  const activeTab = normalizedTabs.find((tab) => tab.id === activeTabId)
  const focusedReturnWorkspaceId =
    activeTab && !activeTab.workspaceKey && typeof activeTab.metadata?.returnWorkspaceId === 'string'
      ? activeTab.metadata.returnWorkspaceId
      : undefined
  const selectedWorkspaceIds = new Set<string>()

  for (const workspaceKey of new Set(normalizedTabs.flatMap((tab) => (tab.workspaceKey ? [tab.workspaceKey] : [])))) {
    const candidates = normalizedTabs.filter((tab) => tab.workspaceKey === workspaceKey)
    const selected =
      candidates.find((tab) => tab.id === activeTabId) ??
      candidates.find((tab) => tab.id === focusedReturnWorkspaceId) ??
      candidates.reduce((latest, tab) =>
        !latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest
      )
    if (selected) selectedWorkspaceIds.add(selected.id)
  }

  const keepFocusedTab = activeTab && !activeTab.workspaceKey ? activeTab : undefined
  const keptTabs = normalizedTabs.filter((tab) => selectedWorkspaceIds.has(tab.id) || tab.id === keepFocusedTab?.id)

  const fallbackWorkspace = keptTabs.reduce<Tab | undefined>((latest, tab) => {
    if (!tab.workspaceKey) return latest
    return !latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest
  }, undefined)
  const resolvedActiveId = keptTabs.some((tab) => tab.id === activeTabId) ? activeTabId : (fallbackWorkspace?.id ?? '')

  return { tabs: keptTabs, activeTabId: resolvedActiveId }
}

import type { Tab } from '@shared/data/cache/cacheValueTypes'

const LEGACY_INSTANCE_APP_ID_KEY = 'instanceAppId'
const LEGACY_INSTANCE_KEY = 'instanceKey'

const LEGACY_CONVERSATION_ROUTES = {
  assistants: { path: '/app/chat', searchParam: 'topicId' },
  agents: { path: '/app/agents', searchParam: 'sessionId' }
} as const

type LegacyConversationAppId = keyof typeof LEGACY_CONVERSATION_ROUTES

function isLegacyConversationAppId(value: unknown): value is LegacyConversationAppId {
  return value === 'assistants' || value === 'agents'
}

function isInternalRouteUrl(url: string, path: string): boolean {
  return url === path || url.startsWith(`${path}?`) || url.startsWith(`${path}#`)
}

function migrateLegacyConversationTab(tab: Tab): Tab {
  const metadata = tab.metadata
  if (!metadata) return tab

  const appId = metadata[LEGACY_INSTANCE_APP_ID_KEY]
  if (!isLegacyConversationAppId(appId)) return tab

  const instanceKey = metadata[LEGACY_INSTANCE_KEY]
  const remainingMetadata = { ...metadata }
  delete remainingMetadata[LEGACY_INSTANCE_APP_ID_KEY]
  delete remainingMetadata[LEGACY_INSTANCE_KEY]

  let url = tab.url
  if (tab.type === 'route' && typeof instanceKey === 'string' && instanceKey) {
    const route = LEGACY_CONVERSATION_ROUTES[appId]
    if (isInternalRouteUrl(tab.url, route.path)) {
      const parsed = new URL(tab.url, 'app://cherry')
      if (parsed.searchParams.get('view') !== 'message' && !parsed.searchParams.get(route.searchParam)) {
        parsed.searchParams.set(route.searchParam, instanceKey)
        url = `${parsed.pathname}${parsed.search}${parsed.hash}`
      }
    }
  }

  return {
    ...tab,
    url,
    metadata: Object.keys(remainingMetadata).length > 0 ? remainingMetadata : undefined
  }
}

/**
 * Upgrade v2.0.0 conversation tabs from metadata-owned identity to URL-owned identity.
 * Explicit URL targets always win; only bare legacy routes consume `instanceKey`.
 * Other tab metadata remains untouched.
 */
export function migrateLegacyConversationTabs(tabs: Tab[]): { tabs: Tab[]; changed: boolean } {
  let changed = false
  const migratedTabs = tabs.map((tab) => {
    const migratedTab = migrateLegacyConversationTab(tab)
    if (migratedTab !== tab) changed = true
    return migratedTab
  })

  return { tabs: changed ? migratedTabs : tabs, changed }
}

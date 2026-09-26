import type { ConversationAppId } from '@renderer/types/conversation'
import { getSidebarApp, type SidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget, ConversationType } from '@shared/types/navigation'

/** The sidebar app holding a conversation type — the shared vocabulary's renderer-side owner. */
export function getConversationAppId(conversationType: ConversationType): ConversationAppId {
  return conversationType === 'agent' ? 'agents' : 'assistants'
}

/** The shared conversation type a sidebar app holds — the inverse of {@link getConversationAppId}. */
export function getConversationType(appId: ConversationAppId): ConversationType {
  return appId === 'agents' ? 'agent' : 'assistant'
}

export function getConversationSidebarApp(target: ConversationNavigationTarget): SidebarApp | undefined {
  return getSidebarApp(getConversationAppId(target.conversationType))
}

export function findConversationTab(tabs: readonly Tab[], target: ConversationNavigationTarget): Tab | undefined {
  const app = getConversationSidebarApp(target)
  if (!app?.conversationRoute) return undefined

  return tabs.find(
    (tab) =>
      tab.type === 'route' &&
      tabBelongsToApp(app, tab.url) &&
      app.conversationRoute?.keyFromUrl(tab.url) === target.conversationId
  )
}

/**
 * Ids of every tab bound to one conversation. Identity comes from the route + conversation
 * key rather than the full URL, so duplicate tabs of the same conversation — pinned,
 * background or dormant — all match, unlike a URL-equality lookup.
 */
export function findConversationTabIds(tabs: readonly Tab[], appId: ConversationAppId, key: string): string[] {
  const app = getSidebarApp(appId)
  const conversationRoute = app?.conversationRoute
  // An absent key must not match a tab whose URL carries an empty parameter.
  if (!key || !app || !conversationRoute) return []

  return tabs
    .filter(
      (tab) => tab.type === 'route' && tabBelongsToApp(app, tab.url) && conversationRoute.keyFromUrl(tab.url) === key
    )
    .map((tab) => tab.id)
}

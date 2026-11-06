import { getSidebarApp, type SidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

export function getConversationSidebarApp(target: ConversationNavigationTarget): SidebarApp | undefined {
  return getSidebarApp(target.conversationType === 'agent' ? 'agents' : 'assistants')
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

export function getConversationTargetFromTab(tab: Tab | undefined): ConversationNavigationTarget | undefined {
  if (tab?.type !== 'route') return undefined

  for (const conversationType of ['assistant', 'agent'] as const) {
    const app = getSidebarApp(conversationType === 'agent' ? 'agents' : 'assistants')
    const conversationId =
      app?.conversationRoute && tabBelongsToApp(app, tab.url) ? app.conversationRoute.keyFromUrl(tab.url) : undefined
    if (conversationId) return { conversationType, conversationId }
  }
  return undefined
}

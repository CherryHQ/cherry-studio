import { getSidebarApp, getSidebarAppTabInstanceKey, type SidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

export function getConversationSidebarApp(target: ConversationNavigationTarget): SidebarApp | undefined {
  return getSidebarApp(target.conversationType === 'agent' ? 'agents' : 'assistants')
}

export function findConversationTab(tabs: readonly Tab[], target: ConversationNavigationTarget): Tab | undefined {
  const app = getConversationSidebarApp(target)
  if (!app) return undefined

  return tabs.find(
    (tab) =>
      tab.type === 'route' &&
      tabBelongsToApp(app, tab.url) &&
      getSidebarAppTabInstanceKey(app, tab) === target.conversationId
  )
}

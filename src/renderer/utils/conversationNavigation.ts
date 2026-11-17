import { cacheService } from '@renderer/data/CacheService'
import { getSidebarApp, type SidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

export function getConversationSidebarApp(target: ConversationNavigationTarget): SidebarApp | undefined {
  return getSidebarApp(target.conversationType === 'agent' ? 'agents' : 'assistants')
}

export function findConversationTab(tabs: readonly Tab[], target: ConversationNavigationTarget): Tab | undefined {
  const app = getConversationSidebarApp(target)
  if (!app?.conversationRoute) return undefined

  return tabs.find((tab) => {
    if (tab.type !== 'route') return false
    if (target.conversationType === 'agent') {
      const url = new URL(tab.url, 'app://x')
      const binding = cacheService.getCasual<{ taskId: string; runId?: string; sessionId: string }>(
        `scheduled-task.conversation.${tab.id}`
      )
      if (
        url.pathname === '/app/scheduled-tasks' &&
        binding?.taskId === url.searchParams.get('taskId') &&
        (binding.runId ?? null) === url.searchParams.get('runId') &&
        binding.sessionId === target.conversationId
      )
        return true
    }
    return tabBelongsToApp(app, tab.url) && app.conversationRoute?.keyFromUrl(tab.url) === target.conversationId
  })
}

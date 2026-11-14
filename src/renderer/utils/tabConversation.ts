import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import { CONVERSATION_ROUTES } from '@shared/utils/conversationRoute'

export function getTabConversation(tab: Pick<Tab, 'type' | 'url'>): ConversationNavigationTarget | undefined {
  if (tab.type !== 'route') return undefined
  const url = new URL(tab.url, 'app://x')
  for (const conversationType of ['agent', 'assistant'] as const) {
    const route = CONVERSATION_ROUTES[conversationType]
    const conversationId = url.searchParams.get(route.keyParam)
    if (url.pathname === route.path && conversationId) return { conversationType, conversationId }
  }
  return undefined
}

import type { ConversationNavigationTarget } from '@shared/types/navigation'

/**
 * The conversation-key↔URL contract. Cross-process because main builds these URLs on the
 * cold-start navigation path while the renderer sidebar registry parses them back into tabs —
 * a second copy on either side silently breaks tab-ownership matching.
 */
export const CONVERSATION_ROUTES = {
  assistant: { path: '/app/chat', keyParam: 'topicId' },
  agent: { path: '/app/agents', keyParam: 'sessionId' }
} as const satisfies Record<ConversationNavigationTarget['conversationType'], { path: string; keyParam: string }>

export function conversationRouteUrl({ conversationType, conversationId }: ConversationNavigationTarget): string {
  const { path, keyParam } = CONVERSATION_ROUTES[conversationType]
  return `${path}?${keyParam}=${encodeURIComponent(conversationId)}`
}

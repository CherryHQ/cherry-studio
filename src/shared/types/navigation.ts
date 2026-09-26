export type ConversationType = 'assistant' | 'agent'

export interface ConversationNavigationTarget {
  conversationType: ConversationType
  conversationId: string
}

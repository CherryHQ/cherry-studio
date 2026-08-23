import type { ConversationEffectId } from '@shared/ai/conversation'

export enum AgentConversationResourceEffectResultKind {
  Applied = 'applied',
  Stale = 'stale'
}

export interface AgentConversationResourceEffectResult {
  readonly kind: AgentConversationResourceEffectResultKind
  readonly effectId: ConversationEffectId
}

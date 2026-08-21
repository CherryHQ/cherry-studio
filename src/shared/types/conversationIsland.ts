import type { ConversationNavigationTarget } from './navigation'

export type ConversationIslandStateKind = 'pending' | 'streaming' | 'awaiting-confirmation' | 'done' | 'error'

export interface ConversationIslandSnapshot {
  activityId: string
  target: ConversationNavigationTarget
  state: ConversationIslandStateKind
  statusText: string
  title: string
  secondaryCount: number
  presentation: 'notch' | 'capsule'
  notchWidth?: number
}

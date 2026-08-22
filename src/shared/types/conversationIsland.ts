import type { ConversationNavigationTarget } from './navigation'

export type ConversationIslandStateKind = 'pending' | 'streaming' | 'awaiting-confirmation' | 'done' | 'error'

export interface ConversationIslandActivityItem {
  activityId: string
  identityAvatar: string
  identityName: string
  target: ConversationNavigationTarget
  state: ConversationIslandStateKind
  statusText: string
  title: string
}

export interface ConversationIslandSnapshot extends ConversationIslandActivityItem {
  activityCountText: string
  secondaryCount: number
  presentation: 'notch' | 'capsule'
  notchWidth?: number
  expanded: boolean
  exiting: boolean
  reducedMotion: boolean
  activities?: ConversationIslandActivityItem[]
}

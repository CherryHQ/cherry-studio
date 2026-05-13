import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { ReactNode } from 'react'

export interface MessageListState {
  topic: Topic
  messages: Message[]
  beforeList?: ReactNode
  isInitialLoading?: boolean
  hasOlder?: boolean
  messageNavigation: string
  estimateSize: number
  overscan: number
  loadOlderDelayMs: number
  loadingResetDelayMs: number
  listKey?: string
}

export interface MessageListActions {
  loadOlder?: () => void
}

export interface MessageListMeta {
  selectionLayer: boolean
  groupMenuBar?: boolean
  assistantProfile?: {
    name?: string
    avatar?: string
  }
  imageExportFileName?: string
}

export interface MessageListProviderValue {
  state: MessageListState
  actions: MessageListActions
  meta: MessageListMeta
}

import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { useMemo } from 'react'

import type { MessageListProviderValue } from '../types'

interface AgentMessageListParams {
  topic: Topic
  messages: Message[]
  assistantProfile?: {
    name?: string
    avatar?: string
  }
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  messageNavigation: string
}

export function useAgentMessageListProviderValue({
  topic,
  messages,
  assistantProfile,
  isLoading,
  hasOlder = false,
  loadOlder,
  messageNavigation
}: AgentMessageListParams): MessageListProviderValue {
  return useMemo(
    () => ({
      state: {
        topic,
        messages,
        isInitialLoading: isLoading && messages.length === 0,
        hasOlder,
        messageNavigation,
        estimateSize: 400,
        overscan: 6,
        loadOlderDelayMs: 0,
        loadingResetDelayMs: 600,
        listKey: topic.id
      },
      actions: {
        loadOlder
      },
      meta: {
        selectionLayer: false,
        assistantProfile
      }
    }),
    [assistantProfile, hasOlder, isLoading, loadOlder, messageNavigation, messages, topic]
  )
}

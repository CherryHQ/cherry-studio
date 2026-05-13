import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useMemo } from 'react'

import type { MessageListProviderValue } from '../types'
import { useMessageActivityState } from './useMessageActivityState'

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
  partsMap?: Record<string, CherryMessagePart[]>
}

export function useAgentMessageListProviderValue({
  topic,
  messages,
  assistantProfile,
  isLoading,
  hasOlder = false,
  loadOlder,
  messageNavigation,
  partsMap
}: AgentMessageListParams): MessageListProviderValue {
  const getMessageActivityState = useMessageActivityState(topic.id, partsMap)

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
        listKey: topic.id,
        readonly: true,
        selection: {
          enabled: false,
          isMultiSelectMode: false,
          selectedMessageIds: []
        },
        getMessageActivityState
      },
      actions: {
        loadOlder
      },
      meta: {
        selectionLayer: false,
        assistantProfile
      }
    }),
    [assistantProfile, getMessageActivityState, hasOlder, isLoading, loadOlder, messageNavigation, messages, topic]
  )
}

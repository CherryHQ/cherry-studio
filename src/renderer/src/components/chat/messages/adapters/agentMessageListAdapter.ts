import { cacheService } from '@data/CacheService'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

import type { MessageListProviderValue, MessageUiState } from '../types'
import { useMessageActivityState } from './useMessageActivityState'
import { useMessageListRenderConfig } from './useMessageListRenderConfig'

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
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const getMessageUiState = useCallback(
    (messageId: string) => (cacheService.get(`message.ui.${messageId}` as const) || {}) as MessageUiState,
    []
  )

  const updateMessageUiState = useCallback((messageId: string, updates: MessageUiState) => {
    const cacheKey = `message.ui.${messageId}` as const
    const current = cacheService.get(cacheKey) || {}
    cacheService.set(cacheKey, { ...current, ...updates })
  }, [])

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
        renderConfig,
        selection: {
          enabled: false,
          isMultiSelectMode: false,
          selectedMessageIds: []
        },
        getMessageUiState,
        getMessageActivityState
      },
      actions: {
        loadOlder,
        updateMessageUiState,
        updateRenderConfig
      },
      meta: {
        selectionLayer: false,
        assistantProfile
      }
    }),
    [
      assistantProfile,
      getMessageActivityState,
      getMessageUiState,
      hasOlder,
      isLoading,
      loadOlder,
      messageNavigation,
      messages,
      renderConfig,
      topic,
      updateMessageUiState,
      updateRenderConfig
    ]
  )
}

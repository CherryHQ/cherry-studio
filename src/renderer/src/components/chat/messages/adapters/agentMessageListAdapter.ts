import { cacheService } from '@data/CacheService'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

import type { MessageListProviderValue, MessageUiState } from '../types'
import { toMessageListItem } from '../utils/messageListItem'
import { useMessageActivityState } from './useMessageActivityState'
import { useMessageListRenderConfig } from './useMessageListRenderConfig'

interface AgentMessageListParams {
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  assistantProfile?: {
    name?: string
    avatar?: string
  }
  assistantId?: string
  modelFallback?: ModelSnapshot
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  messageNavigation: string
}

export function useAgentMessageListProviderValue({
  topic,
  messages,
  partsByMessageId,
  assistantProfile,
  assistantId,
  modelFallback,
  isLoading,
  hasOlder = false,
  loadOlder,
  messageNavigation
}: AgentMessageListParams): MessageListProviderValue {
  const messageItems = useMemo(
    () =>
      messages.map((message) =>
        toMessageListItem(message, {
          assistantId: assistantId ?? topic.assistantId,
          topicId: topic.id,
          modelFallback
        })
      ),
    [assistantId, messages, modelFallback, topic.assistantId, topic.id]
  )

  const getMessageActivityState = useMessageActivityState(topic.id, partsByMessageId)
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
        messages: messageItems,
        partsByMessageId,
        isInitialLoading: isLoading && messageItems.length === 0,
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
      messageItems,
      partsByMessageId,
      renderConfig,
      topic,
      updateMessageUiState,
      updateRenderConfig
    ]
  )
}

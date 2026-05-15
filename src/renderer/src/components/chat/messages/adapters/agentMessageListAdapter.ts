import { cacheService } from '@data/CacheService'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

import type {
  MessageListActions,
  MessageListMeta,
  MessageListProviderValue,
  MessageListState,
  MessageUiState
} from '../types'
import { toMessageListItem } from '../utils/messageListItem'
import { useMessageActivityState } from './useMessageActivityState'
import { useMessageExportActions } from './useMessageExportActions'
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
  deleteMessage?: MessageListActions['deleteMessage']
  selectMessage?: MessageListActions['selectMessage']
  toggleMultiSelectMode?: MessageListActions['toggleMultiSelectMode']
  selection?: {
    isMultiSelectMode: boolean
    selectedMessageIds: string[]
  }
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
  deleteMessage,
  selectMessage,
  toggleMultiSelectMode,
  selection,
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
  const exportActions = useMessageExportActions({ topicName: topic.name })
  const getMessageUiState = useCallback(
    (messageId: string) => (cacheService.get(`message.ui.${messageId}` as const) || {}) as MessageUiState,
    []
  )

  const updateMessageUiState = useCallback((messageId: string, updates: MessageUiState) => {
    const cacheKey = `message.ui.${messageId}` as const
    const current = cacheService.get(cacheKey) || {}
    cacheService.set(cacheKey, { ...current, ...updates })
  }, [])

  const openPath = useCallback((path: string) => {
    return window.api.file.openPath(path)
  }, [])

  const showInFolder = useCallback((path: string) => {
    return window.api.file.showInFolder(path)
  }, [])

  const abortTool = useCallback((toolId: string) => {
    return window.api.mcp.abortTool(toolId)
  }, [])

  const state = useMemo<MessageListState>(
    () => ({
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
        enabled: !!toggleMultiSelectMode,
        isMultiSelectMode: selection?.isMultiSelectMode ?? false,
        selectedMessageIds: selection?.selectedMessageIds ?? []
      },
      getMessageUiState,
      getMessageActivityState
    }),
    [
      getMessageActivityState,
      getMessageUiState,
      hasOlder,
      isLoading,
      messageNavigation,
      messageItems,
      partsByMessageId,
      renderConfig,
      selection,
      toggleMultiSelectMode,
      topic
    ]
  )

  const actions = useMemo<MessageListActions>(
    () => ({
      loadOlder,
      deleteMessage,
      ...exportActions,
      openPath,
      showInFolder,
      abortTool,
      selectMessage,
      toggleMultiSelectMode,
      updateMessageUiState,
      updateRenderConfig
    }),
    [
      abortTool,
      deleteMessage,
      exportActions,
      loadOlder,
      openPath,
      selectMessage,
      showInFolder,
      toggleMultiSelectMode,
      updateMessageUiState,
      updateRenderConfig
    ]
  )

  const meta = useMemo<MessageListMeta>(
    () => ({
      selectionLayer: !!toggleMultiSelectMode,
      assistantProfile
    }),
    [assistantProfile, toggleMultiSelectMode]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}

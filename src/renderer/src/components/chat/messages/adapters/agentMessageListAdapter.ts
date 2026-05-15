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
import { useMessageErrorActions } from './useMessageErrorActions'
import { useMessageExportActions } from './useMessageExportActions'
import { useMessageLeafCapabilities } from './useMessageLeafCapabilities'
import { useMessageListRenderConfig } from './useMessageListRenderConfig'
import { useMessageMenuConfig } from './useMessageMenuConfig'
import { useMessageSelectionController } from './useMessageSelectionController'

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
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  deleteMessage?: MessageListActions['deleteMessage']
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
  openCitationsPanel,
  deleteMessage,
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
  const menuConfig = useMessageMenuConfig()
  const exportActions = useMessageExportActions({ topicName: topic.name })
  const errorActions = useMessageErrorActions()
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId })
  const selectionController = useMessageSelectionController({
    topicId: topic.id,
    messages: messageItems,
    partsByMessageId,
    deleteMessage,
    saveTextFile: exportActions.saveTextFile
  })
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
      menuConfig,
      selection: selectionController.selection,
      getMessageUiState,
      getMessageActivityState,
      isToolAutoApproved: leafCapabilities.isToolAutoApproved,
      externalCodeEditors: leafCapabilities.externalCodeEditors
    }),
    [
      getMessageActivityState,
      getMessageUiState,
      hasOlder,
      isLoading,
      leafCapabilities.externalCodeEditors,
      leafCapabilities.isToolAutoApproved,
      menuConfig,
      messageNavigation,
      messageItems,
      partsByMessageId,
      renderConfig,
      selectionController.selection,
      topic
    ]
  )

  const actions = useMemo<MessageListActions>(
    () => ({
      loadOlder,
      deleteMessage,
      ...exportActions,
      ...errorActions,
      previewFile: leafCapabilities.previewFile,
      subscribeToolProgress: leafCapabilities.subscribeToolProgress,
      openExternalUrl: leafCapabilities.openExternalUrl,
      openInExternalApp: leafCapabilities.openInExternalApp,
      openPath,
      openCitationsPanel,
      showInFolder,
      abortTool,
      ...selectionController.actions,
      updateMessageUiState,
      updateRenderConfig
    }),
    [
      abortTool,
      deleteMessage,
      errorActions,
      exportActions,
      leafCapabilities.previewFile,
      leafCapabilities.subscribeToolProgress,
      leafCapabilities.openExternalUrl,
      leafCapabilities.openInExternalApp,
      loadOlder,
      openCitationsPanel,
      openPath,
      selectionController.actions,
      showInFolder,
      updateMessageUiState,
      updateRenderConfig
    ]
  )

  const meta = useMemo<MessageListMeta>(
    () => ({
      selectionLayer: true,
      assistantProfile
    }),
    [assistantProfile]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}

import { cacheService } from '@data/CacheService'
import type {
  MessageListActions,
  MessageListMeta,
  MessageListProviderValue,
  MessageListState,
  MessageUiState
} from '@renderer/components/chat/messages/types'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { useMessageActivityState } from '@renderer/hooks/messages/useMessageActivityState'
import { useMessageEditorConfig } from '@renderer/hooks/messages/useMessageEditorConfig'
import { useMessageErrorActions } from '@renderer/hooks/messages/useMessageErrorActions'
import { useMessageExportActions } from '@renderer/hooks/messages/useMessageExportActions'
import { useMessageLeafCapabilities } from '@renderer/hooks/messages/useMessageLeafCapabilities'
import { useMessageListRenderConfig } from '@renderer/hooks/messages/useMessageListRenderConfig'
import { useMessageMenuConfig } from '@renderer/hooks/messages/useMessageMenuConfig'
import { useMessageSelectionController } from '@renderer/hooks/messages/useMessageSelectionController'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

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
  const editorConfig = useMessageEditorConfig(renderConfig.fontSize)
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
      editorConfig,
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
      editorConfig,
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
      uploadEditorFiles: leafCapabilities.uploadEditorFiles,
      copyText: leafCapabilities.copyText,
      copyRichContent: leafCapabilities.copyRichContent,
      copyImage: leafCapabilities.copyImage,
      exportTableAsExcel: leafCapabilities.exportTableAsExcel,
      notifySuccess: leafCapabilities.notifySuccess,
      notifyWarning: leafCapabilities.notifyWarning,
      notifyInfo: leafCapabilities.notifyInfo,
      notifyError: leafCapabilities.notifyError,
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
      leafCapabilities.uploadEditorFiles,
      leafCapabilities.copyText,
      leafCapabilities.copyRichContent,
      leafCapabilities.copyImage,
      leafCapabilities.exportTableAsExcel,
      leafCapabilities.notifyError,
      leafCapabilities.notifyInfo,
      leafCapabilities.notifySuccess,
      leafCapabilities.notifyWarning,
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

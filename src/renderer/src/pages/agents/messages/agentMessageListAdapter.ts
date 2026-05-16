import type {
  MessageListActions,
  MessageListMeta,
  MessageListProviderValue,
  MessageListState
} from '@renderer/components/chat/messages/types'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { useMessageActivityState } from '@renderer/pages/shared/messages/hooks/useMessageActivityState'
import { useMessageEditorCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageEditorCapabilities'
import { useMessageEditorConfig } from '@renderer/pages/shared/messages/hooks/useMessageEditorConfig'
import { useMessageErrorActions } from '@renderer/pages/shared/messages/hooks/useMessageErrorActions'
import { useMessageExportActions } from '@renderer/pages/shared/messages/hooks/useMessageExportActions'
import { useMessageHeaderCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageHeaderCapabilities'
import { useMessageLeafCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageLeafCapabilities'
import { useMessageListRenderConfig } from '@renderer/pages/shared/messages/hooks/useMessageListRenderConfig'
import { useMessageMenuConfig } from '@renderer/pages/shared/messages/hooks/useMessageMenuConfig'
import { useMessageSelectionController } from '@renderer/pages/shared/messages/hooks/useMessageSelectionController'
import { useMessageUiStateCache } from '@renderer/pages/shared/messages/hooks/useMessageUiStateCache'
import {
  pickMessageHeaderActions,
  pickMessageLeafActions,
  pickMessageLeafState
} from '@renderer/pages/shared/messages/messageListProviderBuilder'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { useNavigate } from '@tanstack/react-router'
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
  respondToolApproval?: MessageListActions['respondToolApproval']
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
  respondToolApproval,
  messageNavigation
}: AgentMessageListParams): MessageListProviderValue {
  const navigate = useNavigate()
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
  const editorCapabilities = useMessageEditorCapabilities()
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()
  const selectionController = useMessageSelectionController({
    topicId: topic.id,
    messages: messageItems,
    partsByMessageId,
    deleteMessage,
    saveTextFile: exportActions.saveTextFile
  })

  const openPath = useCallback((path: string) => {
    return window.api.file.openPath(path)
  }, [])

  const showInFolder = useCallback((path: string) => {
    return window.api.file.showInFolder(path)
  }, [])

  const abortTool = useCallback((toolId: string) => {
    return window.api.mcp.abortTool(toolId)
  }, [])

  const navigateToRoute = useCallback<NonNullable<MessageListActions['navigateToRoute']>>(
    ({ path, query }) => navigate({ to: path, search: query }),
    [navigate]
  )

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
      getMessageUiState: messageUiStateCache.getMessageUiState,
      getMessageActivityState,
      ...pickMessageLeafState(leafCapabilities)
    }),
    [
      getMessageActivityState,
      hasOlder,
      isLoading,
      editorConfig,
      leafCapabilities,
      menuConfig,
      messageUiStateCache.getMessageUiState,
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
      ...pickMessageLeafActions(leafCapabilities),
      ...editorCapabilities,
      navigateToRoute,
      ...pickMessageHeaderActions(headerCapabilities),
      respondToolApproval,
      openPath,
      openCitationsPanel,
      showInFolder,
      abortTool,
      ...selectionController.actions,
      updateMessageUiState: messageUiStateCache.updateMessageUiState,
      updateRenderConfig
    }),
    [
      abortTool,
      deleteMessage,
      editorCapabilities,
      errorActions,
      exportActions,
      headerCapabilities,
      leafCapabilities,
      navigateToRoute,
      loadOlder,
      messageUiStateCache.updateMessageUiState,
      openCitationsPanel,
      openPath,
      respondToolApproval,
      selectionController.actions,
      showInFolder,
      updateRenderConfig
    ]
  )

  const meta = useMemo<MessageListMeta>(
    () => ({
      selectionLayer: true,
      userProfile: headerCapabilities.userProfile,
      assistantProfile
    }),
    [assistantProfile, headerCapabilities.userProfile]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}

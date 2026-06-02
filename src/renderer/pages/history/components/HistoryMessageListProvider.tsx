import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type {
  MessageListActions,
  MessageListItem,
  MessageListMeta,
  MessageListProviderValue,
  MessageListState
} from '@renderer/components/chat/messages/types'
import { useMessageEditorConfig } from '@renderer/pages/shared/messages/hooks/useMessageEditorConfig'
import { useMessageErrorActions } from '@renderer/pages/shared/messages/hooks/useMessageErrorActions'
import { useMessageHeaderCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageHeaderCapabilities'
import { useMessageLeafCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageLeafCapabilities'
import { useMessageListRenderConfig } from '@renderer/pages/shared/messages/hooks/useMessageListRenderConfig'
import { useMessageUiStateCache } from '@renderer/pages/shared/messages/hooks/useMessageUiStateCache'
import {
  pickMessageHeaderActions,
  pickMessageLeafActions,
  pickMessageLeafState
} from '@renderer/pages/shared/messages/messageListProviderBuilder'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

interface Props {
  topic: Topic
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  children: ReactNode
}

export function HistoryMessageListProvider({ topic, messages, partsByMessageId, children }: Props) {
  const navigate = useNavigate()
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const editorConfig = useMessageEditorConfig(renderConfig.fontSize)
  const errorActions = useMessageErrorActions()
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId })
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()

  const openPath = useCallback((path: string) => {
    return window.api.file.openPath(path)
  }, [])

  const showInFolder = useCallback((path: string) => {
    return window.api.file.showInFolder(path)
  }, [])

  const navigateToRoute = useCallback(
    ({ path, query }: { path: string; query?: Record<string, string> }) => navigate({ to: path, search: query }),
    [navigate]
  )

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages,
      partsByMessageId,
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 400,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      listKey: `history-${topic.id}`,
      readonly: true,
      renderConfig,
      editorConfig,
      selection: {
        enabled: false,
        isMultiSelectMode: false,
        selectedMessageIds: []
      },
      getMessageUiState: messageUiStateCache.getMessageUiState,
      getMessageActivityState: () => ({
        isProcessing: false,
        isStreamTarget: false,
        isApprovalAnchor: false
      }),
      ...pickMessageLeafState(leafCapabilities)
    }),
    [
      messages,
      leafCapabilities,
      messageUiStateCache.getMessageUiState,
      partsByMessageId,
      renderConfig,
      editorConfig,
      topic
    ]
  )

  const actions = useMemo<MessageListActions>(
    () => ({
      openPath,
      showInFolder,
      ...errorActions,
      ...pickMessageLeafActions(leafCapabilities),
      navigateToRoute,
      ...pickMessageHeaderActions(headerCapabilities),
      updateMessageUiState: messageUiStateCache.updateMessageUiState,
      updateRenderConfig
    }),
    [
      errorActions,
      headerCapabilities,
      leafCapabilities,
      messageUiStateCache.updateMessageUiState,
      navigateToRoute,
      openPath,
      showInFolder,
      updateRenderConfig
    ]
  )

  const meta = useMemo<MessageListMeta>(
    () => ({
      selectionLayer: false,
      userProfile: headerCapabilities.userProfile
    }),
    [headerCapabilities.userProfile]
  )

  const value = useMemo<MessageListProviderValue>(() => ({ state, actions, meta }), [actions, meta, state])

  return <MessageListProvider value={value}>{children}</MessageListProvider>
}

import { cacheService } from '@data/CacheService'
import { useMessageErrorActions } from '@renderer/components/chat/messages/adapters/useMessageErrorActions'
import { useMessageLeafCapabilities } from '@renderer/components/chat/messages/adapters/useMessageLeafCapabilities'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/adapters/useMessageListRenderConfig'
import { PartsProvider } from '@renderer/components/chat/messages/blocks'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type {
  MessageListItem,
  MessageListProviderValue,
  MessageUiState
} from '@renderer/components/chat/messages/types'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

interface Props {
  topic: Topic
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  children: ReactNode
}

export function HistoryMessageListProvider({ topic, messages, partsByMessageId, children }: Props) {
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const errorActions = useMessageErrorActions()
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId })
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

  const value = useMemo<MessageListProviderValue>(
    () => ({
      state: {
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
        selection: {
          enabled: false,
          isMultiSelectMode: false,
          selectedMessageIds: []
        },
        getMessageUiState,
        getMessageActivityState: () => ({
          isProcessing: false,
          isStreamTarget: false,
          isApprovalAnchor: false
        }),
        isToolAutoApproved: leafCapabilities.isToolAutoApproved,
        externalCodeEditors: leafCapabilities.externalCodeEditors
      },
      actions: {
        openPath,
        showInFolder,
        ...errorActions,
        previewFile: leafCapabilities.previewFile,
        subscribeToolProgress: leafCapabilities.subscribeToolProgress,
        openExternalUrl: leafCapabilities.openExternalUrl,
        openInExternalApp: leafCapabilities.openInExternalApp,
        copyText: leafCapabilities.copyText,
        copyImage: leafCapabilities.copyImage,
        notifySuccess: leafCapabilities.notifySuccess,
        notifyWarning: leafCapabilities.notifyWarning,
        updateMessageUiState,
        updateRenderConfig
      },
      meta: {
        selectionLayer: false
      }
    }),
    [
      getMessageUiState,
      messages,
      leafCapabilities.externalCodeEditors,
      leafCapabilities.isToolAutoApproved,
      leafCapabilities.openExternalUrl,
      leafCapabilities.openInExternalApp,
      leafCapabilities.copyText,
      leafCapabilities.copyImage,
      leafCapabilities.notifySuccess,
      leafCapabilities.notifyWarning,
      leafCapabilities.previewFile,
      leafCapabilities.subscribeToolProgress,
      openPath,
      partsByMessageId,
      renderConfig,
      showInFolder,
      topic,
      errorActions,
      updateMessageUiState,
      updateRenderConfig
    ]
  )

  return (
    <MessageListProvider value={value}>
      <PartsProvider value={partsByMessageId}>{children}</PartsProvider>
    </MessageListProvider>
  )
}

import { usePreference } from '@data/hooks/usePreference'
import { useMessageListAdapterCapabilities } from '@renderer/components/chat/messages/hooks/useMessageListAdapterCapabilities'
import {
  pickMessageHeaderActions,
  pickMessageLeafActions,
  pickMessageLeafState
} from '@renderer/components/chat/messages/messageListProviderBuilder'
import {
  DEFAULT_MESSAGE_LIST_CONFIG,
  type MessageListActions,
  type MessageListItem,
  type MessageListMeta,
  type MessageListProviderValue,
  type MessageListState
} from '@renderer/components/chat/messages/types'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

interface QuickMessageListParams {
  topic: Topic
  assistant?: Assistant
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

/**
 * Message-list wiring for the quick assistant panel.
 *
 * Deliberately much smaller than the chat and agent-session adapters: the conversation
 * lives in `TemporaryChatService` until the user saves it, so there is no branch tree,
 * no pagination, no message rows to delete, and no workspace to resolve paths against.
 * Everything that remains — copy, export, error handling, file previews — comes from
 * {@link useMessageListAdapterCapabilities}, so the panel renders identically to chat.
 */
export function useQuickMessageListProviderValue({
  topic,
  assistant,
  messages,
  partsByMessageId
}: QuickMessageListParams): MessageListProviderValue {
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const {
    errorActions,
    exportActions,
    getMessageActivityState,
    headerCapabilities,
    leafCapabilities,
    menuConfig,
    messageUiStateCache,
    renderConfig,
    updateRenderConfig
  } = useMessageListAdapterCapabilities({
    topicId: topic.id,
    topicName: topic.name,
    messages,
    partsByMessageId
  })

  const navigateToRoute = useCallback<NonNullable<MessageListActions['navigateToRoute']>>(
    ({ path, query }) => openRoute(path, query),
    []
  )

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages,
      partsByMessageId,
      messageNavigation,
      ...DEFAULT_MESSAGE_LIST_CONFIG,
      listKey: topic.id,
      renderConfig,
      menuConfig,
      getMessageUiState: messageUiStateCache.getMessageUiState,
      getMessageActivityState,
      ...pickMessageLeafState(leafCapabilities)
    }),
    [
      getMessageActivityState,
      leafCapabilities,
      menuConfig,
      messageUiStateCache.getMessageUiState,
      messageNavigation,
      messages,
      partsByMessageId,
      renderConfig,
      topic
    ]
  )

  const actions = useMemo<MessageListActions>(
    () => ({
      ...exportActions,
      ...errorActions,
      ...pickMessageLeafActions(leafCapabilities),
      ...pickMessageHeaderActions(headerCapabilities),
      navigateToRoute,
      updateMessageUiState: messageUiStateCache.updateMessageUiState,
      updateRenderConfig
    }),
    [
      errorActions,
      exportActions,
      headerCapabilities,
      leafCapabilities,
      messageUiStateCache.updateMessageUiState,
      navigateToRoute,
      updateRenderConfig
    ]
  )

  const meta = useMemo<MessageListMeta>(
    () => ({
      // No multi-select: the panel is a few hundred pixels tall and the conversation is
      // temporary — the selection toolbar would cost more room than it earns.
      selectionLayer: false,
      userProfile: headerCapabilities.userProfile,
      assistantProfile: assistant ? { name: assistant.name, avatar: assistant.emoji } : undefined,
      imageExportFileName: topic.name
    }),
    [assistant, headerCapabilities.userProfile, topic.name]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}

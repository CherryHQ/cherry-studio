import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { MessageEditingProvider } from '@renderer/components/chat/editing/MessageEditingContext'
import type { TopicMessageFlowLiveState } from '@renderer/components/chat/flow'
import type { MessageListActions, MessageListSelectAllPagination } from '@renderer/components/chat/messages/types'
import { ConversationGreeting } from '@renderer/components/chat/shell/ConversationGreeting'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import type {
  ChatComposerResolvedContext,
  ChatContextUsageSource,
  ChatConversationControlsChangeHandler
} from '@renderer/components/composer/variants/ChatComposer'
import { ResourceEditDialogEventHost } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ChatWriteProvider } from '@renderer/hooks/chat/ChatWriteContext'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { useTopicMessages } from '@renderer/hooks/useTopicMessages'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types/topic'
import { endsWithProviderQuotaError } from '@renderer/utils/message/providerQuotaError'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { hasClearContextPart } from '@shared/data/types/uiParts'
import { normalizeMaxMessages, resolveMaxMessages } from '@shared/utils/contextSettings'

import ChatComposerSlot from './ChatComposerSlot'
import ChatMain from './ChatMain'
import { useTopicBranchActions } from './hooks/useTopicBranchActions'
import { findContextWindowBoundary } from './messages/contextWindowBoundary'
import { ContextWindowDivider } from './messages/ContextWindowDivider'
import type { AddNewTopicPayload } from './types'
import { useChatRuntimeState } from './useChatRuntimeState'

interface Props {
  topic: Topic
  onOpenCitationsPanel?: MessageListActions['openCitationsPanel']
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onCreateEmptyTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  locateMessageId?: string
  locateToEnd?: boolean
  onLocateMessageHandled?: () => void
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
  assistantContext?: ChatComposerResolvedContext
  providers?: Provider[]
  onConversationControlsChange?: ChatConversationControlsChangeHandler
  composerModelId?: UniqueModelId
}

/**
 * Home chat content.
 *
 * Outer shell — mounts the frame immediately; the shared message list owns the
 * initial-loading view so the composer doesn't disappear during topic switches.
 *
 * `useChatRuntimeState` owns message runtime concerns — stream handoff,
 * execution overlays, and write actions. This page keeps the provider/frame
 * composition visible.
 */
const ChatContent: FC<Props> = ({
  topic,
  onOpenCitationsPanel,
  onNewTopic,
  onCreateEmptyTopic,
  locateMessageId,
  locateToEnd,
  onLocateMessageHandled,
  onBranchLiveStateChange,
  assistantContext,
  providers,
  onConversationControlsChange,
  composerModelId
}) => {
  const {
    uiMessages,
    displayIndex,
    siblingsMap,
    pathMessages,
    replyHistory,
    isLoading: isHistoryLoading,
    isStale: isHistoryStale,
    refresh,
    activeNodeId,
    loadOlder,
    hasOlder,
    selectAllPagination,
    mutate: messagesCacheMutate
  } = useTopicMessages(topic.id)

  return (
    <ChatContentInner
      topic={topic}
      onOpenCitationsPanel={onOpenCitationsPanel}
      onNewTopic={onNewTopic}
      onCreateEmptyTopic={onCreateEmptyTopic}
      locateMessageId={locateMessageId}
      locateToEnd={locateToEnd}
      onLocateMessageHandled={onLocateMessageHandled}
      onBranchLiveStateChange={onBranchLiveStateChange}
      assistantContext={assistantContext}
      providers={providers}
      onConversationControlsChange={onConversationControlsChange}
      composerModelId={composerModelId}
      isHistoryLoading={isHistoryLoading}
      isHistoryStale={isHistoryStale}
      displayIndex={displayIndex}
      uiMessages={uiMessages}
      siblingsMap={siblingsMap}
      pathMessages={pathMessages}
      replyHistory={replyHistory}
      refresh={refresh}
      activeNodeId={activeNodeId}
      loadOlder={loadOlder}
      hasOlder={hasOlder}
      selectAllPagination={selectAllPagination}
      messagesCacheMutate={messagesCacheMutate}
    />
  )
}

// ============================================================================
// Inner — keeps composer mounted while history loads
// ============================================================================

interface InnerProps extends Props {
  isHistoryLoading: boolean
  isHistoryStale: boolean
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
  /** Live DB-backed message list; reactive to SWR refreshes. */
  uiMessages: CherryUIMessage[]
  displayIndex: ReturnType<typeof useTopicMessages>['displayIndex']
  siblingsMap: ReturnType<typeof useTopicMessages>['siblingsMap']
  pathMessages: ReturnType<typeof useTopicMessages>['pathMessages']
  replyHistory: ReturnType<typeof useTopicMessages>['replyHistory']
  refresh: () => Promise<void>
  activeNodeId: string | null
  loadOlder: () => void
  hasOlder: boolean
  selectAllPagination: MessageListSelectAllPagination
  messagesCacheMutate: ReturnType<typeof useTopicMessages>['mutate']
}

const ChatContentInner: FC<InnerProps> = ({
  topic,
  onOpenCitationsPanel,
  onNewTopic,
  onCreateEmptyTopic,
  locateMessageId,
  locateToEnd,
  onLocateMessageHandled,
  onBranchLiveStateChange,
  assistantContext,
  providers,
  onConversationControlsChange,
  composerModelId,
  isHistoryLoading,
  isHistoryStale,
  uiMessages,
  displayIndex,
  siblingsMap,
  pathMessages,
  replyHistory,
  refresh,
  activeNodeId,
  loadOlder,
  hasOlder,
  selectAllPagination,
  messagesCacheMutate
}) => {
  const { t } = useTranslation()
  const [supportsImageInput, setSupportsImageInput] = useState(false)
  const { reserveBranch } = useTopicBranchActions(topic.id)
  const assistant = assistantContext?.assistant
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  const runtime = useChatRuntimeState({
    topic,
    isHistoryLoading,
    replyHistory,
    uiMessages,
    displayIndex,
    refresh,
    activeNodeId,
    messagesCacheMutate,
    assistant,
    composerModelId,
    onBranchLiveStateChange
  })
  const locateRuntimeMessage = runtime.locateMessage
  const handleConversationControlsChange = useCallback<ChatConversationControlsChangeHandler>(
    (snapshot) => {
      setSupportsImageInput(snapshot?.supportsImageInput ?? false)
      onConversationControlsChange?.(snapshot)
    },
    [onConversationControlsChange]
  )
  const addGeneratedImageToComposer = useCallback<NonNullable<MessageListActions['addGeneratedImageToComposer']>>(
    (image) =>
      EventEmitter.emit(EVENT_NAMES.ADD_CHAT_COMPOSER_IMAGE_REFERENCE, {
        topicId: topic.id,
        ...image
      }),
    [topic.id]
  )
  const [globalMaxMessages] = usePreference('chat.context_settings.max_messages')
  const maxMessages = normalizeMaxMessages(
    resolveMaxMessages(topic.assistantId ? assistant?.settings?.contextSettings : undefined, globalMaxMessages)
  )
  const nextTurnFillsActiveNode = runtime.composerChatTarget.mode === 'reserved-branch'
  const canPreviewContextWindow =
    !isHistoryLoading &&
    !isHistoryStale &&
    !runtime.isTurnBusy &&
    (!topic.assistantId || assistant?.id === topic.assistantId)
  const precedingMessageId = hasOlder ? (pathMessages[0]?.parentId ?? undefined) : undefined
  const boundary = useMemo(
    () =>
      canPreviewContextWindow
        ? findContextWindowBoundary(pathMessages, maxMessages, { nextTurnFillsActiveNode, precedingMessageId })
        : null,
    [canPreviewContextWindow, maxMessages, nextTurnFillsActiveNode, pathMessages, precedingMessageId]
  )
  const pageEdgeMessageId = boundary?.precedingMessageId
  const { data: pageEdgeMessage } = useQuery('/messages/:id', {
    enabled: Boolean(pageEdgeMessageId),
    params: { id: pageEdgeMessageId ?? '' }
  })
  const pageEdgeHasEarlierHistory =
    pageEdgeMessage !== undefined &&
    pageEdgeMessage.id === pageEdgeMessageId &&
    pageEdgeMessage.role !== 'root' &&
    !hasClearContextPart(pageEdgeMessage.data.parts)
  const contextWindowSlots = useMemo(() => {
    if (maxMessages === null || !boundary || (pageEdgeMessageId && !pageEdgeHasEarlierHistory)) return {}
    const divider = <ContextWindowDivider limit={maxMessages} />
    return boundary.kind === 'before'
      ? { messageHead: { messageId: boundary.messageId, content: divider } }
      : { afterMessages: divider }
  }, [boundary, maxMessages, pageEdgeHasEarlierHistory, pageEdgeMessageId])
  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])
  const contextRevision = useMemo(
    () => pathMessages?.map((message) => [message.id, message.updatedAt, message.compactionSummary]),
    [pathMessages]
  )
  const { parentAnchorId } = runtime.composerChatTarget
  const { data: estimatedContextTokens, mutate: mutateContextEstimate } = useSWR(
    canPreviewContextWindow && parentAnchorId && composerModelId
      ? ([
          'ai.topic.estimate_context',
          {
            topicId: topic.id,
            anchorId: parentAnchorId,
            modelId: composerModelId,
            fillsAnchor: nextTurnFillsActiveNode
          },
          maxMessages,
          assistant?.updatedAt,
          contextRevision
        ] as const)
      : null,
    ([route, input]) => ipcApi.request(route, input),
    { shouldRetryOnError: false, keepPreviousData: false }
  )
  useDataChange(
    '/topics/:topicId/messages',
    () => {
      if (canPreviewContextWindow && parentAnchorId && composerModelId) {
        void mutateContextEstimate(undefined, { revalidate: true }).catch(() => undefined)
      }
    },
    { routeParams: { topicId: topic.id } }
  )
  const contextUsage: ChatContextUsageSource | null =
    canPreviewContextWindow && composerModelId && typeof estimatedContextTokens === 'number'
      ? { contextTokens: estimatedContextTokens, modelId: composerModelId }
      : null
  const providerQuotaExhausted = useMemo(
    () => !isHistoryStale && endsWithProviderQuotaError(uiMessages, activeNodeId),
    [activeNodeId, isHistoryStale, uiMessages]
  )

  useEffect(() => {
    if (!locateMessageId && !locateToEnd) {
      locateLoadRequestRef.current = undefined
      return
    }
    if (isHistoryLoading || isHistoryStale) return
    const targetLoaded = uiMessages.some((message) => message.id === locateMessageId)
    if (!targetLoaded && !locateToEnd && hasOlder) {
      const requestKey = `${locateMessageId}:${uiMessages.length}`
      if (locateLoadRequestRef.current !== requestKey) {
        locateLoadRequestRef.current = requestKey
        loadOlder()
      }
      return
    }
    locateLoadRequestRef.current = undefined
    // Claim scroll ownership before the list's pending initial-restore frame.
    if (locateToEnd || !targetLoaded) locateRuntimeMessage(null)
    else if (locateMessageId) locateRuntimeMessage(locateMessageId, true)
    onLocateMessageHandled?.()
  }, [
    hasOlder,
    isHistoryLoading,
    isHistoryStale,
    loadOlder,
    locateMessageId,
    locateToEnd,
    locateRuntimeMessage,
    onLocateMessageHandled,
    uiMessages
  ])

  const isEmptyConversation = !isHistoryLoading && runtime.messages.length === 0
  const main = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {isEmptyConversation && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <ConversationGreeting
            avatar={assistant?.avatarSrc ?? assistant?.emoji}
            fallbackEmoji={assistant?.emoji}
            title={t('chat.home.welcome_title')}
          />
        </div>
      )}
      <ChatMain
        key={topic.id}
        topic={topic}
        assistant={assistant}
        messages={runtime.messages}
        partsByMessageId={runtime.partsByMessageId}
        streamingLayers={runtime.streamingLayers}
        onBindRuntime={runtime.bindMessageListRuntime}
        isInitialLoading={isHistoryLoading}
        isMessagesStale={isHistoryStale}
        loadOlder={loadOlder}
        hasOlder={hasOlder}
        selectAllPagination={selectAllPagination}
        openCitationsPanel={onOpenCitationsPanel}
        addGeneratedImageToComposer={supportsImageInput ? addGeneratedImageToComposer : undefined}
        onStartBranchDraft={reserveBranch}
        messageHead={contextWindowSlots.messageHead}
        afterMessages={contextWindowSlots.afterMessages}
      />
    </div>
  )
  const composer = runtime.shouldRenderHomeComposer ? (
    <ChatComposerSlot
      placement="home"
      topic={topic}
      contextUsage={contextUsage}
      providerQuotaExhausted={providerQuotaExhausted}
      onSend={runtime.sendMessage}
      chatTarget={runtime.composerChatTarget}
      onNewTopic={onNewTopic}
      composerContext={runtime.composerContext}
      assistantContext={assistantContext}
      providers={providers}
      onConversationControlsChange={handleConversationControlsChange}
    />
  ) : (
    <ChatComposerSlot
      placement="docked"
      topic={topic}
      contextUsage={contextUsage}
      providerQuotaExhausted={providerQuotaExhausted}
      onSend={runtime.sendMessage}
      chatTarget={runtime.composerChatTarget}
      onNewTopic={onNewTopic}
      onCreateEmptyTopic={onCreateEmptyTopic}
      sendDisabled={isHistoryLoading}
      composerContext={runtime.composerContext}
      assistantContext={assistantContext}
      providers={providers}
      onConversationControlsChange={handleConversationControlsChange}
    />
  )
  const placement = runtime.shouldRenderHomeComposer ? 'home' : 'docked'

  return (
    <ChatWriteProvider value={runtime.chatWriteActions}>
      <SiblingsProvider value={siblingsContextValue}>
        <MessageEditingProvider>
          <ConversationStageCenter placement={placement} main={main} composer={composer} />
          <ResourceEditDialogEventHost />
        </MessageEditingProvider>
      </SiblingsProvider>
    </ChatWriteProvider>
  )
}

export default ChatContent

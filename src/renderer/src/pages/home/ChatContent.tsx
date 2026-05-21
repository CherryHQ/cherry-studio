import { loggerService } from '@logger'
import { ComposerContextProvider } from '@renderer/components/chat/composer/ComposerContext'
import ComposerCore from '@renderer/components/chat/composer/ComposerCore'
import ComposerDockTransitionFrame from '@renderer/components/chat/composer/ComposerDockTransitionFrame'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import ChatComposer, { ChatHomeComposer } from '@renderer/components/chat/composer/variants/ChatComposer'
import { ChatLayoutModeProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import {
  RefreshProvider,
  type TranslationOverlayEntry,
  TranslationOverlayProvider,
  type TranslationOverlaySetter,
  TranslationOverlaySetterProvider
} from '@renderer/components/chat/messages/blocks'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { ChatWriteProvider } from '@renderer/hooks/ChatWriteContext'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import type { TemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicMessages } from '@renderer/hooks/useTopicMessages'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { FileMetadata, Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useChatWriteActions } from './hooks/useChatWriteActions'
import { useTopicMessagesCache } from './hooks/useTopicMessagesCache'
import { useHomeMessageListProviderValue } from './messages/homeMessageListAdapter'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('ChatContent')

interface ChatTurnInput {
  text: string
  options?: {
    files?: FileMetadata[]
    mentionedModels?: UniqueModelId[]
    knowledgeBaseIds?: string[]
    userMessageParts?: CherryMessagePart[]
  }
}

export interface ChatContentFrameSlots {
  main: ReactNode
  bottomComposer?: ReactNode
  overlay?: ReactNode
}

interface Props {
  topic: Topic
  mainHeight: string
  renderFrame?: (slots: ChatContentFrameSlots) => ReactNode
  onOpenCitationsPanel?: MessageListActions['openCitationsPanel']
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  /**
   * If the active topic is a freshly-leased temporary one, this callback
   * migrates it into SQLite (with the same id) before the first message
   * is sent. Owned by HomePage so the lease and the persist trigger live
   * on the same hook instance. `initialName` seeds a placeholder topic
   * title so the sidebar isn't blank pre-auto-name.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<TemporaryConversation | null>
}

/**
 * Home chat content.
 *
 * Outer shell — mounts the frame immediately; the shared message list owns the
 * initial-loading view so the composer doesn't disappear during topic switches.
 *
 * Inner component composes three purpose-built hooks:
 *   - `useExecutionOverlay` — overlays per-execution streaming parts
 *     onto the DB-backed `uiMessages` parts map.
 *   - `useTopicMessagesCache` — optimistic SWR writes + DataApi mutation
 *     triggers for send / delete / edit / fork / setActiveNode.
 *   - `useChatWriteActions` — every write-side handler the
 *     `ChatWriteContext` provides to downstream components.
 *
 * `useChatWithHistory` stays trigger-only: `sendMessage` / `regenerate`
 * / `stop` / `setMessages` / `activeExecutions`. Its
 * `state.messages` is not rendered; chunks land in the per-execution overlay
 * and are merged into `partsByMessageId`.
 */
const ChatContent: FC<Props> = ({
  topic,
  mainHeight,
  renderFrame,
  onOpenCitationsPanel,
  onTemporaryAssistantChange,
  onNewTopic,
  locateMessageId,
  onLocateMessageHandled,
  onPersistTemporaryTopic
}) => {
  const [hasPersistedTemporaryTopic, setHasPersistedTemporaryTopic] = useState(false)
  useEffect(() => setHasPersistedTemporaryTopic(false), [topic.id])
  const isFreshTemporaryTopic = !!onPersistTemporaryTopic && !hasPersistedTemporaryTopic
  const {
    uiMessages,
    siblingsMap,
    isLoading: isHistoryLoading,
    refresh,
    activeNodeId,
    loadOlder,
    hasOlder,
    mutate: messagesCacheMutate
  } = useTopicMessages(topic.id, { fetchOnMount: !isFreshTemporaryTopic })

  return (
    <ChatContentInner
      topic={topic}
      mainHeight={mainHeight}
      renderFrame={renderFrame}
      onOpenCitationsPanel={onOpenCitationsPanel}
      onTemporaryAssistantChange={onTemporaryAssistantChange}
      onNewTopic={onNewTopic}
      locateMessageId={locateMessageId}
      onLocateMessageHandled={onLocateMessageHandled}
      onPersistTemporaryTopic={onPersistTemporaryTopic}
      isHistoryLoading={isHistoryLoading}
      isFreshTemporaryTopic={isFreshTemporaryTopic}
      onTemporaryTopicPersisted={() => setHasPersistedTemporaryTopic(true)}
      initialMessages={uiMessages}
      uiMessages={uiMessages}
      siblingsMap={siblingsMap}
      refresh={refresh}
      activeNodeId={activeNodeId}
      loadOlder={loadOlder}
      hasOlder={hasOlder}
      messagesCacheMutate={messagesCacheMutate}
    />
  )
}

// ============================================================================
// Inner — keeps composer mounted while history loads
// ============================================================================

interface InnerProps extends Props {
  isHistoryLoading: boolean
  isFreshTemporaryTopic: boolean
  onTemporaryTopicPersisted: () => void
  /** One-time seed for `useChat(messages:)` — consumed on mount only. */
  initialMessages: CherryUIMessage[]
  /** Live DB-backed message list; reactive to SWR refreshes. */
  uiMessages: CherryUIMessage[]
  siblingsMap: ReturnType<typeof useTopicMessages>['siblingsMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  loadOlder: () => void
  hasOlder: boolean
  messagesCacheMutate: ReturnType<typeof useTopicMessages>['mutate']
}

const ChatContentInner: FC<InnerProps> = ({
  topic,
  mainHeight,
  renderFrame,
  onOpenCitationsPanel,
  onTemporaryAssistantChange,
  onNewTopic,
  locateMessageId,
  onLocateMessageHandled,
  onPersistTemporaryTopic,
  isHistoryLoading,
  isFreshTemporaryTopic,
  onTemporaryTopicPersisted,
  initialMessages,
  uiMessages,
  siblingsMap,
  refresh,
  activeNodeId,
  loadOlder,
  hasOlder,
  messagesCacheMutate
}) => {
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  const { regenerate, stop, status, setMessages, activeExecutions } = useChatWithHistory(
    topic.id,
    initialMessages,
    refresh
  )
  const messages = uiMessages

  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return
    setMessages(uiMessages)
  }, [uiMessages, status, setMessages])

  const [translationOverlay, setTranslationOverlayMap] = useState<Record<string, TranslationOverlayEntry>>({})
  const setTranslationOverlay = useCallback<TranslationOverlaySetter>((messageId, entry) => {
    setTranslationOverlayMap((prev) => {
      if (entry == null) {
        if (!(messageId in prev)) return prev
        const next = { ...prev }
        delete next[messageId]
        return next
      }
      const existing = prev[messageId]
      if (
        existing &&
        existing.content === entry.content &&
        existing.targetLanguage === entry.targetLanguage &&
        existing.sourceLanguage === entry.sourceLanguage
      ) {
        return prev
      }
      return { ...prev, [messageId]: entry }
    })
  }, [])

  const finishRef = useRef<(executionId: string, event: ExecutionFinishEvent) => void>(undefined)
  const { overlay, disposeOverlay } = useExecutionOverlay(topic.id, activeExecutions, messages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of messages) {
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (messageId in next && parts.length) next[messageId] = parts
    }
    for (const [messageId, entry] of Object.entries(translationOverlay)) {
      const existing = next[messageId]
      if (!existing) continue
      const baseParts = existing.filter((part) => part.type !== 'data-translation')
      next[messageId] = [
        ...baseParts,
        {
          type: 'data-translation',
          data: {
            content: entry.content,
            targetLanguage: entry.targetLanguage,
            ...(entry.sourceLanguage && { sourceLanguage: entry.sourceLanguage })
          }
        } as CherryMessagePart
      ]
    }
    return next
  }, [messages, overlay, translationOverlay])

  const respondToolApproval = useToolApprovalBridge(topic.id)
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: respondToolApproval
  })
  const composerContext = useMemo(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages: cache.seedReservedMessages,
      refresh,
      rollback: isFreshTemporaryTopic ? cache.clearBranchCache : cache.rollbackBranch
    }),
    [cache.clearBranchCache, cache.rollbackBranch, cache.seedReservedMessages, isFreshTemporaryTopic, refresh]
  )
  const turnController = useConversationTurnController<
    ChatTurnInput,
    { topicId: string; parentAnchorId: string | null }
  >({
    scopeKey: topic.id,
    historyAdapter,
    ensureConversation: async ({ text }) => {
      if (isHistoryLoading) return null
      if (isFreshTemporaryTopic && onPersistTemporaryTopic) {
        const persisted = await onPersistTemporaryTopic(text)
        if (persisted?.type !== 'assistant') {
          throw new Error('Temporary topic handoff failed before stream open')
        }
        onTemporaryTopicPersisted()
        return { topicId: persisted.topicId, parentAnchorId: activeNodeId ?? null }
      }
      return { topicId: topic.id, parentAnchorId: activeNodeId ?? null }
    },
    buildStreamRequest: ({ text, options }, conversation) => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      parentAnchorId: conversation.parentAnchorId ?? undefined,
      userMessageParts: options?.userMessageParts ?? [{ type: 'text', text }],
      mentionedModelIds: options?.mentionedModels
    })
  })

  const handleExecutionFinish = useCallback(
    (_executionId: string, { message, isError }: ExecutionFinishEvent) => {
      if (isError || !message.parts?.length) {
        void cache.rollbackBranch().then(() => disposeOverlay(message.id))
        return
      }
      void refresh().finally(() => disposeOverlay(message.id))
    },
    [cache, disposeOverlay, refresh]
  )
  finishRef.current = handleExecutionFinish
  const shouldRenderHomeComposer =
    !isHistoryLoading &&
    isFreshTemporaryTopic &&
    turnController.layout === 'draft' &&
    uiMessages.length === 0 &&
    activeExecutions.length === 0

  // Chat write-side handlers (delete / edit / regenerate / resend / fork /
  // setActiveNode / clearTopic).
  const { actions: chatWriteActions } = useChatWriteActions({
    topic,
    uiMessages: messages,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache
  })

  const handleSend = useCallback(
    async (
      text: string,
      options?: {
        files?: FileMetadata[]
        mentionedModels?: UniqueModelId[]
        knowledgeBaseIds?: string[]
        userMessageParts?: CherryMessagePart[]
      }
    ) => {
      try {
        await turnController.send({ text, options })
      } catch (err) {
        logger.warn('failed to open conversation turn', err as Error)
        throw err
      }
    },
    [turnController]
  )

  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])

  useEffect(() => {
    if (!locateMessageId) {
      locateLoadRequestRef.current = undefined
      return
    }

    if (uiMessages.some((message) => message.id === locateMessageId)) {
      locateLoadRequestRef.current = undefined
      window.requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + locateMessageId, true)
      })
      onLocateMessageHandled?.()
      return
    }

    if (hasOlder && !isHistoryLoading) {
      const requestKey = `${locateMessageId}:${uiMessages.length}`
      if (locateLoadRequestRef.current !== requestKey) {
        locateLoadRequestRef.current = requestKey
        loadOlder()
      }
      return
    }

    if (!hasOlder && !isHistoryLoading) {
      locateLoadRequestRef.current = undefined
      onLocateMessageHandled?.()
    }
  }, [hasOlder, isHistoryLoading, loadOlder, locateMessageId, onLocateMessageHandled, uiMessages])

  return (
    <ChatWriteProvider value={chatWriteActions}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <TranslationOverlaySetterProvider value={setTranslationOverlay}>
            <TranslationOverlayProvider value={translationOverlay}>
              <ChatLayoutModeProvider>
                {(() => {
                  const main = (
                    <>
                      <HomeMessageList
                        key={topic.id}
                        topic={topic}
                        messages={messages}
                        partsByMessageId={partsByMessageId}
                        isInitialLoading={isHistoryLoading}
                        loadOlder={loadOlder}
                        hasOlder={hasOlder}
                        openCitationsPanel={onOpenCitationsPanel}
                        respondToolApproval={respondToolApproval}
                      />
                    </>
                  )
                  const composer = (
                    <ComposerContextProvider value={composerContext}>
                      <ComposerCore
                        fallback={
                          shouldRenderHomeComposer ? (
                            <ChatHomeComposer
                              topic={topic}
                              onSend={handleSend}
                              onTemporaryAssistantChange={onTemporaryAssistantChange}
                              onNewTopic={onNewTopic}
                            />
                          ) : (
                            <ChatComposer
                              topic={topic}
                              onSend={handleSend}
                              onNewTopic={onNewTopic}
                              sendDisabled={isHistoryLoading}
                              useMentionedModelSelector
                            />
                          )
                        }
                      />
                    </ComposerContextProvider>
                  )
                  const dockedFrame = (
                    <ComposerDockTransitionFrame
                      placement={shouldRenderHomeComposer ? 'home' : 'docked'}
                      main={main}
                      composer={composer}
                      mainVisible={!shouldRenderHomeComposer}
                    />
                  )

                  if (renderFrame) {
                    return renderFrame({ main: dockedFrame })
                  }

                  return (
                    <>
                      <div
                        className="flex flex-1 flex-col justify-between"
                        style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                        {dockedFrame}
                      </div>
                    </>
                  )
                })()}
              </ChatLayoutModeProvider>
            </TranslationOverlayProvider>
          </TranslationOverlaySetterProvider>
        </RefreshProvider>
      </SiblingsProvider>
    </ChatWriteProvider>
  )
}

export default ChatContent

const HomeMessageList: FC<{
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  isInitialLoading?: boolean
  loadOlder: () => void
  hasOlder: boolean
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  respondToolApproval: NonNullable<MessageListActions['respondToolApproval']>
}> = ({
  topic,
  messages,
  partsByMessageId,
  isInitialLoading,
  loadOlder,
  hasOlder,
  openCitationsPanel,
  respondToolApproval
}) => {
  const value = useHomeMessageListProviderValue({
    topic,
    messages,
    partsByMessageId,
    isInitialLoading,
    loadOlder,
    hasOlder,
    openCitationsPanel,
    respondToolApproval
  })
  return (
    <MessageListProvider value={value}>
      <MessageList />
    </MessageListProvider>
  )
}

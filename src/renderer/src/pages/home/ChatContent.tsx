import { loggerService } from '@logger'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { ChatWriteProvider } from '@renderer/hooks/ChatWriteContext'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { ToolApprovalProvider } from '@renderer/hooks/ToolApprovalContext'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import type { ExecutionFinishEvent } from '@renderer/hooks/useExecutionChats'
import { useExecutionChats } from '@renderer/hooks/useExecutionChats'
import { useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicMessages } from '@renderer/hooks/useTopicMessages'
import type { FileMetadata, Topic } from '@renderer/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ChatContent')

import { useHomeMessageListProviderValue } from '@renderer/components/chat/messages/adapters/homeMessageListAdapter'
import { RefreshProvider } from '@renderer/components/chat/messages/blocks'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import ExecutionStreamCollector from '@renderer/components/chat/messages/stream/ExecutionStreamCollector'
import { useMessagePartsById } from '@renderer/components/chat/messages/stream/useMessagePartsById'

import { useChatWriteActions } from './hooks/useChatWriteActions'
import { useTopicMessagesCache } from './hooks/useTopicMessagesCache'
import Inputbar from './Inputbar/Inputbar'

export interface ChatContentFrameSlots {
  main: ReactNode
  bottomComposer?: ReactNode
  overlay?: ReactNode
}

interface Props {
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  mainHeight: string
  renderFrame?: (slots: ChatContentFrameSlots) => ReactNode
  /**
   * If the active topic is a freshly-leased temporary one, this callback
   * migrates it into SQLite (with the same id) before the first message
   * is sent. Owned by HomePage so the lease and the persist trigger live
   * on the same hook instance. `initialName` seeds a placeholder topic
   * title so the sidebar isn't blank pre-auto-name.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<void>
}

/**
 * Home chat content.
 *
 * Outer shell — waits on history to be loaded before mounting the inner
 * component (useChat seeds `initialMessages` once, at mount).
 *
 * Inner component composes three purpose-built hooks:
 *   - `useMessagePartsById` — overlays per-execution streaming parts
 *     onto the DB-backed `uiMessages` parts map.
 *   - `useTopicMessagesCache` — optimistic SWR writes + DataApi mutation
 *     triggers for send / delete / edit / fork / setActiveNode.
 *   - `useChatWriteActions` — every write-side handler the
 *     `ChatWriteContext` provides to downstream components.
 *
 * `useChatWithHistory` stays trigger-only: `sendMessage` / `regenerate`
 * / `stop` / `setMessages` / `activeExecutions`. Its
 * `state.messages` is not rendered; chunks land in per-execution
 * `ExecutionStreamCollector`s and are overlaid into `partsByMessageId`.
 */
const ChatContent: FC<Props> = ({ topic, setActiveTopic, mainHeight, renderFrame, onPersistTemporaryTopic }) => {
  const { t } = useTranslation()
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
  } = useTopicMessages(topic.id, { enabled: !isFreshTemporaryTopic })

  if (isHistoryLoading) {
    const main = (
      <div className="flex h-full flex-1 flex-col items-center justify-center">
        <div className="text-foreground-secondary text-sm">{t('common.loading')}</div>
      </div>
    )

    if (renderFrame) {
      return renderFrame({ main })
    }

    return (
      <div
        className="flex flex-1 flex-col items-center justify-center"
        style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
        {main}
      </div>
    )
  }

  return (
    <ChatContentInner
      topic={topic}
      setActiveTopic={setActiveTopic}
      mainHeight={mainHeight}
      renderFrame={renderFrame}
      onPersistTemporaryTopic={onPersistTemporaryTopic}
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
// Inner — only mounted after history is ready
// ============================================================================

interface InnerProps extends Props {
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
  setActiveTopic,
  mainHeight,
  renderFrame,
  onPersistTemporaryTopic,
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
  const { sendMessage, regenerate, stop, status, setMessages, activeExecutions } = useChatWithHistory(
    topic.id,
    initialMessages,
    refresh
  )

  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return
    const canonical = uiMessages.filter((m) => !m.id.startsWith('optimistic-'))
    setMessages(canonical)
  }, [uiMessages, status, setMessages])

  const respondToToolApproval = useToolApprovalBridge(topic.id, uiMessages)

  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose } = useExecutionMessages()
  const partsByMessageId = useMessagePartsById(uiMessages, executionMessagesById)

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })

  const handleExecutionFinish = useCallback(
    (executionId: string, { message, isAbort, isError }: ExecutionFinishEvent) => {
      if (isError || !message.parts?.length) {
        void cache.rollbackBranch().then(() => handleExecutionDispose(executionId))
        return
      }
      void cache
        .patchMessageInBranch(message.id, {
          status: isAbort ? 'paused' : 'success',
          data: { parts: message.parts as never },
          updatedAt: new Date().toISOString()
        })
        .then(() => handleExecutionDispose(executionId))
    },
    [cache, handleExecutionDispose]
  )

  const executionChats = useExecutionChats(topic.id, activeExecutions, {
    initialMessages: uiMessages,
    onFinish: handleExecutionFinish
  })

  // Chat write-side handlers (delete / edit / regenerate / resend / fork /
  // setActiveNode / clearTopic). Also exposes `capabilityBody` so the send
  // path below mirrors the same shape.
  const { actions: chatWriteActions, capabilityBody } = useChatWriteActions({
    topic,
    uiMessages,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache
  })

  const handleSend = useCallback(
    async (text: string, options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }) => {
      if (isFreshTemporaryTopic && onPersistTemporaryTopic) {
        try {
          // Seed the new topic with the user's first message as a placeholder
          // name so the sidebar entry isn't blank while the auto-namer runs.
          await onPersistTemporaryTopic(text)
          onTemporaryTopicPersisted()
        } catch (err) {
          logger.warn('failed to persist temporary topic, falling back', err as Error)
        }
      }
      const optimisticUserId = await cache.seedOptimisticUser({
        text,
        parentId: activeNodeId ?? null,
        files: options?.files
      })
      if (optimisticUserId && !options?.mentionedModels?.length) {
        await cache.seedOptimisticAssistant({ parentId: optimisticUserId })
      }
      try {
        await sendMessage(
          { text },
          {
            body: {
              parentAnchorId: activeNodeId ?? undefined,
              files: options?.files,
              mentionedModels: options?.mentionedModels,
              ...capabilityBody
            }
          }
        )
      } catch (err) {
        // IPC reject / Main persistence error: drop the phantom bubble
        // by forcing a revalidation against the server.
        await cache.rollbackBranch()
        throw err
      }
    },
    [
      isFreshTemporaryTopic,
      onPersistTemporaryTopic,
      onTemporaryTopicPersisted,
      activeNodeId,
      sendMessage,
      capabilityBody,
      cache
    ]
  )

  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])

  return (
    <ChatWriteProvider value={chatWriteActions}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <ToolApprovalProvider value={respondToToolApproval}>
            <ChatContextBridge topic={topic}>
              {(overlay) => {
                const main = (
                  <>
                    {/*
                     * Two coupled guards on the per-execution chunk collector:
                     *
                     * 1. Mount only after SWR's `uiMessages` ends with an
                     *    in-flight assistant. Collector's `useChat` seeds AI
                     *    SDK's `createStreamingUIMessageState` from
                     *    `initialMessages.at(-1)`; AI SDK reuses that object as
                     *    the streaming `state.message` and a `start` chunk only
                     *    overwrites its `id`, leaving the original `parts`
                     *    array in place. If we mount while last is still the
                     *    OLD assistant being replaced, new chunks append onto
                     *    that array — the bubble renders "old content + new
                     *    stream" once SWR finally flips active to the new
                     *    placeholder.
                     *
                     * 2. Re-key on the in-flight assistant id so subsequent
                     *    regenerates for the same model REMOUNT the collector.
                     *    Without this, React reuses the existing `useChat`
                     *    instance whose `state.messages` already carries the
                     *    previous turn's assistant; the next regenerate seeds
                     *    from THAT, accumulating pollution turn over turn.
                     *
                     * The collector cannot self-correct: it sees `resume: true`
                     * only, never the `regenerate` trigger driving the turn.
                     */}
                    {(() => {
                      const last = uiMessages.at(-1)
                      if (last?.role !== 'assistant') return null
                      return activeExecutions.map(({ executionId }) => {
                        const chat = executionChats.get(executionId)
                        if (!chat) return null
                        return (
                          <ExecutionStreamCollector
                            key={`${executionId}:${last.id}`}
                            executionId={executionId}
                            chat={chat}
                            onMessagesChange={handleExecutionMessagesChange}
                            onDispose={handleExecutionDispose}
                          />
                        )
                      })
                    })()}

                    <HomeMessageList
                      key={topic.id}
                      topic={topic}
                      messages={uiMessages}
                      partsByMessageId={partsByMessageId}
                      loadOlder={loadOlder}
                      hasOlder={hasOlder}
                    />
                  </>
                )
                const bottomComposer = <Inputbar topic={topic} setActiveTopic={setActiveTopic} onSend={handleSend} />

                if (renderFrame) {
                  return renderFrame({ main, bottomComposer, overlay })
                }

                return (
                  <>
                    <div
                      className="flex flex-1 flex-col justify-between"
                      style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                      {main}
                      {bottomComposer}
                    </div>
                    {overlay}
                  </>
                )
              }}
            </ChatContextBridge>
          </ToolApprovalProvider>
        </RefreshProvider>
      </SiblingsProvider>
    </ChatWriteProvider>
  )
}

/**
 * Bridge rendered inside `ChatWriteProvider` so `useChatContextProvider`
 * can read that context. Multi-select
 * floating popup mounts here because it depends on the chat context.
 */
const ChatContextBridge: FC<{ topic: Topic; children: (overlay: ReactNode) => ReactNode }> = ({ topic, children }) => {
  const chatContextValue = useChatContextProvider(topic)
  return (
    <ChatContextProvider value={chatContextValue}>
      {children(chatContextValue.isMultiSelectMode ? <MultiSelectActionPopup topic={topic} /> : null)}
    </ChatContextProvider>
  )
}

export default ChatContent

const HomeMessageList: FC<{
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: ReturnType<typeof useMessagePartsById>
  loadOlder: () => void
  hasOlder: boolean
}> = ({ topic, messages, partsByMessageId, loadOlder, hasOlder }) => {
  const value = useHomeMessageListProviderValue({ topic, messages, partsByMessageId, loadOlder, hasOlder })
  return (
    <MessageListProvider value={value}>
      <MessageList />
    </MessageListProvider>
  )
}

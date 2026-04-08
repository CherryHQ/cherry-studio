import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { isDev } from '@renderer/config/constant'
import { type CherryUIMessage, useAiChat } from '@renderer/hooks/useAiChat'
import { type V2ChatOverrides, V2ChatOverridesProvider } from '@renderer/hooks/useMessageOperations'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import { useV2MessageAdapter } from '@renderer/hooks/useV2MessageAdapter'
import { mapLegacyTopicToDto } from '@renderer/services/AssistantService'
import type { Assistant, FileMetadata, Model, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import Inputbar from './Inputbar/Inputbar'
import { PartsProvider, V2BlockProvider } from './Messages/Blocks'
import Messages from './Messages/Messages'

const logger = loggerService.withContext('V2ChatContent')

interface Props {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  mainHeight: string
}

/**
 * V2 chat content area — replaces Messages + Inputbar when USE_V2_CHAT is enabled.
 *
 * Architecture:
 *
 * Outer shell (V2ChatContent):
 *   - Loads history from DataApi via useTopicMessagesV2
 *   - Renders a loading state until history is ready
 *   - Only mounts V2ChatContentInner AFTER history is loaded, so useAiChat
 *     receives complete initialMessages on its first (and only) read
 *
 * Inner component (V2ChatContentInner):
 *   - Owns useAiChat (streaming) + useV2MessageAdapter
 *   - Merge strategy: history adaptedMessages are the AUTHORITY for persisted
 *     messages (they carry askId, parentId, modelId, traceId, real timestamps).
 *     useV2MessageAdapter is only used for NEW messages (IDs not in history).
 *   - PartsContext: history parts + live streaming parts overlay
 *   - V2BlockContext: history blocks + live streaming blocks overlay
 */
const V2ChatContent: FC<Props> = ({ assistant, topic, setActiveTopic, mainHeight }) => {
  const {
    uiMessages: historyUIMessages,
    adaptedMessages: historyMessages,
    blockMap: historyBlockMap,
    partsMap: historyPartsMap,
    isLoading: isHistoryLoading,
    refresh
  } = useTopicMessagesV2(topic.id)

  // Don't mount the chat instance until history is loaded.
  // useChat only reads initialMessages once on creation — if we mount it
  // while history is still loading, the chat instance starts with zero context
  // and will never pick up the history retroactively.
  if (isHistoryLoading) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center"
        style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
        <div className="text-sm" style={{ color: 'var(--color-text-3)' }}>
          Loading conversation...
        </div>
      </div>
    )
  }

  return (
    <V2ChatContentInner
      assistant={assistant}
      topic={topic}
      setActiveTopic={setActiveTopic}
      mainHeight={mainHeight}
      historyUIMessages={historyUIMessages}
      historyMessages={historyMessages}
      historyBlockMap={historyBlockMap}
      historyPartsMap={historyPartsMap}
      refresh={refresh}
    />
  )
}

// ============================================================================
// Inner component — only mounted after history is ready
// ============================================================================

interface InnerProps extends Props {
  historyUIMessages: CherryUIMessage[]
  historyMessages: Message[]
  historyBlockMap: Record<string, MessageBlock>
  historyPartsMap: Record<string, CherryMessagePart[]>
  refresh: () => Promise<void>
}

const V2ChatContentInner: FC<InnerProps> = ({
  assistant,
  topic,
  setActiveTopic,
  mainHeight,
  historyUIMessages,
  historyMessages,
  historyBlockMap,
  historyPartsMap,
  refresh
}) => {
  // Set of persisted message IDs — used to distinguish history vs. live messages
  const historyIds = useMemo(() => new Set(historyUIMessages.map((m) => m.id)), [historyUIMessages])

  // Stable refs so handleFinish can read the latest values without closing over stale state
  const streamingUIMessagesRef = useRef<CherryUIMessage[]>([])
  const topicRef = useRef(topic)
  topicRef.current = topic
  const historyIdsRef = useRef(historyIds)
  historyIdsRef.current = historyIds

  /**
   * Persist a completed exchange (user + assistant) to DataApi.
   *
   * Both messages are written only after the assistant finishes streaming.
   * - If the stream errors (isError=true), nothing is persisted — DB stays clean.
   * - For new conversations: user message is created first, then assistant.
   * - For regenerate/resend: user message already exists in history, only
   *   the new assistant message is persisted (parentId = existing user id).
   * - On abort (isAbort=true), assistant is persisted with status 'paused'.
   */
  const handleFinish = useCallback(
    async (assistantMessage: CherryUIMessage, isAbort: boolean, isError: boolean) => {
      if (isError) {
        logger.warn('Stream ended with error — skipping persistence', { id: assistantMessage.id })
        return
      }

      // Find the user message that immediately precedes this assistant response
      const allMessages = streamingUIMessagesRef.current
      const assistantIndex = allMessages.findIndex((m) => m.id === assistantMessage.id)
      const userMessage = assistantIndex > 0 ? allMessages[assistantIndex - 1] : undefined

      if (!userMessage || userMessage.role !== 'user') {
        logger.error('Could not find preceding user message — skipping persistence', {
          assistantId: assistantMessage.id
        })
        return
      }

      try {
        // 0. Ensure topic exists in SQLite (lazy-create for topics originating from IndexedDB/Redux)
        const currentTopic = topicRef.current
        try {
          await dataApiService.get(`/topics/${currentTopic.id}`)
        } catch {
          await dataApiService.post('/topics', { body: mapLegacyTopicToDto(currentTopic) })
          logger.info('Lazy-created topic in SQLite', { topicId: currentTopic.id })
        }

        // 1. Determine parentId for assistant message
        const isUserPersisted = historyIdsRef.current.has(userMessage.id)
        let userParentId: string

        if (isUserPersisted) {
          // Regenerate/resend: user message already in DB, skip creation
          userParentId = userMessage.id
          logger.info('User message already persisted, skipping creation', { userMsgId: userParentId })
        } else {
          // New conversation: persist user message first
          const savedUser = await dataApiService.post(`/topics/${currentTopic.id}/messages`, {
            body: {
              role: 'user',
              data: { parts: userMessage.parts as CherryMessagePart[] },
              status: 'success'
            }
          })
          userParentId = savedUser.id
        }

        // 2. Persist assistant message linked to the user message
        const assistantStatus = isAbort ? 'paused' : 'success'
        const totalTokens = assistantMessage.metadata?.totalTokens
        await dataApiService.post(`/topics/${currentTopic.id}/messages`, {
          body: {
            role: 'assistant',
            parentId: userParentId,
            assistantId: assistant.id,
            data: { parts: assistantMessage.parts as CherryMessagePart[] },
            status: assistantStatus,
            ...(totalTokens !== undefined && { stats: { totalTokens } })
          }
        })

        logger.info('Persisted exchange', { userMsgId: userParentId, assistantMsgId: assistantMessage.id })
        await refresh()
      } catch (err) {
        logger.error('Failed to persist exchange', { assistantMsgId: assistantMessage.id, err })
      }
    },
    [topic.id, assistant.id, refresh]
  )

  // useAiChat now receives complete history as initialMessages (guaranteed non-loading)
  const {
    messages: streamingUIMessages,
    setMessages,
    status,
    error,
    sendMessage,
    regenerate
  } = useAiChat({
    chatId: topic.id,
    topicId: topic.id,
    assistantId: assistant.id,
    initialMessages: historyUIMessages.length > 0 ? historyUIMessages : undefined,
    onFinish: handleFinish
  })

  // Keep ref in sync with latest messages after every render
  useEffect(() => {
    streamingUIMessagesRef.current = streamingUIMessages
  })

  /** Delete a single message (reparent children to grandparent) and sync UI. */
  const handleDeleteMessage = useCallback(
    async (id: string) => {
      await dataApiService.delete(`/messages/${id}`, { query: { cascade: false } })
      setMessages((msgs) => msgs.filter((m) => m.id !== id))
      logger.info('Deleted message (single)', { id })
      await refresh()
    },
    [refresh, setMessages]
  )

  /** Delete a message and all descendants (cascade) and sync UI. */
  const handleDeleteMessageGroup = useCallback(
    async (id: string) => {
      const result = await dataApiService.delete(`/messages/${id}`, { query: { cascade: true } })
      const deletedSet = new Set(result.deletedIds)
      setMessages((msgs) => msgs.filter((m) => !deletedSet.has(m.id)))
      logger.info('Deleted message group', { id, count: result.deletedIds.length })
      await refresh()
    },
    [refresh, setMessages]
  )

  const v2ChatOverrides = useMemo<V2ChatOverrides>(
    () => ({
      regenerate: async (messageId?: string) => {
        await regenerate(messageId)
      },
      resend: async (messageId?: string) => {
        await regenerate(messageId)
      },
      deleteMessage: handleDeleteMessage,
      deleteMessageGroup: handleDeleteMessageGroup,
      refresh
    }),
    [regenerate, handleDeleteMessage, handleDeleteMessageGroup, refresh]
  )

  // Only adapt NEW messages (those not in persisted history) via useV2MessageAdapter.
  // History messages keep their full metadata from DataApi.
  const liveUIMessages = useMemo(
    () => streamingUIMessages.filter((m) => !historyIds.has(m.id)),
    [streamingUIMessages, historyIds]
  )

  const { messages: liveAdapted, blockMap: liveBlockMap } = useV2MessageAdapter(
    liveUIMessages,
    status,
    topic.id,
    assistant.id
  )

  // Merge: history (authority) + live streaming (appended)
  const adaptedMessages = useMemo<Message[]>(() => {
    if (liveAdapted.length === 0) return historyMessages
    return [...historyMessages, ...liveAdapted]
  }, [historyMessages, liveAdapted])

  const blockMap = useMemo<Record<string, MessageBlock>>(() => {
    if (liveAdapted.length === 0) return historyBlockMap
    return { ...historyBlockMap, ...liveBlockMap }
  }, [historyBlockMap, liveBlockMap, liveAdapted.length])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    if (liveUIMessages.length === 0) return historyPartsMap
    const map: Record<string, CherryMessagePart[]> = { ...historyPartsMap }
    for (const uiMsg of liveUIMessages) {
      map[uiMsg.id] = uiMsg.parts as CherryMessagePart[]
    }
    return map
  }, [historyPartsMap, liveUIMessages])

  const handleSendV2 = useCallback(
    (text: string, options?: { files?: FileMetadata[]; mentionedModels?: Model[] }) => {
      void sendMessage(
        { text },
        {
          body: {
            files: options?.files,
            mentionedModels: options?.mentionedModels
          }
        }
      )
    },
    [sendMessage]
  )

  return (
    <V2ChatOverridesProvider value={v2ChatOverrides}>
      <PartsProvider value={partsMap}>
        <V2BlockProvider value={blockMap}>
          <div
            className="flex flex-1 flex-col justify-between"
            style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
            {/* V2 status indicator — dev only */}
            {isDev && (
              <div className="shrink-0 border-b px-4 py-1 text-xs" style={{ color: 'var(--color-text-3)' }}>
                [V2] {status} | {adaptedMessages.length} msgs ({historyMessages.length} history + {liveAdapted.length}{' '}
                live)
                {error && <span className="ml-2 text-red-500">{error.message}</span>}
              </div>
            )}

            <Messages
              key={topic.id}
              assistant={assistant}
              topic={topic}
              setActiveTopic={setActiveTopic}
              messages={adaptedMessages}
            />

            <Inputbar assistant={assistant} topic={topic} setActiveTopic={setActiveTopic} onSendV2={handleSendV2} />
          </div>
        </V2BlockProvider>
      </PartsProvider>
    </V2ChatOverridesProvider>
  )
}

export default V2ChatContent

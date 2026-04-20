import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { isDev } from '@renderer/config/constant'
import { ToolApprovalProvider } from '@renderer/hooks/ToolApprovalContext'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { type V2ChatOverrides, V2ChatOverridesProvider } from '@renderer/hooks/useMessageOperations'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import type { Assistant, FileMetadata, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Inputbar from './Inputbar/Inputbar'
import { PartsProvider, RefreshProvider } from './Messages/Blocks'
import ExecutionStreamCollector from './Messages/ExecutionStreamCollector'
import Messages from './Messages/Messages'

const logger = loggerService.withContext('V2ChatContent')

interface Props {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  mainHeight: string
}

/**
 * V2 chat content area.
 *
 * Outer shell (V2ChatContent):
 *   - Loads history from DataApi via useTopicMessagesV2
 *   - Renders loading state until history is ready
 *
 * Inner component (V2ChatContentInner):
 *   - Consumes official useChat over IPC transport
 *   - Stream lifecycle is decoupled from React by Main-side AiStreamManager;
 *     switching topics detaches the Renderer subscriber without aborting the stream
 *   - History (from DataApi) and active stream (from useChat) are separate sources
 *   - PartsContext: history parts + live streaming parts overlay
 */
const V2ChatContent: FC<Props> = ({ assistant, topic, setActiveTopic, mainHeight }) => {
  const { uiMessages, metadataMap, isLoading: isHistoryLoading, refresh, activeNodeId } = useTopicMessagesV2(topic.id)

  // Don't mount the chat instance until history is loaded.
  // ChatSession only reads initialMessages on creation — if we create it
  // while history is still loading, the session starts with zero context.
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
      initialMessages={uiMessages}
      metadataMap={metadataMap}
      refresh={refresh}
      activeNodeId={activeNodeId}
    />
  )
}

// ============================================================================
// Inner component — only mounted after history is ready
// ============================================================================

interface InnerProps extends Props {
  initialMessages: CherryUIMessage[]
  metadataMap: ReturnType<typeof useTopicMessagesV2>['metadataMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
}

const V2ChatContentInner: FC<InnerProps> = ({
  assistant,
  topic,
  setActiveTopic,
  mainHeight,
  initialMessages,
  metadataMap,
  refresh,
  activeNodeId
}) => {
  // const { isMultiSelectMode } = useChatContext(topic)

  const {
    adaptedMessages,
    partsMap,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
    streamingUIMessages,
    activeExecutionIds,
    prepareNextAssistantId,
    addToolApprovalResponse
  } = useChatWithHistory(topic.id, initialMessages, refresh, { assistantId: assistant.id }, metadataMap)

  const respondToToolApproval = useToolApprovalBridge({ addToolApprovalResponse })

  const [executionMessagesById, setExecutionMessagesById] = useState<Record<string, CherryUIMessage[]>>({})
  const executionCreatedAtRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (activeExecutionIds.length === 0) {
      setExecutionMessagesById({})
      executionCreatedAtRef.current = {}
      return
    }

    const activeSet = new Set<string>(activeExecutionIds)
    setExecutionMessagesById((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([executionId]) => activeSet.has(executionId)))
    )
  }, [activeExecutionIds])

  const currentAnchorUserMessageId = useMemo(() => {
    for (let index = streamingUIMessages.length - 1; index >= 0; index--) {
      const message = streamingUIMessages[index]
      if (message.role === 'user') return message.id
    }

    for (let index = adaptedMessages.length - 1; index >= 0; index--) {
      const message = adaptedMessages[index]
      if (message.role === 'user') return message.id
    }

    if (!activeNodeId) return undefined
    return metadataMap[activeNodeId]?.parentId ?? activeNodeId
  }, [activeNodeId, adaptedMessages, metadataMap, streamingUIMessages])

  const handleExecutionMessagesChange = useCallback((executionId: string, messages: CherryUIMessage[]) => {
    setExecutionMessagesById((prev) => ({ ...prev, [executionId]: messages }))
  }, [])

  const handleExecutionDispose = useCallback((executionId: string) => {
    setExecutionMessagesById((prev) => {
      if (!(executionId in prev)) return prev
      const next = { ...prev }
      delete next[executionId]
      return next
    })
    delete executionCreatedAtRef.current[executionId]
  }, [])

  const executionOverlayMessages = useMemo<Message[]>(() => {
    const overlaidMessages: Message[] = []

    for (const executionId of activeExecutionIds) {
      const messages = executionMessagesById[executionId] ?? []
      for (const uiMessage of messages) {
        if (uiMessage.role !== 'assistant') continue

        const createdAt =
          uiMessage.metadata?.createdAt ??
          executionCreatedAtRef.current[uiMessage.id] ??
          (executionCreatedAtRef.current[uiMessage.id] = new Date().toISOString())

        overlaidMessages.push({
          id: uiMessage.id,
          role: 'assistant',
          assistantId: assistant.id,
          topicId: topic.id,
          createdAt,
          askId: currentAnchorUserMessageId,
          modelId: executionId,
          status:
            status === 'submitted'
              ? AssistantMessageStatus.PENDING
              : status === 'streaming'
                ? AssistantMessageStatus.PROCESSING
                : AssistantMessageStatus.SUCCESS,
          blocks: []
        })
      }
    }

    return overlaidMessages
  }, [activeExecutionIds, assistant.id, currentAnchorUserMessageId, executionMessagesById, status, topic.id])

  const mergedMessages = useMemo(
    () => [...adaptedMessages, ...executionOverlayMessages],
    [adaptedMessages, executionOverlayMessages]
  )

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const nextPartsMap = { ...partsMap }
    for (const executionId of activeExecutionIds) {
      for (const uiMessage of executionMessagesById[executionId] ?? []) {
        nextPartsMap[uiMessage.id] = uiMessage.parts as CherryMessagePart[]
      }
    }
    return nextPartsMap
  }, [activeExecutionIds, executionMessagesById, partsMap])

  /** Delete a single message (reparent children to grandparent) and sync UI. */
  const handleDeleteMessage = useCallback(
    async (id: string) => {
      try {
        await dataApiService.delete(`/messages/${id}`, { query: { cascade: false } })
        setMessages((msgs) => msgs.filter((m) => m.id !== id))
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'INVALID_OPERATION') {
          const result = await dataApiService.delete(`/messages/${id}`, { query: { cascade: true } })
          const deletedSet = new Set(result.deletedIds)
          setMessages((msgs) => msgs.filter((m) => !deletedSet.has(m.id)))
        } else {
          throw err
        }
      }
      logger.info('Deleted message', { id })
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

  /** Clear all messages for the current topic from DataApi and UI. */
  const handleClearTopicMessages = useCallback(async () => {
    const rootMsg = adaptedMessages.find((m: Message) => !m.askId)
    if (rootMsg) {
      await dataApiService.delete(`/messages/${rootMsg.id}`, { query: { cascade: true } })
      logger.info('Cleared all messages via root cascade delete', { topicId: topic.id, rootId: rootMsg.id })
    }
    setMessages([])
    await refresh()
  }, [adaptedMessages, refresh, setMessages, topic.id])

  /** Edit a message's parts directly and persist to DataApi. */
  const handleEditMessage = useCallback(
    async (messageId: string, editedParts: CherryMessagePart[]) => {
      await dataApiService.patch(`/messages/${messageId}`, { body: { data: { parts: editedParts } } })
      logger.info('Edited message', { messageId, partCount: editedParts.length })
      setMessages((msgs) =>
        msgs.map((m) => (m.id === messageId ? { ...m, parts: editedParts as CherryUIMessage['parts'] } : m))
      )
      await refresh()
    },
    [refresh, setMessages]
  )

  /** Synchronous capability flags derived from assistant config. */
  const capabilityBody = useMemo(
    () => ({
      knowledgeBaseIds: assistant.knowledge_bases?.map((kb) => kb.id),
      enableWebSearch: assistant.enableWebSearch,
      webSearchProviderId: assistant.webSearchProviderId,
      enableUrlContext: assistant.enableUrlContext,
      enableGenerateImage: assistant.enableGenerateImage
    }),
    [
      assistant.knowledge_bases,
      assistant.enableWebSearch,
      assistant.webSearchProviderId,
      assistant.enableUrlContext,
      assistant.enableGenerateImage
    ]
  )

  /** Regenerate with capability body injected. */
  const regenerateWithCapabilities = useCallback(
    async (messageId?: string) => {
      await regenerate({ messageId, body: capabilityBody })
    },
    [regenerate, capabilityBody]
  )

  const v2ChatOverrides = useMemo<V2ChatOverrides>(
    () => ({
      regenerate: async (messageId?: string) => regenerateWithCapabilities(messageId),
      resend: async (messageId?: string) => regenerateWithCapabilities(messageId),
      deleteMessage: handleDeleteMessage,
      deleteMessageGroup: handleDeleteMessageGroup,
      pause: stop,
      clearTopicMessages: handleClearTopicMessages,
      editMessage: handleEditMessage,
      refresh,
      requestStatus: status
    }),
    [
      regenerateWithCapabilities,
      handleDeleteMessage,
      handleDeleteMessageGroup,
      stop,
      handleClearTopicMessages,
      handleEditMessage,
      refresh,
      status
    ]
  )

  const handleSendV2 = useCallback(
    async (text: string, options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }) => {
      // Single-model only: pre-generate the assistant UUID and align all
      // three consumers on it (useChat.activeResponse, useChat.state.messages
      // after refresh, and the DB placeholder row). Multi-model turns keep
      // the old path — Main allocates N ids and the overlay renderer owns
      // per-execution state via `ExecutionStreamCollector`.
      const isMultiModel = (options?.mentionedModels?.length ?? 0) > 1
      const assistantMessageId = isMultiModel ? undefined : crypto.randomUUID()
      if (assistantMessageId) {
        prepareNextAssistantId(assistantMessageId)
      }
      void sendMessage(
        { text },
        {
          body: {
            parentAnchorId: activeNodeId ?? undefined,
            files: options?.files,
            mentionedModels: options?.mentionedModels,
            assistantMessageId,
            ...capabilityBody
          }
        }
      )
      // Append an empty assistant placeholder so the PENDING indicator shows
      // during the ~20–50ms gap between click and Main's `pending` broadcast.
      // The id matches Main's placeholder row, so the later `refresh` +
      // `setMessages(refreshed)` is an idempotent id-preserving replace.
      //
      // The append must wait ONE microtask: `sendMessage` awaits
      // `convertFileListToFileUIParts` (ai/src/ui/chat.ts:371) before
      // `pushMessage(user)`, even for text-only turns (async function yields
      // once). Appending synchronously lands the placeholder *before* the new
      // user message — `adaptedMessages` then derives its `askId` from the
      // prior turn's user, flashing the placeholder into the previous
      // multi-model siblings group until `pending` refresh repairs the order.
      if (assistantMessageId) {
        queueMicrotask(() => {
          setMessages((prev) => [...prev, { id: assistantMessageId, role: 'assistant', parts: [] }])
        })
      }
    },
    [activeNodeId, sendMessage, setMessages, prepareNextAssistantId, capabilityBody]
  )

  return (
    <V2ChatOverridesProvider value={v2ChatOverrides}>
      <RefreshProvider value={refresh}>
        <PartsProvider value={mergedPartsMap}>
          <ToolApprovalProvider value={respondToToolApproval}>
            <ChatContextBridge topic={topic}>
              <div
                className="flex flex-1 flex-col justify-between"
                style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                {isDev && (
                  <div
                    className="fixed top-5 right-50 z-50 px-4 py-1 text-xs opacity-50"
                    style={{ color: 'var(--color-text-3)' }}>
                    [V2] {status} | {mergedMessages.length} msgs
                    {error && <span className="ml-2 text-red-500">{error.message}</span>}
                  </div>
                )}

                {activeExecutionIds.map((executionId) => (
                  <ExecutionStreamCollector
                    key={executionId}
                    topicId={topic.id}
                    executionId={executionId}
                    onMessagesChange={handleExecutionMessagesChange}
                    onDispose={handleExecutionDispose}
                  />
                ))}

                <Messages
                  key={topic.id}
                  assistant={assistant}
                  topic={topic}
                  setActiveTopic={setActiveTopic}
                  messages={mergedMessages}
                />

                <Inputbar assistant={assistant} topic={topic} setActiveTopic={setActiveTopic} onSend={handleSendV2} />
              </div>
            </ChatContextBridge>
          </ToolApprovalProvider>
        </PartsProvider>
      </RefreshProvider>
    </V2ChatOverridesProvider>
  )
}

/**
 * Bridge component rendered INSIDE V2ChatOverridesProvider + PartsProvider
 * so that useChatContextProvider can access those contexts.
 */
const ChatContextBridge: FC<{ topic: Topic; children: ReactNode }> = ({ topic, children }) => {
  const chatContextValue = useChatContextProvider(topic)
  return (
    <ChatContextProvider value={chatContextValue}>
      {children}
      {chatContextValue.isMultiSelectMode && <MultiSelectActionPopup topic={topic} />}
    </ChatContextProvider>
  )
}

export default V2ChatContent

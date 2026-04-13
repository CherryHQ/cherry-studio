import { useChat } from '@ai-sdk/react'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { isDev } from '@renderer/config/constant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { type V2ChatOverrides, V2ChatOverridesProvider } from '@renderer/hooks/useMessageOperations'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import { fetchMcpTools } from '@renderer/services/ApiService'
import { mapLegacyTopicToDto } from '@renderer/services/AssistantService'
import { ensureTopicStreamStateSyncStarted } from '@renderer/services/topicStreamStateSync'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Assistant, FileMetadata, Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/assistant'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import Inputbar from './Inputbar/Inputbar'
import { PartsProvider, RefreshProvider } from './Messages/Blocks'
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
  const {
    adaptedMessages: historyMessages,
    partsMap: historyPartsMap,
    isLoading: isHistoryLoading,
    refresh
  } = useTopicMessagesV2(topic.id)

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
      historyMessages={historyMessages}
      historyPartsMap={historyPartsMap}
      refresh={refresh}
    />
  )
}

// ============================================================================
// Inner component — only mounted after history is ready
// ============================================================================

interface InnerProps extends Props {
  historyMessages: Message[]
  historyPartsMap: Record<string, CherryMessagePart[]>
  refresh: () => Promise<CherryUIMessage[]>
}

const V2ChatContentInner: FC<InnerProps> = ({
  assistant,
  topic,
  setActiveTopic,
  mainHeight,
  historyMessages,
  historyPartsMap,
  refresh
}) => {
  const { isMultiSelectMode } = useChatContext(topic)

  useEffect(() => {
    ensureTopicStreamStateSyncStarted()
  }, [])

  const {
    messages: streamingUIMessages,
    setMessages,
    stop,
    status,
    error,
    sendMessage,
    regenerate
  } = useChat<CherryUIMessage>({
    id: topic.id,
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (streamError) => {
      logger.error('AI stream error', { topicId: topic.id, streamError })
    }
  })

  useEffect(() => {
    const unsubscribe = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topic.id) return
      // Refresh history first, then clear live messages to avoid flash
      void refresh()
        .then(() => setMessages([]))
        .catch((err) => {
          logger.warn('Failed to refresh messages after stream done', { topicId: topic.id, err })
          setMessages([])
        })
    })
    return () => {
      unsubscribe()
    }
  }, [refresh, setMessages, topic.id])

  /** Delete a single message (reparent children to grandparent) and sync UI. */
  const handleDeleteMessage = useCallback(
    async (id: string) => {
      try {
        await dataApiService.delete(`/messages/${id}`, { query: { cascade: false } })
        setMessages((msgs) => msgs.filter((m) => m.id !== id))
      } catch (err: unknown) {
        // Root messages have no parent to reparent children to — fallback to cascade.
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
    const rootMsg = historyMessages.find((m) => !m.askId)
    if (rootMsg) {
      await dataApiService.delete(`/messages/${rootMsg.id}`, { query: { cascade: true } })
      logger.info('Cleared all messages via root cascade delete', { topicId: topic.id, rootId: rootMsg.id })
    }
    setMessages([])
    await refresh()
  }, [historyMessages, refresh, setMessages, topic.id])

  /** Edit a message's parts directly and persist to DataApi. */
  const handleEditMessage = useCallback(
    async (messageId: string, editedParts: CherryMessagePart[]) => {
      await dataApiService.patch(`/messages/${messageId}`, { body: { data: { parts: editedParts } } })
      logger.info('Edited message', { messageId, partCount: editedParts.length })
      await refresh()
    },
    [refresh]
  )

  // Live messages from useChat — only contains active streaming messages (no history)
  const liveUIMessages = streamingUIMessages

  // Stable timestamp cache — preserves createdAt across re-renders for each message ID
  const timestampCacheRef = useRef(new Map<string, string>())

  // Adapt live UIMessages to legacy Message[] for MessageGroup/MessageItem.
  const liveAdapted = useMemo<Message[]>(() => {
    const cache = timestampCacheRef.current
    const activeIds = new Set<string>()

    const messages = liveUIMessages.map((uiMsg) => {
      activeIds.add(uiMsg.id)
      let ts = cache.get(uiMsg.id)
      if (!ts) {
        ts = new Date().toISOString()
        cache.set(uiMsg.id, ts)
      }
      return {
        id: uiMsg.id,
        role: uiMsg.role,
        assistantId: assistant.id,
        topicId: topic.id,
        createdAt: ts,
        status:
          uiMsg.role === 'user'
            ? UserMessageStatus.SUCCESS
            : status === 'streaming' || status === 'submitted'
              ? AssistantMessageStatus.PROCESSING
              : AssistantMessageStatus.SUCCESS,
        blocks: []
      }
    })

    for (const key of cache.keys()) {
      if (!activeIds.has(key)) cache.delete(key)
    }

    return messages
  }, [liveUIMessages, assistant.id, topic.id, status])

  // Merge: history (authority) + live streaming (appended).
  // Merge history (from DataApi) + live (from useChat). Dedup by ID handles the
  // brief race window between onStreamDone setMessages([]) and SWR refresh.
  const adaptedMessages = useMemo<Message[]>(() => {
    if (liveAdapted.length === 0) return historyMessages
    const seen = new Set(historyMessages.map((m) => m.id))
    const deduped = liveAdapted.filter((m) => !seen.has(m.id))
    if (deduped.length === 0) return historyMessages
    return [...historyMessages, ...deduped]
  }, [historyMessages, liveAdapted])

  // PartsContext: history parts + live streaming parts overlay.
  // Live parts overlay on top — during active streaming they carry the latest content.
  // Stale temp-ID entries may briefly exist in the race window but are harmless:
  // adaptedMessages (which controls rendering) is already deduped by ID.
  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    if (liveUIMessages.length === 0) return historyPartsMap
    const map: Record<string, CherryMessagePart[]> = { ...historyPartsMap }
    for (const uiMsg of liveUIMessages) {
      map[uiMsg.id] = uiMsg.parts as CherryMessagePart[]
    }
    return map
  }, [historyPartsMap, liveUIMessages])

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

  /** Resolve MCP tool IDs asynchronously (requires IPC to list server tools). */
  const resolveMcpToolIds = useCallback(async (): Promise<string[] | undefined> => {
    if (!isPromptToolUse(assistant) && !isSupportedToolUse(assistant)) return undefined
    const tools = await fetchMcpTools(assistant)
    return tools.length > 0 ? tools.map((t) => t.id) : undefined
  }, [assistant.mcpServers, assistant.settings?.toolUseMode, assistant.model])

  /** Regenerate with capability body injected. */
  const regenerateWithCapabilities = useCallback(
    async (messageId?: string) => {
      const mcpToolIds = await resolveMcpToolIds()
      await regenerate({ messageId, body: { mcpToolIds, ...capabilityBody } })
    },
    [regenerate, resolveMcpToolIds, capabilityBody]
  )

  const v2ChatOverrides = useMemo<V2ChatOverrides>(
    () => ({
      regenerate: async (messageId?: string) => {
        if (messageId) {
          try {
            await dataApiService.delete(`/messages/${messageId}`, { query: { cascade: true } })
            const refreshed = await refresh()
            setMessages(refreshed)
          } catch (err) {
            logger.warn('Failed to clean up old message before regenerate', { messageId, err })
          }
        }
        // After deleting the assistant message, the old messageId no longer exists
        // in chat.messages. Pass undefined so AI SDK regenerates from the last
        // message (which is now the user message).
        await regenerateWithCapabilities()
      },
      resend: async (messageId?: string) => {
        if (messageId) {
          try {
            const msgs = streamingUIMessages
            const idx = msgs.findIndex((m) => m.id === messageId)
            const nextAssistant = idx >= 0 ? msgs[idx + 1] : undefined
            if (nextAssistant?.role === 'assistant') {
              await dataApiService.delete(`/messages/${nextAssistant.id}`, { query: { cascade: true } })
              const refreshed = await refresh()
              setMessages(refreshed)
            }
          } catch (err) {
            logger.warn('Failed to clean up old reply before resend', { messageId, err })
          }
        }
        await regenerateWithCapabilities(messageId)
      },
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
      streamingUIMessages,
      setMessages,
      handleDeleteMessage,
      handleDeleteMessageGroup,
      stop,
      handleClearTopicMessages,
      handleEditMessage,
      refresh,
      status
    ]
  )

  const ensuredTopicIds = useRef(new Set<string>())
  const ensureTopicExists = useCallback(async () => {
    if (ensuredTopicIds.current.has(topic.id)) return
    try {
      await dataApiService.get(`/topics/${topic.id}`)
    } catch (err: unknown) {
      if (err instanceof Object && 'code' in err && err.code === 'NOT_FOUND') {
        await dataApiService.post('/topics', { body: mapLegacyTopicToDto(topic) })
      } else {
        throw err
      }
    }
    ensuredTopicIds.current.add(topic.id)
  }, [topic])

  const handleSendV2 = useCallback(
    async (text: string, options?: { files?: FileMetadata[]; mentionedModels?: Model[] }) => {
      await ensureTopicExists()
      let mcpToolIds: string[] | undefined
      try {
        mcpToolIds = await resolveMcpToolIds()
      } catch (err) {
        logger.warn('Failed to resolve MCP tool IDs, proceeding without tools', { err })
      }
      const lastMessageId = historyMessages.at(-1)?.id
      void sendMessage(
        { text },
        {
          body: {
            parentAnchorId: lastMessageId,
            files: options?.files,
            mentionedModels: options?.mentionedModels,
            mcpToolIds,
            ...capabilityBody
          }
        }
      )
    },
    [ensureTopicExists, sendMessage, resolveMcpToolIds, capabilityBody, historyMessages]
  )

  return (
    <V2ChatOverridesProvider value={v2ChatOverrides}>
      <RefreshProvider value={refresh}>
        <PartsProvider value={partsMap}>
          <div
            className="flex flex-1 flex-col justify-between"
            style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
            {isDev && (
              <div
                className="fixed top-5 right-50 z-50 px-4 py-1 text-xs opacity-50"
                style={{ color: 'var(--color-text-3)' }}>
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

            <Inputbar assistant={assistant} topic={topic} setActiveTopic={setActiveTopic} onSend={handleSendV2} />
            {isMultiSelectMode && <MultiSelectActionPopup topic={topic} />}
          </div>
        </PartsProvider>
      </RefreshProvider>
    </V2ChatOverridesProvider>
  )
}

export default V2ChatContent

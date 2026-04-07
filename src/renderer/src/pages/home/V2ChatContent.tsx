import { isDev } from '@renderer/config/constant'
import { type CherryUIMessage, useAiChat } from '@renderer/hooks/useAiChat'
import { type V2ChatOverrides, V2ChatOverridesProvider } from '@renderer/hooks/useMessageOperations'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import { useV2MessageAdapter } from '@renderer/hooks/useV2MessageAdapter'
import type { Assistant, FileMetadata, Model, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'

import Inputbar from './Inputbar/Inputbar'
import { PartsProvider, V2BlockProvider } from './Messages/Blocks'
import Messages from './Messages/Messages'

interface Props {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  mainHeight: string
}

/**
 * V2 chat content area — replaces Messages + Inputbar when USE_V2_CHAT is enabled.
 *
 * Architecture (fixes for initialMessages race and metadata loss):
 *
 * Outer shell (V2ChatContent):
 *   - Loads history from DataApi via useTopicMessagesV2
 *   - Renders a loading skeleton until history is ready
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
    isLoading: isHistoryLoading
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
}

const V2ChatContentInner: FC<InnerProps> = ({
  assistant,
  topic,
  setActiveTopic,
  mainHeight,
  historyUIMessages,
  historyMessages,
  historyBlockMap,
  historyPartsMap
}) => {
  // Set of persisted message IDs — used to distinguish history vs. live messages
  const historyIds = useMemo(() => new Set(historyUIMessages.map((m) => m.id)), [historyUIMessages])

  // useAiChat now receives complete history as initialMessages (guaranteed non-loading)
  const {
    messages: streamingUIMessages,
    status,
    error,
    sendMessage,
    regenerate
  } = useAiChat({
    chatId: topic.id,
    topicId: topic.id,
    assistantId: assistant.id,
    initialMessages: historyUIMessages.length > 0 ? historyUIMessages : undefined
  })

  const v2ChatOverrides = useMemo<V2ChatOverrides>(
    () => ({
      regenerate: async (messageId?: string) => {
        await regenerate(messageId)
      },
      resend: async (messageId?: string) => {
        await regenerate(messageId)
      }
    }),
    [regenerate]
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
      sendMessage(
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

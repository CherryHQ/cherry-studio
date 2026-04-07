import { isDev } from '@renderer/config/constant'
import { useAiChat } from '@renderer/hooks/useAiChat'
import { type V2ChatOverrides, V2ChatOverridesProvider } from '@renderer/hooks/useMessageOperations'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import { useV2MessageAdapter } from '@renderer/hooks/useV2MessageAdapter'
import type { Assistant, FileMetadata, Model, Topic } from '@renderer/types'
import type { MessageBlock } from '@renderer/types/newMessage'
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
 * Data flow:
 * 1. useTopicMessagesV2 loads persisted messages from DataApi (parts format)
 * 2. useAiChat receives initialMessages for history context + handles live streaming
 * 3. useV2MessageAdapter converts streaming UIMessages to legacy format
 * 4. PartsContext provides raw parts (history + streaming merged)
 * 5. V2BlockContext provides legacy blocks (history + streaming merged)
 * 6. Messages/Blocks components read from these contexts
 */
const V2ChatContent: FC<Props> = ({ assistant, topic, setActiveTopic, mainHeight }) => {
  // Step 1: Load persisted history from DataApi
  const {
    uiMessages: historyUIMessages,
    adaptedMessages: historyMessages,
    blockMap: historyBlockMap,
    partsMap: historyPartsMap,
    isLoading: isHistoryLoading
  } = useTopicMessagesV2(topic.id)

  // Step 2: AI chat with history as initial messages
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

  // Step 3: Adapt streaming messages to legacy format
  const { messages: streamingAdapted, blockMap: streamingBlockMap } = useV2MessageAdapter(
    streamingUIMessages,
    status,
    topic.id,
    assistant.id
  )

  // Step 4: Merge history + streaming data
  // When streaming is active, useAiChat manages the full message list (including history).
  // So streamingUIMessages already contains history + new messages.
  // We use streaming adapted messages when available, history otherwise.
  const hasStreamingData = streamingUIMessages.length > 0
  const adaptedMessages = hasStreamingData ? streamingAdapted : historyMessages

  const blockMap = useMemo<Record<string, MessageBlock>>(() => {
    if (hasStreamingData) {
      // Streaming active: streaming blocks are authoritative (includes history via useAiChat)
      return { ...historyBlockMap, ...streamingBlockMap }
    }
    return historyBlockMap
  }, [hasStreamingData, historyBlockMap, streamingBlockMap])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = { ...historyPartsMap }
    // Overlay streaming parts (newer data takes precedence)
    for (const uiMsg of streamingUIMessages) {
      map[uiMsg.id] = uiMsg.parts as CherryMessagePart[]
    }
    return map
  }, [historyPartsMap, streamingUIMessages])

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
                [V2] {status} | {isHistoryLoading ? 'loading history...' : `${adaptedMessages.length} msgs`}
                {error && <span className="ml-2 text-red-500">{error.message}</span>}
              </div>
            )}

            {/* Messages receive adapted data directly — no Redux sync needed */}
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

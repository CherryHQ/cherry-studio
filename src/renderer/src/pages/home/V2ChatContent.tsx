import { isDev } from '@renderer/config/constant'
import { useAiChat } from '@renderer/hooks/useAiChat'
import { type V2ChatOverrides, V2ChatOverridesProvider } from '@renderer/hooks/useMessageOperations'
import { useV2MessageAdapter } from '@renderer/hooks/useV2MessageAdapter'
import type { Assistant, FileMetadata, Model, Topic } from '@renderer/types'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'

import Inputbar from './Inputbar/Inputbar'
import { V2BlockProvider } from './Messages/Blocks'
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
 * Messages receive adapted data via props (not Redux).
 * Block data is provided via V2BlockContext, bypassing Redux messageBlock slice.
 */
const V2ChatContent: FC<Props> = ({ assistant, topic, setActiveTopic, mainHeight }) => {
  const {
    messages: uiMessages,
    status,
    error,
    sendMessage,
    regenerate
  } = useAiChat({
    chatId: topic.id,
    topicId: topic.id,
    assistantId: assistant.id
  })

  const v2ChatOverrides = useMemo<V2ChatOverrides>(
    () => ({
      regenerate: async (messageId?: string) => {
        await regenerate(messageId)
      },
      resend: async (messageId?: string) => {
        // AI SDK regenerate handles both regenerate and resend —
        // it trims history at the given message and re-triggers the transport.
        await regenerate(messageId)
      }
    }),
    [regenerate]
  )

  const { messages: adaptedMessages, blockMap } = useV2MessageAdapter(uiMessages, status, topic.id, assistant.id)

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
      <V2BlockProvider value={blockMap}>
        <div
          className="flex flex-1 flex-col justify-between"
          style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
          {/* V2 status indicator — dev only */}
          {isDev && (
            <div className="shrink-0 border-b px-4 py-1 text-xs" style={{ color: 'var(--color-text-3)' }}>
              [V2] {status}
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
    </V2ChatOverridesProvider>
  )
}

export default V2ChatContent

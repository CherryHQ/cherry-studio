import { FONT_FAMILY } from '@renderer/config/constant'
import { useModel } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import MessageErrorBoundary from '@renderer/pages/home/Messages/MessageErrorBoundary'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultAssistant, getDefaultModel } from '@renderer/services/AssistantService'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { Chunk, ChunkType } from '@renderer/types/chunk'
// import { LegacyMessage } from '@renderer/types'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { isMiniWindow } from '@renderer/utils'
import { createAssistantMessage, createMainTextBlock } from '@renderer/utils/messageUtils/create'
import { Dispatch, FC, memo, SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props {
  message: Message
  index?: number
  total: number
  route: string
  onGetMessages?: () => Message[]
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
}

const getMessageBackground = (isBubbleStyle: boolean, isAssistantMessage: boolean) =>
  isBubbleStyle ? (isAssistantMessage ? 'transparent' : 'var(--chat-background-user)') : undefined

const MessageItem: FC<Props> = ({ message: _message, index, total, route, onSetMessages, onGetMessages }) => {
  const [message, setMessage] = useState(_message)
  const [textBlock, setTextBlock] = useState<MainTextMessageBlock | null>(null)
  const model = useModel(getMessageModelId(message))
  const isBubbleStyle = true
  const { messageFont, fontSize } = useSettings()
  const messageContainerRef = useRef<HTMLDivElement>(null)

  const isAssistantMessage = message.role === 'assistant'

  const fontFamily = useMemo(() => {
    return messageFont === 'serif' ? FONT_FAMILY.replace('sans-serif', 'serif').replace('Ubuntu, ', '') : FONT_FAMILY
  }, [messageFont])

  const messageBackground = getMessageBackground(true, isAssistantMessage)

  const maxWidth = isMiniWindow() ? '800px' : '100%'

  useEffect(() => {
    if (onGetMessages && onSetMessages) {
      if (message.status === AssistantMessageStatus.PROCESSING) {
        const messages = onGetMessages()
        const assistant = getDefaultAssistant()
        fetchChatCompletion({
          messages: messages
            .filter((m) => !m.status.includes('ing'))
            .slice(
              0,
              messages.findIndex((m) => m.id === message.id)
            ),
          assistant: { ...assistant, model: getDefaultModel() },
          onChunkReceived: (chunk: Chunk) => {
            if (chunk.type === ChunkType.TEXT_DELTA) {
              if (!textBlock) {
                const block = createMainTextBlock(message.id, chunk.text, { status: MessageBlockStatus.STREAMING })
                const assistantMessage = createAssistantMessage(assistant.id, message.topicId, {
                  blocks: [block.id]
                })
                setTextBlock(block)
                setMessage(assistantMessage)
              } else {
                setTextBlock((prev) => {
                  if (prev) {
                    return { ...prev, content: (prev?.content ?? '') + chunk.text }
                  }
                  return null
                })
              }
            }
          }
        })
      }
    }
  }, [message.status, message.topicId, textBlock, message.id, onGetMessages, onSetMessages])

  if (['summary', 'explanation'].includes(route) && index === total - 1) {
    return null
  }

  return (
    <MessageContainer
      key={message.id}
      ref={messageContainerRef}
      style={{ ...(isBubbleStyle ? { alignItems: isAssistantMessage ? 'start' : 'end' } : {}), maxWidth }}>
      <MessageContentContainer
        className="message-content-container"
        style={{
          fontFamily,
          fontSize,
          background: messageBackground,
          ...(isAssistantMessage ? { paddingLeft: 5, paddingRight: 5 } : {})
        }}>
        <MessageErrorBoundary>
          <MessageContent message={message} model={model} />
        </MessageErrorBoundary>
      </MessageContentContainer>
    </MessageContainer>
  )
}

const MessageContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  position: relative;
  transition: background-color 0.3s ease;
  &.message-highlight {
    background-color: var(--color-primary-mute);
  }
  .menubar {
    opacity: 0;
    transition: opacity 0.2s ease;
    &.show {
      opacity: 1;
    }
  }
  &:hover {
    .menubar {
      opacity: 1;
    }
  }
`

const MessageContentContainer = styled.div`
  max-width: 100%;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  margin-left: 46px;
  margin-top: 5px;
`

export default memo(MessageItem)

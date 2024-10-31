import { FONT_FAMILY } from '@renderer/config/constant'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModel } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { fetchChatCompletion } from '@renderer/services/api'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/event'
import { estimateMessageUsage } from '@renderer/services/tokens'
import { Message, Topic } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { Divider } from 'antd'
import { Dispatch, FC, memo, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageContent from './MessageContent'
import MessageHeader from './MessageHeader'
import MessageMenubar from './MessageMenubar'
import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  topic?: Topic
  index?: number
  total?: number
  hidePresetMessages?: boolean
  onGetMessages?: () => Message[]
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
  onDeleteMessage?: (message: Message) => void
}

const MessageItem: FC<Props> = ({
  message: _message,
  topic,
  index,
  hidePresetMessages,
  onDeleteMessage,
  onSetMessages,
  onGetMessages
}) => {
  const [message, setMessage] = useState(_message)
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const model = useModel(message.modelId)
  const { showMessageDivider, messageFont, fontSize } = useSettings()
  const messageContainerRef = useRef<HTMLDivElement>(null)

  const isLastMessage = index === 0
  const isAssistantMessage = message.role === 'assistant'
  const showMenubar = !message.status.includes('ing')

  const fontFamily = useMemo(() => {
    return messageFont === 'serif' ? FONT_FAMILY.replace('sans-serif', 'serif').replace('Ubuntu, ', '') : FONT_FAMILY
  }, [messageFont])

  const messageBorder = showMessageDivider ? undefined : 'none'

  const onEditMessage = useCallback(
    (msg: Message) => {
      setMessage(msg)
      const messages = onGetMessages?.().map((m) => (m.id === message.id ? message : m))
      messages && onSetMessages?.(messages)
      topic && db.topics.update(topic.id, { messages })
    },
    [message, onGetMessages, onSetMessages, topic]
  )

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, (highlight: boolean = true) => {
        if (messageContainerRef.current) {
          messageContainerRef.current.scrollIntoView({ behavior: 'smooth' })
          if (highlight) {
            setTimeout(() => {
              const classList = messageContainerRef.current?.classList
              classList?.add('message-highlight')
              setTimeout(() => classList?.remove('message-highlight'), 2500)
            }, 500)
          }
        }
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [message])

  useEffect(() => {
    if (message.role === 'user' && !message.usage) {
      runAsyncFunction(async () => {
        const usage = await estimateMessageUsage(message)
        setMessage({ ...message, usage })
        const topic = await db.topics.get({ id: message.topicId })
        const messages = topic?.messages.map((m) => (m.id === message.id ? { ...m, usage } : m))
        db.topics.update(message.topicId, { messages })
      })
    }
  }, [message])

  useEffect(() => {
    if (topic && onGetMessages && onSetMessages) {
      if (message.status === 'sending' && index === 0) {
        const messages = onGetMessages()
        fetchChatCompletion({
          message,
          messages: messages.filter((m) => !m.status.includes('ing')),
          assistant,
          topic,
          onResponse: (msg) => {
            setMessage(msg)
            if (msg.status !== 'pending') {
              const _messages = messages.map((m) => (m.id === msg.id ? msg : m))
              onSetMessages(_messages)
              db.topics.update(topic.id, { messages: _messages })
            }
          }
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (hidePresetMessages && message.isPreset) {
    return null
  }

  if (message.type === 'clear') {
    return (
      <Divider dashed style={{ padding: '0 20px' }} plain>
        {t('chat.message.new.context')}
      </Divider>
    )
  }

  return (
    <MessageContainer
      key={message.id}
      className="message"
      ref={messageContainerRef}
      style={{
        alignItems: isAssistantMessage ? 'start' : 'end'
      }}>
      <MessageHeader message={message} assistant={assistant} model={model} />
      <MessageContentContainer
        style={{
          fontFamily,
          fontSize,
          background: isAssistantMessage ? 'var(--chat-background-assistant)' : 'var(--chat-background-user)'
        }}>
        <MessageContent message={message} model={model} />
        {showMenubar && (
          <MessageFooter style={{ border: messageBorder }}>
            <MessageMenubar
              message={message}
              model={model}
              index={index}
              isLastMessage={isLastMessage}
              isAssistantMessage={isAssistantMessage}
              setModel={setModel}
              onEditMessage={onEditMessage}
              onDeleteMessage={onDeleteMessage}
            />
            <MessageTokens message={message} isLastMessage={isLastMessage} />
          </MessageFooter>
        )}
      </MessageContentContainer>
    </MessageContainer>
  )
}

const MessageContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 15px 20px 0 20px;
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
  margin: 5px 0;
  border-radius: 8px;
  padding: 10px 15px 0 15px;
`

const MessageFooter = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  margin-top: 2px;
  border-top: 0.5px dashed var(--color-border);
  gap: 20px;
`

export default memo(MessageItem)

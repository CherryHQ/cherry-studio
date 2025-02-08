import { FONT_FAMILY } from '@renderer/config/constant'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModel } from '@renderer/hooks/useModel'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { estimateMessageUsage } from '@renderer/services/TokenService'
import { Message, Topic } from '@renderer/types'
import { classNames, runAsyncFunction } from '@renderer/utils'
import { Divider } from 'antd'
import { Dispatch, FC, memo, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageContent from './MessageContent'
import MessageErrorBoundary from './MessageErrorBoundary'
import MessageHeader from './MessageHeader'
import MessageMenubar from './MessageMenubar'
import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  topic?: Topic
  index?: number
  total?: number
  hidePresetMessages?: boolean
  style?: React.CSSProperties
  isGrouped?: boolean
  onGetMessages?: () => Message[]
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
  onDeleteMessage?: (message: Message) => Promise<void>
}

const getMessageBackground = (isBubbleStyle: boolean, isAssistantMessage: boolean) => {
  return isBubbleStyle
    ? isAssistantMessage
      ? 'var(--chat-background-assistant)'
      : 'var(--chat-background-user)'
    : undefined
}

const MessageItem: FC<Props> = ({
  message: _message,
  topic,
  index,
  hidePresetMessages,
  isGrouped,
  style,
  onDeleteMessage,
  onSetMessages,
  onGetMessages
}) => {
  const [message, setMessage] = useState(_message)
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const model = useModel(getMessageModelId(message)) || message.model
  const { isBubbleStyle } = useMessageStyle()
  const { showMessageDivider, messageFont, fontSize } = useSettings()
  const messageContainerRef = useRef<HTMLDivElement>(null)

  const isLastMessage = index === 0
  const isAssistantMessage = message.role === 'assistant'

  const showMenubar = !message.status.includes('ing')

  const fontFamily = useMemo(() => {
    return messageFont === 'serif' ? FONT_FAMILY.replace('sans-serif', 'serif').replace('Ubuntu, ', '') : FONT_FAMILY
  }, [messageFont])

  const messageBorder = showMessageDivider ? undefined : 'none'
  const messageBackground = getMessageBackground(isBubbleStyle, isAssistantMessage)

  const onEditMessage = useCallback(
    (msg: Message) => {
      setMessage(msg)
      const messages = onGetMessages?.()?.map((m) => (m.id === message.id ? msg : m))
      messages && onSetMessages?.(messages)
      topic && db.topics.update(topic.id, { messages })
    },
    [message.id, onGetMessages, onSetMessages, topic]
  )

  const messageHighlightHandler = (highlight: boolean = true) => {
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
  }

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, messageHighlightHandler),
      EventEmitter.on(EVENT_NAMES.RESEND_MESSAGE + ':' + message.id, onEditMessage)
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [message, onEditMessage])

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
      if (message.status === 'sending') {
        const messages = onGetMessages()
        const assistantWithModel = message.model ? { ...assistant, model: message.model } : assistant

        fetchChatCompletion({
          message,
          messages: messages
            .filter((m) => !m.status.includes('ing'))
            .slice(
              0,
              messages.findIndex((m) => m.id === message.id)
            ),
          assistant: assistantWithModel,
          onResponse: (msg) => {
            setMessage(msg)
            if (msg.status !== 'pending') {
              const _messages = onGetMessages().map((m) => (m.id === msg.id ? msg : m))
              onSetMessages(_messages)
              db.topics.update(topic.id, { messages: _messages })
            }
          }
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.status])

  if (hidePresetMessages && message.isPreset) {
    return null
  }

  if (message.type === 'clear') {
    return (
      <NewContextMessage onClick={() => EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)}>
        <Divider dashed style={{ padding: '0 20px' }} plain>
          {t('chat.message.new.context')}
        </Divider>
      </NewContextMessage>
    )
  }

  return (
    <MessageContainer
      key={message.id}
      className={classNames({
        message: true,
        'message-assistant': isAssistantMessage,
        'message-user': !isAssistantMessage
      })}
      ref={messageContainerRef}
      style={{ ...style, alignItems: isBubbleStyle ? (isAssistantMessage ? 'start' : 'end') : undefined }}>
      <MessageHeader message={message} assistant={assistant} model={model} key={getMessageModelId(message)} />
      <MessageContentContainer
        className="message-content-container"
        style={{ fontFamily, fontSize, background: messageBackground }}>
        <MessageErrorBoundary>
          <MessageContent message={message} model={model} />
        </MessageErrorBoundary>
        {showMenubar && (
          <MessageFooter
            style={{
              border: messageBorder,
              flexDirection: isLastMessage || isBubbleStyle ? 'row-reverse' : undefined
            }}>
            <MessageTokens message={message} isLastMessage={isLastMessage} />
            <MessageMenubar
              message={message}
              assistantModel={assistant?.model}
              model={model}
              index={index}
              isLastMessage={isLastMessage}
              isAssistantMessage={isAssistantMessage}
              isGrouped={isGrouped}
              setModel={setModel}
              onEditMessage={onEditMessage}
              onDeleteMessage={onDeleteMessage}
              onGetMessages={onGetMessages}
            />
          </MessageFooter>
        )}
      </MessageContentContainer>
    </MessageContainer>
  )
}

const MessageContainer = styled.div`
  display: flex;
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

const MessageFooter = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  margin-top: 2px;
  border-top: 1px dotted var(--color-border);
  gap: 20px;
`

const NewContextMessage = styled.div`
  cursor: pointer;
`

export default memo(MessageItem)

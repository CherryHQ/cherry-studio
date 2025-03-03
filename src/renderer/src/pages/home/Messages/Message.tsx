import { FONT_FAMILY } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModel } from '@renderer/hooks/useModel'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { useTopic } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getContextCount, getMessageModelId } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { estimateHistoryTokens, estimateMessageUsage } from '@renderer/services/TokenService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { updateMessages } from '@renderer/store/messages'
import { Message, Topic } from '@renderer/types'
import { classNames, runAsyncFunction } from '@renderer/utils'
import { Divider } from 'antd'
import { Dispatch, FC, memo, SetStateAction, useCallback, useEffect, useMemo, useRef } from 'react'
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
  topic: _topic,
  index,
  hidePresetMessages,
  isGrouped,
  style,
  onDeleteMessage,
  onSetMessages,
  onGetMessages
}) => {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(_message.assistantId)
  const model = useModel(getMessageModelId(_message), _message.model?.provider) || _message.model
  const { isBubbleStyle } = useMessageStyle()
  const { showMessageDivider, messageFont, fontSize } = useSettings()
  const messageContainerRef = useRef<HTMLDivElement>(null)
  const topic = useTopic(assistant, _topic?.id)

  // Get message from Redux store
  const message = useAppSelector((state) => {
    const topicMessages = state.messages.messagesByTopic[_message.topicId]
    if (!topicMessages) return _message

    const messages = [...topicMessages.userMessages, ...topicMessages.assistantMessages]
    return messages.find((m) => m.id === _message.id) || _message
  })

  const isLastMessage = index === 0
  const isAssistantMessage = message.role === 'assistant'
  const showMenubar = !message.status.includes('ing')

  const fontFamily = useMemo(() => {
    return messageFont === 'serif' ? FONT_FAMILY.replace('sans-serif', 'serif').replace('Ubuntu, ', '') : FONT_FAMILY
  }, [messageFont])

  const messageBorder = showMessageDivider ? undefined : 'none'
  const messageBackground = getMessageBackground(isBubbleStyle, isAssistantMessage)

  const onEditMessage = useCallback(
    async (msg: Message) => {
      const usage = await estimateMessageUsage(msg)
      const updatedMessage = { ...msg, usage }

      if (topic) {
        await dispatch(
          updateMessages(topic, onGetMessages?.()?.map((m) => (m.id === message.id ? updatedMessage : m)) || [])
        )
      }

      const tokensCount = await estimateHistoryTokens(assistant, onGetMessages?.() || [])
      const contextCount = getContextCount(assistant, onGetMessages?.() || [])
      EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, { tokensCount, contextCount })
    },
    [message.id, onGetMessages, topic, assistant, dispatch]
  )

  const messageHighlightHandler = useCallback((highlight: boolean = true) => {
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
  }, [])

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, messageHighlightHandler),
      EventEmitter.on(EVENT_NAMES.RESEND_MESSAGE + ':' + message.id, onEditMessage)
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [message.id, messageHighlightHandler, onEditMessage])

  useEffect(() => {
    if (message.role === 'user' && !message.usage && topic) {
      runAsyncFunction(async () => {
        const usage = await estimateMessageUsage(message)
        if (topic) {
          await dispatch(
            updateMessages(topic, onGetMessages?.()?.map((m) => (m.id === message.id ? { ...m, usage } : m)) || [])
          )
        }
      })
    }
  }, [message, topic, dispatch, onGetMessages])

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
      <MessageHeader message={message} assistant={assistant} model={model} key={getModelUniqId(model)} />
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
              messageContainerRef={messageContainerRef}
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
  padding: 0 20px;
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
  overflow-y: auto;
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

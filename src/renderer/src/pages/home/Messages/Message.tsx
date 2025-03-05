import { FONT_FAMILY } from '@renderer/config/constant'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModel } from '@renderer/hooks/useModel'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { useTopic } from '@renderer/hooks/useTopic'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getContextCount, getMessageModelId } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { estimateHistoryTokens, estimateMessageUsage } from '@renderer/services/TokenService'
import { Message, Topic } from '@renderer/types'
import { classNames, runAsyncFunction } from '@renderer/utils'
import { Divider, Dropdown } from 'antd'
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
  const [message, setMessage] = useState(_message)
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const model = useModel(getMessageModelId(message), message.model?.provider) || message.model
  const { isBubbleStyle } = useMessageStyle()
  const { showMessageDivider, messageFont, fontSize } = useSettings()
  const messageContainerRef = useRef<HTMLDivElement>(null)
  const topic = useTopic(assistant, _topic?.id)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedQuoteText, setSelectedQuoteText] = useState<string>('')
  const [selectedText, setSelectedText] = useState<string>('')

  const isLastMessage = index === 0
  const isAssistantMessage = message.role === 'assistant'

  const showMenubar = !message.status.includes('ing')

  const fontFamily = useMemo(() => {
    return messageFont === 'serif' ? FONT_FAMILY.replace('sans-serif', 'serif').replace('Ubuntu, ', '') : FONT_FAMILY
  }, [messageFont])

  const messageBorder = showMessageDivider ? undefined : 'none'
  const messageBackground = getMessageBackground(isBubbleStyle, isAssistantMessage)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const _selectedText = window.getSelection()?.toString()
    if (_selectedText) {
      const quotedText =
        _selectedText
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n') + '\n-------------'
      setSelectedQuoteText(quotedText)
      setContextMenuPosition({ x: e.clientX, y: e.clientY })
      setSelectedText(_selectedText)
    }
  }, [])

  useEffect(() => {
    const handleClick = () => {
      setContextMenuPosition(null)
    }
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('click', handleClick)
    }
  }, [])

  const onEditMessage = useCallback(
    async (msg: Message) => {
      if (msg.role === 'user') {
        const usage = await estimateMessageUsage(msg)
        msg.usage = usage
      }

      setMessage(msg)
      const messages = onGetMessages?.()?.map((m) => (m.id === message.id ? msg : m))
      messages && onSetMessages?.(messages)
      topic && db.topics.update(topic.id, { messages })

      if (messages) {
        const tokensCount = await estimateHistoryTokens(assistant, messages)
        const contextCount = getContextCount(assistant, messages)
        EventEmitter.emit(EVENT_NAMES.ESTIMATED_TOKEN_COUNT, { tokensCount, contextCount })
      }
    },
    [message.id, onGetMessages, onSetMessages, topic, assistant]
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

        if (topic.prompt) {
          assistantWithModel.prompt = assistantWithModel.prompt
            ? `${assistantWithModel.prompt}\n${topic.prompt}`
            : topic.prompt
        }

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
      onContextMenu={handleContextMenu}
      style={{ ...style, alignItems: isBubbleStyle ? (isAssistantMessage ? 'start' : 'end') : undefined }}>
      {contextMenuPosition && (
        <ContextMenuOverlay style={{ left: contextMenuPosition.x, top: contextMenuPosition.y, zIndex: 1000 }}>
          <Dropdown
            menu={{ items: getContextMenuItems(t, selectedQuoteText, selectedText) }}
            open={true}
            trigger={['contextMenu']}>
            <div />
          </Dropdown>
        </ContextMenuOverlay>
      )}
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

const getMessageBackground = (isBubbleStyle: boolean, isAssistantMessage: boolean) => {
  return isBubbleStyle
    ? isAssistantMessage
      ? 'var(--chat-background-assistant)'
      : 'var(--chat-background-user)'
    : undefined
}

const getContextMenuItems = (t: (key: string) => string, selectedQuoteText: string, selectedText: string) => [
  {
    key: 'copy',
    label: t('common.copy'),
    onClick: () => {
      navigator.clipboard.writeText(selectedText)
      window.message.success({ content: t('message.copied'), key: 'copy-message' })
    }
  },
  {
    key: 'quote',
    label: t('chat.message.quote'),
    onClick: () => {
      EventEmitter.emit(EVENT_NAMES.QUOTE_TEXT, selectedQuoteText)
    }
  }
]

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

const ContextMenuOverlay = styled.div`
  position: fixed;
`

export default memo(MessageItem)

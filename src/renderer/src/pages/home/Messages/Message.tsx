import { FONT_FAMILY } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModel } from '@renderer/hooks/useModel'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getMessageModelId } from '@renderer/services/MessagesService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Assistant, Message, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
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
  topic: Topic
  assistant?: Assistant
  index?: number
  total?: number
  hidePresetMessages?: boolean
  style?: React.CSSProperties
  isGrouped?: boolean
  isStreaming?: boolean
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
}

const MessageItem: FC<Props> = ({
  message,
  topic,
  // assistant,
  index,
  hidePresetMessages,
  isGrouped,
  isStreaming = false,
  style
}) => {
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const model = useModel(getMessageModelId(message), message.model?.provider) || message.model
  const { isBubbleStyle } = useMessageStyle()
  const { showMessageDivider, messageFont, fontSize } = useSettings()
  const messageContainerRef = useRef<HTMLDivElement>(null)
  // const topic = useTopic(assistant, _topic?.id)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedQuoteText, setSelectedQuoteText] = useState<string>('')
  const [selectedText, setSelectedText] = useState<string>('')

  const isLastMessage = index === 0
  const isAssistantMessage = message.role === 'assistant'
  const showMenubar = !isStreaming && !message.status.includes('ing')

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
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, messageHighlightHandler)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [message.id, messageHighlightHandler])

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
              assistant={assistant}
              model={model}
              index={index}
              topic={topic}
              isLastMessage={isLastMessage}
              isAssistantMessage={isAssistantMessage}
              isGrouped={isGrouped}
              messageContainerRef={messageContainerRef}
              setModel={setModel}
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
  transform: translateZ(0);
  will-change: transform;
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

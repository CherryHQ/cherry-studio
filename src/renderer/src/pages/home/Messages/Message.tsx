import { FONT_FAMILY } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useModel } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/event'
import { Message } from '@renderer/types'
import { Divider } from 'antd'
import { FC, memo, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageContent from './MessageContent'
import MessageHeader from './MessageHeader'
import MessageMenubar from './MessageMenubar'
import MessgeTokens from './MessageTokens'

interface Props {
  message: Message
  index?: number
  total?: number
  lastMessage?: boolean
  showMenu?: boolean
  hidePresetMessages?: boolean
  onEditMessage?: (message: Message) => void
  onDeleteMessage?: (message: Message) => void
}

const MessageItem: FC<Props> = ({
  message,
  index,
  lastMessage,
  showMenu = true,
  hidePresetMessages,
  onEditMessage,
  onDeleteMessage
}) => {
  const { t } = useTranslation()
  const { assistant, setModel } = useAssistant(message.assistantId)
  const model = useModel(message.modelId)
  const { showMessageDivider, messageFont, fontSize } = useSettings()
  const messageRef = useRef<HTMLDivElement>(null)

  const isLastMessage = lastMessage || index === 0
  const isAssistantMessage = message.role === 'assistant'

  const fontFamily = useMemo(() => {
    return messageFont === 'serif' ? FONT_FAMILY.replace('sans-serif', 'serif').replace('Ubuntu, ', '') : FONT_FAMILY
  }, [messageFont])

  const messageBorder = showMessageDivider ? undefined : 'none'

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id, (highlight: boolean = true) => {
        if (messageRef.current) {
          messageRef.current.scrollIntoView({ behavior: 'smooth' })
          if (highlight) {
            setTimeout(() => {
              messageRef.current?.classList.add('message-highlight')
              setTimeout(() => {
                messageRef.current?.classList.remove('message-highlight')
              }, 2500)
            }, 500)
          }
        }
      })
    ]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [message])

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
    <MessageContainer key={message.id} className="message" ref={messageRef}>
      <MessageHeader message={message} assistant={assistant} model={model} />
      <MessageContentContainer style={{ fontFamily, fontSize }}>
        <MessageContent message={message} model={model} />
        {!lastMessage && showMenu && (
          <MessageFooter style={{ border: messageBorder, flexDirection: isLastMessage ? 'row-reverse' : undefined }}>
            <MessgeTokens message={message} isLastMessage={isLastMessage} />
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
  border-top: 0.5px dashed var(--color-border);
`

export default memo(MessageItem)

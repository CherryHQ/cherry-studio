import { useSettings } from '@renderer/hooks/useSettings'
// import MessageContent from './MessageContent'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import MessageErrorBoundary from '@renderer/pages/home/Messages/MessageErrorBoundary'
// import { LegacyMessage } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { classNames } from '@renderer/utils'
import { FC, memo, useRef } from 'react'
import styled from 'styled-components'

interface Props {
  message: Message
  index?: number
  total: number
  route: string
}

const getMessageBackground = (isBubbleStyle: boolean, isAssistantMessage: boolean) =>
  isBubbleStyle ? (isAssistantMessage ? 'transparent' : 'var(--chat-background-user)') : undefined

const MessageItem: FC<Props> = ({ message, index, total, route }) => {
  // const [message, setMessage] = useState(_message)
  // const [bl, setTextBlock] = useState<MainTextMessageBlock | null>(null)
  // const model = useModel(getMessageModelId(message))
  const { messageFont, fontSize } = useSettings()
  const messageContainerRef = useRef<HTMLDivElement>(null)

  const isAssistantMessage = message.role === 'assistant'

  const messageBackground = getMessageBackground(true, isAssistantMessage)

  const maxWidth = '800px'

  if (['summary', 'explanation'].includes(route) && index === total - 1) {
    return null
  }

  return (
    <MessageContainer
      key={message.id}
      ref={messageContainerRef}
      className={classNames({
        message: true,
        'message-assistant': isAssistantMessage,
        'message-user': !isAssistantMessage
      })}
      style={{ maxWidth }}>
      <MessageContentContainer
        className="message-content-container"
        style={{
          fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
          fontSize,
          background: messageBackground
        }}>
        <MessageErrorBoundary>
          <MessageContent message={message} />
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
  margin-top: 20px;
`

export default memo(MessageItem)

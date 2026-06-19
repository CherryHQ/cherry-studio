import { usePreference } from '@data/hooks/usePreference'
import { MessageContent, MessageErrorBoundary, type MessageListItem } from '@renderer/components/chat/messages'
// import { LegacyMessage } from '@renderer/types'
import { cn } from '@renderer/utils/style'
import type { FC } from 'react'
import { memo, useRef } from 'react'

interface Props {
  message: MessageListItem
  index?: number
  total: number
  route: string
}

const getMessageBackground = (isBubbleStyle: boolean, isAssistantMessage: boolean) =>
  isBubbleStyle ? (isAssistantMessage ? 'transparent' : 'var(--color-muted)') : undefined

const MessageItem: FC<Props> = ({ message, index, total, route }) => {
  // const [message, setMessage] = useState(_message)
  // const [bl, setTextBlock] = useState<MainTextMessageBlock | null>(null)
  // const model = useModel(getMessageModelId(message))
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const messageContainerRef = useRef<HTMLDivElement>(null)

  const isAssistantMessage = message.role === 'assistant'

  const messageBackground = getMessageBackground(true, isAssistantMessage)

  const maxWidth = '800px'

  if (['summary', 'explanation'].includes(route) && index === total - 1) {
    return null
  }

  return (
    <div
      key={message.id}
      ref={messageContainerRef}
      className={cn(
        'message flex w-full flex-col transition-colors duration-300 [&.message-highlight]:bg-primary/10 [&_.menubar.show]:opacity-100 [&_.menubar]:opacity-0 [&_.menubar]:transition-opacity hover:[&_.menubar]:opacity-100',
        isAssistantMessage ? 'message-assistant' : 'message-user'
      )}
      style={{ maxWidth }}>
      <div
        className="message-content-container mt-5 flex max-w-full flex-1 flex-col justify-between"
        style={{
          fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
          fontSize,
          background: messageBackground
        }}>
        <MessageErrorBoundary>
          <MessageContent message={message} />
        </MessageErrorBoundary>
      </div>
    </div>
  )
}

export default memo(MessageItem)

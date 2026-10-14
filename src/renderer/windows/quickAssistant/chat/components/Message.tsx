import type { FC } from 'react'
import { memo, useRef } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import MessageContent from '@renderer/components/chat/messages/frame/MessageContent'
import MessageErrorBoundary from '@renderer/components/chat/messages/frame/MessageErrorBoundary'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
// import { LegacyMessage } from '@renderer/types'
import { cn } from '@renderer/utils/style'

interface Props {
  message: MessageListItem
  index?: number
  total: number
  route: string
}

const MessageItem: FC<Props> = ({ message, index, total, route }) => {
  // const [message, setMessage] = useState(_message)
  // const [bl, setTextBlock] = useState<MainTextMessageBlock | null>(null)
  // const model = useModel(getMessageModelId(message))
  const [messageFont] = usePreference('chat.message.font')
  const [fontSize] = usePreference('chat.message.font_size')
  const messageContainerRef = useRef<HTMLDivElement>(null)

  const isAssistantMessage = message.role === 'assistant'

  const maxWidth = '800px'

  if (['summary', 'explanation'].includes(route) && index === total - 1) {
    return null
  }

  return (
    <div
      key={message.id}
      ref={messageContainerRef}
      className={cn(
        'message flex w-full flex-col transition-colors duration-300 [&_.menubar]:opacity-0 [&_.menubar]:transition-opacity hover:[&_.menubar]:opacity-100 [&_.menubar.show]:opacity-100 [&.message-highlight]:bg-primary/10',
        isAssistantMessage ? 'message-assistant' : 'message-user items-end'
      )}
      style={{ maxWidth }}>
      <div
        className={cn(
          'message-content-container mt-5 flex max-w-full flex-col justify-between',
          isAssistantMessage ? 'w-full' : 'rounded-[10px] bg-muted px-4 py-2.5'
        )}
        style={{
          fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
          fontSize
        }}>
        <MessageErrorBoundary>
          <MessageContent message={message} />
        </MessageErrorBoundary>
      </div>
    </div>
  )
}

export default memo(MessageItem)

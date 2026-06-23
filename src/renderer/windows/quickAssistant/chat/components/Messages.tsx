import { Scrollbar } from '@cherrystudio/ui'
import { MessageContentProvider, type MessageListItem } from '@renderer/components/chat/messages'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import type { Assistant } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Loader2 } from 'lucide-react'
import type { FC } from 'react'

import MessageItem from './Message'

interface Props {
  assistant: Assistant | null
  route: string
  isOutputted: boolean
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const Messages: FC<Props> = ({ assistant, route, isOutputted, messages, partsByMessageId }) => {
  const { renderConfig } = useMessageListRenderConfig()
  const platformActions = useMessagePlatformActions()

  return (
    <MessageContentProvider
      messages={messages}
      partsByMessageId={partsByMessageId}
      renderConfig={renderConfig}
      actions={platformActions}>
      <Scrollbar
        id="messages"
        key={assistant?.id ?? 'runtime-default'}
        className="flex min-w-full flex-col-reverse items-center overflow-x-hidden bg-transparent! pb-5">
        {!isOutputted && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {[...messages].reverse().map((message, index) => (
          <MessageItem key={message.id} message={message} index={index} total={messages.length} route={route} />
        ))}
      </Scrollbar>
    </MessageContentProvider>
  )
}

export default Messages

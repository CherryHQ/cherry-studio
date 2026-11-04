import { Loader2 } from 'lucide-react'
import type { FC } from 'react'

import { ScrollArea } from '@cherrystudio/ui'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import { MessageContentProvider } from '@renderer/components/chat/messages/MessageContentProvider'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { Assistant } from '@renderer/types/assistant'
import type { CherryMessagePart } from '@shared/data/types/message'

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
      <ScrollArea
        viewportProps={{ id: 'messages', className: 'flex flex-col-reverse overflow-x-hidden pb-5' }}
        contentProps={{ className: 'flex shrink-0 flex-col-reverse items-center' }}
        key={assistant?.id ?? 'runtime-default'}
        className="w-full flex-1 bg-transparent!">
        {!isOutputted && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {[...messages].reverse().map((message, index) => (
          <MessageItem key={message.id} message={message} index={index} total={messages.length} route={route} />
        ))}
      </ScrollArea>
    </MessageContentProvider>
  )
}

export default Messages

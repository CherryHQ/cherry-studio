import type { FC } from 'react'

import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { Assistant } from '@renderer/types/assistant'
import { cn } from '@renderer/utils/style'
import type { CherryMessagePart } from '@shared/data/types/message'

import Messages from './components/Messages'

interface Props {
  draggable: boolean
  route: string
  assistant: Assistant | null
  isOutputted: boolean
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const ChatWindow: FC<Props> = ({ draggable, route, assistant, isOutputted, messages, partsByMessageId }) => {
  return (
    <div className="bubble mb-auto flex min-h-0 max-h-full w-full flex-col bg-transparent! [-webkit-app-region:no-drag]">
      <div className={cn('h-1.5 w-full shrink-0', draggable && 'drag')} aria-hidden="true" />
      <Messages
        assistant={assistant}
        route={route}
        isOutputted={isOutputted}
        messages={messages}
        partsByMessageId={partsByMessageId}
      />
    </div>
  )
}

export default ChatWindow

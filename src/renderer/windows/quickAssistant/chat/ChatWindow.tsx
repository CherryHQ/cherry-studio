import type { FC } from 'react'

import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { Assistant } from '@renderer/types/assistant'
import type { CherryMessagePart } from '@shared/data/types/message'

import Messages from './components/Messages'

interface Props {
  route: string
  assistant: Assistant | null
  isOutputted: boolean
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

const ChatWindow: FC<Props> = ({ route, assistant, isOutputted, messages, partsByMessageId }) => {
  return (
    <div className="bubble mb-auto flex min-h-0 max-h-full w-full flex-col bg-transparent! [-webkit-app-region:no-drag]">
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
